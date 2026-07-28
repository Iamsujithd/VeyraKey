import { createCryptoProvider, createWebAuthnPrfProvider, zeroBytes } from "@zk-wallet/crypto";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbVaultHeaderRepository,
} from "@zk-wallet/persistence";
import { decideAutofill, decideCredentialCapture } from "@zk-wallet/security";
import { createVaultService, type LoginItem } from "@zk-wallet/vault";
import {
  type AutofillResponse,
  CAPTURE_CONFIRM_TYPE,
  CAPTURE_DISMISS_TYPE,
  CAPTURE_REQUEST_TYPE,
  type CaptureRequest,
  type CaptureResponse,
  parseAuthenticatedAutofillSelectRequest,
  parseAutofillRequest,
  parseBiometricAutofillRequest,
  parseCaptureActionRequest,
  parseCapturePendingRequest,
  parseCaptureRequest,
  parseManualAutofillRequest,
  parseUsernameObservedRequest,
} from "../src/autofill";
import { ExtensionSessionCoordinator } from "../src/session";

export default defineBackground(() => {
  const service = createVaultService({
    crypto: createCryptoProvider(),
    devicePrf: createWebAuthnPrfProvider(),
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
    readonly capture: CaptureRequest;
    readonly displayHost: string;
    readonly expiresAt: number;
    readonly username: string;
  };
  const pendingKey = (tabId: number) => `zk-wallet.pending-capture.v1.${tabId}`;
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
      parseCaptureRequest(pending.capture, CAPTURE_REQUEST_TYPE) === null
    ) {
      await browser.storage.session.remove(key);
      return null;
    }
    return pending as PendingCapture;
  };
  const savePending = (tabId: number, pending: PendingCapture) =>
    browser.storage.session.set({ [pendingKey(tabId)]: pending });
  const deletePending = (tabId: number) => browser.storage.session.remove(pendingKey(tabId));

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
  const unlockedLogins = async (): Promise<readonly LoginItem[] | null> => {
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
      return (await service.listItems()).filter((item): item is LoginItem => item.type === "login");
    } catch {
      return null;
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
    async (message, sender): Promise<AutofillResponse | CaptureResponse | undefined> => {
      const authenticatedSelection = parseAuthenticatedAutofillSelectRequest(message);
      const biometricAutofill = parseBiometricAutofillRequest(message);
      const manualAutofill = parseManualAutofillRequest(message);
      const authenticatedAutofill = authenticatedSelection ?? biometricAutofill ?? manualAutofill;
      if (authenticatedAutofill !== null) {
        if (!trustedOrigin(authenticatedAutofill.topUrl, sender) || sender.tab?.id === undefined) {
          return { status: "unavailable", version: 1 };
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
        const state = service.getState();
        return {
          credentials: matching.map((login) => ({ id: login.id, username: login.username })),
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
          await deletePending(tabId);
        }
        return;
      }

      const confirm = parseCaptureActionRequest(message, CAPTURE_CONFIRM_TYPE);
      if (confirm !== null) {
        if (sender.id !== browser.runtime.id || sender.frameId !== 0 || tabId === undefined) {
          return { status: "unavailable", version: 1 };
        }
        const pending = await loadPending(tabId);
        await deletePending(tabId);
        if (pending === null || pending.expiresAt <= Date.now()) {
          return { status: "unavailable", version: 1 };
        }
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
          return {
            status: decision.reason === "UNCHANGED" ? "unchanged" : "unsafe",
            version: 1,
          };
        }
        if (decision.action === "save") {
          if (service.createLogin === undefined) return { status: "unavailable", version: 1 };
          await service.createLogin({
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
            notes: existing.notes,
            password: pending.capture.password,
            ...(existing.tags === undefined ? {} : { tags: existing.tags }),
            title: existing.title,
            uris: existing.uris,
            username: pending.username,
          });
        }
        return { action: decision.action, status: "saved", version: 1 };
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
      const logins = await unlockedLogins();
      if (logins === null) return { status: "locked", version: 1 };
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
        return {
          status: decision.reason === "UNCHANGED" ? "unchanged" : "unsafe",
          version: 1,
        };
      }
      if (tabId === undefined) return { status: "unavailable", version: 1 };
      await savePending(tabId, {
        action: decision.action,
        capture,
        displayHost: decision.displayHost,
        expiresAt: Date.now() + 2 * 60 * 1_000,
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
