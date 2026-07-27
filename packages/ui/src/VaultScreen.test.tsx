// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type VaultClient, VaultScreen, type VaultViewState } from "./VaultScreen";

function viewState(initialStatus: "needs-setup" | "locked" | "unlocked"): VaultViewState {
  if (initialStatus === "needs-setup") return { status: "needs-setup" };
  if (initialStatus === "locked") {
    return {
      deviceUnlock: { available: false, slots: [] },
      status: "locked",
      vaultId: "vault-id",
    };
  }
  return {
    deviceUnlock: { available: false, slots: [] },
    itemCount: 0,
    recovery: { status: "verified" },
    status: "unlocked",
    unlockedCompartments: [],
    vaultId: "vault-id",
  };
}

function client(initialStatus: "needs-setup" | "locked" | "unlocked"): VaultClient {
  const initial = viewState(initialStatus);
  const unlocked = viewState("unlocked");
  const locked = viewState("locked");

  return {
    changeMasterPassword: vi.fn(async () => unlocked),
    createLogin: vi.fn(async (input) => ({
      ...input,
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "item",
      revisionId: "revision",
      type: "login" as const,
      updatedAt: "2026-07-25T00:00:00.000Z",
    })),
    createSecureNote: vi.fn(async (input) => ({
      ...input,
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "note",
      revisionId: "revision",
      type: "secure-note" as const,
      updatedAt: "2026-07-25T00:00:00.000Z",
    })),
    createVault: vi.fn(async () => unlocked),
    deleteItem: vi.fn(async () => undefined),
    enrollDevice: vi.fn(async () => unlocked),
    getState: vi.fn(() => initial),
    initialize: vi.fn(async () => initial),
    listItems: vi.fn(async () => []),
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
    updateLogin: vi.fn(),
    updateSecureNote: vi.fn(),
    verifyRecoveryKit: vi.fn(async () => unlocked),
  };
}

