// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultClient } from "@zk-wallet/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, authenticatedAutofillTarget, captureAuthenticationTarget } from "./App";

function client(): VaultClient {
  const locked = {
    deviceUnlock: { available: false, slots: [] },
    status: "locked",
    vaultId: "vault-id",
  } as const;
  return {
    changeMasterPassword: vi.fn(),
    createVault: vi.fn(),
    enrollDevice: vi.fn(),
    getState: vi.fn(() => locked),
    initialize: vi.fn(async () => locked),
    lock: vi.fn(() => locked),
    recordActivity: vi.fn(),
    replaceRecoveryKit: vi.fn(),
    restoreVault: vi.fn(),
    revokeDevice: vi.fn(),
    stepUpCompartment: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    unlock: vi.fn(),
    unlockWithDevice: vi.fn(),
    unlockWithRecoveryKit: vi.fn(),
    verifyRecoveryKit: vi.fn(),
  };
}

describe("extension popup", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a compact page controller instead of the full vault manager", async () => {
    render(<App client={client()} />);

    expect(screen.queryByText(/Check Vault/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Vault Manager" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unlock" })).not.toBeInTheDocument();
  });

  it("keeps the full vault flow in the separate manager mode", async () => {
    window.history.replaceState(null, "", "/?mode=manager");
    render(<App client={client()} />);

    expect(await screen.findByRole("heading", { name: "Unlock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
    expect(screen.getByText("Browser extension")).toBeInTheDocument();
  });

  it("accepts only strict HTTPS authenticated autofill targets", () => {
    expect(
      authenticatedAutofillTarget(
        "?mode=biometric-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
      ),
    ).toEqual({ method: "biometric", tabId: 7, topUrl: "https://example.test/login" });
    expect(
      authenticatedAutofillTarget(
        "?mode=manual-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
      ),
    ).toEqual({ method: "password", tabId: 7, topUrl: "https://example.test/login" });
    expect(
      authenticatedAutofillTarget(
        "?mode=biometric-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin&usernameHint=person%40example.test",
      ),
    ).toEqual({
      method: "biometric",
      tabId: 7,
      topUrl: "https://example.test/login",
      usernameHint: "person@example.test",
    });
    expect(
      authenticatedAutofillTarget(
        "?credentialId=login-id&mode=biometric-autofill&submit=false&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
      ),
    ).toEqual({
      credentialId: "login-id",
      method: "biometric",
      submitAfterFill: false,
      tabId: 7,
      topUrl: "https://example.test/login",
    });
    expect(
      authenticatedAutofillTarget(
        "?mode=biometric-autofill&tabId=7&topUrl=http%3A%2F%2Fexample.test%2Flogin",
      ),
    ).toBeNull();
    expect(
      authenticatedAutofillTarget(
        "?mode=biometric-autofill&tabId=-1&topUrl=https%3A%2F%2Fexample.test%2Flogin",
      ),
    ).toBeNull();
    expect(
      authenticatedAutofillTarget(
        "?extra=bypass&mode=biometric-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
      ),
    ).toBeNull();
  });

  it("accepts only strict pending-save authentication targets", () => {
    expect(
      captureAuthenticationTarget("?displayHost=example.test&mode=capture-auth&tabId=7"),
    ).toEqual({ displayHost: "example.test", tabId: 7 });
    expect(
      captureAuthenticationTarget(
        "?displayHost=example.test&extra=bypass&mode=capture-auth&tabId=7",
      ),
    ).toBeNull();
    expect(captureAuthenticationTarget("?displayHost=&mode=capture-auth&tabId=7")).toBeNull();
    expect(
      captureAuthenticationTarget("?displayHost=example.test&mode=capture-auth&tabId=-1"),
    ).toBeNull();
  });

  it("fills directly from an already unlocked vault without another biometric prompt", async () => {
    const locked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlocked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      itemCount: 1,
      recovery: { status: "verified" },
      status: "unlocked",
      unlockedCompartments: [],
      vaultId: "vault-id",
    } as const;
    const unlockWithDevice = vi.fn(async () => unlocked);
    const lock = vi.fn(() => locked);
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ filled: true, submitted: true });
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => unlocked,
      initialize: async () => unlocked,
      listItems: async () => [
        {
          createdAt: "2026-07-27T00:00:00.000Z",
          id: "login-id",
          notes: "",
          password: "synthetic-secret",
          revisionId: "revision-id",
          title: "Example",
          type: "login",
          updatedAt: "2026-07-27T00:00:00.000Z",
          uris: ["https://practicetestautomation.com"],
          username: "student",
        },
        {
          createdAt: "2026-07-27T00:00:00.000Z",
          id: "other-login-id",
          notes: "",
          password: "other-secret",
          revisionId: "other-revision-id",
          title: "Other Example",
          type: "login",
          updatedAt: "2026-07-27T00:00:00.000Z",
          uris: ["https://practicetestautomation.com"],
          username: "other@example.test",
        },
      ],
      lock,
      unlockWithDevice,
    };
    vi.stubGlobal("browser", { tabs: { sendMessage } });
    window.history.replaceState(
      null,
      "",
      "/?credentialId=login-id&mode=biometric-autofill&submit=false&tabId=7&topUrl=https%3A%2F%2Fpracticetestautomation.com%2Fpractice-test-login%2F",
    );

    render(<App client={vaultClient} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(7, {
        password: "synthetic-secret",
        submit: false,
        topUrl: "https://practicetestautomation.com/practice-test-login/",
        type: "zk-wallet.biometric-fill.v1",
        username: "student",
        version: 1,
      }),
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(unlockWithDevice).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("never releases a selected password when fresh biometric verification fails", async () => {
    const locked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlockWithDevice = vi.fn(async () => {
      throw new Error("Biometric verification was canceled or timed out");
    });
    const listItems = vi.fn();
    const lock = vi.fn(() => locked);
    const sendMessage = vi.fn();
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => locked,
      initialize: async () => locked,
      listItems,
      lock,
      unlockWithDevice,
    };
    vi.stubGlobal("browser", { tabs: { sendMessage } });
    window.history.replaceState(
      null,
      "",
      "/?credentialId=login-id&mode=biometric-autofill&submit=false&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
    );

    render(<App client={vaultClient} />);
    expect(await screen.findByLabelText("Master password")).toBeVisible();
    expect(screen.getByText("Touch ID was canceled.")).toBeVisible();
    expect(unlockWithDevice).toHaveBeenCalledWith("device-slot");
    expect(screen.queryByRole("button", { name: "Fill with Touch ID" })).not.toBeInTheDocument();
    expect(listItems).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
  });

  it("does not offer a meaningless biometric retry for an obsolete device enrollment", async () => {
    const locked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlockWithDevice = vi.fn(async () => {
      throw new Error("This biometric enrollment is not available to this app");
    });
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => locked,
      initialize: async () => locked,
      listItems: vi.fn(async () => []),
      unlockWithDevice,
    };
    vi.stubGlobal("browser", { tabs: { sendMessage: vi.fn() } });
    window.history.replaceState(
      null,
      "",
      "/?credentialId=login-id&mode=biometric-autofill&submit=false&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
    );

    render(<App client={vaultClient} />);

    expect(
      await screen.findByText(
        "Touch ID was enrolled in another app or browser profile. Unlock with your master password, then replace this device enrollment in Settings.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try Touch ID Again" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Master password")).toBeVisible();
    expect(unlockWithDevice).toHaveBeenCalledTimes(1);
  });

  it("ends the biometric flow when the vault has no exact-origin login", async () => {
    const locked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlocked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      itemCount: 1,
      recovery: { status: "verified" },
      status: "unlocked",
      unlockedCompartments: [],
      vaultId: "vault-id",
    } as const;
    const lock = vi.fn(() => locked);
    const sendMessage = vi.fn();
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => locked,
      initialize: async () => locked,
      listItems: async () => [
        {
          createdAt: "2026-07-27T00:00:00.000Z",
          id: "other-origin-login",
          notes: "",
          password: "must-not-be-released",
          revisionId: "other-origin-revision",
          title: "Other origin",
          type: "login",
          updatedAt: "2026-07-27T00:00:00.000Z",
          uris: ["https://other.example.test"],
          username: "person@example.test",
        },
      ],
      lock,
      unlockWithDevice: vi.fn(async () => unlocked),
    };
    vi.stubGlobal("browser", { tabs: { sendMessage } });
    window.history.replaceState(
      null,
      "",
      "/?mode=biometric-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
    );

    render(<App client={vaultClient} />);

    expect(await screen.findByRole("heading", { name: "No saved login" })).toBeVisible();
    expect(screen.getByText("No exact-origin password is saved for this page.")).toBeVisible();
    expect(screen.getByText(/passwords are never reused across origins/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try Touch ID Again" })).not.toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
  });

  it("ignores a blank duplicate and automatically fills the only named login", async () => {
    const locked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlocked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      itemCount: 2,
      recovery: { status: "verified" },
      status: "unlocked",
      unlockedCompartments: [],
      vaultId: "vault-id",
    } as const;
    const sendMessage = vi.fn(async () => ({ filled: true, submitted: false }));
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const lock = vi.fn(() => locked);
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => locked,
      initialize: async () => locked,
      listItems: async () => [
        {
          createdAt: "2026-07-27T00:00:00.000Z",
          id: "saved-login",
          notes: "",
          password: "first-secret",
          revisionId: "first-revision",
          title: "Saved login",
          type: "login",
          updatedAt: "2026-07-27T00:00:00.000Z",
          uris: ["https://example.test"],
          username: "",
        },
        {
          createdAt: "2026-07-27T00:00:00.000Z",
          id: "student-login",
          notes: "",
          password: "student-secret",
          revisionId: "student-revision",
          title: "Student",
          type: "login",
          updatedAt: "2026-07-27T00:00:00.000Z",
          uris: ["https://example.test"],
          username: "student",
        },
      ],
      lock,
      unlockWithDevice: vi.fn(async () => unlocked),
    };
    vi.stubGlobal("browser", { tabs: { sendMessage } });
    window.history.replaceState(
      null,
      "",
      "/?mode=biometric-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
    );

    render(<App client={vaultClient} />);

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(7, {
        password: "student-secret",
        submit: false,
        topUrl: "https://example.test/login",
        type: "zk-wallet.biometric-fill.v1",
        username: "student",
        version: 1,
      }),
    );
    expect(lock).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("fills after master-password entry in the protected extension page and relocks", async () => {
    const locked = {
      deviceUnlock: { available: false, slots: [] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlocked = {
      deviceUnlock: { available: false, slots: [] },
      itemCount: 1,
      recovery: { status: "verified" },
      status: "unlocked",
      unlockedCompartments: [],
      vaultId: "vault-id",
    } as const;
    const unlock = vi.fn(async () => unlocked);
    const lock = vi.fn(() => locked);
    const sendMessage = vi.fn(async () => ({ filled: true, submitted: false }));
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => locked,
      initialize: async () => locked,
      listItems: async () => [
        {
          createdAt: "2026-07-27T00:00:00.000Z",
          id: "login-id",
          notes: "",
          password: "synthetic-secret",
          revisionId: "revision-id",
          title: "Example",
          type: "login",
          updatedAt: "2026-07-27T00:00:00.000Z",
          uris: ["https://example.test"],
          username: "person@example.test",
        },
      ],
      lock,
      unlock,
    };
    vi.stubGlobal("browser", { tabs: { sendMessage } });
    window.history.replaceState(
      null,
      "",
      "/?mode=manual-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
    );

    render(<App client={vaultClient} />);
    const password = await screen.findByLabelText("Master password");
    fireEvent.change(password, { target: { value: "correct master password" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill Password" }));

    await waitFor(() => expect(unlock).toHaveBeenCalledWith("correct master password"));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(7, {
        password: "synthetic-secret",
        submit: false,
        topUrl: "https://example.test/login",
        type: "zk-wallet.biometric-fill.v1",
        username: "person@example.test",
        version: 1,
      }),
    );
    expect(lock).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("clears a rejected master password without delivering a credential", async () => {
    const locked = {
      deviceUnlock: { available: false, slots: [] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlock = vi.fn(async () => {
      throw new Error("synthetic wrong password");
    });
    const lock = vi.fn(() => locked);
    const sendMessage = vi.fn();
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => locked,
      initialize: async () => locked,
      listItems: vi.fn(),
      lock,
      unlock,
    };
    vi.stubGlobal("browser", { tabs: { sendMessage } });
    window.history.replaceState(
      null,
      "",
      "/?mode=manual-autofill&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
    );

    render(<App client={vaultClient} />);
    const password = await screen.findByLabelText<HTMLInputElement>("Master password");
    fireEvent.change(password, { target: { value: "wrong master password" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill Password" }));

    expect(await screen.findByText("Unable to unlock. Check the master password.")).toBeVisible();
    expect(password.value).toBe("");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
  });

  it("routes toolbar autofill into the authenticated field-level flow", async () => {
    const sendMessage = vi.fn(async () => ({ shown: true }));
    vi.stubGlobal("browser", {
      storage: {
        local: {
          get: vi.fn(async () => ({
            "zk-wallet.autofill-metadata-index.v1": [
              {
                id: "login-id",
                origins: ["https://example.test"],
                username: "person@example.test",
              },
            ],
          })),
        },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: "https://example.test/login" }]),
        sendMessage,
      },
    });
    vi.spyOn(window, "close").mockImplementation(() => undefined);
    render(<App client={client()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fill person@example.test" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(7, {
        type: "zk-wallet.show-autofill.v1",
        version: 1,
      }),
    );
  });

  it("opens the full manager in a separate extension tab", async () => {
    const create = vi.fn(async () => ({ id: 8 }));
    vi.stubGlobal("browser", {
      runtime: {
        getURL: vi.fn(() => "chrome-extension://extension-id/popup.html?mode=manager"),
      },
      tabs: {
        create,
        query: vi.fn(async () => [{ id: 7, url: "https://example.test/login" }]),
      },
    });
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);

    render(<App client={client()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Vault Manager" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        url: "chrome-extension://extension-id/popup.html?mode=manager",
      }),
    );
    expect(close).toHaveBeenCalled();
  });
});
