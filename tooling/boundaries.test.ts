import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const sourcePattern = /\.(?:ts|tsx)$/u;
const appImportPattern =
  /(?:from\s+|import\s*)["'](?:@zk-wallet\/(?:web|extension|api)|.*\/apps\/)/u;
const apiForbiddenPattern =
  /["']@zk-wallet\/(?:crypto|vault|persistence|sync|documents|credentials|ui)["']/u;
const cryptoForbiddenPattern =
  /["']@zk-wallet\/(?:ui|vault|persistence|sync|documents|credentials|web|extension|api)["']/u;
const vaultForbiddenPattern =
  /["']@zk-wallet\/(?:ui|persistence|sync|documents|credentials|web|extension|api)["']/u;

function sourceFiles(directory: string): string[] {
  const absolute = join(root, directory);

  return readdirSync(absolute).flatMap((entry) => {
    const path = join(absolute, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(relative(root, path))
      : sourcePattern.test(path)
        ? [path]
        : [];
  });
}

describe("module boundaries", () => {
  it("prevents packages from importing application code", () => {
    const violations = sourceFiles("packages")
      .filter((path) => appImportPattern.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));

    expect(violations).toEqual([]);
  });

  it("keeps the control plane outside client secret-bearing modules", () => {
    const violations = sourceFiles("apps/api/src")
      .filter((path) => apiForbiddenPattern.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));

    expect(violations).toEqual([]);
  });

  it("keeps the crypto package independent from domain and application layers", () => {
    const violations = sourceFiles("packages/crypto/src")
      .filter((path) => cryptoForbiddenPattern.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));

    expect(violations).toEqual([]);
  });

  it("keeps vault orchestration independent from persistence and UI", () => {
    const violations = sourceFiles("packages/vault/src")
      .filter((path) => vaultForbiddenPattern.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));

    expect(violations).toEqual([]);
  });
});
