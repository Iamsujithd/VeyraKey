import { createCryptoProvider, createWebAuthnPrfProvider, zeroBytes } from "@zk-wallet/crypto";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbVaultHeaderRepository,
} from "@zk-wallet/persistence";
import { decideAutofill } from "@zk-wallet/security";
import { createVaultService, type LoginItem } from "@zk-wallet/vault";
import {
  type AutofillResponse,
  parseAutofillRequest,
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

  browser.runtime.onMessage.addListener(async (message, sender): Promise<AutofillResponse | void> => {
    const request = parseAutofillRequest(message);
    if (request === null) return;
    let senderOrigin: string;
    let requestOrigin: string;
    try {
      senderOrigin = new URL(sender.url ?? "").origin;
      requestOrigin = new URL(request.topUrl).origin;
    } catch {
      return { status: "unavailable", version: 1 };
    }
    if (
      sender.id !== browser.runtime.id ||
      sender.frameId !== 0 ||
      sender.tab === undefined ||
      senderOrigin !== requestOrigin
    ) {
      return { status: "unavailable", version: 1 };
    }
    await initialized;
    if (service.getState().status !== "unlocked" && service.resumeSession !== undefined) {
      const material = await coordinator.load();
      if (material !== null) {
        try {
          await service.resumeSession(material);
        } catch {
          return { status: "locked", version: 1 };
        } finally {
          zeroBytes(material.rootKey);
        }
      }
    }
    if (service.getState().status !== "unlocked" || service.listItems === undefined) {
      return { status: "locked", version: 1 };
    }
    let logins: readonly LoginItem[];
    try {
      logins = (await service.listItems()).filter(
        (item): item is LoginItem => item.type === "login",
      );
    } catch {
      return { status: "locked", version: 1 };
    }
    const decision = decideAutofill({
      credentials: logins.map((item) => ({ id: item.id, uris: item.uris })),
      frameUrl: request.topUrl,
      topUrl: request.topUrl,
      userInitiated: true,
    });
    if (!decision.allowed) {
      return {
        status: decision.reason === "AMBIGUOUS_ACCOUNT" ? "ambiguous" : "no-match",
        version: 1,
      };
    }
    const login = logins.find((item) => item.id === decision.credentialId);
    return login === undefined
      ? { status: "no-match", version: 1 }
      : {
          password: login.password,
          status: "fill",
          username: login.username,
          version: 1,
        };
  });
});
