import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
const extensionPackage = JSON.parse(await readFile("apps/extension/package.json", "utf8"));
if (rootPackage.version !== extensionPackage.version) {
  throw new Error(
    `Release version mismatch: root=${rootPackage.version}, extension=${extensionPackage.version}`,
  );
}

const roots = [
  ["web", "apps/web/dist"],
  ["chrome", "apps/extension/.output/chrome-mv3"],
  ["firefox", "apps/extension/.output/firefox-mv3"],
];

const reviewedIcons = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};

function readPngSize(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature || bytes.length < 24) {
    throw new Error("Release icon is not a valid PNG");
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

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
  if (manifest.version !== rootPackage.version) {
    throw new Error(
      `${browser} manifest version ${manifest.version} does not match release ${rootPackage.version}`,
    );
  }
  if (manifest.name !== "VeyraKey" || manifest.action?.default_title !== "VeyraKey") {
    throw new Error(`${browser} manifest does not contain the reviewed VeyraKey identity`);
  }
  if (JSON.stringify(manifest.icons) !== JSON.stringify(reviewedIcons)) {
    throw new Error(`${browser} icon inventory changed without review`);
  }
  for (const [size, path] of Object.entries(reviewedIcons)) {
    const bytes = await readFile(`apps/extension/.output/${browser}/${path}`);
    const dimensions = readPngSize(bytes);
    if (dimensions.width !== Number(size) || dimensions.height !== Number(size)) {
      throw new Error(`${browser}/${path} has incorrect dimensions`);
    }
  }
  const permissions = [...(manifest.permissions ?? [])].sort();
  const reviewedPermissions = ["activeTab", "identity", "scripting", "storage"];
  if (JSON.stringify(permissions) !== JSON.stringify(reviewedPermissions)) {
    throw new Error(`${browser} permissions changed without review`);
  }
  if (
    JSON.stringify(manifest.host_permissions ?? []) !==
    JSON.stringify([
      "https://*.googleapis.com/*",
      "https://api.pwnedpasswords.com/*",
      "https://app.simplelogin.io/*",
      "https://app.addy.io/*",
    ])
  ) {
    throw new Error(`${browser} host permissions changed without review`);
  }
  const extensionPolicy = manifest.content_security_policy?.extension_pages ?? "";
  if (
    !extensionPolicy.includes("script-src 'self' 'wasm-unsafe-eval'") ||
    !extensionPolicy.includes(
      "connect-src 'self' https://*.googleapis.com https://api.pwnedpasswords.com https://app.simplelogin.io https://app.addy.io",
    )
  ) {
    throw new Error(`${browser} CSP is missing the reviewed script or connection policy`);
  }
  if (/(?:^|[\s;])'unsafe-eval'(?:[\s;]|$)/u.test(extensionPolicy)) {
    throw new Error(`${browser} CSP enables unrestricted script evaluation`);
  }
  const autofillSource = await readFile(
    `apps/extension/.output/${browser}/content-scripts/autofill.js`,
    "utf8",
  );
  if (
    autofillSource.includes("zk-wallet.autofill-select.v1") ||
    !autofillSource.includes("zk-wallet.authenticated-autofill-select.v1")
  ) {
    throw new Error(`${browser} contains an unauthenticated credential-selection path`);
  }
  if (!autofillSource.includes("extension context invalidated")) {
    throw new Error(`${browser} does not contain the stale-content-script reload guard`);
  }
}

for (const target of ["chrome", "firefox", "sources"]) {
  const archive = `apps/extension/.output/veyrakey-extension-${rootPackage.version}-${target}.zip`;
  if ((await stat(archive)).size === 0) {
    throw new Error(`${archive} is empty`);
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

console.log(
  `Release ${rootPackage.version} artifact, version, permission, source-map, secret, size, and SBOM checks passed.`,
);
