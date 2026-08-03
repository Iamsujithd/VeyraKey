// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { VaultClient } from "@zk-wallet/ui";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

function client(): VaultClient {
  const setup = { status: "needs-setup" } as const;
  return {
    changeMasterPassword: vi.fn(),
    createVault: vi.fn(),
    enrollDevice: vi.fn(),
    getState: vi.fn(() => setup),
    initialize: vi.fn(async () => setup),
    lock: vi.fn(() => setup),
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

describe("web app", () => {
  it("wires the shared vault flow to the web surface", async () => {
    render(<App client={client()} />);

    expect(await screen.findByRole("heading", { name: "Set up your vault" })).toBeInTheDocument();
    expect(screen.getByText("Web application")).toBeInTheDocument();
  });
});
