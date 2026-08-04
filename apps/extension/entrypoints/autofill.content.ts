import {
  AUTHENTICATED_AUTOFILL_SELECT_TYPE,
  AUTOFILL_FILLED_TYPE,
  AUTOFILL_REQUEST_TYPE,
  type AutofillResponse,
  CAPTURE_CONFIRM_TYPE,
  CAPTURE_DISMISS_TYPE,
  CAPTURE_PENDING_TYPE,
  CAPTURE_REQUEST_TYPE,
  CARD_AUTOFILL_REQUEST_TYPE,
  CARD_AUTOFILL_SELECT_TYPE,
  type CaptureResponse,
  type CardAutofillResponse,
  captureLoginFields,
  cardFieldKind,
  credentialsMatch,
  fillCardField,
  fillLoginFields,
  fillProfileField,
  fillRegistrationPasswordFields,
  filterCredentialsForUsername,
  generateAdaptiveRegistrationPassword,
  isCredentialField,
  isLoginAction,
  isRegistrationEmailField,
  isRegistrationPasswordField,
  isUsernameField,
  OPEN_VAULT_MANAGER_TYPE,
  PRIVATE_EMAIL_REQUEST_TYPE,
  PROFILE_AUTOFILL_REQUEST_TYPE,
  PROFILE_AUTOFILL_SELECT_TYPE,
  type PrivateEmailResponse,
  type ProfileAutofillResponse,
  parseBiometricFillRequest,
  parseShowAutofillRequest,
  profileFieldKind,
  type RegistrationPasswordStyle,
  readExtensionRuntimeIdSafely,
  registrationPasswordPolicy,
  SHOW_AUTOFILL_TYPE,
  sendRuntimeMessageSafely,
  shouldDismissSuggestionsForUsername,
  submitLoginForm,
  USERNAME_OBSERVED_TYPE,
  usernameFieldForCredentialAnchor,
} from "../src/autofill";

