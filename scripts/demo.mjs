import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferred = "/tmp/opencode";
const temporaryRoot = await fs.access(preferred).then(
  () => preferred,
  () => os.tmpdir(),
);
const directory = await fs.mkdtemp(path.join(temporaryRoot, "infrajournal-demo-"));
const cli = path.join(root, "packages/cli/dist/index.js");

try {
  await fs.cp(path.join(root, "examples/multi-service"), directory, { recursive: true });
  for (const command of ["scan", "generate", "check"]) {
    const result = execFileSync(process.execPath, [cli, command, "--root", directory], {
      encoding: "utf8",
    });
    console.log(result.trim());
  }
  if (!process.argv.includes("--keep")) {
    console.log(
      "Temporary demo documentation verified; use `node scripts/demo.mjs --keep` to inspect it.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  // Never modify the versioned example itself. Use --keep to inspect output.
  if (process.argv.includes("--keep")) console.log(`Demo preserved at: ${directory}`);
  else await fs.rm(directory, { recursive: true, force: true });
}
