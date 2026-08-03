import { describe, expect, it, vi } from "vitest";
import {
  createPlusAddress,
  createPrivateEmailAlias,
  parsePrivateEmailSettings,
} from "./privateEmail";

const random = { randomBytes: (length: number) => new Uint8Array(length).fill(1) };

describe("private email aliases", () => {
  it("creates a site-scoped plus address without changing the base inbox", () => {
    expect(
      createPlusAddress("person@example.com", "https://shop.example.test/register", random),
    ).toMatch(/^person\+veyrakey-shop-[a-z0-9]+@example\.com$/u);
  });

  it("strictly parses encrypted provider settings", () => {
    expect(
      parsePrivateEmailSettings({
        autoFill: true,
        baseEmail: "person@example.com",
        provider: "plus",
        version: 1,
      }),
    ).toMatchObject({ provider: "plus" });
    expect(
      parsePrivateEmailSettings({
        apiCode: "secret",
        autoFill: true,
        provider: "simplelogin",
        plaintextToken: "duplicate-secret",
        version: 1,
      }),
    ).toBeNull();
  });

  it("refuses aliases for insecure or credential-bearing origins", async () => {
    await expect(
      createPrivateEmailAlias(
        { autoFill: true, baseEmail: "person@example.com", provider: "plus", version: 1 },
        "http://shop.example.test/register",
        random,
      ),
    ).rejects.toThrow("exact HTTPS origin");
    await expect(
      createPrivateEmailAlias(
        { autoFill: true, baseEmail: "person@example.com", provider: "plus", version: 1 },
        "https://user:password@shop.example.test/register",
        random,
      ),
    ).rejects.toThrow("exact HTTPS origin");
  });

  it("uses SimpleLogin's authenticated random-alias endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ email: "alias@sl.example", id: 42 }), { status: 201 }),
    );
    const alias = await createPrivateEmailAlias(
      { apiCode: "api-code", autoFill: true, provider: "simplelogin", version: 1 },
      "https://shop.example.test/register",
      random,
      fetcher,
    );
    expect(alias.address).toBe("alias@sl.example");
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "app.simplelogin.io" }),
      expect.objectContaining({ headers: expect.objectContaining({ Authentication: "api-code" }) }),
    );
  });

  it("uses Addy.io's bearer-token alias endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { email: "alias@addy.example", id: "id-1" } }), {
          status: 201,
        }),
    );
    const alias = await createPrivateEmailAlias(
      {
        apiToken: "token",
        autoFill: true,
        domain: "addy.example",
        provider: "addy",
        version: 1,
      },
      "https://shop.example.test/register",
      random,
      fetcher,
    );
    expect(alias).toMatchObject({ address: "alias@addy.example", providerAliasId: "id-1" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.addy.io/api/v1/aliases",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });
});
