import type { OpaqueSyncObject, SyncRepository } from "@zk-wallet/sync";
import type {
  EncryptedItemRevisionV1,
  ItemRevisionRepository,
  VaultHeader,
  VaultHeaderRepository,
  VaultHeaderWriteCondition,
} from "@zk-wallet/vault";

const DEFAULT_DATABASE_NAME = "zk-wallet-vault";
const DATABASE_VERSION = 5;
const STORE_NAME = "bootstrap";
const PRIMARY_HEADER_KEY = "primary";
const ITEM_REVISIONS_STORE = "item-revisions";
const ITEM_HEADS_STORE = "item-heads";
const SYNC_OBJECTS_STORE = "sync-objects";
const SYNC_QUARANTINE_STORE = "sync-quarantine";
const SYNC_CONFLICTS_STORE = "sync-conflicts";
const SEARCH_INDEX_STORE = "search-index";

function ensureStores(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
  if (!database.objectStoreNames.contains(ITEM_REVISIONS_STORE)) {
    database.createObjectStore(ITEM_REVISIONS_STORE, { keyPath: "revisionId" });
  }
  if (!database.objectStoreNames.contains(ITEM_HEADS_STORE)) {
    database.createObjectStore(ITEM_HEADS_STORE);
  }
  if (!database.objectStoreNames.contains(SYNC_OBJECTS_STORE)) {
    database.createObjectStore(SYNC_OBJECTS_STORE, { keyPath: "locator" });
  }
  if (!database.objectStoreNames.contains(SYNC_QUARANTINE_STORE)) {
    database.createObjectStore(SYNC_QUARANTINE_STORE, { autoIncrement: true });
  }
  if (!database.objectStoreNames.contains(SYNC_CONFLICTS_STORE)) {
    database.createObjectStore(SYNC_CONFLICTS_STORE);
  }
  if (!database.objectStoreNames.contains(SEARCH_INDEX_STORE)) {
    database.createObjectStore(SEARCH_INDEX_STORE);
  }
}

export type PersistenceErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "VAULT_ALREADY_EXISTS"
  | "VAULT_PERSISTENCE_FAILED"
  | "VAULT_WRITE_CONFLICT";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export interface IndexedDbVaultHeaderRepositoryOptions {
  readonly databaseName?: string;
}

function databaseFactory(): IDBFactory {
  if (globalThis.indexedDB === undefined) {
    throw new PersistenceError(
      "PERSISTENCE_UNAVAILABLE",
      "Encrypted local persistence is unavailable",
    );
  }
  return globalThis.indexedDB;
}

function persistenceFailure(message = "Encrypted local persistence failed"): PersistenceError {
  return new PersistenceError("VAULT_PERSISTENCE_FAILED", message);
}

function matchesCondition(value: unknown, condition: VaultHeaderWriteCondition): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.vaultId === condition.vaultId &&
    record.version === condition.version &&
    (record.revision ?? null) === condition.revision
  );
}

export class IndexedDbVaultHeaderRepository implements VaultHeaderRepository {
  readonly databaseName: string;

  constructor(options: IndexedDbVaultHeaderRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = databaseFactory().open(this.databaseName, DATABASE_VERSION);
      request.onblocked = () =>
        reject(
          new PersistenceError(
            "VAULT_PERSISTENCE_FAILED",
            "Encrypted local persistence is blocked",
          ),
        );
      request.onerror = () =>
        reject(
          new PersistenceError(
            "VAULT_PERSISTENCE_FAILED",
            "Encrypted local persistence could not be opened",
          ),
        );
      request.onupgradeneeded = () => {
        ensureStores(request.result);
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  async create(header: VaultHeader): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const request = transaction.objectStore(STORE_NAME).add(header, PRIMARY_HEADER_KEY);
        let rejected = false;

        request.onerror = () => {
          rejected = true;
          const code =
            request.error?.name === "ConstraintError"
              ? "VAULT_ALREADY_EXISTS"
              : "VAULT_PERSISTENCE_FAILED";
          reject(
            new PersistenceError(
              code,
              code === "VAULT_ALREADY_EXISTS"
                ? "A local vault already exists"
                : "Encrypted local persistence failed",
            ),
          );
        };
        transaction.onabort = () => {
          if (!rejected) reject(persistenceFailure("Encrypted local persistence was interrupted"));
        };
        transaction.onerror = () => {
          if (!rejected) reject(persistenceFailure());
        };
        transaction.oncomplete = () => resolve();
      });
    } finally {
      database.close();
    }
  }

  async restoreArchive(
    header: VaultHeader,
    revisions: readonly EncryptedItemRevisionV1[],
    headRevisionIds: readonly string[],
  ): Promise<void> {
    const database = await this.open();
    try {
      const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]));
      const heads = headRevisionIds.map((revisionId) => byId.get(revisionId));
      if (
        heads.some((revision) => revision === undefined) ||
        new Set(heads.map((revision) => revision?.itemId)).size !== heads.length
      ) {
        throw persistenceFailure("Encrypted archive heads are invalid");
      }
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [STORE_NAME, ITEM_REVISIONS_STORE, ITEM_HEADS_STORE],
          "readwrite",
        );
        let rejected = false;
        const fail = (error: PersistenceError) => {
          if (rejected) return;
          rejected = true;
          reject(error);
        };
        const bootstrap = transaction.objectStore(STORE_NAME);
        const existing = bootstrap.get(PRIMARY_HEADER_KEY);
        existing.onerror = () => fail(persistenceFailure());
        existing.onsuccess = () => {
          if (existing.result !== undefined) {
            fail(new PersistenceError("VAULT_ALREADY_EXISTS", "A local vault already exists"));
            transaction.abort();
            return;
          }
          bootstrap.add(header, PRIMARY_HEADER_KEY);
          const revisionStore = transaction.objectStore(ITEM_REVISIONS_STORE);
          for (const revision of revisions) revisionStore.add(revision);
          const headStore = transaction.objectStore(ITEM_HEADS_STORE);
          for (const revision of heads) {
            if (revision !== undefined) headStore.put(revision.revisionId, revision.itemId);
          }
        };
        transaction.onabort = () => {
          if (!rejected) fail(persistenceFailure("Encrypted archive restore was rolled back"));
        };
        transaction.onerror = () => {
          if (!rejected) fail(persistenceFailure());
        };
        transaction.oncomplete = () => {
          if (!rejected) resolve();
        };
      });
    } finally {
      database.close();
    }
  }

  async read(): Promise<unknown | null> {
    const database = await this.open();
    try {
      return await new Promise<unknown | null>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(PRIMARY_HEADER_KEY);
        request.onerror = () =>
          reject(
            new PersistenceError(
              "VAULT_PERSISTENCE_FAILED",
              "Encrypted local persistence could not be read",
            ),
          );
        request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
      });
    } finally {
      database.close();
    }
  }

  async replace(condition: VaultHeaderWriteCondition, header: VaultHeader): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const readRequest = store.get(PRIMARY_HEADER_KEY);
        let rejected = false;

        const rejectOnce = (error: PersistenceError) => {
          if (rejected) return;
          rejected = true;
          reject(error);
        };

        readRequest.onerror = () => rejectOnce(persistenceFailure());
        readRequest.onsuccess = () => {
          if (!matchesCondition(readRequest.result, condition)) {
            rejectOnce(
              new PersistenceError(
                "VAULT_WRITE_CONFLICT",
                "The encrypted vault changed concurrently",
              ),
            );
            transaction.abort();
            return;
          }
          const writeRequest = store.put(header, PRIMARY_HEADER_KEY);
          writeRequest.onerror = () => rejectOnce(persistenceFailure());
        };
        transaction.onabort = () => {
          if (!rejected)
            rejectOnce(persistenceFailure("Encrypted local persistence was interrupted"));
        };
        transaction.onerror = () => {
          if (!rejected) rejectOnce(persistenceFailure());
        };
        transaction.oncomplete = () => {
          if (!rejected) resolve();
        };
      });
    } finally {
      database.close();
    }
  }
}

export class IndexedDbItemRevisionRepository implements ItemRevisionRepository {
  readonly databaseName: string;

  constructor(options: IndexedDbVaultHeaderRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  }

