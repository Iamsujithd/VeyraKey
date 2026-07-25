import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const roots = [
  ["web", "apps/web/dist"],
  ["chrome", "apps/extension/.output/chrome-mv3"],
  ["firefox", "apps/extension/.output/firefox-mv3"],
];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
      }),
    )
  ).flat();
}

for (const [target, root] of roots) {
  const files = await filesUnder(root);
  if (files.some((file) => file.endsWith(".map"))) {
    throw new Error(`${target} contains a production source map`);
  }
  for (const file of files.filter((candidate) => candidate.endsWith(".js"))) {
    const bytes = (await stat(file)).size;
    if (bytes > 900_000) throw new Error(`${file} exceeds the 900 kB per-chunk budget`);
    const source = await readFile(file, "utf8");
    if (
      /sourceMappingURL=/u.test(source) ||
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/u.test(source)
    ) {
      throw new Error(`${file} contains forbidden release material`);
    }
  }
}

for (const browser of ["chrome-mv3", "firefox-mv3"]) {
  const manifest = JSON.parse(
    await readFile(`apps/extension/.output/${browser}/manifest.json`, "utf8"),
  );
  const permissions = [...(manifest.permissions ?? [])].sort();
  if (JSON.stringify(permissions) !== JSON.stringify(["activeTab", "scripting", "storage"])) {
    throw new Error(`${browser} permissions changed without review`);
  }
  if ((manifest.host_permissions ?? []).length !== 0) {
    throw new Error(`${browser} must not request persistent host permissions`);
  }
  if (!manifest.content_security_policy?.extension_pages?.includes("script-src 'self'")) {
    throw new Error(`${browser} CSP is missing the self-only script policy`);
  }
}

const sbom = JSON.parse(await readFile("release/sbom.cdx.json", "utf8"));
if (
  sbom.bomFormat !== "CycloneDX" ||
  !Array.isArray(sbom.components) ||
  sbom.components.length < 8
) {
  throw new Error("Release SBOM is missing or incomplete");
}

console.log("Production artifact, permission, source-map, secret, size, and SBOM checks passed.");
