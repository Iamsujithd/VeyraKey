// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultClient } from "@zk-wallet/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

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
  afterEach(() => vi.unstubAllGlobals());

  it("wires the shared vault flow to the extension surface", async () => {
    render(<App client={client()} />);

    expect(await screen.findByRole("heading", { name: "Vault locked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock vault" })).toBeInTheDocument();
    expect(screen.getByText("Browser extension")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Save or update current login" }));
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
