import { createCryptoProvider, createWebAuthnPrfProvider } from "@zk-wallet/crypto";
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
import { type VaultClient, VaultScreen } from "@zk-wallet/ui";
import { createVaultService, type LoginItem, type VaultPublicState } from "@zk-wallet/vault";
import { useEffect, useRef, useState } from "react";
import { BIOMETRIC_FILL_TYPE } from "../../src/autofill";
import { withExtensionGoogleDriveSync } from "../../src/googleDrive";
import {
  ExtensionSessionCoordinator,
  type ExtensionSessionEvent,
  withExtensionSession,
} from "../../src/session";

export interface AppProps {
  readonly client?: VaultClient;
}

export async function fillActiveTab(client: VaultClient): Promise<string> {
  if (client.getState().status !== "unlocked") return "Unlock the vault before filling.";
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) return "The active page is unavailable.";
  if (client.listItems === undefined) return "Encrypted login access is unavailable.";
  const logins = (await client.listItems()).filter(
    (item): item is LoginItem => item.type === "login",
  );
  const decision = decideAutofill({
    credentials: logins.map((item) => ({ id: item.id, uris: item.uris })),
    frameUrl: tab.url,
    topUrl: tab.url,
    userInitiated: true,
  });
  if (!decision.allowed) {
    return decision.reason === "AMBIGUOUS_ACCOUNT"
      ? "Choose an account in the vault; automatic selection is unsafe."
      : "No exact, secure login match is available for this page.";
  }
  const login = logins.find((item) => item.id === decision.credentialId);
  if (login === undefined) return "The selected login is unavailable.";
  const results = await browser.scripting.executeScript({
    args: [login.username, login.password],
    func: (username: string, password: string) => {
      if (
        window.top !== window ||
        location.protocol !== "https:" ||
        document.defaultView?.location.origin !== location.origin
      ) {
        return false;
      }
      const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(
        (input) =>
          input.isConnected && !input.disabled && !input.readOnly && input.type !== "hidden",
      );
      const passwordInput = inputs.find(
        (input) =>
          input.type === "password" ||
          ["current-password", "new-password"].includes(input.autocomplete),
      );
      if (passwordInput === undefined) return false;
      const usernameInput =
        inputs.find((input) => ["email", "username"].includes(input.autocomplete)) ??
        inputs.find((input) => ["email", "text"].includes(input.type));
      const setValue = (input: HTMLInputElement, value: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      if (usernameInput !== undefined) setValue(usernameInput, username);
      setValue(passwordInput, password);
      return true;
    },
    target: { frameIds: [0], tabId: tab.id },
  });
  return results[0]?.result === true
    ? `Filled the exact origin ${decision.displayHost}.`
    : "No safe standard login form was found.";
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
    devicePrf: createWebAuthnPrfProvider(),
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
  return withExtensionSession(withExtensionGoogleDriveSync(client, crypto), coordinator);
}

