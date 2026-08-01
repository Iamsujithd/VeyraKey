import { createCryptoProvider } from "@zk-wallet/crypto";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbVaultHeaderRepository,
} from "@zk-wallet/persistence";
import {
  decideAutofill,
  decideCredentialCapture,
  generateTotp,
  parseOtpAuthUri,
} from "@zk-wallet/security";
import type { VaultClient } from "@zk-wallet/ui";
import { createVaultService, type LoginItem, type VaultPublicState } from "@zk-wallet/vault";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BIOMETRIC_FILL_TYPE, SHOW_AUTOFILL_TYPE } from "../../src/autofill";
import { readAutofillMetadataIndex, writeAutofillMetadataIndex } from "../../src/autofillIndex";
import { createExtensionDevicePrfProvider } from "../../src/devicePrf";
import { withExtensionGoogleDriveSync } from "../../src/googleDrive";
import {
  ExtensionSessionCoordinator,
  type ExtensionSessionEvent,
  withExtensionSession,
} from "../../src/session";

const VaultScreen = lazy(async () => {
  const module = await import("@zk-wallet/ui");
  return { default: module.VaultScreen };
});

export interface AppProps {
  readonly client?: VaultClient;
}

export async function showInlineAutofill(): Promise<string> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) return "The active page is unavailable.";
  if (!tab.url.startsWith("https://")) return "Passwords only runs on secure web pages.";
  const response = (await browser.tabs.sendMessage(tab.id, {
    type: SHOW_AUTOFILL_TYPE,
    version: 1,
  })) as { readonly shown?: boolean } | undefined;
  return response?.shown === true
    ? "Passwords opened beside the relevant field."
    : "No supported login, signup, or contact field was found.";
}

export async function openVaultManager(): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL("/popup.html?mode=manager") });
}

interface CaptureProposal {
  readonly action: "save" | "update";
  readonly canonicalOrigin: string;
  readonly displayHost: string;
  readonly existingId?: string;
  readonly existingRevisionId?: string;
  readonly password: string;
  readonly username: string;
}

export async function captureActiveTab(client: VaultClient): Promise<CaptureProposal | string> {
  if (client.getState().status !== "unlocked") return "Unlock the vault before saving a login.";
  if (client.listItems === undefined) return "Encrypted login access is unavailable.";
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) return "The active page is unavailable.";
  const result = await browser.scripting.executeScript({
    func: () => {
      if (window.top !== window || location.protocol !== "https:") return null;
      const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(
        (input) =>
          input.isConnected && !input.disabled && !input.readOnly && input.type !== "hidden",
      );
      const password = inputs.find(
        (input) =>
          input.type === "password" ||
          ["current-password", "new-password"].includes(input.autocomplete),
      );
      if (password === undefined || password.value.length === 0) return null;
      const username =
        inputs.find((input) => ["email", "username"].includes(input.autocomplete)) ??
        inputs.find((input) => ["email", "text"].includes(input.type));
      return { password: password.value, username: username?.value ?? "" };
    },
    target: { frameIds: [0], tabId: tab.id },
  });
  const captured = result[0]?.result;
  if (
    typeof captured !== "object" ||
    captured === null ||
    typeof captured.password !== "string" ||
    typeof captured.username !== "string"
  ) {
    return "No completed standard login form was found.";
  }
  const logins = (await client.listItems()).filter(
    (item): item is LoginItem => item.type === "login",
  );
  const decision = decideCredentialCapture({
    captured,
    credentials: logins.map((item) => ({
      id: item.id,
      passwordMatches: item.password === captured.password,
      password: item.password,
      uris: item.uris,
      username: item.username,
    })),
    frameUrl: tab.url,
    topUrl: tab.url,
  });
  if (decision.action === "none") {
    return decision.reason === "UNCHANGED"
      ? "This saved login is already up to date."
      : "This page is not safe for credential capture.";
  }
  const existing =
    decision.action === "update"
      ? logins.find((item) => item.id === decision.credentialId)
      : undefined;
  return {
    action: decision.action,
    canonicalOrigin: decision.canonicalOrigin,
    displayHost: decision.displayHost,
    ...(existing === undefined
      ? {}
      : { existingId: existing.id, existingRevisionId: existing.revisionId }),
    password: captured.password,
    username: captured.username,
  };
}

