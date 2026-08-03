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
    createIdentityProfile: vi.fn(async (input) => ({
      ...input,
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "profile",
      revisionId: "revision",
      type: "identity-profile" as const,
      updatedAt: "2026-07-25T00:00:00.000Z",
    })),
    createLogin: vi.fn(async (input) => ({
      ...input,
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "item",
      revisionId: "revision",
      type: "login" as const,
      updatedAt: "2026-07-25T00:00:00.000Z",
    })),
    createItemShare: vi.fn(async (_itemId, expiresAt) => ({
      bundle: { expiresAt, shareId: "share-id" },
      secret: "separate-share-secret",
    })),
    createPaymentCard: vi.fn(async (input) => ({
      ...input,
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "payment-card",
      revisionId: "revision",
      type: "payment-card" as const,
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
    listItemHistory: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    lock: vi.fn(() => locked),
    recordActivity: vi.fn(),
    replaceRecoveryKit: vi.fn(async () => unlocked),
    restoreVault: vi.fn(async () => unlocked),
    restoreItemRevision: vi.fn(),
    revokeDevice: vi.fn(async () => unlocked),
    stepUpCompartment: vi.fn(async () => unlocked),
    subscribe: vi.fn(() => () => undefined),
    unlock: vi.fn(async () => unlocked),
    unlockWithDevice: vi.fn(async () => unlocked),
    unlockWithRecoveryKit: vi.fn(async () => unlocked),
    updateLogin: vi.fn(),
    updateIdentityProfile: vi.fn(),
    updatePaymentCard: vi.fn(),
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
    expect(await screen.findByRole("heading", { name: "Set up your vault" })).toBeInTheDocument();

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
    expect(await screen.findByRole("heading", { name: "Passwords" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No saved items" })).toBeInTheDocument();
  });

  it("prevents mismatched confirmation without invoking cryptography", async () => {
    const vaultClient = client("needs-setup");
    render(<VaultScreen client={vaultClient} surface="Web application" />);
    await screen.findByRole("heading", { name: "Set up your vault" });

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

  it("defaults to configured cloud storage while keeping local-only setup explicit", async () => {
    const vaultClient = client("needs-setup");
    vaultClient.syncGoogleDrive = vi.fn(async () => ({
      conflicts: [],
      itemCount: 0,
      quarantined: 0,
      revisionCount: 0,
      uploaded: 0,
    }));
    render(
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: "fixture.apps.googleusercontent.com" }}
        surface="Browser extension"
      />,
    );
    await screen.findByRole("heading", { name: "Set up your vault" });

    expect(screen.getByRole("radio", { name: /Continue with Google/u })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Use without an account/u }));
    expect(screen.getByText(/No registration or cloud connection/u)).toBeInTheDocument();
  });

  it("collapses wrong-password and corruption failures into a safe unlock error", async () => {
    const vaultClient = client("locked");
    vi.mocked(vaultClient.unlock).mockRejectedValueOnce(
      Object.assign(new Error("internal primitive details"), {
        code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
      }),
    );
    render(<VaultScreen client={vaultClient} surface="Browser extension" />);
    await screen.findByRole("heading", { name: "Unlock" });

    fireEvent.change(screen.getByLabelText("Master password"), {
      target: { value: "wrong password" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Master password")).toHaveValue("wrong password"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

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
    await screen.findByRole("heading", { name: "Passwords" });

    fireEvent.click(screen.getByRole("button", { name: "Lock Passwords" }));

    expect(vaultClient.lock).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Unlock" })).toBeInTheDocument();
    expect(screen.getByLabelText("Master password")).toHaveValue("");
  });

  it("keeps the item editor out of the vault overview until the user asks to add an item", async () => {
    const vaultClient = client("unlocked");
    render(<VaultScreen client={vaultClient} surface="Browser extension" />);

    await screen.findByRole("heading", { name: "Passwords" });
    expect(screen.getByRole("heading", { name: "No saved items" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByRole("heading", { name: "Add to your vault" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close item editor" }));
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("presents concise security recommendations without inventing password age", async () => {
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

    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    await screen.findAllByText("Health fixture");
    expect(await screen.findAllByText("Weak password")).not.toHaveLength(0);
    expect(screen.queryByText(/\bold\b/iu)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh security recommendations" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /security recommendations updated on this device/i,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("creates a login through the shared encrypted-item form and clears its password", async () => {
    const vaultClient = client("unlocked");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline fixture"));
    render(<VaultScreen client={vaultClient} surface="Web application" />);
    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Example" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "person" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "private" } });
    fireEvent.change(screen.getByLabelText("Website addresses, one per line"), {
      target: { value: "https://example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save encrypted item" }));

    await waitFor(() =>
      expect(vaultClient.createLogin).toHaveBeenCalledWith({
        breachCheck: {
          checkedAt: expect.any(String),
          status: "unavailable",
        },
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
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("restores immutable item history as a new conflict-protected revision", async () => {
    const vaultClient = client("unlocked");
    const listItems = vaultClient.listItems;
    const listItemHistory = vaultClient.listItemHistory;
    const restoreItemRevision = vaultClient.restoreItemRevision;
    if (
      listItems === undefined ||
      listItemHistory === undefined ||
      restoreItemRevision === undefined
    ) {
      throw new Error("Fixture client must support item history");
    }
    const current = {
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "history-item",
      notes: "",
      password: "current-password",
      revisionId: "current-revision",
      title: "History fixture",
      type: "login" as const,
      updatedAt: "2026-07-26T00:00:00.000Z",
      uris: ["https://history.example"],
      username: "person",
    };
    const earlier = {
      ...current,
      password: "earlier-password",
      revisionId: "earlier-revision",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    vi.mocked(listItems).mockResolvedValue([current]);
    vi.mocked(listItemHistory).mockResolvedValue([
      { item: current, operation: "update", revisionId: current.revisionId },
      {
        item: earlier,
        operation: "create",
        revisionId: earlier.revisionId,
      },
    ]);
    vi.mocked(restoreItemRevision).mockResolvedValue({
      ...earlier,
      revisionId: "restored-revision",
      updatedAt: "2026-07-27T00:00:00.000Z",
    });

    render(<VaultScreen client={vaultClient} surface="Browser extension" />);
    await screen.findByText("History fixture");
    fireEvent.click(screen.getByRole("button", { name: "History" }));

    expect(await screen.findByLabelText("Version history for History fixture")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(restoreItemRevision).toHaveBeenCalledWith(
        current.id,
        earlier.revisionId,
        current.revisionId,
      ),
    );
  });

  it("keeps an encrypted item share separate from its out-of-band secret", async () => {
    const vaultClient = client("unlocked");
    const listItems = vaultClient.listItems;
    const createItemShare = vaultClient.createItemShare;
    if (listItems === undefined || createItemShare === undefined) {
      throw new Error("Fixture client must support encrypted sharing");
    }
    vi.mocked(listItems).mockResolvedValue([
      {
        createdAt: "2026-07-25T00:00:00.000Z",
        id: "share-item",
        notes: "",
        password: "private-password",
        revisionId: "share-revision",
        title: "Share fixture",
        type: "login",
        updatedAt: "2026-07-25T00:00:00.000Z",
        uris: ["https://share.example"],
        username: "person",
      },
    ]);

    render(<VaultScreen client={vaultClient} surface="Browser extension" />);
    await screen.findByText("Share fixture");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() =>
      expect(createItemShare).toHaveBeenCalledWith("share-item", expect.any(String)),
    );
    expect(await screen.findByRole("dialog", { name: "Share Share fixture" })).toBeVisible();
    expect(screen.getByDisplayValue("separate-share-secret")).toHaveAttribute("readonly");
    expect(screen.getByText(/separate channels/i)).toBeVisible();
  });

  it("creates an encrypted identity profile with contact, address, and age fields", async () => {
    const vaultClient = client("unlocked");
    render(<VaultScreen client={vaultClient} surface="Browser extension" />);
    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    fireEvent.change(screen.getByLabelText("Item type"), {
      target: { value: "identity-profile" },
    });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Personal" } });
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Lovelace" } });
    fireEvent.change(screen.getByLabelText("Age"), { target: { value: "36" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "London" } });
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "United Kingdom" } });
    fireEvent.click(screen.getByRole("button", { name: "Save encrypted item" }));

    await waitFor(() =>
      expect(vaultClient.createIdentityProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          age: "36",
          city: "London",
          country: "United Kingdom",
          email: "ada@example.test",
          firstName: "Ada",
          lastName: "Lovelace",
          title: "Personal",
        }),
      ),
    );
  });

  it("creates an encrypted payment card and keeps secondary details disclosed on demand", async () => {
    const vaultClient = client("unlocked");
    render(<VaultScreen client={vaultClient} surface="Browser extension" />);
    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));

    fireEvent.change(screen.getByLabelText("Item type"), {
      target: { value: "payment-card" },
    });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Travel card" } });
    fireEvent.change(screen.getByLabelText("Name on card"), {
      target: { value: "Private Person" },
    });
    fireEvent.change(screen.getByLabelText("Card number"), {
      target: { value: "4111 1111 1111 1111" },
    });
    fireEvent.change(screen.getByLabelText("Expiry month"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Expiry year"), { target: { value: "2030" } });
    expect(screen.getByText(/Security codes are never stored/i)).toBeVisible();
    fireEvent.click(screen.getByText("Billing details"));
    fireEvent.change(screen.getByLabelText("Billing address"), {
      target: { value: "1 Private Way" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save encrypted item" }));

    await waitFor(() =>
      expect(vaultClient.createPaymentCard).toHaveBeenCalledWith({
        billingAddress: "1 Private Way",
        cardNumber: "4111 1111 1111 1111",
        cardholderName: "Private Person",
        expiryMonth: "12",
        expiryYear: "2030",
        favorite: false,
        folder: "",
        notes: "",
        securityCode: "",
        tags: [],
        title: "Travel card",
      }),
    );
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
    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Import & Backup" }));
    fireEvent.click(screen.getByText("Import passwords"));

    fireEvent.change(screen.getByLabelText("File contents"), {
      target: {
        value: "title,username,password,url\nExample,person,synthetic,https://example.test\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByLabelText(/Example: valid/i)).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await waitFor(() =>
      expect(importItems).toHaveBeenCalledWith([
        {
          input: expect.objectContaining({
            breachCheck: expect.objectContaining({
              checkedAt: expect.any(String),
              status: expect.stringMatching(/^(found|not-found|unavailable)$/u),
            }),
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
    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Cloud Sync" }));

    const connect = screen.getByRole("button", { name: "Continue with Google" });
    expect(connect).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(connect);

    await waitFor(() =>
      expect(syncGoogleDrive).toHaveBeenCalledWith({
        clientId: "fixture.apps.googleusercontent.com",
        selectAccount: true,
      }),
    );
    expect(await screen.findByText(/2 encrypted revision\(s\), 1 uploaded/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another Google account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });

  it("shows only sync and disconnect when Google Drive is already connected", async () => {
    const vaultClient = client("unlocked");
    vaultClient.isGoogleDriveConnected = () => true;
    vaultClient.syncGoogleDrive = vi.fn(async () => ({
      conflicts: [],
      itemCount: 0,
      quarantined: 0,
      revisionCount: 0,
      uploaded: 0,
    }));
    vaultClient.disconnectGoogleDrive = vi.fn();
    render(
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: "fixture.apps.googleusercontent.com" }}
        surface="Browser extension"
      />,
    );
    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Cloud Sync" }));

    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another Google account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });

  it("keeps Private Email, Cloud Sync, and Import & Backup in separate settings views", async () => {
    const vaultClient = client("unlocked");
    vaultClient.syncGoogleDrive = vi.fn(async () => ({
      conflicts: [],
      itemCount: 0,
      quarantined: 0,
      revisionCount: 0,
      uploaded: 0,
    }));
    render(
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: "fixture.apps.googleusercontent.com" }}
        surface="Browser extension"
      />,
    );
    await screen.findByRole("heading", { name: "Passwords" });

    fireEvent.click(screen.getByRole("button", { name: "Private Email" }));
    expect(screen.getByRole("heading", { name: "Private Email" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Google Drive" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Import & Backup" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cloud Sync" }));
    expect(screen.getByRole("heading", { name: "Google Drive" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Private Email" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Import & Backup" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Import & Backup" }));
    expect(screen.getByRole("heading", { name: "Import & Backup" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Private Email" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Google Drive" })).toBeNull();
  });

  it("exposes passkeys and authenticator codes as a first-class vault section", async () => {
    const vaultClient = client("unlocked");
    const listItems = vaultClient.listItems;
    if (listItems === undefined) throw new Error("Expected listItems support");
    vi.mocked(listItems).mockResolvedValue([
      {
        createdAt: "2026-08-01T00:00:00.000Z",
        id: "secured-login",
        notes: "",
        password: "synthetic-password",
        passkeys: [
          {
            createdAt: "2026-08-01T00:00:00.000Z",
            displayName: "Work laptop",
            provider: "platform",
            rpId: "accounts.example.test",
            userName: "person@example.test",
          },
        ],
        revisionId: "revision",
        title: "Example account",
        totpUri: "otpauth://totp/Example:person?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        type: "login",
        updatedAt: "2026-08-01T00:00:00.000Z",
        uris: ["https://accounts.example.test"],
        username: "person@example.test",
      },
    ]);
    render(<VaultScreen client={vaultClient} surface="Browser extension" />);
    await screen.findByRole("heading", { name: "Passwords" });
    fireEvent.click(screen.getByRole("button", { name: "Passkeys & MFA" }));

    expect(screen.getByRole("heading", { name: "Passkeys & MFA" })).toBeInTheDocument();
    expect(screen.getByText("Work laptop")).toBeInTheDocument();
    expect(screen.getByText(/accounts\.example\.test · platform/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show code" })).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "Set up your vault" });
    fireEvent.click(screen.getByRole("button", { name: "I already have a vault" }));
    fireEvent.click(screen.getByText("Use a Recovery Kit or encrypted backup"));

    fireEvent.change(screen.getByLabelText("Recovery Kit"), {
      target: { value: "recovery-fixture" },
    });
    fireEvent.change(screen.getByLabelText("New master password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new master password"), {
      target: { value: "new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Recover Google vault with Recovery Kit" }));

    await waitFor(() =>
      expect(restoreFromGoogleDrive).toHaveBeenCalledWith({
        clientId: "fixture.apps.googleusercontent.com",
        newMasterPassword: "new-password",
        recoveryKit: "recovery-fixture",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Passwords" })).toBeInTheDocument();
  });

  it("opens an existing Google vault with its current master password", async () => {
    const vaultClient = client("needs-setup");
    const restoreFromGoogleDriveWithMasterPassword = vi.fn(async () => viewState("unlocked"));
    vaultClient.restoreFromGoogleDriveWithMasterPassword = restoreFromGoogleDriveWithMasterPassword;
    render(
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: "fixture.apps.googleusercontent.com" }}
        surface="Browser extension"
      />,
    );
    await screen.findByRole("heading", { name: "Set up your vault" });
    fireEvent.click(screen.getByRole("button", { name: "I already have a vault" }));

    fireEvent.change(screen.getByLabelText("Existing master password"), {
      target: { value: "existing-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google and open vault" }));

    await waitFor(() =>
      expect(restoreFromGoogleDriveWithMasterPassword).toHaveBeenCalledWith({
        clientId: "fixture.apps.googleusercontent.com",
        masterPassword: "existing-password",
        selectAccount: true,
      }),
    );
    expect(await screen.findByRole("heading", { name: "Passwords" })).toBeInTheDocument();
  });
});
