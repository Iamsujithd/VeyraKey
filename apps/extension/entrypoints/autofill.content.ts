import {
  AUTHENTICATED_AUTOFILL_SELECT_TYPE,
  AUTOFILL_REQUEST_TYPE,
  type AutofillResponse,
  BIOMETRIC_AUTOFILL_REQUEST_TYPE,
  CAPTURE_CONFIRM_TYPE,
  CAPTURE_DISMISS_TYPE,
  CAPTURE_PENDING_TYPE,
  CAPTURE_REQUEST_TYPE,
  type CaptureResponse,
  captureLoginFields,
  fillLoginFields,
  isCredentialField,
  isLoginAction,
  isUsernameField,
  MANUAL_AUTOFILL_REQUEST_TYPE,
  parseBiometricFillRequest,
  sendRuntimeMessageSafely,
  submitLoginForm,
  USERNAME_OBSERVED_TYPE,
} from "../src/autofill";

export default defineContentScript({
  allFrames: false,
  matches: ["https://*/*"],
  main() {
    let promptHost: HTMLElement | null = null;
    let promptAnchor: Element | null = null;
    let promptKind: "capture" | "suggestions" | null = null;
    let promptCleanup: (() => void) | null = null;
    let requestInProgress = false;
    let queuedSuggestionAnchor: Element | null = null;
    let extensionContextActive = true;
    let observer: MutationObserver | null = null;
    const extensionId = browser.runtime.id;

    const closePrompt = () => {
      promptCleanup?.();
      promptCleanup = null;
      promptHost?.remove();
      promptHost = null;
      promptAnchor = null;
      promptKind = null;
    };
    const invalidateExtensionContext = () => {
      if (!extensionContextActive) return;
      extensionContextActive = false;
      queuedSuggestionAnchor = null;
      requestInProgress = false;
      observer?.disconnect();
      closePrompt();
    };
    const sendMessage = <T>(message: unknown) =>
      sendRuntimeMessageSafely<T>(
        () => browser.runtime.sendMessage(message) as Promise<T>,
        invalidateExtensionContext,
      );
    const prompt = (
      kind: "capture" | "suggestions",
      title: string,
      subtitle: string,
      options: readonly {
        readonly detail?: string;
        readonly icon?: string;
        readonly label: string;
        readonly run: () => void;
      }[],
      anchor: Element | null,
      dismissAction?: () => void,
    ) => {
      if (promptKind === "capture" && kind === "suggestions") return;
      closePrompt();
      const host = document.createElement("div");
      host.dataset.zkWalletUi = "true";
      host.style.cssText =
        "all:initial;position:fixed;z-index:2147483647;width:min(300px,calc(100vw - 24px));font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;color-scheme:light dark";
      const root = host.attachShadow({ mode: "closed" });
      const styles = document.createElement("style");
      styles.textContent = `
        * { box-sizing: border-box; }
        .glass {
          position: relative;
          overflow: hidden;
          padding: 7px;
          border: 1px solid rgb(255 255 255 / 72%);
          border-radius: 14px;
          color: #151517;
          background:
            linear-gradient(145deg, rgb(255 255 255 / 72%), rgb(242 242 247 / 54%));
          box-shadow:
            0 18px 46px rgb(0 0 0 / 22%),
            inset 0 1px 0 rgb(255 255 255 / 92%),
            inset 0 -1px 0 rgb(255 255 255 / 28%);
          backdrop-filter: blur(34px) saturate(190%) contrast(105%);
          -webkit-backdrop-filter: blur(34px) saturate(190%) contrast(105%);
          animation: appear 160ms cubic-bezier(.2,.8,.2,1);
          transition: box-shadow 180ms ease, transform 180ms cubic-bezier(.2,.8,.2,1);
        }
        .glass::before {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background:
            linear-gradient(110deg, transparent 35%, rgb(255 255 255 / 22%) 50%, transparent 66%);
          content: "";
          pointer-events: none;
        }
        .glass::after {
          position: absolute;
          inset: 1px;
          border: 1px solid rgb(255 255 255 / 22%);
          border-radius: 13px;
          content: "";
          pointer-events: none;
        }
        .header, .option, .dismiss { position: relative; z-index: 1; }
        .header { display: grid; gap: 1px; padding: 4px 7px 7px; }
        .title { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: -.01em; }
        .subtitle { margin: 0; color: rgb(60 60 67 / 68%); font-size: 11px; line-height: 1.35; }
        .option {
          display: grid;
          width: 100%;
          grid-template-columns: 30px 1fr 14px;
          align-items: center;
          gap: 9px;
          min-height: 46px;
          margin: 0;
          padding: 6px 8px;
          border: 0;
          border-radius: 12px;
          color: inherit;
          background: transparent;
          text-align: left;
          cursor: pointer;
        }
        .option {
          transition:
            background 140ms ease,
            box-shadow 140ms ease,
            transform 180ms cubic-bezier(.2,.8,.2,1);
        }
        .option:hover, .option:focus-visible {
          outline: none;
          background: linear-gradient(135deg, rgb(255 255 255 / 42%), rgb(0 122 255 / 13%));
          box-shadow: inset 0 1px rgb(255 255 255 / 48%), 0 5px 14px rgb(0 87 255 / 9%);
          transform: scale(1.012);
        }
        .option:active { transform: scale(.985); }
        .icon {
          display: grid;
          width: 30px;
          height: 30px;
          place-items: center;
          border-radius: 9px;
          color: white;
          background: linear-gradient(145deg, #5ac8fa, #0a84ff 58%, #5e5ce6);
          box-shadow: inset 0 1px rgb(255 255 255 / 45%), 0 4px 12px rgb(0 122 255 / 18%);
          font-size: 14px;
          font-weight: 700;
        }
        .copy { min-width: 0; }
        .label, .detail {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .label { font-size: 12px; font-weight: 650; }
        .detail { margin-top: 2px; color: rgb(60 60 67 / 62%); font-size: 11px; }
        .chevron { color: rgb(60 60 67 / 42%); font-size: 18px; font-weight: 400; }
        .dismiss {
          width: 100%;
          min-height: 34px;
          margin-top: 3px;
          border: 0;
          border-radius: 10px;
          color: #007aff;
          background: transparent;
          font-size: 12px;
          font-weight: 560;
          cursor: pointer;
        }
        .dismiss:hover, .dismiss:focus-visible { outline: none; background: rgb(118 118 128 / 10%); }
        @keyframes appear {
          from { opacity: 0; transform: translateY(-5px) scale(.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-color-scheme: dark) {
          .glass {
            border-color: rgb(255 255 255 / 15%);
            color: #f5f5f7;
            background: linear-gradient(145deg, rgb(44 44 46 / 92%), rgb(28 28 30 / 82%));
            box-shadow: 0 20px 54px rgb(0 0 0 / 48%), inset 0 1px rgb(255 255 255 / 13%);
          }
          .subtitle, .detail { color: rgb(235 235 245 / 60%); }
          .chevron { color: rgb(235 235 245 / 34%); }
          .option:hover, .option:focus-visible { background: rgb(10 132 255 / 20%); }
          .dismiss { color: #64a8ff; }
        }
        @media (prefers-reduced-transparency: reduce) {
          .glass { background: #f2f2f7; backdrop-filter: none; -webkit-backdrop-filter: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .glass { animation: none; }
        }
      `;
      const panel = document.createElement("div");
      panel.className = "glass";
      panel.setAttribute("role", "dialog");
      const header = document.createElement("div");
      header.className = "header";
      const heading = document.createElement("strong");
      heading.className = "title";
      heading.id = `zk-wallet-heading-${crypto.randomUUID()}`;
      heading.textContent = title;
      panel.setAttribute("aria-labelledby", heading.id);
      const context = document.createElement("span");
      context.className = "subtitle";
      context.textContent = subtitle;
      header.append(heading, context);
      panel.append(header);
      for (const option of options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "option";
        const icon = document.createElement("span");
        icon.className = "icon";
        icon.textContent = option.icon ?? (kind === "capture" ? "✓" : "•••");
        const copy = document.createElement("span");
        copy.className = "copy";
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = option.label;
        const detail = document.createElement("span");
        detail.className = "detail";
        detail.textContent = option.detail ?? subtitle;
        copy.append(label, detail);
        const chevron = document.createElement("span");
        chevron.className = "chevron";
        chevron.textContent = "›";
        button.append(icon, copy, chevron);
        button.addEventListener("click", (event) => {
          if (!event.isTrusted) return;
          option.run();
        });
        panel.append(button);
      }
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "dismiss";
      dismiss.textContent = "Not Now";
      dismiss.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        closePrompt();
        dismissAction?.();
      });
      panel.append(dismiss);
      root.append(styles, panel);
      document.documentElement.append(host);
      const place = () => {
        const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
        const width = Math.min(300, window.innerWidth - 24);
        const left =
          rect === null
            ? Math.max(12, window.innerWidth - width - 18)
            : Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
        const estimatedHeight = Math.min(240, panel.getBoundingClientRect().height || 180);
        const below = rect === null ? 18 : rect.bottom + 8;
        const top =
          below + estimatedHeight <= window.innerHeight - 12
            ? below
            : Math.max(12, (rect?.top ?? 18) - estimatedHeight - 8);
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
      };
      const followAnchor = () => place();
      place();
      window.addEventListener("resize", followAnchor);
      window.addEventListener("scroll", followAnchor, true);
      promptCleanup = () => {
        window.removeEventListener("resize", followAnchor);
        window.removeEventListener("scroll", followAnchor, true);
      };
      promptHost = host;
      promptAnchor = anchor;
      promptKind = kind;
    };

    const requestSuggestions = (anchor: Element | null) => {
      if (!extensionContextActive) return;
      if (requestInProgress) {
        queuedSuggestionAnchor = anchor;
        return;
      }
      if (promptKind === "suggestions" && promptHost !== null && promptAnchor === anchor) {
        return;
      }
      requestInProgress = true;
      void sendMessage<AutofillResponse>({
        topUrl: location.href,
        type: AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      })
        .then((response: AutofillResponse | undefined) => {
          if (response?.status === "locked") {
            prompt(
              "suggestions",
              "Passwords",
              new URL(location.href).hostname,
              [
                ...(response.deviceSlots.length > 0
                  ? [
                      {
                        detail: "Fill without leaving Passwords unlocked",
                        icon: "◎",
                        label: "Use Touch ID or Biometrics",
                        run: () => {
                          closePrompt();
                          void sendMessage({
                            topUrl: location.href,
                            type: BIOMETRIC_AUTOFILL_REQUEST_TYPE,
                            userInitiated: true,
                            version: 1,
                          });
                        },
                      },
                    ]
                  : []),
                {
                  detail: "Unlock once for this login",
                  icon: "●",
                  label: "Enter Master Password",
                  run: () => {
                    closePrompt();
                    void sendMessage({
                      topUrl: location.href,
                      type: MANUAL_AUTOFILL_REQUEST_TYPE,
                      userInitiated: true,
                      version: 1,
                    });
                  },
                },
              ],
              anchor,
            );
            return;
          }
          if (response?.status !== "suggestions") return;
          const authenticateAndFill = (credentialId: string, submit: boolean) => {
            closePrompt();
            void sendMessage({
              credentialId,
              method: response.deviceSlots.length > 0 ? "biometric" : "password",
              submit,
              topUrl: location.href,
              type: AUTHENTICATED_AUTOFILL_SELECT_TYPE,
              userInitiated: true,
              version: 1,
            });
          };
          const options = response.credentials.flatMap((credential) => [
            {
              detail:
                response.deviceSlots.length > 0
                  ? "Verify with biometrics, then fill"
                  : "Confirm master password, then fill",
              icon: response.deviceSlots.length > 0 ? "◎" : "●",
              label: credential.username || "Saved login",
              run: () => authenticateAndFill(credential.id, false),
            },
            ...(response.credentials.length === 1
              ? [
                  {
                    detail:
                      response.deviceSlots.length > 0
                        ? "Verify, fill, and press Sign In"
                        : "Confirm, fill, and press Sign In",
                    icon: "→",
                    label: `Sign in as ${credential.username || "saved login"}`,
                    run: () => authenticateAndFill(credential.id, true),
                  },
                ]
              : []),
          ]);
          prompt("suggestions", "Passwords", response.displayHost, options, anchor);
        })
        .finally(() => {
          if (!extensionContextActive) return;
          requestInProgress = false;
          const queuedAnchor = queuedSuggestionAnchor;
          queuedSuggestionAnchor = null;
          if (isCredentialField(queuedAnchor)) requestSuggestions(queuedAnchor);
        });
    };

    const offerCapture = (anchor: Element | null) => {
      if (!extensionContextActive) return;
      const captured = captureLoginFields(document);
      if (captured === null) return;
      void sendMessage<CaptureResponse>({
        ...captured,
        topUrl: location.href,
        type: CAPTURE_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }).then((response: CaptureResponse | undefined) => {
        if (response?.status !== "offer") return;
        prompt(
          "capture",
          response.action === "save" ? "Save This Password?" : "Update This Password?",
          response.displayHost,
          [
            {
              detail: "Encrypted in your vault",
              icon: "✓",
              label: response.action === "save" ? "Save Password" : "Update Password",
              run: () => {
                closePrompt();
                void sendMessage({
                  type: CAPTURE_CONFIRM_TYPE,
                  userInitiated: true,
                  version: 1,
                });
              },
            },
          ],
          anchor,
          () => {
            void sendMessage({
              type: CAPTURE_DISMISS_TYPE,
              userInitiated: true,
              version: 1,
            });
          },
        );
      });
    };
    const showPendingCapture = () => {
      if (!extensionContextActive) return;
      const anchor =
        document.querySelector<HTMLInputElement>('input[type="password"]') ??
        document.querySelector<HTMLElement>('button[type="submit"],input[type="submit"]');
      void sendMessage<CaptureResponse>({ type: CAPTURE_PENDING_TYPE, version: 1 }).then(
        (response: CaptureResponse | undefined) => {
          if (response?.status !== "offer") return;
          prompt(
            "capture",
            response.action === "save" ? "Save This Password?" : "Update This Password?",
            response.displayHost,
            [
              {
                detail: "Encrypted in your vault",
                icon: "✓",
                label: response.action === "save" ? "Save Password" : "Update Password",
                run: () => {
                  closePrompt();
                  void sendMessage({
                    type: CAPTURE_CONFIRM_TYPE,
                    userInitiated: true,
                    version: 1,
                  });
                },
              },
            ],
            anchor,
            () => {
              void sendMessage({
                type: CAPTURE_DISMISS_TYPE,
                userInitiated: true,
                version: 1,
              });
            },
          );
        },
      );
    };
    const rememberUsername = (input: HTMLInputElement) => {
      if (!extensionContextActive || !isUsernameField(input) || input.value.length === 0) return;
      void sendMessage({
        topUrl: location.href,
        type: USERNAME_OBSERVED_TYPE,
        userInitiated: true,
        username: input.value,
        version: 1,
      });
    };

    document.addEventListener(
      "focusin",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (event.isTrusted && window.top === window && isCredentialField(target)) {
          requestSuggestions(target);
        }
      },
      true,
    );
    document.addEventListener(
      "focusout",
      (event) => {
        if (!event.isTrusted || !(event.target instanceof HTMLInputElement)) return;
        rememberUsername(event.target);
      },
      true,
    );
    document.addEventListener(
      "change",
      (event) => {
        if (event.isTrusted && event.target instanceof HTMLInputElement) {
          rememberUsername(event.target);
        }
      },
      true,
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        if (isCredentialField(event.target)) requestSuggestions(event.target);
        if (!isLoginAction(event.target)) return;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement) rememberUsername(active);
        offerCapture(event.target);
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.isTrusted && event.key === "Enter") {
          offerCapture(event.target instanceof Element ? event.target : null);
        }
      },
      true,
    );
    document.addEventListener(
      "submit",
      (event) => {
        if (event.isTrusted) {
          offerCapture(event.target instanceof Element ? event.target : null);
        }
      },
      true,
    );
    browser.runtime.onMessage.addListener((message, sender) => {
      const request = parseBiometricFillRequest(message);
      if (
        request === null ||
        sender.id !== extensionId ||
        sender.tab !== undefined ||
        new URL(request.topUrl).origin !== location.origin
      ) {
        return;
      }
      const filled = fillLoginFields(document, request);
      const submitted = filled && request.submit ? submitLoginForm(document) : false;
      closePrompt();
      return Promise.resolve({ filled, submitted });
    });
    let activeFieldCheckQueued = false;
    const checkActiveField = () => {
      activeFieldCheckQueued = false;
      if (
        extensionContextActive &&
        window.top === window &&
        isCredentialField(document.activeElement)
      ) {
        requestSuggestions(document.activeElement);
      }
    };
    const queueActiveFieldCheck = () => {
      if (!extensionContextActive || activeFieldCheckQueued) return;
      activeFieldCheckQueued = true;
      queueMicrotask(checkActiveField);
    };
    observer = new MutationObserver((records) => {
      const onlyWalletUiChanged = records.every((record) =>
        [...record.addedNodes, ...record.removedNodes].every(
          (node) => node instanceof HTMLElement && node.dataset.zkWalletUi === "true",
        ),
      );
      if (!onlyWalletUiChanged) queueActiveFieldCheck();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("pageshow", queueActiveFieldCheck);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") queueActiveFieldCheck();
    });
    queueActiveFieldCheck();
    showPendingCapture();
  },
});
