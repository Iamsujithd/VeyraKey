// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultClient } from "@zk-wallet/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, authenticatedAutofillTarget } from "./App";

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

  it("wires the shared vault flow to the extension surface", async () => {
    render(<App client={client()} />);

    expect(await screen.findByRole("heading", { name: "Vault locked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock vault" })).toBeInTheDocument();
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

  it("requires fresh biometrics for a selected login even while the manager is unlocked", async () => {
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
    const sendMessage = vi.fn(async () => ({ filled: true, submitted: true }));
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
          uris: ["https://example.test"],
          username: "person@example.test",
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
          uris: ["https://example.test"],
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
      "/?credentialId=login-id&mode=biometric-autofill&submit=false&tabId=7&topUrl=https%3A%2F%2Fexample.test%2Flogin",
    );

    render(<App client={vaultClient} />);
    expect(await screen.findByRole("heading", { name: "Touch ID to fill" })).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(unlockWithDevice).toHaveBeenCalledWith("device-slot"));
    expect(
      screen.queryByRole("button", { name: "Use Touch ID or Biometrics" }),
    ).not.toBeInTheDocument();
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

  it("never releases a selected password when fresh biometric verification fails", async () => {
    const unlocked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      itemCount: 1,
      recovery: { status: "verified" },
      status: "unlocked",
      unlockedCompartments: [],
      vaultId: "vault-id",
    } as const;
    const locked = {
      deviceUnlock: { available: true, slots: [{ id: "device-slot" }] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const unlockWithDevice = vi.fn(async () => {
      throw new Error("synthetic biometric cancellation");
    });
    const listItems = vi.fn();
    const lock = vi.fn(() => locked);
    const sendMessage = vi.fn();
    const vaultClient: VaultClient = {
      ...client(),
      getState: () => unlocked,
      initialize: async () => unlocked,
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
    expect(
      await screen.findByText(
        "Biometric verification was canceled or is unavailable on this device.",
      ),
    ).toBeVisible();
    expect(unlockWithDevice).toHaveBeenCalledWith("device-slot");
    expect(listItems).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
  });

  it("fills the account clicked after biometric verification finds multiple matches", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: /student.*Fill this account/u }));

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

  it("shows an exact-origin confirmation before saving a captured login", async () => {
    const unlocked = {
      deviceUnlock: { available: false, slots: [] },
      itemCount: 0,
      recovery: { status: "verified" },
      status: "unlocked",
      unlockedCompartments: [],
      vaultId: "vault-id",
    } as const;
    const createLogin = vi.fn(async (input) => ({
      ...input,
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "item",
      revisionId: "revision",
      type: "login" as const,
      updatedAt: "2026-07-25T00:00:00.000Z",
    }));
    const vaultClient: VaultClient = {
      ...client(),
      createLogin,
      getState: () => unlocked,
      initialize: async () => unlocked,
      listItems: async () => [],
    };
    vi.stubGlobal("browser", {
      scripting: {
        executeScript: vi.fn(async () => [
          { result: { password: "synthetic-secret", username: "person" } },
        ]),
      },
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: "https://example.test/login" }]),
      },
    });
    render(<App client={vaultClient} />);
    await screen.findByRole("heading", { name: "Vault unlocked" });

    fireEvent.click(screen.getByRole("button", { name: "Save or Update Password" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/exact origin example.test/i);
    expect(createLogin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm save" }));
    await waitFor(() =>
      expect(createLogin).toHaveBeenCalledWith({
        notes: "",
        password: "synthetic-secret",
        title: "example.test",
        uris: ["https://example.test"],
        username: "person",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
