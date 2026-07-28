import { describe, expect, it } from "vitest";
import {
  AUTOFILL_METADATA_INDEX_KEY,
  buildAutofillMetadataIndex,
  readAutofillMetadataIndex,
} from "./autofillIndex";

describe("local AutoFill metadata index", () => {
  it("keeps only named login identifiers and exact HTTPS origins", () => {
    expect(
      buildAutofillMetadataIndex([
        {
          createdAt: "2026-07-28T00:00:00.000Z",
          id: "student-login",
          notes: "",
          password: "never-index-this",
          revisionId: "revision",
          title: "Student",
          type: "login",
          updatedAt: "2026-07-28T00:00:00.000Z",
          uris: ["https://example.test/login", "http://unsafe.test", "not a URL"],
          username: "student",
        },
        {
          createdAt: "2026-07-28T00:00:00.000Z",
          id: "blank-login",
          notes: "",
          password: "blank-secret",
          revisionId: "blank-revision",
          title: "Blank",
          type: "login",
          updatedAt: "2026-07-28T00:00:00.000Z",
          uris: ["https://example.test"],
          username: "",
        },
      ]),
    ).toEqual([{ id: "student-login", origins: ["https://example.test"], username: "student" }]);
  });

  it("rejects malformed stored entries", async () => {
    expect(
      await readAutofillMetadataIndex({
        get: async () => ({
          [AUTOFILL_METADATA_INDEX_KEY]: [
            { id: "good", origins: ["https://example.test"], username: "person" },
            { id: "bad", origins: ["http://unsafe.test"], username: "person" },
          ],
        }),
        set: async () => undefined,
      }),
    ).toEqual([{ id: "good", origins: ["https://example.test"], username: "person" }]);
  });
});
