import { createCryptoProvider, createWebAuthnPrfProvider } from "@zk-wallet/crypto";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbVaultHeaderRepository,
} from "@zk-wallet/persistence";
import { type VaultClient, VaultScreen } from "@zk-wallet/ui";
import { createVaultService } from "@zk-wallet/vault";
import { useState } from "react";

export interface AppProps {
  readonly client?: VaultClient;
}

function createLocalVaultClient(): VaultClient {
  return createVaultService({
    crypto: createCryptoProvider(),
    devicePrf: createWebAuthnPrfProvider(),
    itemRepository: new IndexedDbItemRevisionRepository(),
    repository: new IndexedDbVaultHeaderRepository(),
  });
}

export function App({ client }: AppProps) {
  const [vaultClient] = useState(() => client ?? createLocalVaultClient());
  return <VaultScreen client={vaultClient} surface="Web application" />;
}
