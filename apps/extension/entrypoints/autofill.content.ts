import {
  AUTOFILL_REQUEST_TYPE,
  type AutofillResponse,
  fillLoginFields,
} from "../src/autofill";

export default defineContentScript({
  allFrames: false,
  matches: ["https://*/*"],
  main() {
    let requestInProgress = false;
    document.addEventListener(
      "focusin",
      (event) => {
        if (
          requestInProgress ||
          !event.isTrusted ||
          window.top !== window ||
          location.protocol !== "https:" ||
          !(event.target instanceof HTMLInputElement) ||
          !["email", "password", "text"].includes(event.target.type)
        ) {
          return;
        }
        requestInProgress = true;
        void browser.runtime
          .sendMessage({
            topUrl: location.href,
            type: AUTOFILL_REQUEST_TYPE,
            userInitiated: true,
            version: 1,
          })
          .then((response: AutofillResponse | undefined) => {
            if (response?.status === "fill") {
              fillLoginFields(document, response);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            requestInProgress = false;
          });
      },
      true,
    );
  },
});