  private async open(): Promise<IDBDatabase> {
    return await new Promise((resolve, reject) => {
      const request = databaseFactory().open(this.databaseName, DATABASE_VERSION);
      request.onerror = () => reject(persistenceFailure());
      request.onblocked = () =>
        reject(persistenceFailure("Encrypted local persistence is blocked"));
      request.onupgradeneeded = () => {
        ensureStores(request.result);
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  async commit(
    expectedRevisionId: string | null,
    revision: EncryptedItemRevisionV1,
  ): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [ITEM_REVISIONS_STORE, ITEM_HEADS_STORE],
          "readwrite",
        );
        const heads = transaction.objectStore(ITEM_HEADS_STORE);
        const revisions = transaction.objectStore(ITEM_REVISIONS_STORE);
        const read = heads.get(revision.itemId);
        let rejected = false;
        const fail = (error: PersistenceError) => {
          if (rejected) return;
          rejected = true;
          reject(error);
        };
        read.onerror = () => fail(persistenceFailure());
        read.onsuccess = () => {
          const actual = read.result === undefined ? null : read.result;
          if (actual !== expectedRevisionId) {
            fail(
              new PersistenceError(
                "VAULT_WRITE_CONFLICT",
                "The encrypted item changed concurrently",
              ),
            );
            transaction.abort();
            return;
          }
          const add = revisions.add(revision);
          add.onerror = () => fail(persistenceFailure());
          heads.put(revision.revisionId, revision.itemId);
        };
        transaction.onabort = () => {
          if (!rejected) fail(persistenceFailure("Encrypted local persistence was interrupted"));
        };
        transaction.onerror = () => {
          if (!rejected) fail(persistenceFailure());
        };
        transaction.oncomplete = () => {
          if (!rejected) resolve();
        };
      });
    } finally {
      database.close();
    }
  }

  async commitBatch(revisions: readonly EncryptedItemRevisionV1[]): Promise<void> {
    const database = await this.open();
    try {
      if (
        revisions.length === 0 ||
        new Set(revisions.map((revision) => revision.itemId)).size !== revisions.length ||
        revisions.some(
          (revision) => revision.operation !== "create" || revision.parentRevisionId !== null,
        )
      ) {
        throw persistenceFailure("Atomic import batch is invalid");
      }
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [ITEM_REVISIONS_STORE, ITEM_HEADS_STORE],
          "readwrite",
        );
        const storedRevisions = transaction.objectStore(ITEM_REVISIONS_STORE);
        const heads = transaction.objectStore(ITEM_HEADS_STORE);
        for (const revision of revisions) {
          const existing = heads.get(revision.itemId);
          existing.onsuccess = () => {
            if (existing.result !== undefined) transaction.abort();
            else {
              storedRevisions.add(revision);
              heads.add(revision.revisionId, revision.itemId);
            }
          };
        }
        transaction.onabort = () => reject(persistenceFailure("Encrypted import was rolled back"));
        transaction.onerror = () => reject(persistenceFailure());
        transaction.oncomplete = () => resolve();
      });
    } finally {
      database.close();
    }
  }

  async listHeads(): Promise<readonly unknown[]> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          [ITEM_REVISIONS_STORE, ITEM_HEADS_STORE],
          "readonly",
        );
        const headsRequest = transaction.objectStore(ITEM_HEADS_STORE).getAll();
        headsRequest.onerror = () => reject(persistenceFailure());
        headsRequest.onsuccess = () => {
          const revisionIds = headsRequest.result;
          if (revisionIds.length === 0) {
            resolve([]);
            return;
          }
          const revisions = transaction.objectStore(ITEM_REVISIONS_STORE);
          const values: unknown[] = [];
          let remaining = revisionIds.length;
          for (const revisionId of revisionIds) {
            const request = revisions.get(revisionId);
            request.onerror = () => reject(persistenceFailure());
            request.onsuccess = () => {
              values.push(request.result);
              remaining -= 1;
              if (remaining === 0) resolve(values);
            };
          }
        };
      });
    } finally {
      database.close();
    }
  }

  async listRevisions(): Promise<readonly unknown[]> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(ITEM_REVISIONS_STORE, "readonly")
          .objectStore(ITEM_REVISIONS_STORE)
          .getAll();
        request.onerror = () => reject(persistenceFailure());
        request.onsuccess = () => resolve(request.result);
      });
    } finally {
      database.close();
    }
  }

  async readSearchIndex(): Promise<unknown | null> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(SEARCH_INDEX_STORE, "readonly")
          .objectStore(SEARCH_INDEX_STORE)
          .get("current");
        request.onerror = () => reject(persistenceFailure());
        request.onsuccess = () => resolve(request.result ?? null);
      });
    } finally {
      database.close();
    }
  }

  async writeSearchIndex(index: unknown): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SEARCH_INDEX_STORE, "readwrite");
        transaction.objectStore(SEARCH_INDEX_STORE).put(structuredClone(index), "current");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(persistenceFailure());
      });
    } finally {
      database.close();
    }
  }

  async importRevision(revision: EncryptedItemRevisionV1): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(ITEM_REVISIONS_STORE, "readwrite");
        const store = transaction.objectStore(ITEM_REVISIONS_STORE);
        const read = store.get(revision.revisionId);
        read.onerror = () => reject(persistenceFailure());
        read.onsuccess = () => {
          if (read.result === undefined) store.add(revision);
          else if (JSON.stringify(read.result) !== JSON.stringify(revision)) {
            transaction.abort();
          }
        };
        transaction.onabort = () =>
          reject(persistenceFailure("A revision locator collision was rejected"));
        transaction.onerror = () => reject(persistenceFailure());
        transaction.oncomplete = () => resolve();
      });
    } finally {
      database.close();
    }
  }

  async setHead(itemId: string, revisionId: string): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [ITEM_REVISIONS_STORE, ITEM_HEADS_STORE],
          "readwrite",
        );
        const revision = transaction.objectStore(ITEM_REVISIONS_STORE).get(revisionId);
        revision.onerror = () => reject(persistenceFailure());
        revision.onsuccess = () => {
          if (revision.result?.itemId !== itemId) {
            transaction.abort();
            return;
          }
          transaction.objectStore(ITEM_HEADS_STORE).put(revisionId, itemId);
        };
        transaction.onabort = () => reject(persistenceFailure("Invalid sync head rejected"));
        transaction.onerror = () => reject(persistenceFailure());
        transaction.oncomplete = () => resolve();
      });
    } finally {
      database.close();
    }
  }

  async listConflicts(): Promise<
    readonly { readonly itemId: string; readonly revisionIds: readonly string[] }[]
  > {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(SYNC_CONFLICTS_STORE, "readonly")
          .objectStore(SYNC_CONFLICTS_STORE)
          .get("current");
        request.onerror = () => reject(persistenceFailure());
        request.onsuccess = () => resolve(request.result ?? []);
      });
    } finally {
      database.close();
    }
  }

  async setConflicts(
    conflicts: readonly { readonly itemId: string; readonly revisionIds: readonly string[] }[],
  ): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SYNC_CONFLICTS_STORE, "readwrite");
        transaction.objectStore(SYNC_CONFLICTS_STORE).put(structuredClone(conflicts), "current");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(persistenceFailure());
      });
    } finally {
      database.close();
    }
  }
}

