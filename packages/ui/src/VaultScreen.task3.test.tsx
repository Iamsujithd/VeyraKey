// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type VaultClient, VaultScreen, type VaultViewState } from "./VaultScreen";

const RECOVERY_KIT = "ZKWR1 PTEST TEST TEST TEST TEST TEST TEST TEST TEST TEST TEST TEST CHECK";

function unlocked(overrides: Partial<VaultViewState> = {}) {
  return {
    deviceUnlock: { available: true, slots: [] },
    itemCount: 0,
    recovery: { status: "verified" },
    status: "unlocked",
    unlockedCompartments: [],
    vaultId: "vault-id",
    ...overrides,
  } as const;
}

function task3Client(initial: VaultViewState) {
  let state = initial;
  let listener: ((nextState: VaultViewState) => void) | undefined;
  const client = {
    changeMasterPassword: vi.fn(async () => state),
    createVault: vi.fn(async () => {
      state = unlocked({
        recovery: { recoveryKit: RECOVERY_KIT, status: "pending" },
      });
      return state;
    }),
    enrollDevice: vi.fn(async () => state),
    getState: vi.fn(() => state),
    initialize: vi.fn(async () => state),
    lock: vi.fn(() => {
      state = {
        deviceUnlock: { available: true, slots: [] },
        status: "locked",
        vaultId: "vault-id",
      };
      return state;
    }),
    recordActivity: vi.fn(),
    replaceRecoveryKit: vi.fn(async () => state),
    restoreVault: vi.fn(async () => state),
    revokeDevice: vi.fn(async () => state),
    stepUpCompartment: vi.fn(async () => {
      state = unlocked({ unlockedCompartments: ["document"] });
      return state;
    }),
    subscribe: vi.fn((nextListener: (nextState: VaultViewState) => void) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    }),
    unlock: vi.fn(async () => state),
    unlockWithDevice: vi.fn(async () => state),
    unlockWithRecoveryKit: vi.fn(async () => state),
    verifyRecoveryKit: vi.fn(async () => {
      state = unlocked();
      return state;
    }),
  };
  return {
    client: client as unknown as VaultClient,
    emit(nextState: VaultViewState) {
      state = nextState;
      listener?.(nextState);
    },
    mocks: client,
  };
}

