import assert from "node:assert/strict";

const endpoint = process.env.ZK_WALLET_CDP ?? "http://127.0.0.1:9223";
const expectedExtensionId = "lnabfclakgdolgcfallnnhkeeoclfkcf";
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
  if (message.error !== undefined) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { reject, resolve });
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

let available = await targets();
let worker = available.find(
  (target) =>
    target.type === "service_worker" &&
    target.url.startsWith(`chrome-extension://${expectedExtensionId}/`),
);
if (worker === undefined) {
  const popupTarget = await send("Target.createTarget", {
    url: `chrome-extension://${expectedExtensionId}/popup.html`,
  });
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
const extensionId = new URL(worker.url).host;
const page = available.find(
  (target) => target.type === "page" && !target.url.startsWith("chrome-extension://"),
);
assert(page, "Chrome test page did not load");
const pageSession = await attach(page.targetId);
await send("Page.enable", {}, pageSession);
await send("Runtime.enable", {}, pageSession);
await send("Log.enable", {}, pageSession);
await send("Page.navigate", { url: "https://example.com/" }, pageSession);
await pause(2_000);

available = await targets();
const activePage = available.find(
  (target) => target.type === "page" && target.url.startsWith("https://example.com"),
);
assert(activePage, "HTTPS fixture page did not load");
const activePageSession =
  activePage.targetId === page.targetId ? pageSession : await attach(activePage.targetId);
const workerSession = await attach(worker.targetId);
await send("Runtime.enable", {}, workerSession);
await send("Log.enable", {}, workerSession);
const tabId = await evaluate(
  workerSession,
  "chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>tab.id)",
);
assert.equal(typeof tabId, "number");
const storageKey = `zk-wallet.pending-capture.v1.${tabId}`;
const pendingCapture = {
  action: "save",
  capture: {
    password: "runtime-only-secret",
    topUrl: "https://example.com/login",
    type: "zk-wallet.capture-request.v1",
    userInitiated: true,
    username: "runtime@example.com",
    version: 1,
  },
  displayHost: "example.com",
  expiresAt: Date.now() + 120_000,
  username: "runtime@example.com",
};
await evaluate(
  workerSession,
  `chrome.storage.session.set(${JSON.stringify({ [storageKey]: pendingCapture })})`,
);

await send("Target.closeTarget", { targetId: worker.targetId });
await pause(500);
await send(
  "Page.navigate",
  { url: "https://example.com/?after-worker-restart=1" },
  activePageSession,
);
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
      "pending credential survived service-worker termination",
      "save prompt restored after navigation",
    ],
  }),
);
