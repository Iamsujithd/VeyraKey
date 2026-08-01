import { describe, expect, it, vi } from "vitest";
import { createWebAuthnPrfProvider, type WebAuthnPrfPlatform } from "./index";

function credential(
  rawId: Uint8Array,
  extensionResults: Record<string, unknown>,
): PublicKeyCredential {
  return {
    getClientExtensionResults: () => extensionResults,
    rawId: rawId.buffer.slice(rawId.byteOffset, rawId.byteOffset + rawId.byteLength),
    type: "public-key",
  } as unknown as PublicKeyCredential;
}

function supportedPlatform() {
  const output = Uint8Array.from({ length: 32 }, (_, index) => index + 10);
  const create = vi.fn(async (_options: CredentialCreationOptions) =>
    credential(Uint8Array.of(1, 2, 3, 4), { prf: { enabled: true } }),
  );
  const get = vi.fn(async (_options: CredentialRequestOptions) =>
    credential(Uint8Array.of(1, 2, 3, 4), {
      prf: { results: { first: output.buffer.slice(0) } },
    }),
  );
  const platform: WebAuthnPrfPlatform = {
    credentials: { create, get },
    getClientCapabilities: async () => ({ "extension:prf": true }),
    protocol: "https:",
    randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 1),
  };
  return { create, get, output, platform };
}

describe("WebAuthn PRF provider", () => {
  it("requires positive client capability and a secure web or extension origin", async () => {
    const supported = supportedPlatform();
    await expect(
      createWebAuthnPrfProvider({ platform: supported.platform }).getCapability(),
    ).resolves.toBe("supported");

    const extensionWithAdvisoryFalse: WebAuthnPrfPlatform = {
      ...supported.platform,
      hostname: "abcdefghijklmnop",
      protocol: "chrome-extension:",
      getClientCapabilities: async () => ({ "extension:prf": false }),
    };
    await expect(
      createWebAuthnPrfProvider({ platform: extensionWithAdvisoryFalse }).getCapability(),
    ).resolves.toBe("supported");

    const extensionOrigin: WebAuthnPrfPlatform = {
      ...supported.platform,
      hostname: "abcdefghijklmnop",
      protocol: "chrome-extension:",
    };
    const extensionProvider = createWebAuthnPrfProvider({ platform: extensionOrigin });
    await expect(extensionProvider.getCapability()).resolves.toBe("supported");
    expect(extensionProvider.getScope?.()).toBe("chrome-extension://abcdefghijklmnop");

    const insecureOrigin: WebAuthnPrfPlatform = {
      ...supported.platform,
      hostname: "example.test",
      protocol: "http:",
    };
    await expect(
      createWebAuthnPrfProvider({ platform: insecureOrigin }).getCapability(),
    ).resolves.toBe("unsupported");
  });

  it("enrolls with required user verification and obtains output through a fresh assertion", async () => {
    const { create, get, output, platform } = supportedPlatform();
    const provider = createWebAuthnPrfProvider({ platform });
    const prfInput = new Uint8Array(32).fill(0xa5);

    const enrolled = await provider.enroll({
      prfInput,
      userId: new Uint8Array(16).fill(0x5a),
    });

    expect(enrolled.credentialId).toBe("AQIDBA");
    expect(enrolled.prfOutput).toEqual(output);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      publicKey: {
        attestation: "none",
        authenticatorSelection: { userVerification: "required" },
        extensions: { prf: { eval: { first: prfInput } } },
      },
    });
    expect(get).toHaveBeenCalledOnce();
    expect(get.mock.calls[0]?.[0]).toMatchObject({
      publicKey: {
        allowCredentials: [{ id: Uint8Array.of(1, 2, 3, 4), type: "public-key" }],
        extensions: {
          prf: { evalByCredential: { AQIDBA: { first: prfInput } } },
        },
        userVerification: "required",
      },
    });
  });

  it("uses the real PRF ceremony when advisory capability reporting is false", async () => {
    const { create, get, output, platform } = supportedPlatform();
    const provider = createWebAuthnPrfProvider({
      platform: {
        ...platform,
        getClientCapabilities: async () => ({ "extension:prf": false }),
      },
    });
    const prfInput = new Uint8Array(32).fill(0x7c);

    await expect(provider.getCapability()).resolves.toBe("unsupported");
    await expect(
      provider.enroll({
        prfInput,
        userId: new Uint8Array(16).fill(0x31),
      }),
    ).resolves.toEqual({
      credentialId: "AQIDBA",
      prfOutput: output,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
  });

  it("evaluates an enrolled credential with a random challenge and exact 32-byte output", async () => {
    const { get, output, platform } = supportedPlatform();
    const provider = createWebAuthnPrfProvider({ platform });
    const prfInput = new Uint8Array(32).fill(0x33);

    await expect(provider.evaluate({ credentialId: "AQIDBA", prfInput })).resolves.toEqual(output);
    const options = get.mock.calls[0]?.[0] as CredentialRequestOptions;
    expect(options.publicKey?.challenge).toEqual(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    expect(options.publicKey?.userVerification).toBe("required");
  });

  it("fails closed for missing PRF results, malformed output, or a canceled ceremony", async () => {
    const base = supportedPlatform();
    const missing: WebAuthnPrfPlatform = {
      ...base.platform,
      credentials: {
        ...base.platform.credentials,
        get: vi.fn(async () => credential(Uint8Array.of(1), { prf: {} })),
      },
    };
    await expect(
      createWebAuthnPrfProvider({ platform: missing }).evaluate({
        credentialId: "AQ",
        prfInput: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "PRF_OPERATION_FAILED" });

    const malformed: WebAuthnPrfPlatform = {
      ...base.platform,
      credentials: {
        ...base.platform.credentials,
        get: vi.fn(async () =>
          credential(Uint8Array.of(1), {
            prf: { results: { first: new Uint8Array(31).buffer } },
          }),
        ),
      },
    };
    await expect(
      createWebAuthnPrfProvider({ platform: malformed }).evaluate({
        credentialId: "AQ",
        prfInput: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({ code: "PRF_OPERATION_FAILED" });

    const canceled: WebAuthnPrfPlatform = {
      ...base.platform,
      credentials: {
        ...base.platform.credentials,
        get: vi.fn(async () => {
          throw new DOMException("cancel details", "NotAllowedError");
        }),
      },
    };
    await expect(
      createWebAuthnPrfProvider({ platform: canceled }).evaluate({
        credentialId: "AQ",
        prfInput: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({
      code: "PRF_OPERATION_FAILED",
      message: "Biometric verification was canceled or timed out",
      reason: "canceled-or-timed-out",
    });
  });
});