interface AuthenticatedAutofillTarget {
  readonly credentialId?: string;
  readonly method: "biometric" | "password";
  readonly submitAfterFill?: boolean;
  readonly tabId: number;
  readonly topUrl: string;
  readonly usernameHint?: string;
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
  const autoBiometricStarted = useRef(false);
  const authenticateWithDeviceRef = useRef<() => Promise<void>>(() => Promise.resolve());
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
            ? "Confirm your identity to release one matching password."
            : "Password AutoFill is ready.",
        );
      })
      .catch(() => {
        if (active) setStatus("The encrypted local vault could not be opened.");
      });
    return () => {
      active = false;
      unsubscribe();
      client.lock();
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
      const response = (await browser.tabs.sendMessage(target.tabId, {
        password: login.password,
        submit: submitAfterFill,
        topUrl: target.topUrl,
        type: BIOMETRIC_FILL_TYPE,
        username: login.username,
        version: 1,
      })) as { readonly filled?: boolean; readonly submitted?: boolean } | undefined;
      if (response?.filled !== true) {
        setStatus("The login form changed before the password could be filled.");
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
      relock();
      setBusy(false);
    }
  };

  const findMatches = async () => {
    if (client.listItems === undefined) {
      throw new Error("Encrypted login access is unavailable");
    }
    const matching = (await client.listItems()).filter(
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
    if (target.credentialId !== undefined || target.usernameHint === undefined) return matching;
    const normalizedHint = target.usernameHint.trim().toLocaleLowerCase();
    const hinted = matching.filter(
      (item) => item.username.trim().toLocaleLowerCase() === normalizedHint,
    );
    return hinted.length === 1 ? hinted : matching;
  };

  const handleMatches = async (logins: readonly LoginItem[]) => {
    if (logins.length === 0) {
      setStatus("No exact-origin password is saved for this page.");
      relock();
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
      setStatus("Enroll this device from Passwords settings before using biometric AutoFill.");
      setUseMasterPassword(true);
      return;
    }
    setBusy(true);
    setStatus("Waiting for Touch ID, Windows Hello, or your security key…");
    try {
      await client.unlockWithDevice(slot.id);
      await handleMatches(await findMatches());
    } catch {
      setStatus("Biometric verification was canceled or is unavailable on this device.");
      relock();
    } finally {
      setBusy(false);
    }
  };
  authenticateWithDeviceRef.current = authenticateWithDevice;

  useEffect(() => {
    if (
      target.method !== "biometric" ||
      state.status === "preparing" ||
      useMasterPassword ||
      autoBiometricStarted.current
    ) {
      return;
    }
    autoBiometricStarted.current = true;
    if (slots.length === 0) {
      setStatus("Biometrics are unavailable. Enter your master password instead.");
      setUseMasterPassword(true);
      return;
    }
    void authenticateWithDeviceRef.current();
  }, [state.status, target.method, useMasterPassword, slots.length]);

  const authenticateWithPassword = async (password: string) => {
    setManualPassword("");
    setBusy(true);
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

  return (
    <main className="biometric-shell">
      <section
        className="biometric-card"
        aria-labelledby="biometric-title"
        onPointerLeave={(event) => {
          event.currentTarget.style.setProperty("--lens-x", "22%");
          event.currentTarget.style.setProperty("--lens-y", "0%");
        }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty("--lens-x", `${event.clientX - bounds.left}px`);
          event.currentTarget.style.setProperty("--lens-y", `${event.clientY - bounds.top}px`);
        }}
      >
        <header className="biometric-header">
          <span className="biometric-symbol" aria-hidden="true">
            ◎
          </span>
          <span>
            <p className="eyebrow">Passwords</p>
            <h1 id="biometric-title">
              {useMasterPassword ? "Enter master password" : "Touch ID to fill"}
            </h1>
            <p className="biometric-host">{new URL(target.topUrl).hostname}</p>
          </span>
        </header>
        {matches.length === 0 && useMasterPassword ? (
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
                  autoBiometricStarted.current = false;
                  setUseMasterPassword(false);
                  setStatus("Touch the biometric sensor to fill.");
                }}
                type="button"
              >
                Use Touch ID
              </button>
            ) : null}
          </form>
        ) : matches.length === 0 ? (
          <div className="biometric-verification">
            <span
              className={busy ? "biometric-pulse is-active" : "biometric-pulse"}
              aria-hidden="true"
            >
              ◎
            </span>
            <strong>{busy ? "Touch the sensor" : "Biometric verification"}</strong>
            {!busy && state.status !== "preparing" ? (
              <button
                className="biometric-action"
                onClick={() => void authenticateWithDevice()}
                type="button"
              >
                Try Touch ID Again
              </button>
            ) : null}
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
            relock();
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
  const [fillStatus, setFillStatus] = useState("");
  const [capture, setCapture] = useState<CaptureProposal | null>(null);
  if (autofillTarget !== null) {
    return <AuthenticatedAutofill client={vaultClient} target={autofillTarget} />;
  }
  return (
    <>
      <VaultScreen
        client={vaultClient}
        providerConfiguration={{ googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID }}
        surface="Browser extension"
      />
      <section className="browser-tools" aria-label="Browser login tools">
        <header className="browser-tools-header">
          <span className="browser-tools-symbol" aria-hidden="true">
            •••
          </span>
          <span>
            <strong>AutoFill</strong>
            <small>Current website</small>
          </span>
        </header>
        <button
          className="browser-tool-button"
          type="button"
          onClick={() => {
            setFillStatus("Checking the active site…");
            void fillActiveTab(vaultClient)
              .then(setFillStatus)
              .catch(() => setFillStatus("Autofill could not access this page."));
          }}
        >
          <span aria-hidden="true">↗</span>
          <span>Fill Password</span>
        </button>
        <button
          className="browser-tool-button"
          type="button"
          onClick={() => {
            setCapture(null);
            setFillStatus("Inspecting the current login form…");
            void captureActiveTab(vaultClient)
              .then((result) => {
                if (typeof result === "string") setFillStatus(result);
                else {
                  setCapture(result);
                  setFillStatus("");
                }
              })
              .catch(() => setFillStatus("The login form could not be captured safely."));
          }}
        >
          <span aria-hidden="true">＋</span>
          <span>Save or Update Password</span>
        </button>
        <button
          className="browser-tool-button"
          type="button"
          onClick={() => {
            setFillStatus("Checking for an exact-origin authenticator…");
            void fillActiveTotp(vaultClient)
              .then(setFillStatus)
              .catch(() => setFillStatus("The authenticator code could not be filled safely."));
          }}
        >
          <span aria-hidden="true">⌁</span>
          <span>Fill Verification Code</span>
        </button>
        <p className="browser-tool-status" aria-live="polite">
          {fillStatus}
        </p>
        {capture === null ? null : (
          <div className="capture-sheet" role="dialog" aria-labelledby="capture-title">
            <h2 id="capture-title">{capture.action === "save" ? "Save login" : "Update login"}</h2>
            <p>
              Confirm {capture.action} for the exact origin <strong>{capture.displayHost}</strong>.
            </p>
            <button
              type="button"
              onClick={() => {
                const operation =
                  capture.action === "save"
                    ? vaultClient.createLogin?.({
                        notes: "",
                        password: capture.password,
                        title: capture.displayHost,
                        uris: [capture.canonicalOrigin],
                        username: capture.username,
                      })
                    : capture.existingId !== undefined && capture.existingRevisionId !== undefined
                      ? vaultClient.updateLogin?.(capture.existingId, capture.existingRevisionId, {
                          notes: "",
                          password: capture.password,
                          title: capture.displayHost,
                          uris: [capture.canonicalOrigin],
                          username: capture.username,
                        })
                      : undefined;
                if (operation === undefined) {
                  setCapture(null);
                  setFillStatus("Encrypted login saving is unavailable.");
                  return;
                }
                void operation
                  .then(() => {
                    setCapture(null);
                    setFillStatus(capture.action === "save" ? "Login saved." : "Login updated.");
                  })
                  .catch(() => {
                    setCapture(null);
                    setFillStatus("The login changed or could not be saved.");
                  });
              }}
            >
              Confirm {capture.action}
            </button>
            <button type="button" onClick={() => setCapture(null)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </>
  );
}