describe("VaultScreen", () => {
  it("creates a local vault through an accessible setup form", async () => {
    const vaultClient = client("needs-setup");
    render(
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: "fixture.apps.googleusercontent.com" }}
        surface="Web application"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/preparing vault/i);
    expect(
      await screen.findByRole("heading", { name: "Create your local vault" }),
    ).toBeInTheDocument();

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

    await waitFor(() =>
      expect(vaultClient.createVault).toHaveBeenCalledWith("correct horse battery staple"),
    );
    expect(await screen.findByRole("heading", { name: "Vault unlocked" })).toBeInTheDocument();
    expect(screen.getByText(/empty root compartment is open/i)).toBeInTheDocument();
  });

  it("prevents mismatched confirmation without invoking cryptography", async () => {
    const vaultClient = client("needs-setup");
    render(<VaultScreen client={vaultClient} surface="Web application" />);
    await screen.findByRole("heading", { name: "Create your local vault" });

    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "one password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "another password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create encrypted vault" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/passwords do not match/i);
    expect(vaultClient.createVault).not.toHaveBeenCalled();
  });

  it("collapses wrong-password and corruption failures into a safe unlock error", async () => {
    const vaultClient = client("locked");
    vi.mocked(vaultClient.unlock).mockRejectedValueOnce(
      Object.assign(new Error("internal primitive details"), {
        code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
      }),
    );
    render(<VaultScreen client={vaultClient} surface="Browser extension" />);
    await screen.findByRole("heading", { name: "Vault locked" });

    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "wrong password" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Master password")).toHaveValue("wrong password"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlock vault" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Unable to unlock. Check the password or local vault data.",
      ),
    );
    expect(screen.queryByText(/primitive details/i)).not.toBeInTheDocument();
  });

  it("locks an unlocked vault and returns to the password form", async () => {
    const vaultClient = client("unlocked");
    render(<VaultScreen client={vaultClient} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });

    fireEvent.click(screen.getByRole("button", { name: "Lock vault" }));

    expect(vaultClient.lock).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Vault locked" })).toBeInTheDocument();
    expect(screen.getByLabelText("Master password")).toHaveValue("");
  });

  it("presents local password health accessibly without making a network request", async () => {
    const vaultClient = client("unlocked");
    const listItems = vaultClient.listItems;
    if (listItems === undefined) throw new Error("Fixture client must list items");
    vi.mocked(listItems).mockResolvedValue([
      {
        createdAt: "2024-01-01T00:00:00.000Z",
        id: "health-login",
        notes: "",
        password: "weak",
        revisionId: "health-revision",
        title: "Health fixture",
        type: "login",
        updatedAt: "2024-01-01T00:00:00.000Z",
        uris: ["https://health.example"],
        username: "fixture",
      },
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<VaultScreen client={vaultClient} surface="Web application" />);

    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByRole("heading", { name: "Password health" })).toBeInTheDocument();
    await screen.findAllByText("Health fixture");
    fireEvent.click(screen.getByRole("button", { name: "Analyze passwords locally" }));

    expect(await screen.findByText(/weak · not reused/u)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/analyzed 1 login\(s\) locally/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("creates a login through the shared encrypted-item form and clears its password", async () => {
    const vaultClient = client("unlocked");
    render(<VaultScreen client={vaultClient} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Example" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "person" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "private" } });
    fireEvent.change(screen.getByLabelText("Website addresses, one per line"), {
      target: { value: "https://example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save encrypted item" }));

    await waitFor(() =>
      expect(vaultClient.createLogin).toHaveBeenCalledWith({
        favorite: false,
        folder: "",
        notes: "",
        password: "private",
        tags: [],
        title: "Example",
        totpUri: "",
        uris: ["https://example.test"],
        username: "person",
      }),
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("shows every preserved sync conflict for user review", async () => {
    const vaultClient = client("unlocked");
    const conflicted = {
      ...viewState("unlocked"),
      syncConflicts: [
        {
          itemId: "opaque-item-id",
          revisionIds: ["left-revision", "right-revision"],
        },
      ],
    } as VaultViewState;
    vi.mocked(vaultClient.initialize).mockResolvedValue(conflicted);
    render(<VaultScreen client={vaultClient} surface="Web application" />);

    expect(
      await screen.findByRole("heading", { name: "Sync conflicts need review" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 preserved versions/i)).toBeInTheDocument();
  });

  it("previews and commits selected CSV rows through one atomic import call", async () => {
    const vaultClient = client("unlocked");
    const importItems = vi.fn(async () => []);
    vaultClient.importItems = importItems;
    render(<VaultScreen client={vaultClient} surface="Web application" />);
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));

    fireEvent.change(screen.getByLabelText("Import file contents"), {
      target: {
        value: "title,username,password,url\nExample,person,synthetic,https://example.test\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(screen.getByLabelText(/Example: valid/i)).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Import selected rows atomically" }));
    await waitFor(() =>
      expect(importItems).toHaveBeenCalledWith([
        {
          input: expect.objectContaining({
            password: "synthetic",
            title: "Example",
          }),
          type: "login",
        },
      ]),
    );
  });

  it("connects Google Drive only after an explicit client ID and reports encrypted sync", async () => {
    const vaultClient = client("unlocked");
    const syncGoogleDrive = vi.fn(async () => ({
      conflicts: [],
      itemCount: 0,
      quarantined: 0,
      revisionCount: 2,
      uploaded: 1,
    }));
    vaultClient.syncGoogleDrive = syncGoogleDrive;
    vaultClient.disconnectGoogleDrive = vi.fn();
    render(
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: "fixture.apps.googleusercontent.com" }}
        surface="Web application"
      />,
    );
    await screen.findByRole("heading", { name: "Vault unlocked" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const connect = screen.getByRole("button", { name: "Connect Google Drive" });
    expect(connect).toBeEnabled();
    fireEvent.click(connect);

    await waitFor(() =>
      expect(syncGoogleDrive).toHaveBeenCalledWith({
        clientId: "fixture.apps.googleusercontent.com",
      }),
    );
    expect(await screen.findByText(/2 encrypted revision\(s\), 1 uploaded/u)).toBeInTheDocument();
  });

  it("restores a clean profile directly from the encrypted Drive recovery archive", async () => {
    const vaultClient = client("needs-setup");
    const restored = viewState("unlocked");
    const restoreFromGoogleDrive = vi.fn(async () => restored);
    vaultClient.restoreFromGoogleDrive = restoreFromGoogleDrive;
    render(
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: "fixture.apps.googleusercontent.com" }}
        surface="Web application"
      />,
    );
    await screen.findByRole("heading", { name: "Create your local vault" });
    fireEvent.click(screen.getByRole("button", { name: "Restore from encrypted BYOS state" }));

    fireEvent.change(screen.getByLabelText("Recovery Kit"), {
      target: { value: "recovery-fixture" },
    });
    fireEvent.change(screen.getByLabelText("New master password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new master password"), {
      target: { value: "new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore directly from Google Drive" }));

    await waitFor(() =>
      expect(restoreFromGoogleDrive).toHaveBeenCalledWith({
        clientId: "fixture.apps.googleusercontent.com",
        newMasterPassword: "new-password",
        recoveryKit: "recovery-fixture",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Vault unlocked" })).toBeInTheDocument();
  });
});
