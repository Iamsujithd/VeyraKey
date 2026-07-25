import { createCryptoProvider, createWebAuthnPrfProvider } from "@zk-wallet/crypto";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbVaultHeaderRepository,
} from "@zk-wallet/persistence";
import { type VaultClient, VaultScreen } from "@zk-wallet/ui";
import { createVaultService } from "@zk-wallet/vault";
import { useState } from "react";
import { withGoogleDriveSync } from "./googleDrive";
import { withOneDriveSync } from "./oneDrive";

export interface AppProps {
  readonly client?: VaultClient;
}

function createLocalVaultClient(): VaultClient {
  const crypto = createCryptoProvider();
  const service = createVaultService({
    crypto,
    devicePrf: createWebAuthnPrfProvider(),
    itemRepository: new IndexedDbItemRevisionRepository(),
    repository: new IndexedDbVaultHeaderRepository(),
  });
  return withOneDriveSync(withGoogleDriveSync(service, crypto), crypto);
}

export function App({ client }: AppProps) {
  const [vaultClient] = useState(() => client ?? createLocalVaultClient());
  return <VaultScreen client={vaultClient} surface="Web application" />;
}
