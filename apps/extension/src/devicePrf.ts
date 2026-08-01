import { createWebAuthnPrfProvider, type DevicePrfProvider } from "@zk-wallet/crypto";

export function createExtensionDevicePrfProvider(): DevicePrfProvider {
  return createWebAuthnPrfProvider();
}
