import { createCryptoProvider } from "@zk-wallet/crypto";
import {
  createEncryptedVaultSyncCodec,
  MemorySyncStore,
  type SyncRevisionV1,
  synchronize,
} from "@zk-wallet/sync";
import { describe, expect, it } from "vitest";
import { DriveProviderError, GOOGLE_DRIVE_APPDATA_SCOPE, GoogleDriveSyncProvider } from "./index";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function provider(fetch: typeof globalThis.fetch, tokens = ["token"]) {
  let index = 0;
  const invalidated: string[] = [];
  return {
    invalidated,
    value: new GoogleDriveSyncProvider({
      fetch,
      maximumAttempts: 3,
      retryDelay: async () => undefined,
      tokenProvider: {
        getAccessToken: async () => tokens[Math.min(index, tokens.length - 1)] ?? "",
        invalidateAccessToken(token) {
          invalidated.push(token);
          index += 1;
        },
      },
    }),
  };
}

describe("Google Drive appDataFolder provider", () => {
  it("publishes only the least-privilege OAuth scope", () => {
    expect(GOOGLE_DRIVE_APPDATA_SCOPE).toBe("https://www.googleapis.com/auth/drive.appdata");
  });

  it("paginates appDataFolder files and ignores unrelated names", async () => {
    const urls: string[] = [];
    const fetch = async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("pageToken=next")) {
        return json({ files: [{ id: "b", name: "zkv1_second.sync" }] });
      }
      if (url.includes("alt=media")) {
        return new Response(url.includes("/a?") ? "cipher-a" : "cipher-b");
      }
      return json({
        files: [
          { id: "a", name: "zkv1_first.sync" },
          { id: "ignored", name: "notes.txt" },
        ],
        nextPageToken: "next",
      });
    };
    const result = await provider(fetch as typeof globalThis.fetch).value.list();
    expect(result).toEqual([
      { body: "cipher-a", locator: "first" },
      { body: "cipher-b", locator: "second" },
    ]);
    expect(urls.filter((url) => url.includes("/files?"))).toHaveLength(2);
    expect(urls[0]).toContain("spaces=appDataFolder");
  });

  it("uploads immutable multipart objects and treats an existing name idempotently", async () => {
    const requests: Array<{ init: RequestInit | undefined; url: string }> = [];
    let exists = false;
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ init, url });
      if (url.includes("/upload/")) {
        exists = true;
        return json({ id: "created" });
      }
      return json({
        files: exists ? [{ id: "created", name: "zkv1_revision.sync" }] : [],
      });
    };
    const drive = provider(fetch as typeof globalThis.fetch).value;
    await expect(
      drive.putIfAbsent({ body: "opaque-ciphertext", locator: "revision" }),
    ).resolves.toBe("created");
    await expect(drive.putIfAbsent({ body: "ignored", locator: "revision" })).resolves.toBe(
      "exists",
    );
    const upload = requests.find((request) => request.url.includes("/upload/"));
    expect(upload?.url).toContain("uploadType=multipart");
    expect(String(upload?.init?.body)).toContain('"parents":["appDataFolder"]');
    expect(String(upload?.init?.body)).toContain("opaque-ciphertext");
    expect(upload?.init?.headers).toMatchObject({
      "Content-Type": expect.stringContaining("multipart/related"),
    });
  });

  it("retries an upload whose committed response was lost", async () => {
    let uploadAttempts = 0;
    const fetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/upload/")) return json({ files: [] });
      uploadAttempts += 1;
      if (uploadAttempts === 1) throw new TypeError("connection closed after commit");
      return json({ id: "duplicate-safe" });
    };
    const drive = provider(fetch as typeof globalThis.fetch).value;
    await expect(drive.putIfAbsent({ body: "opaque", locator: "retry" })).resolves.toBe("created");
    expect(uploadAttempts).toBe(2);
  });

  it("refreshes one expired token without persisting it", async () => {
    const authorization: string[] = [];
    let calls = 0;
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      authorization.push(
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
      );
      calls += 1;
      return calls === 1 ? json({ error: { errors: [] } }, 401) : json({ files: [] });
    };
    const drive = provider(fetch as typeof globalThis.fetch, ["expired", "fresh"]);
    await expect(drive.value.list()).resolves.toEqual([]);
    expect(drive.invalidated).toEqual(["expired"]);
    expect(authorization).toEqual(["Bearer expired", "Bearer fresh"]);
    expect(JSON.stringify(drive.value)).not.toContain("fresh");
  });

  it("separates quota, revocation, and retryable provider failures", async () => {
    const quota = provider((async () =>
      json(
        { error: { errors: [{ reason: "storageQuotaExceeded" }] } },
        403,
      )) as typeof fetch).value;
    await expect(quota.list()).rejects.toMatchObject({ code: "DRIVE_QUOTA", retryable: false });

    const revoked = provider((async () => json({ error: { errors: [] } }, 401)) as typeof fetch, [
      "bad",
      "still-bad",
    ]).value;
    await expect(revoked.list()).rejects.toMatchObject({ code: "DRIVE_AUTH", retryable: false });

    let attempts = 0;
    const transient = provider((async () => {
      attempts += 1;
      return attempts < 3 ? json({ error: { errors: [] } }, 503) : json({ files: [] });
    }) as typeof fetch).value;
    await expect(transient.list()).resolves.toEqual([]);
    expect(attempts).toBe(3);
  });

  it("reads paged change feeds and advances only returned cursors", async () => {
    const fetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("startPageToken")) return json({ startPageToken: "start" });
      if (url.includes("pageToken=start")) {
        return json({
          changes: [
            {
              file: { id: "one", name: "zkv1_root.sync" },
              fileId: "one",
              removed: false,
            },
          ],
          nextPageToken: "next",
        });
      }
      return json({
        changes: [{ fileId: "one", removed: true }],
        newStartPageToken: "fresh",
      });
    };
    const drive = provider(fetch as typeof globalThis.fetch).value;
    await expect(drive.getStartCursor()).resolves.toBe("start");
    await expect(drive.listChanges("start")).resolves.toEqual({
      changes: [{ fileId: "one", locator: "root", removed: false }],
      cursor: "next",
      hasMore: true,
    });
    await expect(drive.listChanges("next")).resolves.toEqual({
      changes: [{ fileId: "one", locator: undefined, removed: true }],
      cursor: "fresh",
      hasMore: false,
    });
  });

  it("rejects unsafe locators and oversized downloads", async () => {
    const drive = provider((async () => json({ files: [] })) as typeof fetch).value;
    await expect(drive.putIfAbsent({ body: "x", locator: "../escape" })).rejects.toBeInstanceOf(
      DriveProviderError,
    );

    const oversized = provider((async (input: string | URL | Request) =>
      String(input).includes("alt=media")
        ? new Response("x", { headers: { "content-length": "16777217" } })
        : json({ files: [{ id: "a", name: "zkv1_safe.sync" }] })) as typeof fetch).value;
    await expect(oversized.list()).rejects.toMatchObject({ code: "DRIVE_CORRUPT_RESPONSE" });
  });

  it("recovers an encrypted vault revision into a clean browser profile", async () => {
    const files = new Map<string, { body: string; id: string; name: string }>();
    const fakeDrive = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/upload/")) {
        const multipart = String(init?.body);
        const name = /"name":"([^"]+)"/u.exec(multipart)?.[1];
        const marker = "Content-Type: application/octet-stream\r\n\r\n";
        const mediaStart = multipart.indexOf(marker);
        const boundaryStart = multipart.indexOf("\r\n--", mediaStart + marker.length);
        if (name === undefined || mediaStart < 0 || boundaryStart < 0) {
          return json({ error: { errors: [] } }, 400);
        }
        const id = `file-${files.size + 1}`;
        files.set(id, {
          body: multipart.slice(mediaStart + marker.length, boundaryStart),
          id,
          name,
        });
        return json({ id });
      }
      if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/files")) {
        return json({
          files: [...files.values()].map(({ id, name }) => ({ id, name })),
        });
      }
      if (url.hostname === "www.googleapis.com" && url.searchParams.get("alt") === "media") {
        const id = url.pathname.split("/").at(-1);
        const file = [...files.values()].find((candidate) => candidate.id === id);
        return file === undefined ? new Response("", { status: 404 }) : new Response(file.body);
      }
      if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/files")) {
        throw new Error("unreachable");
      }
      if (url.hostname === "www.googleapis.com") throw new Error("unexpected API request");
      throw new Error("unexpected host");
    };
    const drive = provider(fakeDrive as typeof globalThis.fetch).value;
    const crypto = createCryptoProvider();
    const rootKey = new Uint8Array(32).fill(7);
    const codec = createEncryptedVaultSyncCodec(crypto, rootKey, "AQEBAQEBAQEBAQEBAQEBAQ");
    const revision: SyncRevisionV1 = {
      clock: { counter: 0, wallTime: 1 },
      deviceId: "profile-a",
      itemId: "item",
      kind: "value",
      parents: [],
      payload: "synthetic-secret",
      revisionId: "revision",
      version: 1,
    };
    const profileA = new MemorySyncStore();
    const cleanProfileB = new MemorySyncStore();
    await profileA.putIfAbsent(await codec.encode(revision));

    await synchronize({ codec, provider: drive, repository: profileA });
    const recovered = await synchronize({ codec, provider: drive, repository: cleanProfileB });

    expect(recovered).toMatchObject({ revisionCount: 1, uploaded: 0 });
    const recoveredObject = (await cleanProfileB.list())[0];
    if (recoveredObject === undefined) throw new Error("Expected recovered encrypted object");
    expect(await codec.decode(recoveredObject)).toEqual(revision);
    expect(JSON.stringify([...files.values()])).not.toContain("synthetic-secret");
  });
});