export class IndexedDbSyncRepository implements SyncRepository {
  readonly databaseName: string;

  constructor(options: IndexedDbVaultHeaderRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  }

  private async open(): Promise<IDBDatabase> {
    return await new Promise((resolve, reject) => {
      const request = databaseFactory().open(this.databaseName, DATABASE_VERSION);
      request.onerror = () => reject(persistenceFailure());
      request.onblocked = () =>
        reject(persistenceFailure("Encrypted local persistence is blocked"));
      request.onupgradeneeded = () => ensureStores(request.result);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async list(): Promise<readonly OpaqueSyncObject[]> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(SYNC_OBJECTS_STORE, "readonly")
          .objectStore(SYNC_OBJECTS_STORE)
          .getAll();
        request.onerror = () => reject(persistenceFailure());
        request.onsuccess = () => resolve(request.result as OpaqueSyncObject[]);
      });
    } finally {
      database.close();
    }
  }

  async putIfAbsent(object: OpaqueSyncObject): Promise<"created" | "exists"> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(SYNC_OBJECTS_STORE, "readwrite");
        const store = transaction.objectStore(SYNC_OBJECTS_STORE);
        const read = store.get(object.locator);
        let outcome: "created" | "exists" = "exists";
        read.onerror = () => reject(persistenceFailure());
        read.onsuccess = () => {
          if (read.result === undefined) {
            outcome = "created";
            store.add(object);
          } else if (read.result.body !== object.body) {
            transaction.abort();
          }
        };
        transaction.onabort = () =>
          reject(persistenceFailure("A sync locator collision was rejected"));
        transaction.onerror = () => reject(persistenceFailure());
        transaction.oncomplete = () => resolve(outcome);
      });
    } finally {
      database.close();
    }
  }

  async quarantine(object: OpaqueSyncObject, reason: "corrupt" | "missing-parent"): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SYNC_QUARANTINE_STORE, "readwrite");
        transaction.objectStore(SYNC_QUARANTINE_STORE).add({ object, reason });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(persistenceFailure());
      });
    } finally {
      database.close();
    }
  }
}
