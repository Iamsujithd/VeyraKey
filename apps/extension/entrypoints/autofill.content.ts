import {
  AUTOFILL_REQUEST_TYPE,
  AUTOFILL_SELECT_TYPE,
  type AutofillResponse,
  CAPTURE_CONFIRM_TYPE,
  CAPTURE_DISMISS_TYPE,
  CAPTURE_PENDING_TYPE,
  CAPTURE_REQUEST_TYPE,
  type CaptureResponse,
  captureLoginFields,
  fillLoginFields,
  isLoginAction,
  isUsernameField,
  USERNAME_OBSERVED_TYPE,
} from "../src/autofill";

export default defineContentScript({
  allFrames: false,
  matches: ["https://*/*"],
  main() {
    let promptHost: HTMLElement | null = null;
    let promptKind: "capture" | "suggestions" | null = null;
    let promptCleanup: (() => void) | null = null;
    let requestInProgress = false;

    const closePrompt = () => {
      promptCleanup?.();
      promptCleanup = null;
      promptHost?.remove();
      promptHost = null;
      promptKind = null;
    };
    const prompt = (
      kind: "capture" | "suggestions",
      title: string,
      subtitle: string,
      options: readonly {
        readonly detail?: string;
        readonly label: string;
        readonly run: () => void;
      }[],
      anchor: Element | null,
      dismissAction?: () => void,
    ) => {
      if (promptKind === "capture" && kind === "suggestions") return;
      closePrompt();
      const host = document.createElement("div");
      host.style.cssText =
        "all:initial;position:fixed;z-index:2147483647;width:min(340px,calc(100vw - 24px));font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;color-scheme:light dark";
      const root = host.attachShadow({ mode: "closed" });
      const styles = document.createElement("style");
      styles.textContent = `
        * { box-sizing: border-box; }
        .glass {
          position: relative;
          overflow: hidden;
          padding: 10px;
          border: 1px solid rgb(255 255 255 / 72%);
          border-radius: 18px;
          color: #151517;
          background: linear-gradient(145deg, rgb(255 255 255 / 88%), rgb(242 242 247 / 76%));
          box-shadow: 0 18px 46px rgb(0 0 0 / 22%), inset 0 1px 0 rgb(255 255 255 / 86%);
          backdrop-filter: blur(28px) saturate(180%);
          -webkit-backdrop-filter: blur(28px) saturate(180%);
          animation: appear 160ms cubic-bezier(.2,.8,.2,1);
        }
        .glass::before {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background:
            radial-gradient(circle at 18% 0%, rgb(255 255 255 / 62%), transparent 42%),
            linear-gradient(110deg, transparent 35%, rgb(255 255 255 / 22%) 50%, transparent 66%);
          content: "";
          pointer-events: none;
        }
        .header, .option, .dismiss { position: relative; z-index: 1; }
        .header { display: grid; gap: 2px; padding: 5px 7px 10px; }
        .title { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: -.01em; }
        .subtitle { margin: 0; color: rgb(60 60 67 / 68%); font-size: 11px; line-height: 1.35; }
        .option {
          display: grid;
          width: 100%;
          grid-template-columns: 34px 1fr 16px;
          align-items: center;
          gap: 10px;
          min-height: 52px;
          margin: 0;
          padding: 8px 10px;
          border: 0;
          border-radius: 12px;
          color: inherit;
          background: transparent;
          text-align: left;
          cursor: pointer;
        }
        .option:hover, .option:focus-visible { outline: none; background: rgb(0 122 255 / 11%); }
        .icon {
          display: grid;
          width: 34px;
          height: 34px;
          place-items: center;
          border-radius: 9px;
          color: white;
          background: linear-gradient(145deg, #5ac8fa, #0a84ff 58%, #5e5ce6);
          box-shadow: inset 0 1px rgb(255 255 255 / 45%), 0 4px 12px rgb(0 122 255 / 18%);
          font-size: 16px;
          font-weight: 700;
        }
        .copy { min-width: 0; }
        .label, .detail {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .label { font-size: 13px; font-weight: 650; }
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
      const header = document.createElement("div");
      header.className = "header";
      const heading = document.createElement("strong");
      heading.className = "title";
      heading.textContent = title;
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
        icon.textContent = kind === "capture" ? "✓" : "•••";
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
        const width = Math.min(340, window.innerWidth - 24);
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
      promptKind = kind;
    };

    const requestSuggestions = (anchor: Element | null) => {
      if (requestInProgress) return;
      requestInProgress = true;
      void browser.runtime
        .sendMessage({
          topUrl: location.href,
          type: AUTOFILL_REQUEST_TYPE,
          userInitiated: true,
          version: 1,
        })
        .then((response: AutofillResponse | undefined) => {
          if (response?.status !== "suggestions") return;
          prompt(
            "suggestions",
            "Passwords",
            response.displayHost,
            response.credentials.map((credential) => ({
              detail: response.displayHost,
              label: credential.username || "Saved login",
              run: () => {
                closePrompt();
                void browser.runtime
                  .sendMessage({
                    credentialId: credential.id,
                    topUrl: location.href,
                    type: AUTOFILL_SELECT_TYPE,
                    userInitiated: true,
                    version: 1,
                  })
                  .then((selected: AutofillResponse | undefined) => {
                    if (selected?.status === "fill") fillLoginFields(document, selected);
                  });
              },
            })),
            anchor,
          );
        })
        .catch(() => undefined)
        .finally(() => {
          requestInProgress = false;
        });
    };

    const offerCapture = (anchor: Element | null) => {
      const captured = captureLoginFields(document);
      if (captured === null) return;
      void browser.runtime
        .sendMessage({
          ...captured,
          topUrl: location.href,
          type: CAPTURE_REQUEST_TYPE,
          userInitiated: true,
          version: 1,
        })
        .then((response: CaptureResponse | undefined) => {
          if (response?.status !== "offer") return;
          prompt(
            "capture",
            response.action === "save" ? "Save This Password?" : "Update This Password?",
            response.displayHost,
            [
              {
                detail: "Encrypted in your vault",
                label: response.action === "save" ? "Save Password" : "Update Password",
                run: () => {
                  closePrompt();
                  void browser.runtime
                    .sendMessage({
                      type: CAPTURE_CONFIRM_TYPE,
                      userInitiated: true,
                      version: 1,
                    })
                    .catch(() => undefined);
                },
              },
            ],
            anchor,
            () => {
              void browser.runtime
                .sendMessage({
                  type: CAPTURE_DISMISS_TYPE,
                  userInitiated: true,
                  version: 1,
                })
                .catch(() => undefined);
            },
          );
        })
        .catch(() => undefined);
    };
    const showPendingCapture = () => {
      const anchor =
        document.querySelector<HTMLInputElement>('input[type="password"]') ??
        document.querySelector<HTMLElement>('button[type="submit"],input[type="submit"]');
      void browser.runtime
        .sendMessage({ type: CAPTURE_PENDING_TYPE, version: 1 })
        .then((response: CaptureResponse | undefined) => {
          if (response?.status !== "offer") return;
          prompt(
            "capture",
            response.action === "save" ? "Save This Password?" : "Update This Password?",
            response.displayHost,
            [
              {
                detail: "Encrypted in your vault",
                label: response.action === "save" ? "Save Password" : "Update Password",
                run: () => {
                  closePrompt();
                  void browser.runtime
                    .sendMessage({
                      type: CAPTURE_CONFIRM_TYPE,
                      userInitiated: true,
                      version: 1,
                    })
                    .catch(() => undefined);
                },
              },
            ],
            anchor,
            () => {
              void browser.runtime
                .sendMessage({
                  type: CAPTURE_DISMISS_TYPE,
                  userInitiated: true,
                  version: 1,
                })
                .catch(() => undefined);
            },
          );
        })
        .catch(() => undefined);
    };
    const rememberUsername = (input: HTMLInputElement) => {
      if (!isUsernameField(input) || input.value.length === 0) return;
      void browser.runtime
        .sendMessage({
          topUrl: location.href,
          type: USERNAME_OBSERVED_TYPE,
          userInitiated: true,
          username: input.value,
          version: 1,
        })
        .catch(() => undefined);
    };

    document.addEventListener(
      "focusin",
      (event) => {
        if (
          event.isTrusted &&
          window.top === window &&
          event.target instanceof HTMLInputElement &&
          ["email", "password", "text"].includes(event.target.type)
        ) {
          requestSuggestions(event.target);
        }
      },
      true,
    );
    document.addEventListener(
      "focusout",
      (event) => {
        if (!event.isTrusted || !(event.target instanceof HTMLInputElement)) return;
        rememberUsername(event.target);
        if (event.target.type === "password" && event.target.value.length > 0) {
          offerCapture(event.target);
        }
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
        if (
          !event.isTrusted ||
          !(event.target instanceof Element) ||
          !isLoginAction(event.target)
        ) {
          return;
        }
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
    showPendingCapture();
  },
});
