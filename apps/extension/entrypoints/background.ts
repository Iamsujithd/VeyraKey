import { createCryptoProvider, zeroBytes } from "@zk-wallet/crypto";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbVaultHeaderRepository,
} from "@zk-wallet/persistence";
import { checkPwnedPassword, decideAutofill, decideCredentialCapture } from "@zk-wallet/security";
import {
  createVaultService,
  type IdentityProfileItem,
  type LoginItem,
  type PaymentCardItem,
  type SecureNoteItem,
  type VaultItem,
} from "@zk-wallet/vault";
import {
  type AutofillResponse,
  BIOMETRIC_FILL_TYPE,
  CAPTURE_CONFIRM_TYPE,
  CAPTURE_DISMISS_TYPE,
  CAPTURE_REQUEST_TYPE,
  type CaptureRequest,
  type CaptureResponse,
  type CardAutofillResponse,
  credentialFingerprint,
  type PrivateEmailResponse,
  type ProfileAutofillResponse,
  parseAuthenticatedAutofillSelectRequest,
  parseAutofillFilledRequest,
  parseAutofillRequest,
  parseBiometricAutofillRequest,
  parseCaptureActionRequest,
  parseCapturePendingRequest,
  parseCaptureRequest,
  parseCardAutofillRequest,
  parseCardAutofillSelectRequest,
  parseManualAutofillRequest,
  parseOpenVaultManagerRequest,
  parsePrivateEmailRequest,
  parseProfileAutofillRequest,
  parseProfileAutofillSelectRequest,
  parseUsernameObservedRequest,
  preferNamedCredentials,
} from "../src/autofill";
import { readAutofillMetadataIndex, writeAutofillMetadataIndex } from "../src/autofillIndex";
import { createExtensionDevicePrfProvider } from "../src/devicePrf";
import {
  type CreatedPrivateEmailAlias,
  createPrivateEmailAlias,
  PRIVATE_EMAIL_SETTINGS_TAG,
  parsePrivateEmailSettingsNote,
} from "../src/privateEmail";
import { ExtensionSessionCoordinator } from "../src/session";

