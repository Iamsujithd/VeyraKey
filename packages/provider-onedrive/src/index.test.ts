import { describe, expect, it, vi } from "vitest";
import { ONEDRIVE_APP_FOLDER_SCOPE, OneDriveProviderError, OneDriveSyncProvider } from ".";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });

function provider(fetch: typeof globalThis.fetch) {
  return new OneDriveSyncProvider({
    fetch,
    maximumAttempts: 2,
    retryDelay: async () => undefined,
    tokenProvider: { getAccessToken: async () => "valid-access-token-value" },
  });
}

describe("OneDrive app-folder provider", () => {
  it("uses the least-privilege app-folder scope", () => {
    expect(ONEDRIVE_APP_FOLDER_SCOPE).toBe("Files.ReadWrite.AppFolder");
  });

  it("lists and downloads only opaque sync objects", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [
            { id: "1", name: "zkv1_revision-1.sync" },
            { id: "2", name: "notes.txt" },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("encrypted"));
    await expect(provider(fetch).list()).resolves.toEqual([
      { locator: "revision-1", body: "encrypted" },
    ]);
  });

  it("preserves immutable put-if-absent behavior", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ value: [] }))
      .mockResolvedValueOnce(json({ id: "1" }));
    await expect(
      provider(fetch).putIfAbsent({ locator: "revision-2", body: "ciphertext" }),
    ).resolves.toBe("created");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "PUT", body: "ciphertext" });
  });

  it("writes and reads the encrypted recovery archive", async () => {
    const archive = { ciphertext: "opaque", version: 1 };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ value: [] }))
      .mockResolvedValueOnce(json({ id: "backup" }))
      .mockResolvedValueOnce(
        json({ value: [{ id: "backup", name: "zk-wallet-recovery-v1.backup" }] }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(archive)));
    const drive = provider(fetch);
    await drive.writeEncryptedRecoveryArchive(archive);
    await expect(drive.readEncryptedRecoveryArchive()).resolves.toEqual(archive);
  });

  it("classifies quota and transient failures", async () => {
    await expect(provider(vi.fn().mockResolvedValue(json({}, 507))).list()).rejects.toMatchObject({
      code: "ONEDRIVE_QUOTA",
    });
    await expect(provider(vi.fn().mockResolvedValue(json({}, 503))).list()).rejects.toMatchObject({
      code: "ONEDRIVE_RETRYABLE",
      retryable: true,
    });
    expect(new OneDriveProviderError("ONEDRIVE_AUTH", "x").name).toBe("OneDriveProviderError");
  });
});