export async function fillActiveTotp(client: VaultClient): Promise<string> {
  if (client.getState().status !== "unlocked" || client.listItems === undefined) {
    return "Unlock the vault before filling an authenticator code.";
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) return "The active page is unavailable.";
  const logins = (await client.listItems()).filter(
    (item): item is LoginItem => item.type === "login" && Boolean(item.totpUri),
  );
  const decision = decideAutofill({
    credentials: logins.map((item) => ({ id: item.id, uris: item.uris })),
    frameUrl: tab.url,
    topUrl: tab.url,
    userInitiated: true,
  });
  if (!decision.allowed) return "No single exact-origin authenticator is available.";
  const login = logins.find((item) => item.id === decision.credentialId);
  if (login?.totpUri === undefined) return "The authenticator configuration is unavailable.";
  const { code } = await generateTotp(parseOtpAuthUri(login.totpUri), Date.now());
  const result = await browser.scripting.executeScript({
    args: [code],
    func: (value: string) => {
      if (window.top !== window || location.protocol !== "https:") return false;
      const input = [...document.querySelectorAll<HTMLInputElement>("input")].find(
        (candidate) =>
          candidate.isConnected &&
          !candidate.disabled &&
          !candidate.readOnly &&
          (candidate.autocomplete === "one-time-code" ||
            /otp|totp|verification.?code/u.test(
              `${candidate.name} ${candidate.id} ${candidate.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase(),
            )),
      );
      if (input === undefined) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    target: { frameIds: [0], tabId: tab.id },
  });
  return result[0]?.result === true
    ? `Filled a current code for ${decision.displayHost}.`
    : "No conservative one-time-code field was found.";
}

function createLocalVaultClient(): VaultClient {
  const crypto = createCryptoProvider();
  const client = createVaultService({
    crypto,
    devicePrf: createExtensionDevicePrfProvider(),
    itemRepository: new IndexedDbItemRevisionRepository(),
    repository: new IndexedDbVaultHeaderRepository(),
  });
  const coordinator = new ExtensionSessionCoordinator({
    bus: {
      publish: async (message) => {
        await browser.runtime.sendMessage(message).catch(() => undefined);
      },
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
            listener(message as ExtensionSessionEvent);
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
  const coordinated = withExtensionSession(
    withExtensionGoogleDriveSync(client, crypto),
    coordinator,
  );
  if (coordinated.listItems === undefined) return coordinated;
  return {
    ...coordinated,
    async listItems() {
      const items = await coordinated.listItems?.();
      if (items === undefined) return [];
      await writeAutofillMetadataIndex(items, browser.storage.local);
      return items;
    },
  };
}

interface AuthenticatedAutofillTarget {
  readonly credentialId?: string;
  readonly method: "biometric" | "password";
  readonly submitAfterFill?: boolean;
  readonly tabId: number;
  readonly topUrl: string;
  readonly usernameHint?: string;
}

interface CaptureAuthenticationTarget {
  readonly displayHost: string;
  readonly tabId: number;
}

export function captureAuthenticationTarget(search: string): CaptureAuthenticationTarget | null {
  const parameters = new URLSearchParams(search);
  if ([...parameters.keys()].sort().join(",") !== "displayHost,mode,tabId") return null;
  if (parameters.get("mode") !== "capture-auth") return null;
  const tabId = Number(parameters.get("tabId"));
  const displayHost = parameters.get("displayHost")?.trim() ?? "";
  if (
    !Number.isSafeInteger(tabId) ||
    tabId < 0 ||
    displayHost.length === 0 ||
    displayHost.length > 253
  )
    return null;
  return { displayHost, tabId };
}

export function authenticatedAutofillTarget(search: string): AuthenticatedAutofillTarget | null {
  const parameters = new URLSearchParams(search);
  const mode = parameters.get("mode");
  if (!["biometric-autofill", "manual-autofill"].includes(mode ?? "")) return null;
  const credentialId = parameters.get("credentialId");
  const submit = parameters.get("submit");
  const usernameHint = parameters.get("usernameHint");
  if ((credentialId === null) !== (submit === null)) return null;
  if (credentialId !== null && usernameHint !== null) return null;
  const expectedKeys =
    credentialId === null
      ? usernameHint === null
        ? "mode,tabId,topUrl"
        : "mode,tabId,topUrl,usernameHint"
      : "credentialId,mode,submit,tabId,topUrl";
  if ([...parameters.keys()].sort().join(",") !== expectedKeys) return null;
  if (
    credentialId !== null &&
    (!/^[A-Za-z0-9_-]{1,128}$/u.test(credentialId) || !["false", "true"].includes(submit ?? ""))
  ) {
    return null;
  }
  const tabId = Number(parameters.get("tabId"));
  const topUrl = parameters.get("topUrl");
  if (
    !Number.isSafeInteger(tabId) ||
    tabId < 0 ||
    topUrl === null ||
    (usernameHint !== null && (usernameHint.trim().length === 0 || usernameHint.length > 320))
  ) {
    return null;
  }
  try {
    const parsed = new URL(topUrl);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
      ? {
          ...(credentialId === null ? {} : { credentialId, submitAfterFill: submit === "true" }),
          method: mode === "biometric-autofill" ? "biometric" : "password",
          tabId,
          topUrl: parsed.href,
          ...(usernameHint === null ? {} : { usernameHint }),
        }
      : null;
  } catch {
    return null;
  }
}

function CaptureAuthentication({
  client,
  target,
}: {
  readonly client: VaultClient;
  readonly target: CaptureAuthenticationTarget;
}) {
  const [state, setState] = useState<VaultPublicState | { readonly status: "preparing" }>({
    status: "preparing",
  });
  const [manualPassword, setManualPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [useMasterPassword, setUseMasterPassword] = useState(false);
  const [status, setStatus] = useState("Choose how to confirm this save.");
  const slots = "deviceUnlock" in state ? state.deviceUnlock.slots : [];

  useEffect(() => {
    let active = true;
    const unsubscribe = client.subscribe((nextState) => {
      if (active) setState(nextState);
    });
    void client
      .initialize()
      .then((nextState) => {
        if (!active) return;
        setState(nextState);
        if (nextState.status === "unlocked") window.close();
        else if ("deviceUnlock" in nextState && nextState.deviceUnlock.slots.length === 0) {
          setUseMasterPassword(true);
          setStatus("Enter your master password to save this login.");
        }
      })
      .catch(() => {
        if (active) setStatus("The encrypted vault could not be opened.");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const unlockWithDevice = async () => {
    const slot = slots[0];
    if (slot === undefined) {
      setUseMasterPassword(true);
      setStatus("Enter your master password to save this login.");
      return;
    }
    setBusy(true);
    setStatus("Confirm with Touch ID.");
    try {
      await client.unlockWithDevice(slot.id);
      setStatus("Login saved.");
      window.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const retryable = message.includes("canceled or timed out");
      setStatus(
        retryable
          ? "Touch ID was canceled."
          : message.includes("not available to this app")
            ? "This Touch ID enrollment belongs to another app or browser profile. Use your master password and replace it in Settings."
            : message.includes("not supported")
              ? "Touch ID is unavailable in this browser profile."
              : "Touch ID could not unlock this vault. Use your master password and repair device unlock in Settings.",
      );
      if (!retryable) setUseMasterPassword(true);
    } finally {
      setBusy(false);
    }
  };

  const unlockWithPassword = async () => {
    if (manualPassword.length === 0) return;
    setBusy(true);
    setStatus("Unlocking and saving…");
    const password = manualPassword;
    setManualPassword("");
    try {
      await client.unlock(password);
      setStatus("Login saved.");
      window.close();
    } catch {
      setStatus("Unable to unlock. Check the master password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="biometric-shell">
      <section className="biometric-card" aria-labelledby="capture-auth-title">
        <header className="biometric-header">
          <span className="biometric-symbol" aria-hidden="true">
            ◎
          </span>
          <span>
            <p className="eyebrow">Passwords</p>
            <h1 id="capture-auth-title">
              {useMasterPassword ? "Unlock to save" : "Touch ID to save"}
            </h1>
            <p className="biometric-host">{target.displayHost}</p>
          </span>
        </header>
        {useMasterPassword ? (
          <form
            className="biometric-password-form"
            onSubmit={(event) => {
              event.preventDefault();
              void unlockWithPassword();
            }}
          >
            <label htmlFor="capture-master-password">Master password</label>
            <input
              autoComplete="current-password"
              disabled={busy}
              id="capture-master-password"
              onChange={(event) => setManualPassword(event.target.value)}
              type="password"
              value={manualPassword}
            />
            <button
              className="biometric-action"
              disabled={busy || manualPassword.length === 0}
              type="submit"
            >
              {busy ? "Saving…" : "Save Login"}
            </button>
            {slots.length > 0 ? (
              <button
                className="biometric-switch biometric-password-switch"
                disabled={busy}
                onClick={() => {
                  setUseMasterPassword(false);
                  setStatus("Choose how to confirm this save.");
                }}
                type="button"
              >
                Use Touch ID
              </button>
            ) : null}
          </form>
        ) : (
          <div className="biometric-verification">
            <span className="biometric-pulse" aria-hidden="true">
              ◎
            </span>
            <strong>Touch ID</strong>
            <button
              className="biometric-action"
              disabled={busy || state.status === "preparing"}
              onClick={() => void unlockWithDevice()}
              type="button"
            >
              {busy ? "Waiting…" : "Save with Touch ID"}
            </button>
            <button
              className="biometric-switch biometric-fallback"
              disabled={busy}
              onClick={() => setUseMasterPassword(true)}
              type="button"
            >
              Use Master Password
            </button>
          </div>
        )}
        <p className="biometric-status" aria-live="polite">
          {status}
        </p>
        <button className="biometric-cancel" onClick={() => window.close()} type="button">
          Cancel
        </button>
      </section>
    </main>
  );
}

function AuthenticatedAutofill({
  client,
  target,
}: {
  readonly client: VaultClient;
  readonly target: AuthenticatedAutofillTarget;
}) {
  const [state, setState] = useState<VaultPublicState | { readonly status: "preparing" }>({
    status: "preparing",
  });
  const [status, setStatus] = useState("Preparing encrypted vault…");
  const [busy, setBusy] = useState(false);
  const [manualPassword, setManualPassword] = useState("");
  const [useMasterPassword, setUseMasterPassword] = useState(target.method === "password");
  const [submitAfterFill] = useState(target.submitAfterFill ?? false);
  const [matches, setMatches] = useState<readonly LoginItem[]>([]);
  const [noMatch, setNoMatch] = useState(false);
  const autoStartRef = useRef(false);
  const preserveUnlockedSessionRef = useRef(false);
  const slots = "deviceUnlock" in state ? state.deviceUnlock.slots : [];

  useEffect(() => {
    document.documentElement.classList.add("autofill-document");
    document.body.classList.add("autofill-surface");
    void browser.action?.setPopup({
      popup: "popup.html",
      tabId: target.tabId,
    });
    return () => {
      document.documentElement.classList.remove("autofill-document");
      document.body.classList.remove("autofill-surface");
    };
  }, [target.tabId]);

  useEffect(() => {
    let active = true;
    const unsubscribe = client.subscribe((nextState) => {
      if (active) setState(nextState);
    });
    void client
      .initialize()
      .then((nextState) => {
        if (!active) return;
        setState(nextState);
        setStatus(
          nextState.status === "locked"
            ? "Preparing secure AutoFill…"
            : "Filling from your unlocked vault…",
        );
      })
      .catch(() => {
        if (active) setStatus("The encrypted local vault could not be opened.");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const relock = () => {
    client.lock();
    setManualPassword("");
    setMatches([]);
  };

  const fill = async (login: LoginItem) => {
    setBusy(true);
    setStatus(`Filling ${new URL(target.topUrl).hostname}…`);
    try {
      const request = {
        password: login.password,
        submit: submitAfterFill,
        topUrl: target.topUrl,
        type: BIOMETRIC_FILL_TYPE,
        username: login.username,
        version: 1,
      } as const;
      let response: { readonly filled?: boolean; readonly submitted?: boolean } | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && response?.filled !== true; attempt += 1) {
        try {
          response = (await browser.tabs.sendMessage(target.tabId, request)) as typeof response;
        } catch (error) {
          lastError = error;
        }
      }
      if (response?.filled !== true) {
        setStatus(
          lastError === undefined
            ? "No stable login form accepted the password."
            : "The password could not be delivered to the original secure page.",
        );
        return;
      }
      setStatus(
        response.submitted === true
          ? "Password filled and sign-in submitted."
          : "Password filled. You can submit the form when ready.",
      );
      window.close();
    } catch {
      setStatus("The password could not be delivered to the original secure page.");
    } finally {
      if (preserveUnlockedSessionRef.current) {
        setManualPassword("");
        setMatches([]);
      } else {
        relock();
      }
      setBusy(false);
    }
  };

  const findMatches = async () => {
    if (client.listItems === undefined) {
      throw new Error("Encrypted login access is unavailable");
    }
    const items = await client.listItems();
    if (browser.storage?.local !== undefined) {
      await writeAutofillMetadataIndex(items, browser.storage.local);
    }
    const matching = items.filter(
      (item): item is LoginItem =>
        item.type === "login" &&
        (target.credentialId === undefined || item.id === target.credentialId) &&
        decideAutofill({
          credentials: [{ id: item.id, uris: item.uris }],
          frameUrl: target.topUrl,
          topUrl: target.topUrl,
          userInitiated: true,
        }).allowed,
    );
    const named = matching.filter((item) => item.username.trim().length > 0);
    const candidates = named.length > 0 ? named : matching;
    if (target.credentialId !== undefined || target.usernameHint === undefined) return candidates;
    const normalizedHint = target.usernameHint.trim().toLocaleLowerCase();
    const hinted = candidates.filter(
      (item) => item.username.trim().toLocaleLowerCase() === normalizedHint,
    );
    return hinted.length === 1 ? hinted : candidates;
  };

  const handleMatches = async (logins: readonly LoginItem[]) => {
    if (logins.length === 0) {
      setStatus("No exact-origin password is saved for this page.");
      setNoMatch(true);
      if (!preserveUnlockedSessionRef.current) relock();
    } else if (logins.length === 1) {
      const login = logins[0];
      if (login !== undefined) await fill(login);
    } else {
      setMatches(logins);
      setStatus("Choose the account to fill.");
    }
  };

  const authenticateWithDevice = async () => {
    const slot = slots[0];
    if (slot === undefined || client.listItems === undefined) {
      setStatus("Enter your master password to continue.");
      setUseMasterPassword(true);
      return;
    }
    preserveUnlockedSessionRef.current = false;
    setBusy(true);
    setNoMatch(false);
    setStatus("Touch the biometric sensor to fill.");
    try {
      await client.unlockWithDevice(slot.id);
      await handleMatches(await findMatches());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatus(
        message.includes("not available to this app")
          ? "Touch ID was enrolled in another app or browser profile. Unlock with your master password, then replace this device enrollment in Settings."
          : message.includes("not supported")
            ? "Touch ID is unavailable in this browser profile. Use your master password."
            : message.includes("canceled or timed out")
              ? "Touch ID was canceled."
              : "Touch ID could not release this credential. Use your master password, then repair device unlock in Settings.",
      );
      setUseMasterPassword(true);
      relock();
    } finally {
      setBusy(false);
    }
  };

  const authenticateWithPassword = async (password: string) => {
    preserveUnlockedSessionRef.current = false;
    setManualPassword("");
    setBusy(true);
    setNoMatch(false);
    setStatus("Unlocking the encrypted vault on this device…");
    try {
      await client.unlock(password);
      await handleMatches(await findMatches());
    } catch {
      setStatus("Unable to unlock. Check the master password.");
      relock();
    } finally {
      setBusy(false);
    }
  };

  const fillFromUnlockedVault = async () => {
    setBusy(true);
    setNoMatch(false);
    try {
      await handleMatches(await findMatches());
    } catch {
      setStatus("The unlocked vault could not read this saved login.");
    } finally {
      setBusy(false);
    }
  };

  // This is an intentional one-shot transition after vault initialization. The ref prevents
  // subscription updates from restarting biometric verification or releasing a credential twice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot authentication state machine
  useEffect(() => {
    if (state.status === "preparing" || autoStartRef.current) return;
    autoStartRef.current = true;

    if (state.status === "unlocked") {
      preserveUnlockedSessionRef.current = true;
      setStatus("Filling from your unlocked vault…");
      void fillFromUnlockedVault();
      return;
    }

    if (slots.length > 0) {
      void authenticateWithDevice();
      return;
    }

    setUseMasterPassword(true);
    setStatus("Enter your master password to continue.");
  }, [state.status, slots.length]);

  return (
    <main className="biometric-shell">
      <section className="biometric-card" aria-labelledby="biometric-title">
        <header className="biometric-header">
          <span className="biometric-symbol" aria-hidden="true">
            ◎
          </span>
          <span>
            <p className="eyebrow">Passwords</p>
            <h1 id="biometric-title">
              {noMatch
                ? "No saved login"
                : useMasterPassword
                  ? "Enter master password"
                  : "Touch ID to fill"}
            </h1>
            <p className="biometric-host">{new URL(target.topUrl).hostname}</p>
          </span>
        </header>
        {noMatch ? (
          <div className="biometric-verification">
            <span className="biometric-pulse" aria-hidden="true">
              —
            </span>
            <strong>Nothing to fill for this website</strong>
            <p>
              Save a login for this exact site first. Passwords are never reused across origins.
            </p>
          </div>
        ) : matches.length === 0 && useMasterPassword ? (
          <form
            className="biometric-password-form"
            onSubmit={(event) => {
              event.preventDefault();
              const password = manualPassword;
              if (password.length > 0) void authenticateWithPassword(password);
            }}
          >
            <label htmlFor="autofill-master-password">Master password</label>
            <input
              autoComplete="current-password"
              disabled={busy || state.status === "preparing"}
              id="autofill-master-password"
              onChange={(event) => setManualPassword(event.target.value)}
              type="password"
              value={manualPassword}
            />
            <button
              className="biometric-action"
              disabled={busy || state.status === "preparing" || manualPassword.length === 0}
              type="submit"
            >
              {busy ? "Verifying…" : "Fill Password"}
            </button>
            {slots.length > 0 ? (
              <button
                className="biometric-switch biometric-password-switch"
                disabled={busy}
                onClick={() => {
                  setManualPassword("");
                  setUseMasterPassword(false);
                  void authenticateWithDevice();
                }}
                type="button"
              >
                Use Touch ID
              </button>
            ) : null}
          </form>
        ) : matches.length === 0 ? (
          <div className="biometric-verification">
            <span className="biometric-pulse" aria-hidden="true">
              ◎
            </span>
            <strong>{busy ? "Waiting for Touch ID" : "Touch ID"}</strong>
            <button
              className="biometric-switch biometric-fallback"
              disabled={busy}
              onClick={() => {
                setUseMasterPassword(true);
                setStatus("Enter your master password to fill this credential.");
              }}
              type="button"
            >
              Use Master Password
            </button>
          </div>
        ) : (
          <fieldset className="biometric-accounts">
            <legend>Matching accounts</legend>
            {matches.map((login) => (
              <button disabled={busy} key={login.id} onClick={() => void fill(login)} type="button">
                <strong>{login.username || "Saved login"}</strong>
                <span>Fill this account</span>
              </button>
            ))}
          </fieldset>
        )}
        <p className="biometric-status" aria-live="polite">
          {status}
        </p>
        <button
          className="biometric-cancel"
          onClick={() => {
            if (!preserveUnlockedSessionRef.current) relock();
            window.close();
          }}
          type="button"
        >
          Cancel
        </button>
      </section>
    </main>
  );
}

export function App({ client }: AppProps) {
  const [vaultClient] = useState(() => client ?? createLocalVaultClient());
  const [autofillTarget] = useState(() => authenticatedAutofillTarget(globalThis.location.search));
  const [captureTarget] = useState(() => captureAuthenticationTarget(globalThis.location.search));
  const [managerMode] = useState(
    () => new URLSearchParams(globalThis.location.search).get("mode") === "manager",
  );
  const [fillStatus, setFillStatus] = useState("");
  const [activeHost, setActiveHost] = useState("Current website");
  const [activeCredentials, setActiveCredentials] = useState<
    readonly { readonly id: string; readonly username: string }[]
  >([]);
  useEffect(() => {
    if (
      autofillTarget !== null ||
      captureTarget !== null ||
      managerMode ||
      typeof browser === "undefined"
    )
      return;
    const metadata =
      browser.storage?.local === undefined
        ? Promise.resolve([])
        : readAutofillMetadataIndex(browser.storage.local);
    void Promise.all([browser.tabs.query({ active: true, currentWindow: true }), metadata])
      .then(([[tab], metadata]) => {
        if (tab?.url === undefined) return;
        try {
          const target = new URL(tab.url);
          setActiveHost(target.hostname || "Current website");
          setActiveCredentials(
            metadata
              .filter((entry) => entry.origins.includes(target.origin))
              .map(({ id, username }) => ({ id, username }))
              .filter(
                (credential, index, credentials) =>
                  credentials.findIndex(
                    (candidate) =>
                      candidate.username.trim().toLocaleLowerCase() ===
                      credential.username.trim().toLocaleLowerCase(),
                  ) === index,
              ),
          );
        } catch {
          setActiveHost("Current website");
          setActiveCredentials([]);
        }
      })
      .catch(() => {
        setActiveHost("Current website");
        setActiveCredentials([]);
      });
  }, [autofillTarget, captureTarget, managerMode]);
  if (autofillTarget !== null) {
    return <AuthenticatedAutofill client={vaultClient} target={autofillTarget} />;
  }
  if (captureTarget !== null) {
    return <CaptureAuthentication client={vaultClient} target={captureTarget} />;
  }
  if (managerMode) {
    return (
      <Suspense fallback={<p role="status">Opening encrypted vault…</p>}>
        <VaultScreen
          client={vaultClient}
          providerConfiguration={{ googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID }}
          surface="Browser extension"
        />
      </Suspense>
    );
  }
  return (
    <main className="toolbar-shell">
      <section className="browser-tools" aria-label="Password tools for this page">
        <header className="browser-tools-header">
          <span className="browser-tools-symbol" aria-hidden="true">
            •••
          </span>
          <span>
            <strong>Passwords</strong>
            <small>{activeHost}</small>
          </span>
        </header>
        {activeCredentials.map((credential) => (
          <button
            aria-label={`Fill ${credential.username}`}
            className="browser-tool-button browser-tool-primary"
            key={credential.id}
            type="button"
            onClick={() => {
              setFillStatus("Opening beside the sign-in field…");
              void showInlineAutofill()
                .then((status) => {
                  setFillStatus(status);
                  if (status.startsWith("Passwords opened")) window.close();
                })
                .catch(() =>
                  setFillStatus("Reload this page once so Passwords can attach securely."),
                );
            }}
          >
            <span className="browser-tool-icon" aria-hidden="true">
              ◎
            </span>
            <span className="browser-tool-copy">
              <strong>{credential.username}</strong>
              <small>Fill this login</small>
            </span>
            <span className="browser-tool-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
        <button
          aria-label="Open Vault Manager"
          className="browser-tool-button"
          type="button"
          onClick={() => {
            setFillStatus("Opening vault manager…");
            void openVaultManager()
              .then(() => window.close())
              .catch(() => {
                setFillStatus("The vault manager could not be opened.");
              });
          }}
        >
          <span className="browser-tool-icon" aria-hidden="true">
            ◫
          </span>
          <span className="browser-tool-copy">
            <strong>Open Passwords</strong>
            <small>Manage logins, notes, and personal details</small>
          </span>
          <span className="browser-tool-chevron" aria-hidden="true">
            ›
          </span>
        </button>
        <p className="browser-tool-status" aria-live="polite">
          {fillStatus}
        </p>
      </section>
    </main>
  );
}