export default defineContentScript({
  allFrames: false,
  matches: ["https://*/*"],
  main() {
    let promptHost: HTMLElement | null = null;
    let promptAnchor: Element | null = null;
    let promptKind: "capture" | "suggestions" | null = null;
    let promptCleanup: (() => void) | null = null;
    let promptUsernames: readonly string[] | null = null;
    let requestInProgress = false;
    let queuedSuggestionAnchor: Element | null = null;
    let extensionContextActive = true;
    let observer: MutationObserver | null = null;
    let lastFilledCredential: { readonly password: string; readonly username: string } | null =
      null;
    const suppressedUsernameInputs = new WeakSet<HTMLInputElement>();
    const knownUsernamesByInput = new WeakMap<HTMLInputElement, readonly string[]>();
    const generatedPasswords = new WeakMap<object, Map<RegistrationPasswordStyle, string>>();
    const closePrompt = () => {
      promptCleanup?.();
      promptCleanup = null;
      promptHost?.remove();
      promptHost = null;
      promptAnchor = null;
      promptKind = null;
      promptUsernames = null;
    };
    const invalidateExtensionContext = () => {
      if (!extensionContextActive) return;
      extensionContextActive = false;
      queuedSuggestionAnchor = null;
      requestInProgress = false;
      observer?.disconnect();
      closePrompt();
    };
    const extensionId = readExtensionRuntimeIdSafely(
      () => browser.runtime.id,
      invalidateExtensionContext,
    );
    if (extensionId === null) return;
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
        "all:initial;position:fixed;z-index:2147483647;width:min(264px,calc(100vw - 24px));font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;color-scheme:light dark";
      const root = host.attachShadow({ mode: "closed" });
      const styles = document.createElement("style");
      styles.textContent = `
        * { box-sizing: border-box; }
        .glass {
          position: relative;
          overflow: hidden;
          padding: 5px;
          border: 1px solid rgb(255 255 255 / 72%);
          border-radius: 13px;
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
          border-radius: 12px;
          content: "";
          pointer-events: none;
        }
        .header, .option, .dismiss { position: relative; z-index: 1; }
        .header { display: grid; gap: 0; padding: 3px 6px 5px; }
        .title { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: -.01em; }
        .subtitle { margin: 0; color: rgb(60 60 67 / 68%); font-size: 10px; line-height: 1.3; }
        .option {
          display: grid;
          width: 100%;
          grid-template-columns: 26px 1fr 12px;
          align-items: center;
          gap: 7px;
          min-height: 38px;
          margin: 0;
          padding: 4px 6px;
          border: 0;
          border-radius: 10px;
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
          width: 26px;
          height: 26px;
          place-items: center;
          border-radius: 8px;
          color: white;
          background: linear-gradient(145deg, #5ac8fa, #0a84ff 58%, #5e5ce6);
          box-shadow: inset 0 1px rgb(255 255 255 / 45%), 0 4px 12px rgb(0 122 255 / 18%);
          font-size: 12px;
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
        .detail { margin-top: 1px; color: rgb(60 60 67 / 62%); font-size: 10px; }
        .chevron { color: rgb(60 60 67 / 42%); font-size: 16px; font-weight: 400; }
        .dismiss {
          width: 100%;
          min-height: 28px;
          margin-top: 1px;
          border: 0;
          border-radius: 8px;
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
        copy.append(label);
        if (option.detail !== undefined && option.detail.length > 0) {
          const detail = document.createElement("span");
          detail.className = "detail";
          detail.textContent = option.detail;
          copy.append(detail);
        }
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
      const usernameField = usernameFieldForCredentialAnchor(document, anchor);
      if (usernameField !== null && suppressedUsernameInputs.has(usernameField)) return;
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
            // A locked vault without an exact-origin entry in the metadata index is not
            // evidence that a credential exists. Stay silent instead of asking the user to
            // authenticate merely to check the vault.
            promptUsernames = null;
            closePrompt();
            return;
          }
          if (response?.status !== "suggestions") return;
          const currentUsernameField = usernameFieldForCredentialAnchor(document, anchor);
          if (currentUsernameField !== null) {
            knownUsernamesByInput.set(
              currentUsernameField,
              response.credentials.map((credential) => credential.username),
            );
          }
          const credentials = filterCredentialsForUsername(
            currentUsernameField?.value ?? "",
            response.credentials,
          );
          if (credentials.length === 0) {
            if (currentUsernameField !== null) suppressedUsernameInputs.add(currentUsernameField);
            closePrompt();
            return;
          }
          if (currentUsernameField !== null) suppressedUsernameInputs.delete(currentUsernameField);
          const authenticateAndFill = (credentialId: string) => {
            closePrompt();
            void sendMessage({
              credentialId,
              method: response.deviceSlots.length > 0 ? "biometric" : "password",
              submit: false,
              topUrl: location.href,
              type: AUTHENTICATED_AUTOFILL_SELECT_TYPE,
              userInitiated: true,
              version: 1,
            });
          };
          const options = credentials.map((credential) => ({
            detail: "Verify and fill",
            icon: response.deviceSlots.length > 0 ? "◎" : "●",
            label: credential.username || "Saved login",
            run: () => authenticateAndFill(credential.id),
          }));
          prompt("suggestions", "Passwords", response.displayHost, options, anchor);
          promptUsernames = credentials.map((credential) => credential.username);
        })
        .finally(() => {
          if (!extensionContextActive) return;
          requestInProgress = false;
          const queuedAnchor = queuedSuggestionAnchor;
          queuedSuggestionAnchor = null;
          if (isCredentialField(queuedAnchor)) requestSuggestions(queuedAnchor);
        });
    };

    const requestStrongPassword = (anchor: HTMLInputElement) => {
      const key = anchor.form ?? anchor;
      const policy = registrationPasswordPolicy(anchor);
      const generatedFor = (style: RegistrationPasswordStyle, regenerate = false): string => {
        const values = generatedPasswords.get(key) ?? new Map<RegistrationPasswordStyle, string>();
        generatedPasswords.set(key, values);
        const existing = values.get(style);
        if (!regenerate && existing !== undefined) return existing;
        const value = generateAdaptiveRegistrationPassword(anchor, undefined, style);
        values.set(style, value);
        return value;
      };
      const fillGenerated = (style: RegistrationPasswordStyle, regenerate = false) => {
        const password = generatedFor(style, regenerate);
        if (fillRegistrationPasswordFields(document, password, anchor)) closePrompt();
      };
      const showOtherOptions = () => {
        const options = [
          {
            detail: "Create another unique password",
            icon: "↻",
            label: "New Strong Password",
            run: () => fillGenerated("strong", true),
          },
          ...(policy.supportsNoSpecialCharacters
            ? [
                {
                  detail: "Letters and numbers only",
                  icon: "Aa",
                  label: "No Special Characters",
                  run: () => fillGenerated("no-special"),
                },
              ]
            : []),
          {
            detail: "Avoids look-alike characters",
            icon: "⌨",
            label: "Easy to Type",
            run: () => fillGenerated("easy-to-type"),
          },
          {
            detail: "Keep the field ready for typing",
            icon: "…",
            label: "Choose My Own Password",
            run: () => {
              closePrompt();
              anchor.focus({ preventScroll: true });
            },
          },
        ] as const;
        prompt(
          "suggestions",
          "Other Password Options",
          new URL(location.href).hostname,
          options,
          anchor,
        );
      };
      prompt(
        "suggestions",
        "Strong Password",
        new URL(location.href).hostname,
        [
          {
            detail: policy.label,
            icon: "✦",
            label: "Use Strong Password",
            run: () => fillGenerated("strong"),
          },
          {
            detail: "Generate another or change the style",
            icon: "•••",
            label: "Other Options",
            run: showOtherOptions,
          },
        ],
        anchor,
      );
    };

    const requestProfileSuggestions = (anchor: HTMLInputElement) => {
      const field = profileFieldKind(anchor);
      if (field === null) return;
      void sendMessage<ProfileAutofillResponse>({
        field,
        topUrl: location.href,
        type: PROFILE_AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }).then((response) => {
        if (response?.status !== "suggestions") return;
        prompt(
          "suggestions",
          "Contact AutoFill",
          new URL(location.href).hostname,
          response.profiles.map((profile) => ({
            detail: "Fill this field",
            icon: "⌁",
            label: profile.label,
            run: () => {
              closePrompt();
              void sendMessage<ProfileAutofillResponse>({
                field,
                profileId: profile.id,
                topUrl: location.href,
                type: PROFILE_AUTOFILL_SELECT_TYPE,
                userInitiated: true,
                version: 1,
              }).then((selection) => {
                if (selection?.status === "value") fillProfileField(anchor, selection.value);
              });
            },
          })),
          anchor,
        );
      });
    };

    const requestPrivateEmail = (anchor: HTMLInputElement) => {
      void sendMessage<PrivateEmailResponse>({
        topUrl: location.href,
        type: PRIVATE_EMAIL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }).then((response) => {
        if (response?.status === "value") {
          fillProfileField(anchor, response.address);
          return;
        }
        if (response?.status === "not-configured" || response?.status === "disabled") {
          requestProfileSuggestions(anchor);
        }
      });
    };

    const requestProfileOrPrivateEmail = (anchor: HTMLInputElement) => {
      if (isRegistrationEmailField(anchor)) requestPrivateEmail(anchor);
      else requestProfileSuggestions(anchor);
    };

    const requestCardSuggestions = (anchor: HTMLInputElement) => {
      const field = cardFieldKind(anchor);
      if (field === null) return;
      void sendMessage<CardAutofillResponse>({
        field,
        topUrl: location.href,
        type: CARD_AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }).then((response) => {
        if (response?.status !== "suggestions") return;
        prompt(
          "suggestions",
          "Payment AutoFill",
          new URL(location.href).hostname,
          response.cards.map((card) => ({
            detail: "Fill this field",
            icon: "◫",
            label: card.label,
            run: () => {
              closePrompt();
              void sendMessage<CardAutofillResponse>({
                cardId: card.id,
                field,
                topUrl: location.href,
                type: CARD_AUTOFILL_SELECT_TYPE,
                userInitiated: true,
                version: 1,
              }).then((selection) => {
                if (selection?.status === "value") fillCardField(anchor, selection.value);
              });
            },
          })),
          anchor,
        );
      });
    };

    const offerCapture = (anchor: Element | null) => {
      if (!extensionContextActive) return;
      const captured = captureLoginFields(document, anchor);
      if (captured === null) return;
      if (lastFilledCredential !== null && credentialsMatch(captured, lastFilledCredential)) {
        closePrompt();
        return;
      }
      void sendMessage<CaptureResponse>({
        ...captured,
        topUrl: location.href,
        type: CAPTURE_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }).then((response: CaptureResponse | undefined) => {
        if (response?.status === "locked") {
          prompt(
            "capture",
            "Save password?",
            response.displayHost ?? new URL(location.href).hostname,
            [
              {
                detail: "Unlock to save",
                icon: "◎",
                label: "Continue",
                run: () => {
                  closePrompt();
                  void sendMessage({
                    type: OPEN_VAULT_MANAGER_TYPE,
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
        if (response?.status !== "offer") return;
        prompt(
          "capture",
          response.action === "save" ? "Save password?" : "Update password?",
          response.displayHost,
          [
            {
              icon: "✓",
              label: response.action === "save" ? "Save" : "Update",
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
            response.action === "save" ? "Save password?" : "Update password?",
            response.displayHost,
            [
              {
                icon: "✓",
                label: response.action === "save" ? "Save" : "Update",
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
      "input",
      (event) => {
        if (
          !event.isTrusted ||
          !(event.target instanceof HTMLInputElement) ||
          !isUsernameField(event.target)
        ) {
          return;
        }
        const storedUsernames =
          knownUsernamesByInput.get(event.target) ??
          (promptKind === "suggestions" ? promptUsernames : null);
        if (storedUsernames === null) return;
        if (shouldDismissSuggestionsForUsername(event.target.value, storedUsernames)) {
          suppressedUsernameInputs.add(event.target);
          if (promptKind === "suggestions") closePrompt();
          return;
        }
        suppressedUsernameInputs.delete(event.target);
        if (promptKind === "suggestions") closePrompt();
        requestSuggestions(event.target);
      },
      true,
    );
    document.addEventListener(
      "focusin",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (
          event.isTrusted &&
          window.top === window &&
          target instanceof HTMLInputElement &&
          isRegistrationPasswordField(target)
        ) {
          requestStrongPassword(target);
        } else if (
          event.isTrusted &&
          window.top === window &&
          target instanceof HTMLInputElement &&
          cardFieldKind(target) !== null
        ) {
          requestCardSuggestions(target);
        } else if (
          event.isTrusted &&
          window.top === window &&
          target instanceof HTMLInputElement &&
          profileFieldKind(target) !== null
        ) {
          requestProfileOrPrivateEmail(target);
        } else if (event.isTrusted && window.top === window && isCredentialField(target)) {
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
        suppressedUsernameInputs.delete(event.target);
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
        if (isRegistrationPasswordField(event.target)) {
          requestStrongPassword(event.target);
        } else if (
          event.target instanceof HTMLInputElement &&
          cardFieldKind(event.target) !== null
        ) {
          requestCardSuggestions(event.target);
        } else if (
          event.target instanceof HTMLInputElement &&
          profileFieldKind(event.target) !== null
        ) {
          requestProfileOrPrivateEmail(event.target);
        } else if (isCredentialField(event.target)) {
          requestSuggestions(event.target);
        }
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
    window.addEventListener("pagehide", () => offerCapture(document.activeElement));
    const fillListener = (message: unknown, sender: Browser.runtime.MessageSender) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "unlocked" &&
        "version" in message &&
        message.version === 1 &&
        sender.id === extensionId &&
        sender.tab === undefined
      ) {
        showPendingCapture();
        return;
      }
      const showRequest = parseShowAutofillRequest(message);
      if (
        showRequest !== null &&
        showRequest.type === SHOW_AUTOFILL_TYPE &&
        sender.id === extensionId &&
        sender.tab === undefined &&
        window.top === window
      ) {
        const active = document.activeElement;
        const anchor = isCredentialField(active)
          ? active
          : ([...document.querySelectorAll<HTMLInputElement>("input")].find((input) => {
              return (
                isRegistrationPasswordField(input) ||
                cardFieldKind(input) !== null ||
                profileFieldKind(input) !== null ||
                isCredentialField(input)
              );
            }) ?? null);
        if (anchor === null) return Promise.resolve({ shown: false });
        anchor.focus({ preventScroll: true });
        if (isRegistrationPasswordField(anchor)) {
          requestStrongPassword(anchor);
        } else if (cardFieldKind(anchor) !== null) {
          requestCardSuggestions(anchor);
        } else if (profileFieldKind(anchor) !== null) {
          requestProfileOrPrivateEmail(anchor);
        } else {
          requestSuggestions(anchor);
        }
        return Promise.resolve({ shown: true });
      }
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
      if (filled) {
        lastFilledCredential = {
          password: request.password,
          username: request.username,
        };
        void sendMessage({
          password: request.password,
          topUrl: request.topUrl,
          type: AUTOFILL_FILLED_TYPE,
          username: request.username,
          version: 1,
        });
      }
      const submitted = filled && request.submit ? submitLoginForm(document) : false;
      closePrompt();
      return Promise.resolve({ filled, submitted });
    };
    if (
      readExtensionRuntimeIdSafely(() => {
        browser.runtime.onMessage.addListener(fillListener);
        return extensionId;
      }, invalidateExtensionContext) === null
    ) {
      return;
    }
    let activeFieldCheckQueued = false;
    const checkActiveField = () => {
      activeFieldCheckQueued = false;
      if (
        extensionContextActive &&
        window.top === window &&
        document.activeElement instanceof HTMLInputElement &&
        (isCredentialField(document.activeElement) ||
          cardFieldKind(document.activeElement) !== null ||
          profileFieldKind(document.activeElement) !== null)
      ) {
        const active = document.activeElement;
        if (isRegistrationPasswordField(active)) {
          requestStrongPassword(active);
        } else if (cardFieldKind(active) !== null) {
          requestCardSuggestions(active);
        } else if (profileFieldKind(active) !== null) {
          requestProfileOrPrivateEmail(active);
        } else {
          requestSuggestions(active);
        }
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
