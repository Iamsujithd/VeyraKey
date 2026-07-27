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
  if (
    JSON.stringify(permissions) !==
    JSON.stringify(["activeTab", "identity", "scripting", "storage"])
  ) {
    throw new Error(`${browser} permissions changed without review`);
  }
  if (
    JSON.stringify(manifest.host_permissions ?? []) !==
    JSON.stringify(["https://*.googleapis.com/*", "https://api.pwnedpasswords.com/*"])
  ) {
    throw new Error(`${browser} host permissions changed without review`);
  }
  const extensionPolicy = manifest.content_security_policy?.extension_pages ?? "";
  if (
    !extensionPolicy.includes("script-src 'self' 'wasm-unsafe-eval'") ||
    !extensionPolicy.includes(
      "connect-src 'self' https://*.googleapis.com https://api.pwnedpasswords.com",
    )
  ) {
    throw new Error(`${browser} CSP is missing the reviewed script or connection policy`);
  }
  if (/(?:^|[\s;])'unsafe-eval'(?:[\s;]|$)/u.test(extensionPolicy)) {
    throw new Error(`${browser} CSP enables unrestricted script evaluation`);
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