export default defineBackground(() => {
  const service = createVaultService({
    crypto: createCryptoProvider(),
    devicePrf: createExtensionDevicePrfProvider(),
    itemRepository: new IndexedDbItemRevisionRepository(),
    repository: new IndexedDbVaultHeaderRepository(),
  });
  const coordinator = new ExtensionSessionCoordinator({
    bus: {
      publish: (message) => browser.runtime.sendMessage(message).catch(() => undefined),
      subscribe(listener) {
        const handle = (message: unknown) => {
          if (
            typeof message === "object" &&
            message !== null &&
            "version" in message &&
            message.version === 1 &&
            "type" in message &&
            ["locked", "unlocked"].includes(String(message.type))
          ) {
            listener(message as Parameters<typeof listener>[0]);
          }
        };
        browser.runtime.onMessage.addListener(handle);
        return () => browser.runtime.onMessage.removeListener(handle);
      },
    },
    storage: {
      get: (key) => browser.storage.session.get(key),
      remove: (key) => browser.storage.session.remove(key),
      set: (items) => browser.storage.session.set(items),
      setAccessLevel: (options) => browser.storage.session.setAccessLevel(options),
    },
  });
  coordinator.bind(service);
  const initialized = coordinator.initialize().then(() => service.initialize());
  type PendingCapture = {
    readonly action: "save" | "update";
    readonly approved: boolean;
    readonly capture: CaptureRequest;
    readonly displayHost: string;
    readonly expiresAt: number;
    readonly username: string;
  };
  const pendingKey = (tabId: number) => `zk-wallet.pending-capture.v1.${tabId}`;
  const recentFillKey = (tabId: number) => `zk-wallet.recent-fill.v1.${tabId}`;
  const privateEmailKey = (tabId: number) => `zk-wallet.private-email.v1.${tabId}`;
  type PendingPrivateEmail = CreatedPrivateEmailAlias & { readonly expiresAt: number };
  const loadPendingPrivateEmail = async (
    tabId: number,
    topUrl: string,
  ): Promise<PendingPrivateEmail | null> => {
    const key = privateEmailKey(tabId);
    const value = (await browser.storage.session.get(key))[key];
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const alias = value as Partial<PendingPrivateEmail>;
    if (
      typeof alias.address !== "string" ||
      typeof alias.createdAt !== "string" ||
      typeof alias.createdForOrigin !== "string" ||
      typeof alias.expiresAt !== "number" ||
      !["addy", "plus", "simplelogin"].includes(alias.provider ?? "") ||
      alias.expiresAt <= Date.now() ||
      alias.createdForOrigin !== new URL(topUrl).origin
    ) {
      await browser.storage.session.remove(key);
      return null;
    }
    return alias as PendingPrivateEmail;
  };
  type RecentFill = { readonly expiresAt: number; readonly fingerprint: string };
  const rememberRecentFill = async (
    tabId: number,
    credential: { readonly password: string; readonly topUrl: string; readonly username: string },
  ) =>
    browser.storage.session.set({
      [recentFillKey(tabId)]: {
        expiresAt: Date.now() + 10 * 60 * 1_000,
        fingerprint: await credentialFingerprint(credential),
      } satisfies RecentFill,
    });
  const matchesRecentFill = async (
    tabId: number,
    credential: { readonly password: string; readonly topUrl: string; readonly username: string },
  ): Promise<boolean> => {
    const key = recentFillKey(tabId);
    const stored = (await browser.storage.session.get(key))[key] as Partial<RecentFill> | undefined;
    if (
      stored === undefined ||
      typeof stored.expiresAt !== "number" ||
      typeof stored.fingerprint !== "string" ||
      stored.expiresAt <= Date.now()
    ) {
      await browser.storage.session.remove(key);
      return false;
    }
    return stored.fingerprint === (await credentialFingerprint(credential));
  };
  const loadPending = async (tabId: number): Promise<PendingCapture | null> => {
    const key = pendingKey(tabId);
    const value = (await browser.storage.session.get(key))[key];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      await browser.storage.session.remove(key);
      return null;
    }
    const pending = value as Partial<PendingCapture>;
    if (
      !["save", "update"].includes(pending.action ?? "") ||
      typeof pending.displayHost !== "string" ||
      typeof pending.expiresAt !== "number" ||
      typeof pending.username !== "string" ||
      (pending.approved !== undefined && typeof pending.approved !== "boolean") ||
      parseCaptureRequest(pending.capture, CAPTURE_REQUEST_TYPE) === null
    ) {
      await browser.storage.session.remove(key);
      return null;
    }
    return { ...(pending as PendingCapture), approved: pending.approved === true };
  };
  const savePending = (tabId: number, pending: PendingCapture) =>
    browser.storage.session.set({ [pendingKey(tabId)]: pending });
  const deletePending = (tabId: number) => browser.storage.session.remove(pendingKey(tabId));
  const breachCheckFor = async (password: string) => {
    const result = await checkPwnedPassword(password);
    const checkedAt = new Date().toISOString();
    return result.status === "found"
      ? ({ checkedAt, count: result.count, status: "found" } as const)
      : ({ checkedAt, status: result.status } as const);
  };

  const trustedOrigin = (topUrl: string, sender: Browser.runtime.MessageSender): boolean => {
    try {
      return (
        sender.id === browser.runtime.id &&
        sender.frameId === 0 &&
        sender.tab !== undefined &&
        new URL(sender.url ?? "").origin === new URL(topUrl).origin
      );
    } catch {
      return false;
    }
  };
  const pendingMatchesSender = (
    _pending: PendingCapture,
    sender: Browser.runtime.MessageSender,
  ): boolean => {
    return sender.id === browser.runtime.id && sender.frameId === 0 && sender.tab?.id !== undefined;
  };
  const unlockedItems = async (): Promise<readonly VaultItem[] | null> => {
    await initialized;
    if (service.getState().status !== "unlocked" && service.resumeSession !== undefined) {
      const material = await coordinator.load();
      if (material !== null) {
        try {
          await service.resumeSession(material);
        } catch {
          return null;
        } finally {
          zeroBytes(material.rootKey);
        }
      }
    }
    if (service.getState().status !== "unlocked" || service.listItems === undefined) return null;
    try {
      const items = await service.listItems();
      await writeAutofillMetadataIndex(items, browser.storage.local);
      return items;
    } catch {
      return null;
    }
  };
  const unlockedLogins = async (): Promise<readonly LoginItem[] | null> => {
    const items = await unlockedItems();
    return items?.filter((item): item is LoginItem => item.type === "login") ?? null;
  };
  const commitPendingCapture = async (
    tabId: number,
    pending: PendingCapture,
  ): Promise<CaptureResponse> => {
    const logins = await unlockedLogins();
    if (logins === null) return { status: "locked", version: 1 };
    const decision = decideCredentialCapture({
      captured: { password: pending.capture.password, username: pending.username },
      credentials: logins.map((login) => ({
        id: login.id,
        password: login.password,
        passwordMatches: login.password === pending.capture.password,
        uris: login.uris,
        username: login.username,
      })),
      frameUrl: pending.capture.topUrl,
      topUrl: pending.capture.topUrl,
    });
    if (decision.action === "none") {
      await deletePending(tabId);
      await browser.action.setPopup({ popup: "popup.html", tabId });
      return {
        status: decision.reason === "UNCHANGED" ? "unchanged" : "unsafe",
        version: 1,
      };
    }
    if (decision.action === "save") {
      if (service.createLogin === undefined) return { status: "unavailable", version: 1 };
      const pendingAlias = await loadPendingPrivateEmail(tabId, pending.capture.topUrl);
      await service.createLogin({
        breachCheck: await breachCheckFor(pending.capture.password),
        ...(pendingAlias !== null &&
        pendingAlias.address.toLocaleLowerCase() === pending.username.trim().toLocaleLowerCase()
          ? {
              emailAlias: {
                address: pendingAlias.address,
                createdAt: pendingAlias.createdAt,
                createdForOrigin: pendingAlias.createdForOrigin,
                provider: pendingAlias.provider,
                ...(pendingAlias.providerAliasId === undefined
                  ? {}
                  : { providerAliasId: pendingAlias.providerAliasId }),
                ...(pendingAlias.sourceEmail === undefined
                  ? {}
                  : { sourceEmail: pendingAlias.sourceEmail }),
              },
            }
          : {}),
        notes: "",
        password: pending.capture.password,
        title: decision.displayHost,
        uris: [decision.canonicalOrigin],
        username: pending.username,
      });
    } else {
      const existing = logins.find((login) => login.id === decision.credentialId);
      if (existing === undefined || service.updateLogin === undefined) {
        return { status: "unavailable", version: 1 };
      }
      await service.updateLogin(existing.id, existing.revisionId, {
        ...(existing.favorite === undefined ? {} : { favorite: existing.favorite }),
        ...(existing.folder === undefined ? {} : { folder: existing.folder }),
        breachCheck: await breachCheckFor(pending.capture.password),
        ...(existing.emailAlias === undefined ? {} : { emailAlias: existing.emailAlias }),
        notes: existing.notes,
        password: pending.capture.password,
        ...(existing.passkeys === undefined ? {} : { passkeys: existing.passkeys }),
        ...(existing.tags === undefined ? {} : { tags: existing.tags }),
        title: existing.title,
        ...(existing.totpUri === undefined ? {} : { totpUri: existing.totpUri }),
        uris: existing.uris,
        username: pending.username,
      });
    }
    await deletePending(tabId);
    await browser.storage.session.remove(privateEmailKey(tabId));
    await browser.action.setPopup({ popup: "popup.html", tabId });
    await unlockedLogins();
    return { action: decision.action, status: "saved", version: 1 };
  };
  const commitApprovedPendingCaptures = async (): Promise<void> => {
    const stored = await browser.storage.session.get(null);
    const prefix = "zk-wallet.pending-capture.v1.";
    for (const key of Object.keys(stored)) {
      if (!key.startsWith(prefix)) continue;
      const tabId = Number(key.slice(prefix.length));
      if (!Number.isSafeInteger(tabId) || tabId < 0) continue;
      const pending = await loadPending(tabId);
      if (pending === null || pending.expiresAt <= Date.now()) {
        await deletePending(tabId);
        continue;
      }
      if (pending.approved) await commitPendingCapture(tabId, pending);
    }
  };
  const openCaptureAuthentication = async (
    tabId: number,
    windowId: number | undefined,
  ): Promise<void> => {
    const popupUrl = new URL(browser.runtime.getURL("/popup.html"));
    popupUrl.searchParams.set(
      "displayHost",
      (await loadPending(tabId))?.displayHost ?? "this site",
    );
    popupUrl.searchParams.set("mode", "capture-auth");
    popupUrl.searchParams.set("tabId", String(tabId));
    const popupPath = `${popupUrl.pathname.replace(/^\/+/u, "")}${popupUrl.search}`;
    await browser.action.setPopup({ popup: popupPath, tabId });
    try {
      await browser.action.openPopup({
        ...(windowId === undefined ? {} : { windowId }),
      });
    } catch {
      await browser.windows.create({
        focused: true,
        height: 390,
        type: "popup",
        url: popupUrl.href,
        width: 320,
      });
    }
  };
  const observationKey = (sender: Browser.runtime.MessageSender, topUrl: string): string | null => {
    if (sender.tab?.id === undefined) return null;
    try {
      return `zk-wallet.observed-username.v1.${sender.tab.id}.${encodeURIComponent(new URL(topUrl).origin)}`;
    } catch {
      return null;
    }
  };
  const loadObservedUsername = async (
    key: string | null,
  ): Promise<{ readonly expiresAt: number; readonly username: string } | null> => {
    if (key === null) return null;
    const value = (await browser.storage.session.get(key))[key];
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("expiresAt" in value) ||
      typeof value.expiresAt !== "number" ||
      !("username" in value) ||
      typeof value.username !== "string"
    ) {
      await browser.storage.session.remove(key);
      return null;
    }
    return value as { readonly expiresAt: number; readonly username: string };
  };

  browser.runtime.onMessage.addListener(
    async (
      message,
      sender,
    ): Promise<
      | AutofillResponse
      | CardAutofillResponse
      | CaptureResponse
      | PrivateEmailResponse
      | ProfileAutofillResponse
      | undefined
    > => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "unlocked" &&
        "version" in message &&
        message.version === 1 &&
        sender.id === browser.runtime.id &&
        sender.tab === undefined
      ) {
        await commitApprovedPendingCaptures();
        return;
      }
      const openManager = parseOpenVaultManagerRequest(message);
      if (openManager !== null) {
        if (sender.id !== browser.runtime.id) return;
        await browser.tabs.create({ url: browser.runtime.getURL("/popup.html?mode=manager") });
        return;
      }
      const filledReceipt = parseAutofillFilledRequest(message);
      if (filledReceipt !== null) {
        if (!trustedOrigin(filledReceipt.topUrl, sender) || sender.tab?.id === undefined) return;
        await rememberRecentFill(sender.tab.id, filledReceipt);
        return;
      }
      const privateEmailRequest = parsePrivateEmailRequest(message);
      if (privateEmailRequest !== null) {
        if (!trustedOrigin(privateEmailRequest.topUrl, sender) || sender.tab?.id === undefined) {
          return { status: "unavailable", version: 1 };
        }
        const cached = await loadPendingPrivateEmail(sender.tab.id, privateEmailRequest.topUrl);
        if (cached !== null) {
          return {
            address: cached.address,
            provider: cached.provider,
            status: "value",
            version: 1,
          };
        }
        const items = await unlockedItems();
        if (items === null) return { status: "locked", version: 1 };
        const settingsNote = items.find(
          (item): item is SecureNoteItem =>
            item.type === "secure-note" && item.tags?.includes(PRIVATE_EMAIL_SETTINGS_TAG) === true,
        );
        if (settingsNote === undefined) return { status: "not-configured", version: 1 };
        const settings = parsePrivateEmailSettingsNote(settingsNote.note);
        if (settings === null) return { status: "not-configured", version: 1 };
        if (!settings.autoFill) return { status: "disabled", version: 1 };
        try {
          const alias = await createPrivateEmailAlias(settings, privateEmailRequest.topUrl, {
            randomBytes(length) {
              const output = new Uint8Array(length);
              crypto.getRandomValues(output);
              return output;
            },
          });
          await browser.storage.session.set({
            [privateEmailKey(sender.tab.id)]: {
              ...alias,
              expiresAt: Date.now() + 30 * 60 * 1_000,
            } satisfies PendingPrivateEmail,
          });
          return { address: alias.address, provider: alias.provider, status: "value", version: 1 };
        } catch {
          return { status: "unavailable", version: 1 };
        }
      }
      const profileSelection = parseProfileAutofillSelectRequest(message);
      if (profileSelection !== null) {
        if (!trustedOrigin(profileSelection.topUrl, sender)) {
          return { status: "unavailable", version: 1 };
        }
        const items = await unlockedItems();
        if (items === null) return { status: "locked", version: 1 };
        const profile = items.find(
          (item): item is IdentityProfileItem =>
            item.type === "identity-profile" && item.id === profileSelection.profileId,
        );
        if (profile === undefined) return { status: "no-match", version: 1 };
        const value = profile[profileSelection.field];
        return value.length === 0
          ? { status: "no-match", version: 1 }
          : { status: "value", value, version: 1 };
      }

      const cardSelection = parseCardAutofillSelectRequest(message);
      if (cardSelection !== null) {
        if (!trustedOrigin(cardSelection.topUrl, sender)) {
          return { status: "unavailable", version: 1 };
        }
        const items = await unlockedItems();
        if (items === null) return { status: "locked", version: 1 };
        const card = items.find(
          (item): item is PaymentCardItem =>
            item.type === "payment-card" && item.id === cardSelection.cardId,
        );
        if (card === undefined) return { status: "no-match", version: 1 };
        const value =
          cardSelection.field === "expiry"
            ? [card.expiryMonth, card.expiryYear].filter(Boolean).join("/")
            : card[cardSelection.field];
        return value.trim().length === 0
          ? { status: "no-match", version: 1 }
          : { status: "value", value, version: 1 };
      }

      const cardRequest = parseCardAutofillRequest(message);
      if (cardRequest !== null) {
        if (!trustedOrigin(cardRequest.topUrl, sender)) {
          return { status: "unavailable", version: 1 };
        }
        const items = await unlockedItems();
        if (items === null) return { status: "locked", version: 1 };
        const cards = items.filter((item): item is PaymentCardItem => {
          if (item.type !== "payment-card") return false;
          return cardRequest.field === "expiry"
            ? item.expiryMonth.trim().length > 0 && item.expiryYear.trim().length > 0
            : item[cardRequest.field].trim().length > 0;
        });
        if (cards.length === 0) return { status: "no-match", version: 1 };
        return {
          cards: cards.map((card) => {
            const lastFour = card.cardNumber.replace(/\D/gu, "").slice(-4);
            return {
              id: card.id,
              label: `${card.title}${lastFour.length === 4 ? ` •••• ${lastFour}` : ""}`,
            };
          }),
          status: "suggestions",
          version: 1,
        } satisfies CardAutofillResponse;
      }

      const profileRequest = parseProfileAutofillRequest(message);
      if (profileRequest !== null) {
        if (!trustedOrigin(profileRequest.topUrl, sender)) {
          return { status: "unavailable", version: 1 };
        }
        const items = await unlockedItems();
        if (items === null) return { status: "locked", version: 1 };
        const profiles = items.filter(
          (item): item is IdentityProfileItem =>
            item.type === "identity-profile" && item[profileRequest.field].trim().length > 0,
        );
        if (profiles.length === 0) return { status: "no-match", version: 1 };
        return {
          profiles: profiles.map((profile) => ({
            id: profile.id,
            label:
              [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
              profile.nickname ||
              profile.title,
          })),
          status: "suggestions",
          version: 1,
        };
      }

      const authenticatedSelection = parseAuthenticatedAutofillSelectRequest(message);
      const biometricAutofill = parseBiometricAutofillRequest(message);
      const manualAutofill = parseManualAutofillRequest(message);
      const authenticatedAutofill = authenticatedSelection ?? biometricAutofill ?? manualAutofill;
      if (authenticatedAutofill !== null) {
        if (!trustedOrigin(authenticatedAutofill.topUrl, sender) || sender.tab?.id === undefined) {
          return { status: "unavailable", version: 1 };
        }
        if (authenticatedSelection !== null) {
          const logins = await unlockedLogins();
          if (logins !== null) {
            const selected = logins.find(
              (login) =>
                login.id === authenticatedSelection.credentialId &&
                decideAutofill({
                  credentials: [{ id: login.id, uris: login.uris }],
                  frameUrl: authenticatedSelection.topUrl,
                  topUrl: authenticatedSelection.topUrl,
                  userInitiated: true,
                }).allowed,
            );
            if (selected === undefined) return { status: "no-match", version: 1 };
            try {
              const result = (await browser.tabs.sendMessage(sender.tab.id, {
                password: selected.password,
                submit: authenticatedSelection.submit,
                topUrl: authenticatedSelection.topUrl,
                type: BIOMETRIC_FILL_TYPE,
                username: selected.username,
                version: 1,
              })) as { readonly filled?: boolean } | undefined;
              if (result?.filled === true) {
                await rememberRecentFill(sender.tab.id, {
                  password: selected.password,
                  topUrl: authenticatedSelection.topUrl,
                  username: selected.username,
                });
              }
              return result?.filled === true
                ? { status: "filled", version: 1 }
                : { status: "unavailable", version: 1 };
            } catch {
              return { status: "unavailable", version: 1 };
            }
          }
        }
        const targetUrl = new URL(authenticatedAutofill.topUrl);
        const popupUrl = new URL(browser.runtime.getURL("/popup.html"));
        const mode =
          authenticatedSelection === null
            ? biometricAutofill === null
              ? "manual-autofill"
              : "biometric-autofill"
            : authenticatedSelection.method === "biometric"
              ? "biometric-autofill"
              : "manual-autofill";
        popupUrl.searchParams.set("mode", mode);
        popupUrl.searchParams.set("tabId", String(sender.tab.id));
        popupUrl.searchParams.set("topUrl", targetUrl.href);
        if (authenticatedSelection !== null) {
          popupUrl.searchParams.set("credentialId", authenticatedSelection.credentialId);
          popupUrl.searchParams.set("submit", String(authenticatedSelection.submit));
        } else {
          const observed = await loadObservedUsername(
            observationKey(sender, authenticatedAutofill.topUrl),
          );
          if (
            observed !== null &&
            observed.expiresAt > Date.now() &&
            observed.username.trim().length > 0
          ) {
            popupUrl.searchParams.set("usernameHint", observed.username.slice(0, 320));
          }
        }
        const popupPath = `${popupUrl.pathname.replace(/^\/+/u, "")}${popupUrl.search}`;
        await browser.action.setPopup({
          popup: popupPath,
          tabId: sender.tab.id,
        });
        try {
          await browser.action.openPopup({
            ...(sender.tab.windowId === undefined ? {} : { windowId: sender.tab.windowId }),
          });
        } catch {
          // Chrome before 127 and browsers without programmatic action popups retain
          // the isolated extension-window fallback.
          await browser.windows.create({
            focused: true,
            height: mode === "biometric-autofill" ? 270 : 320,
            type: "popup",
            url: popupUrl.href,
            width: 300,
          });
        }
        return { status: "opening-authentication", version: 1 };
      }

      const autofill = parseAutofillRequest(message);
      if (autofill !== null) {
        if (!trustedOrigin(autofill.topUrl, sender)) {
          return { status: "unavailable", version: 1 };
        }
        const logins = await unlockedLogins();
        if (logins === null) {
          const state = service.getState();
          const origin = new URL(autofill.topUrl).origin;
          const indexed = (await readAutofillMetadataIndex(browser.storage.local)).filter((entry) =>
            entry.origins.includes(origin),
          );
          if (indexed.length > 0) {
            return {
              credentials: indexed.map(({ id, username }) => ({ id, username })),
              deviceSlots: "deviceUnlock" in state ? state.deviceUnlock.slots : [],
              displayHost: new URL(autofill.topUrl).hostname,
              status: "suggestions",
              version: 1,
            };
          }
          return {
            deviceSlots: "deviceUnlock" in state ? state.deviceUnlock.slots : [],
            status: "locked",
            version: 1,
          };
        }
        const matching = logins.filter(
          (login) =>
            decideAutofill({
              credentials: [{ id: login.id, uris: login.uris }],
              frameUrl: autofill.topUrl,
              topUrl: autofill.topUrl,
              userInitiated: true,
            }).allowed,
        );
        if (matching.length === 0) return { status: "no-match", version: 1 };
        const candidates = preferNamedCredentials(matching);
        const state = service.getState();
        return {
          credentials: candidates.map((login) => ({ id: login.id, username: login.username })),
          deviceSlots: "deviceUnlock" in state ? state.deviceUnlock.slots : [],
          displayHost: new URL(autofill.topUrl).hostname,
          status: "suggestions",
          version: 1,
        };
      }

      const observed = parseUsernameObservedRequest(message);
      if (observed !== null) {
        if (!trustedOrigin(observed.topUrl, sender)) return { status: "unavailable", version: 1 };
        const key = observationKey(sender, observed.topUrl);
        if (key !== null) {
          await browser.storage.session.set({
            [key]: {
              expiresAt: Date.now() + 10 * 60 * 1_000,
              username: observed.username,
            },
          });
        }
        return;
      }

      const tabId = sender.tab?.id;
      const pendingQuery = parseCapturePendingRequest(message);
      if (pendingQuery !== null) {
        if (sender.id !== browser.runtime.id || sender.frameId !== 0 || tabId === undefined) return;
        const pending = await loadPending(tabId);
        if (pending === null || pending.expiresAt <= Date.now()) {
          await deletePending(tabId);
          return { status: "unavailable", version: 1 };
        }
        if (pending.approved) return { status: "unavailable", version: 1 };
        if (!pendingMatchesSender(pending, sender)) {
          return { status: "unavailable", version: 1 };
        }
        return {
          action: pending.action,
          displayHost: pending.displayHost,
          status: "offer",
          version: 1,
        };
      }

      const dismiss = parseCaptureActionRequest(message, CAPTURE_DISMISS_TYPE);
      if (dismiss !== null) {
        if (sender.id === browser.runtime.id && sender.frameId === 0 && tabId !== undefined) {
          const pending = await loadPending(tabId);
          if (pending !== null && pendingMatchesSender(pending, sender)) {
            await deletePending(tabId);
          }
        }
        return;
      }

      const confirm = parseCaptureActionRequest(message, CAPTURE_CONFIRM_TYPE);
      if (confirm !== null) {
        if (sender.id !== browser.runtime.id || sender.frameId !== 0 || tabId === undefined) {
          return { status: "unavailable", version: 1 };
        }
        const pending = await loadPending(tabId);
        if (pending === null || pending.expiresAt <= Date.now()) {
          await deletePending(tabId);
          return { status: "unavailable", version: 1 };
        }
        if (!pendingMatchesSender(pending, sender)) {
          return { status: "unavailable", version: 1 };
        }
        const saved = await commitPendingCapture(tabId, pending);
        if (saved.status === "locked") {
          await savePending(tabId, { ...pending, approved: true });
          await openCaptureAuthentication(tabId, sender.tab?.windowId);
        }
        return saved;
      }

      const capture = parseCaptureRequest(message, CAPTURE_REQUEST_TYPE);
      if (capture === null) return;
      if (!trustedOrigin(capture.topUrl, sender)) {
        return { status: "unavailable", version: 1 };
      }
      const key = observationKey(sender, capture.topUrl);
      const remembered = await loadObservedUsername(key);
      if (key !== null && remembered !== null && remembered.expiresAt <= Date.now()) {
        await browser.storage.session.remove(key);
      }
      const username =
        capture.username.length > 0
          ? capture.username
          : remembered !== null && remembered.expiresAt > Date.now()
            ? remembered.username
            : "";
      if (
        tabId !== undefined &&
        (await matchesRecentFill(tabId, {
          password: capture.password,
          topUrl: capture.topUrl,
          username,
        }))
      ) {
        await deletePending(tabId);
        return { status: "unchanged", version: 1 };
      }
      const logins = await unlockedLogins();
      if (logins === null) {
        if (tabId === undefined) return { status: "unavailable", version: 1 };
        const target = new URL(capture.topUrl);
        await savePending(tabId, {
          action: "save",
          approved: false,
          capture,
          displayHost: target.hostname,
          expiresAt: Date.now() + 10 * 60 * 1_000,
          username,
        });
        return { displayHost: target.hostname, status: "locked", version: 1 };
      }
      const decision = decideCredentialCapture({
        captured: { password: capture.password, username },
        credentials: logins.map((login) => ({
          id: login.id,
          password: login.password,
          passwordMatches: login.password === capture.password,
          uris: login.uris,
          username: login.username,
        })),
        frameUrl: capture.topUrl,
        topUrl: capture.topUrl,
      });
      if (decision.action === "none") {
        if (tabId !== undefined) {
          await deletePending(tabId);
          await browser.action.setPopup({ popup: "popup.html", tabId });
        }
        if (key !== null) await browser.storage.session.remove(key);
        return {
          status: decision.reason === "UNCHANGED" ? "unchanged" : "unsafe",
          version: 1,
        };
      }
      if (tabId === undefined) return { status: "unavailable", version: 1 };
      await savePending(tabId, {
        action: decision.action,
        approved: false,
        capture,
        displayHost: decision.displayHost,
        expiresAt: Date.now() + 10 * 60 * 1_000,
        username,
      });
      if (key !== null) await browser.storage.session.remove(key);
      return {
        action: decision.action,
        displayHost: decision.displayHost,
        status: "offer",
        version: 1,
      };
    },
  );
});
