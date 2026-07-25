import { describe, expect, it } from "vitest";
import { previewBitwardenJson, previewGenericCsv, selectedImportRequests } from "./index";

describe("focused import preview", () => {
  it("parses quoted generic CSV, warns about duplicates, and selects valid rows", () => {
    const existing = [
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "existing",
        notes: "",
        password: "old",
        revisionId: "revision",
        title: "Existing",
        type: "login" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
        uris: ["https://example.test"],
        username: "person",
      },
    ];
    const preview = previewGenericCsv(
      'title,username,password,url,notes,tags\n"Example, Inc",person,new,https://example.test,"line one",work;important\n,person,,,,\n',
      existing,
    );
    expect(preview).toMatchObject({ source: "csv", validCount: 1 });
    expect(preview.rows[0]).toMatchObject({
      sourceLabel: "Example, Inc",
      status: "valid",
      warnings: ["duplicate"],
    });
    expect(preview.rows[1]).toMatchObject({ status: "invalid" });
    expect(selectedImportRequests(preview, [0])).toHaveLength(1);
  });

  it("previews Bitwarden login items and ignores unsupported item types", () => {
    const preview = previewBitwardenJson(
      JSON.stringify({
        encrypted: false,
        folders: [{ id: "folder", name: "Work" }],
        items: [
          {
            favorite: true,
            folderId: "folder",
            login: {
              password: "secret",
              totp: "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP",
              uris: [{ uri: "https://example.test" }],
              username: "person",
            },
            name: "Example",
            notes: "note",
            type: 1,
          },
          { name: "Card", type: 3 },
        ],
      }),
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]?.input).toMatchObject({
      favorite: true,
      folder: "Work",
      title: "Example",
    });
  });

  it("rejects encrypted, oversized-shape, and malformed inputs safely", () => {
    expect(() => previewBitwardenJson('{"encrypted":true,"items":[]}')).toThrow();
    expect(() => previewGenericCsv('title,password\n"unfinished')).toThrow();
    expect(() => previewGenericCsv("unknown\nvalue")).toThrow();
  });
});
