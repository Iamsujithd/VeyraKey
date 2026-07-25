// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type VaultClient, VaultScreen, type VaultViewState } from "./VaultScreen";

const unlocked: VaultViewState = {
  deviceUnlock: { available: false, slots: [] },
  itemCount: 0,
  recovery: { status: "verified" },
  status: "unlocked",
  unlockedCompartments: [],
  vaultId: "vault-id",
};
const locked: VaultViewState = {
  deviceUnlock: { available: false, slots: [] },
  status: "locked",
  vaultId: "vault-id",
};

function baseClient(overrides: Partial<VaultClient> = {}): VaultClient {
  return {
    changeMasterPassword: vi.fn(async () => unlocked),
    createVault: vi.fn(async () => unlocked),
    enrollDevice: vi.fn(async () => unlocked),
    getState: vi.fn(() => ({ status: "needs-setup" }) as const),
    initialize: vi.fn(async () => ({ status: "needs-setup" }) as const),
    lock: vi.fn(() => locked),
    recordActivity: vi.fn(),
    replaceRecoveryKit: vi.fn(async () => unlocked),
    restoreVault: vi.fn(async () => unlocked),
    revokeDevice: vi.fn(async () => unlocked),
    stepUpCompartment: vi.fn(async () => unlocked),
    subscribe: vi.fn(() => () => undefined),
    unlock: vi.fn(async () => unlocked),
    unlockWithDevice: vi.fn(async () => unlocked),
    unlockWithRecoveryKit: vi.fn(async () => unlocked),
    verifyRecoveryKit: vi.fn(async () => unlocked),
    ...overrides,
  };
}

function lifecycleClient(): VaultClient {
  return baseClient({
    initialize: vi
      .fn()
      .mockRejectedValueOnce(new Error("raw IndexedDB failure"))
      .mockResolvedValueOnce({ status: "needs-setup" } as const),
  });
}

describe("VaultScreen lifecycle safety", () => {
  it("shows a safe retryable state when initialization fails", async () => {
    const client = lifecycleClient();
    render(<VaultScreen client={client} surface="Web application" />);

    expect(await screen.findByRole("heading", { name: "Vault unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to read the encrypted local vault. Retry when local storage is available.",
    );
    expect(screen.queryByText(/raw IndexedDB failure/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry vault loading" }));

    expect(
      await screen.findByRole("heading", { name: "Create your local vault" }),
    ).toBeInTheDocument();
    expect(client.initialize).toHaveBeenCalledTimes(2);
  });

  it("locks the client when the vault surface unmounts", async () => {
    const client = baseClient({
      getState: vi.fn(() => unlocked),
      initialize: vi.fn(async () => unlocked),
    });
    const rendered = render(<VaultScreen client={client} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });

    rendered.unmount();

    expect(client.lock).toHaveBeenCalledOnce();
  });
});
