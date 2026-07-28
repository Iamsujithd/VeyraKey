import assert from "node:assert/strict";

const endpoint = process.env.ZK_WALLET_CDP ?? "http://127.0.0.1:9223";
const expectedExtensionId = "lnabfclakgdolgcfallnnhkeeoclfkcf";
const fixtureHost = "www.google.com";
const fixtureUrl = `https://${fixtureHost}/robots.txt`;
const version = await (await fetch(`${endpoint}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
  if (
    message.method === "Log.entryAdded" &&
    ["error", "warning"].includes(message.params.entry.level)
  ) {
    runtimeErrors.push(message.params.entry.text);
  }
  if (message.id === undefined) return;
  const request = pending.get(message.id);
  if (request === undefined) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error !== undefined) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 15_000);
    pending.set(id, { reject, resolve, timer });
    socket.send(
      JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
    );
  });
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const targets = async () => (await send("Target.getTargets")).targetInfos;
const attach = async (targetId) =>
  (await send("Target.attachToTarget", { flatten: true, targetId })).sessionId;
const evaluate = async (sessionId, expression) => {
  const result = await send(
    "Runtime.evaluate",
    { awaitPromise: true, expression, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.exception?.description ?? "Runtime evaluation failed");
  }
  return result.result.value;
};
const waitForValue = async (sessionId, expression, predicate, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await evaluate(sessionId, expression);
    if (predicate(value)) return value;
    await pause(200);
  } while (Date.now() < deadline);
  return value;
};

let available = await targets();
let startupPopupTargetId;
let worker = available.find(
  (target) =>
    target.type === "service_worker" &&
    target.url.startsWith(`chrome-extension://${expectedExtensionId}/`),
);
if (worker === undefined) {
  const popupTarget = await send("Target.createTarget", {
    url: `chrome-extension://${expectedExtensionId}/popup.html`,
  });
  startupPopupTargetId = popupTarget.targetId;
  await pause(500);
  const popupSession = await attach(popupTarget.targetId);
  await evaluate(
    popupSession,
    `chrome.runtime.sendMessage({type:"zk-wallet.capture-pending.v1",version:1}).catch(()=>undefined)`,
  );
  await pause(500);
  available = await targets();
  worker = available.find(
    (target) =>
      target.type === "service_worker" &&
      target.url.startsWith(`chrome-extension://${expectedExtensionId}/`),
  );
}
assert(worker, "Extension service worker did not load");
if (startupPopupTargetId !== undefined) {
  await send("Target.closeTarget", { targetId: startupPopupTargetId }).catch(() => undefined);
  await pause(300);
}
const extensionId = new URL(worker.url).host;
const page = available.find(
  (target) => target.type === "page" && !target.url.startsWith("chrome-extension://"),
);
assert(page, "Chrome test page did not load");
const pageSession = await attach(page.targetId);
await send("Page.enable", {}, pageSession);
await send("Runtime.enable", {}, pageSession);
await send("Log.enable", {}, pageSession);
await send("Page.navigate", { url: fixtureUrl }, pageSession).catch(() => undefined);
await pause(2_000);

available = await targets();
const activePage = available.find(
  (target) => target.type === "page" && target.url.startsWith(fixtureUrl),
);
assert(activePage, "HTTPS fixture page did not load");
const activePageSession =
  activePage.targetId === page.targetId ? pageSession : await attach(activePage.targetId);
const workerSession = await attach(worker.targetId);
await send("Runtime.enable", {}, workerSession);
await send("Log.enable", {}, workerSession);
const tabId = await evaluate(
  workerSession,
  "chrome.tabs.query({}).then(tabs => (tabs.length === 1 ? tabs[0]?.id : tabs.find(tab => tab.active)?.id) ?? null)",
);
assert.equal(typeof tabId, "number");
const contentScriptReady = await waitForValue(
  workerSession,
  `chrome.tabs.sendMessage(${tabId}, {
    password: "readiness-only",
    submit: false,
    topUrl: ${JSON.stringify(fixtureUrl)},
    type: "zk-wallet.biometric-fill.v1",
    username: "",
    version: 1
  }).then(response => response?.filled === false, () => false)`,
  (value) => value === true,
);
assert.equal(contentScriptReady, true, "HTTPS content script did not become ready");
await evaluate(
  activePageSession,
  `(() => {
    const form = document.createElement("form");
    form.id = "zk-runtime-idempotent-fill";
    const username = document.createElement("input");
    username.type = "email";
    username.autocomplete = "username";
    const password = document.createElement("input");
    password.type = "password";
    password.autocomplete = "current-password";
    form.append(username, password);
    document.body.append(form);
    globalThis.__zkRuntimeInputEvents = 0;
    form.addEventListener("input", () => {
      globalThis.__zkRuntimeInputEvents += 1;
    });
  })()`,
);
const repeatedFillExpression = `chrome.tabs.sendMessage(${tabId}, {
  password: "runtime-only-secret",
  submit: false,
  topUrl: ${JSON.stringify(fixtureUrl)},
  type: "zk-wallet.biometric-fill.v1",
  username: "runtime@example.com",
  version: 1
}).then(response => response?.filled === true, () => false)`;
assert.equal(
  await evaluate(workerSession, repeatedFillExpression),
  true,
  "First authenticated credential delivery was not acknowledged",
);
assert.equal(
  await evaluate(workerSession, repeatedFillExpression),
  true,
  "Identical repeated credential delivery was not acknowledged",
);
const repeatedFillState = await evaluate(
  activePageSession,
  `(() => {
    const form = document.querySelector("#zk-runtime-idempotent-fill");
    const fields = form?.querySelectorAll("input");
    return {
      inputEvents: globalThis.__zkRuntimeInputEvents,
      password: fields?.[1]?.value,
      username: fields?.[0]?.value
    };
  })()`,
);
assert.deepEqual(
  repeatedFillState,
  {
    inputEvents: 2,
    password: "runtime-only-secret",
    username: "runtime@example.com",
  },
  "Repeated credential delivery rewrote or failed to populate the login form",
);
await evaluate(
  activePageSession,
  `(() => {
    document.querySelector("#zk-runtime-idempotent-fill")?.remove();
    delete globalThis.__zkRuntimeInputEvents;
  })()`,
);
await evaluate(
  activePageSession,
  `(() => {
    const form = document.createElement("form");
    form.id = "zk-runtime-dynamic-login";
    const username = document.createElement("input");
    username.type = "email";
    username.autocomplete = "username";
    form.append(username);
    document.body.append(form);
    username.focus();
  })()`,
);
const dynamicPromptCount = await waitForValue(
  activePageSession,
  `[...document.documentElement.children].filter(el=>el instanceof HTMLDivElement&&el.style.zIndex==="2147483647").length`,
  (value) => value === 1,
);
assert.equal(dynamicPromptCount, 1, "Dynamic focused login field did not open Passwords");
await evaluate(
  activePageSession,
  `(() => {
    document.querySelector("#zk-runtime-dynamic-login")?.remove();
    const form = document.createElement("form");
    form.id = "zk-runtime-replaced-login";
    const password = document.createElement("input");
    password.type = "password";
    password.autocomplete = "current-password";
    form.append(password);
    document.body.append(form);
    password.focus();
  })()`,
);
const replacedPromptCount = await waitForValue(
  activePageSession,
  `[...document.documentElement.children].filter(el=>el instanceof HTMLDivElement&&el.style.zIndex==="2147483647").length`,
  (value) => value === 1,
);
assert.equal(replacedPromptCount, 1, "Replaced password step did not refresh Passwords");
await evaluate(
  activePageSession,
  `(() => {
    document.querySelector("#zk-runtime-replaced-login")?.remove();
    for (const element of [...document.documentElement.children]) {
      if (element instanceof HTMLDivElement && element.style.zIndex === "2147483647") {
        element.remove();
      }
    }
  })()`,
);
const storageKey = `zk-wallet.pending-capture.v1.${tabId}`;
const pendingCapture = {
  action: "save",
  capture: {
    password: "runtime-only-secret",
    topUrl: fixtureUrl,
    type: "zk-wallet.capture-request.v1",
    userInitiated: true,
    username: "runtime@example.com",
    version: 1,
  },
  displayHost: fixtureHost,
  expiresAt: Date.now() + 120_000,
  username: "runtime@example.com",
};
await evaluate(
  workerSession,
  `chrome.storage.session.set(${JSON.stringify({ [storageKey]: pendingCapture })})`,
);

await send("Target.closeTarget", { targetId: worker.targetId }).catch(() => undefined);
await pause(500);
const wakePopup = await send("Target.createTarget", {
  url: `chrome-extension://${expectedExtensionId}/popup.html`,
});
const wakePopupSession = await attach(wakePopup.targetId);
await pause(500);
await send(
  "Runtime.evaluate",
  {
    expression: `void chrome.runtime.sendMessage({type:"zk-wallet.capture-pending.v1",version:1}).catch(()=>undefined)`,
  },
  wakePopupSession,
).catch(() => undefined);
const extensionPrfCapability = await evaluate(
  wakePopupSession,
  `globalThis.PublicKeyCredential?.getClientCapabilities?.().then(capabilities=>capabilities["extension:prf"]===true)`,
);
assert.equal(
  extensionPrfCapability,
  true,
  "Extension origin did not report WebAuthn PRF capability",
);
await send(
  "Page.navigate",
  { url: `${fixtureUrl}?after-worker-restart=1` },
  activePageSession,
).catch(() => undefined);
await pause(2_000);

available = await targets();
const restartedWorker = available.find(
  (target) =>
    target.type === "service_worker" && target.url.startsWith(`chrome-extension://${extensionId}/`),
);
assert(restartedWorker, "Extension service worker did not restart after navigation");
const restartedSession = await attach(restartedWorker.targetId);
await send("Runtime.enable", {}, restartedSession);
await send("Log.enable", {}, restartedSession);
const persisted = await evaluate(
  restartedSession,
  `chrome.storage.session.get(${JSON.stringify(storageKey)}).then(value=>value[${JSON.stringify(storageKey)}])`,
);
assert.deepEqual(
  persisted,
  pendingCapture,
  "Pending credential capture did not survive worker restart",
);

const promptHostCount = await evaluate(
  activePageSession,
  `[...document.documentElement.children].filter(el=>el instanceof HTMLDivElement&&el.style.zIndex==="2147483647").length`,
);
assert.equal(promptHostCount, 1, "Persistent credential prompt was not restored after navigation");

assert.deepEqual(runtimeErrors, [], `Runtime errors were reported: ${runtimeErrors.join("; ")}`);
socket.close();
console.log(
  JSON.stringify({
    extensionId,
    passed: [
      "extension loaded",
      "HTTPS content script injected",
      "repeated credential delivery stayed idempotent",
      "dynamic username field opened Passwords",
      "replaced password step refreshed Passwords",
      "pending credential survived service-worker termination",
      "save prompt restored after navigation",
      "extension origin reported WebAuthn PRF capability",
    ],
  }),
);
