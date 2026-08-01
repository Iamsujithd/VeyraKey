import { access, readFile } from "node:fs/promises";

const gateFile = "release/external-gates.json";
const document = JSON.parse(await readFile(gateFile, "utf8"));
if (document.schemaVersion !== 1 || !Array.isArray(document.gates)) {
  throw new Error(`${gateFile} has an unsupported schema`);
}

const statuses = new Set(["pending", "complete", "waived"]);
const gateIds = new Set();
for (const gate of document.gates) {
  if (
    typeof gate.id !== "string" ||
    typeof gate.title !== "string" ||
    typeof gate.owner !== "string" ||
    typeof gate.instructions !== "string" ||
    !statuses.has(gate.status) ||
    !Array.isArray(gate.evidence)
  ) {
    throw new Error(`External release gate is malformed: ${JSON.stringify(gate)}`);
  }
  if (gateIds.has(gate.id)) {
    throw new Error(`External release gate ID is duplicated: ${gate.id}`);
  }
  gateIds.add(gate.id);
  await access(gate.instructions.split("#")[0]);
  if (gate.status !== "pending" && gate.evidence.length === 0) {
    throw new Error(`${gate.id} is marked ${gate.status} without evidence`);
  }
  for (const evidence of gate.evidence) {
    if (typeof evidence !== "string" || evidence.trim() === "") {
      throw new Error(`${gate.id} contains invalid evidence`);
    }
    if (!evidence.startsWith("https://")) {
      await access(evidence);
    }
  }
}

const pending = document.gates.filter((gate) => gate.status === "pending");
for (const gate of document.gates) {
  console.log(`${gate.status.toUpperCase().padEnd(8)} ${gate.id}: ${gate.title}`);
}

if (process.argv.includes("--require-complete") && pending.length > 0) {
  throw new Error(
    `Public release is blocked by ${pending.length} external gate(s): ${pending.map((gate) => gate.id).join(", ")}`,
  );
}

console.log(
  pending.length === 0
    ? "All public-release evidence is present."
    : `Local release is complete; ${pending.length} external public-release gate(s) remain.`,
);
