import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
const extensionPackage = JSON.parse(await readFile("apps/extension/package.json", "utf8"));
const chromeManifest = JSON.parse(
  await readFile("apps/extension/.output/chrome-mv3/manifest.json", "utf8"),
);
const firefoxManifest = JSON.parse(
  await readFile("apps/extension/.output/firefox-mv3/manifest.json", "utf8"),
);
const externalGateDocument = JSON.parse(await readFile("release/external-gates.json", "utf8"));

const version = rootPackage.version;
const versions = [extensionPackage.version, chromeManifest.version, firefoxManifest.version];
if (versions.some((candidate) => candidate !== version)) {
  throw new Error(
    `Release versions disagree: root=${version}, extension=${extensionPackage.version}, chrome=${chromeManifest.version}, firefox=${firefoxManifest.version}`,
  );
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

const artifactPaths = [
  "pnpm-lock.yaml",
  "release/external-gates.json",
  "release/sbom.cdx.json",
  ...(await filesUnder("apps/api/dist")).filter((path) => !path.endsWith(".map")),
  ...(await filesUnder("apps/web/dist")).filter((path) => !path.endsWith(".map")),
  `apps/extension/.output/veyrakey-extension-${version}-chrome.zip`,
  `apps/extension/.output/veyrakey-extension-${version}-firefox.zip`,
  `apps/extension/.output/veyrakey-extension-${version}-sources.zip`,
].sort();

const artifacts = [];
for (const path of artifactPaths) {
  const contents = await readFile(path);
  artifacts.push({
    path,
    bytes: (await stat(path)).size,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}

function git(args, fallback) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

const workingTreeChanges = git(["status", "--porcelain"], "unknown");
const manifest = {
  schemaVersion: 1,
  product: "VeyraKey",
  packageName: rootPackage.name,
  version,
  generatedAt: new Date().toISOString(),
  releaseStatus: "local-release-candidate",
  source: {
    revision: git(["rev-parse", "HEAD"], "unknown"),
    workingTree: workingTreeChanges === "" ? "clean" : "modified",
  },
  validation: {
    command: "CI=true pnpm release:verify",
    automatedGates: [
      "Biome lint and formatting",
      "strict TypeScript",
      "unit, property, integration, and chaos tests",
      "web, Worker, Chrome MV3, and Firefox MV3 production builds",
      "permission, CSP, source-map, secret, chunk-size, and SBOM checks",
    ],
  },
  artifacts,
  externalGates: externalGateDocument.gates,
};

await mkdir("release", { recursive: true });
await writeFile("release/release-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release manifest written for ${version} with ${artifacts.length} hashed artifacts.`);
