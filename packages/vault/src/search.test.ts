import { createCryptoProvider } from "@zk-wallet/crypto";
import { describe, expect, it } from "vitest";
import type { VaultItem } from "./items";
import { encryptSearchIndex, searchEncryptedIndex } from "./search";

describe("encrypted rebuildable local search", () => {
  it("indexes organization fields without persisting their plaintext", async () => {
    const crypto = createCryptoProvider();
    const root = new Uint8Array(32).fill(3);
    const vaultId = "AQEBAQEBAQEBAQEBAQEBAQ";
    const items: VaultItem[] = [
      {
        createdAt: "2026-07-25T00:00:00.000Z",
        favorite: true,
        folder: "Employment",
        id: "item",
        notes: "",
        password: "secret",
        revisionId: "revision",
        tags: ["Payroll", "Important"],
        title: "Acme Portal",
        type: "login",
        updatedAt: "2026-07-25T00:00:00.000Z",
        uris: ["https://example.test"],
        username: "person@example.test",
      },
    ];
    const encrypted = await encryptSearchIndex(crypto, root, vaultId, items);
    expect(JSON.stringify(encrypted)).not.toMatch(/Acme|Payroll|Employment|person/u);
    await expect(searchEncryptedIndex(crypto, root, vaultId, encrypted, "pay")).resolves.toEqual([
      "item",
    ]);
    await expect(
      searchEncryptedIndex(crypto, root, vaultId, encrypted, "missing"),
    ).resolves.toEqual([]);
  });

  it("fails closed for a wrong root or tampered index", async () => {
    const crypto = createCryptoProvider();
    const vaultId = "AQEBAQEBAQEBAQEBAQEBAQ";
    const encrypted = await encryptSearchIndex(crypto, new Uint8Array(32).fill(1), vaultId, []);
    await expect(
      searchEncryptedIndex(crypto, new Uint8Array(32).fill(2), vaultId, encrypted, ""),
    ).rejects.toBeDefined();
    await expect(
      searchEncryptedIndex(
        crypto,
        new Uint8Array(32).fill(1),
        vaultId,
        {
          ...encrypted,
          ciphertext: `${encrypted.ciphertext.slice(0, -1)}A`,
        },
        "",
      ),
    ).rejects.toBeDefined();
  });
});
