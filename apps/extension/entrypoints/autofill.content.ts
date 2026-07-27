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
    let requestInProgress = false;

    const closePrompt = () => {
      promptHost?.remove();
      promptHost = null;
      promptKind = null;
    };
    const prompt = (
      kind: "capture" | "suggestions",
      title: string,
      options: readonly { readonly label: string; readonly run: () => void }[],
      dismissAction?: () => void,
    ) => {
      if (promptKind === "capture" && kind === "suggestions") return;
      closePrompt();
      const host = document.createElement("div");
      host.style.cssText =
        "all:initial;position:fixed;right:18px;top:18px;z-index:2147483647;font-family:system-ui,sans-serif";
      const root = host.attachShadow({ mode: "closed" });
      const panel = document.createElement("div");
      panel.style.cssText =
        "width:300px;padding:16px;border:1px solid #6474e8;border-radius:14px;background:#111827;color:#f8fafc;box-shadow:0 18px 50px #0008";
      const heading = document.createElement("strong");
      heading.textContent = title;
      heading.style.cssText = "display:block;margin-bottom:12px;font-size:15px";
      panel.append(heading);
      for (const option of options) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = option.label;
        button.style.cssText =
          "display:block;width:100%;margin-top:8px;padding:10px;border:1px solid #6474e8;border-radius:9px;background:#26316c;color:white;text-align:left;cursor:pointer";
        button.addEventListener("click", (event) => {
          if (!event.isTrusted) return;
          option.run();
        });
        panel.append(button);
      }
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "Not now";
      dismiss.style.cssText =
        "display:block;width:100%;margin-top:8px;padding:8px;border:0;background:transparent;color:#cbd5e1;cursor:pointer";
      dismiss.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        closePrompt();
        dismissAction?.();
      });
      panel.append(dismiss);
      root.append(panel);
      document.documentElement.append(host);
      promptHost = host;
      promptKind = kind;
    };

    const requestSuggestions = () => {
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
            `Fill a saved login for ${response.displayHost}?`,
            response.credentials.map((credential) => ({
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
          );
        })
        .catch(() => undefined)
        .finally(() => {
          requestInProgress = false;
        });
    };

    const offerCapture = () => {
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
            `${response.action === "save" ? "Save" : "Update"} login for ${response.displayHost}?`,
            [
              {
                label: response.action === "save" ? "Save in vault" : "Update saved login",
                run: () => {
                  closePrompt();
                  void browser.runtime.sendMessage({
                    type: CAPTURE_CONFIRM_TYPE,
                    userInitiated: true,
                    version: 1,
                  });
                },
              },
            ],
            () => {
              void browser.runtime.sendMessage({
                type: CAPTURE_DISMISS_TYPE,
                userInitiated: true,
                version: 1,
              });
            },
          );
        })
        .catch(() => undefined);
    };
    const showPendingCapture = () => {
      void browser.runtime
        .sendMessage({ type: CAPTURE_PENDING_TYPE, version: 1 })
        .then((response: CaptureResponse | undefined) => {
          if (response?.status !== "offer") return;
          prompt(
            "capture",
            `${response.action === "save" ? "Save" : "Update"} login for ${response.displayHost}?`,
            [
              {
                label: response.action === "save" ? "Save in vault" : "Update saved login",
                run: () => {
                  closePrompt();
                  void browser.runtime.sendMessage({
                    type: CAPTURE_CONFIRM_TYPE,
                    userInitiated: true,
                    version: 1,
                  });
                },
              },
            ],
            () => {
              void browser.runtime.sendMessage({
                type: CAPTURE_DISMISS_TYPE,
                userInitiated: true,
                version: 1,
              });
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
          requestSuggestions();
        }
      },
      true,
    );
    document.addEventListener(
      "focusout",
      (event) => {
        if (!event.isTrusted || !(event.target instanceof HTMLInputElement)) return;
        rememberUsername(event.target);
        if (event.target.type === "password" && event.target.value.length > 0) offerCapture();
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
        offerCapture();
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.isTrusted && event.key === "Enter") offerCapture();
      },
      true,
    );
    document.addEventListener(
      "submit",
      (event) => {
        if (event.isTrusted) offerCapture();
      },
      true,
    );
    showPendingCapture();
  },
});