describe("VaultScreen Task 3 flows", () => {
  it("blocks normal use on a one-time Recovery Kit display until the explicit drill succeeds", async () => {
    const { client, mocks } = task3Client({ status: "needs-setup" });
    render(<VaultScreen client={client} surface="Web application" />);
    await screen.findByRole("heading", { name: "Create your local vault" });

    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "correct horse battery staple" },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Master password")).toHaveValue("correct horse battery staple");
      expect(screen.getByLabelText("Confirm master password")).toHaveValue(
        "correct horse battery staple",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Create encrypted vault" }));

    expect(
      await screen.findByRole("heading", { name: "Save your Recovery Kit" }),
    ).toBeInTheDocument();
    expect(screen.getByText(RECOVERY_KIT)).toBeInTheDocument();
    expect(screen.getByText(/shown only for this verification drill/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print Recovery Kit" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Re-enter Recovery Kit"), {
      target: { value: RECOVERY_KIT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify Recovery Kit" }));

    await waitFor(() => expect(mocks.verifyRecoveryKit).toHaveBeenCalledWith(RECOVERY_KIT));
    expect(await screen.findByRole("heading", { name: "Vault unlocked" })).toBeInTheDocument();
  });

  it("offers capability-gated device unlock while retaining password and Recovery Kit fallback", async () => {
    const locked = {
      deviceUnlock: {
        available: true,
        slots: [{ id: "device-slot-1" }, { id: "device-slot-2" }],
      },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const { client, mocks } = task3Client(locked);
    render(<VaultScreen client={client} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault locked" });

    expect(
      screen.getByRole("button", { name: "Unlock with Touch ID or biometrics" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "abandoned password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use Recovery Kit instead" }));
    expect(screen.getByLabelText("Recovery Kit")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Recovery Kit"), {
      target: { value: RECOVERY_KIT },
    });

    fireEvent.change(screen.getByLabelText("Device unlock credential"), {
      target: { value: "device-slot-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock with Touch ID or biometrics" }));
    await waitFor(() => expect(mocks.unlockWithDevice).toHaveBeenCalledWith("device-slot-2"));
    expect(screen.getByLabelText("Recovery Kit")).toHaveValue("");
  });

  it("shows sealed compartments, performs explicit document step-up, and reacts to service expiry", async () => {
    const { client, emit, mocks } = task3Client(
      unlocked({
        deviceUnlock: {
          available: true,
          slots: [{ id: "device-slot-1" }, { id: "device-slot-2" }],
        },
      }),
    );
    render(<VaultScreen client={client} surface="Browser extension" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText(/document compartment is sealed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlock document compartment" }));
    fireEvent.change(screen.getByLabelText("Step-up master password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm document step-up" }));

    await waitFor(() =>
      expect(mocks.stepUpCompartment).toHaveBeenCalledWith("document", {
        password: "correct horse battery staple",
        type: "master-password",
      }),
    );
    expect(
      await screen.findByText(/document compartment is temporarily unlocked/i),
    ).toBeInTheDocument();

    emit(
      unlocked({
        deviceUnlock: {
          available: true,
          slots: [{ id: "device-slot-1" }, { id: "device-slot-2" }],
        },
        unlockedCompartments: [],
      }),
    );
    expect(await screen.findByText(/document compartment is sealed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unlock credential compartment" }));
    fireEvent.change(screen.getByLabelText("Step-up method"), {
      target: { value: "recovery-kit" },
    });
    fireEvent.change(screen.getByLabelText("Step-up Recovery Kit"), {
      target: { value: RECOVERY_KIT },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm credential step-up" }));
    await waitFor(() =>
      expect(mocks.stepUpCompartment).toHaveBeenCalledWith("credential", {
        recoveryKit: RECOVERY_KIT,
        type: "recovery-kit",
      }),
    );

    emit(
      unlocked({
        deviceUnlock: {
          available: true,
          slots: [{ id: "device-slot-1" }, { id: "device-slot-2" }],
        },
        unlockedCompartments: [],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlock credential compartment" }));
    fireEvent.change(screen.getByLabelText("Step-up master password"), {
      target: { value: "abandoned step-up password" },
    });
    fireEvent.change(screen.getByLabelText("Device step-up credential"), {
      target: { value: "device-slot-2" },
    });
    mocks.stepUpCompartment.mockRejectedValueOnce(new Error("device ceremony canceled"));
    fireEvent.click(screen.getByRole("button", { name: "Use enrolled device for step-up" }));
    await waitFor(() =>
      expect(mocks.stepUpCompartment).toHaveBeenCalledWith("credential", {
        slotId: "device-slot-2",
        type: "device",
      }),
    );
    expect(screen.getByLabelText("Step-up master password")).toHaveValue("");
    expect(mocks.subscribe).toHaveBeenCalledOnce();
  });

  it("shows retryable guidance for crypto-provider outages", async () => {
    const locked = {
      deviceUnlock: { available: false, slots: [] },
      status: "locked",
      vaultId: "vault-id",
    } as const;
    const { client, mocks } = task3Client(locked);
    mocks.unlock.mockRejectedValueOnce({ code: "CRYPTO_UNAVAILABLE" });
    render(<VaultScreen client={client} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault locked" });

    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "temporary secret" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Master password")).toHaveValue("temporary secret"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cryptography is temporarily unavailable/i,
    );
    expect(screen.getByLabelText("Master password")).toHaveValue("");
  });

  it("clears abandoned and auto-locked secret fields", async () => {
    const unlockedState = unlocked();
    const { client, emit } = task3Client(unlockedState);
    render(<VaultScreen client={client} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.change(screen.getByLabelText("Master password for device enrollment"), {
      target: { value: "enrollment secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock document compartment" }));
    fireEvent.change(screen.getByLabelText("Step-up master password"), {
      target: { value: "step-up secret" },
    });
    fireEvent.change(screen.getByLabelText("Step-up method"), {
      target: { value: "recovery-kit" },
    });
    fireEvent.change(screen.getByLabelText("Step-up Recovery Kit"), {
      target: { value: RECOVERY_KIT },
    });
    fireEvent.change(screen.getByLabelText("Step-up method"), {
      target: { value: "master-password" },
    });
    fireEvent.change(screen.getByLabelText("Step-up method"), {
      target: { value: "recovery-kit" },
    });
    expect(screen.getByLabelText("Step-up Recovery Kit")).toHaveValue("");

    emit(unlocked({ recovery: { status: "replacement-required" } }));
    await screen.findByRole("heading", { name: "Replace your Recovery Kit" });
    emit(unlockedState);
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Master password for device enrollment")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Master password for device enrollment"), {
      target: { value: "second enrollment secret" },
    });

    emit({
      deviceUnlock: { available: true, slots: [] },
      status: "locked",
      vaultId: "vault-id",
    });
    await screen.findByRole("heading", { name: "Vault locked" });
    emit(unlockedState);
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByLabelText("Master password for device enrollment")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Unlock document compartment" }));
    expect(screen.getByLabelText("Step-up master password")).toHaveValue("");
  });

  it("clears entered secrets after a failed sensitive operation", async () => {
    const { client, mocks } = task3Client(unlocked());
    mocks.enrollDevice.mockRejectedValueOnce(new Error("enrollment failed"));
    render(<VaultScreen client={client} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const enrollmentPassword = screen.getByLabelText("Master password for device enrollment");
    fireEvent.change(enrollmentPassword, { target: { value: "temporary secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up Touch ID or biometrics" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/device enrollment failed/i);
    expect(enrollmentPassword).toHaveValue("");
  });

  it("supports password rewrap and prospective device revocation with explicit consequences", async () => {
    const state = unlocked({
      deviceUnlock: { available: true, slots: [{ id: "device-slot-1" }] },
    });
    const { client, mocks } = task3Client(state);
    render(<VaultScreen client={client} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.change(screen.getByLabelText("Current master password"), {
      target: { value: "old password" },
    });
    fireEvent.change(screen.getByLabelText("New master password"), {
      target: { value: "new password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new master password"), {
      target: { value: "new password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change master password" }));
    await waitFor(() =>
      expect(mocks.changeMasterPassword).toHaveBeenCalledWith({
        currentPassword: "old password",
        newPassword: "new password",
      }),
    );

    expect(
      screen.getByText(/revocation prevents future use after updated state is available/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke enrolled device" }));
    await waitFor(() => expect(mocks.revokeDevice).toHaveBeenCalledWith("device-slot-1"));
  });
});
