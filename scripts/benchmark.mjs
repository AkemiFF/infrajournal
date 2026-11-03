import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig, scanFromConfig } from "../packages/core/dist/index.js";

const args = process.argv.slice(2);
const countIndex = args.indexOf("--services");
const services = countIndex < 0 ? 100 : Number(args[countIndex + 1]);
if (!Number.isInteger(services) || services < 1 || services > 500) {
  console.error("--services must be an integer from 1 to 500.");
  process.exitCode = 2;
} else {
  const preferred = "/tmp/opencode";
  const temporaryRoot = await fs.access(preferred).then(
    () => preferred,
    () => os.tmpdir(),
  );
  const directory = await fs.mkdtemp(path.join(temporaryRoot, "infrajournal-benchmark-"));
  try {
    const entries = Array.from(
      { length: services },
      (_, index) =>
        `  service-${index + 1}:\n    image: nginx:1.27-alpine\n    networks:\n      - backend\n`,
    );
    await fs.writeFile(
      path.join(directory, "compose.yml"),
      `name: benchmark\nservices:\n${entries.join("")}networks:\n  backend: {}\n`,
    );
    const config = await loadConfig({ cwd: directory });
    const started = performance.now();
    const snapshot = await scanFromConfig(config);
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    const result = {
      services: snapshot.services.length,
      files: snapshot.files.length,
      dependencies: snapshot.dependencies.length,
      durationMs,
      rssBytes: process.memoryUsage().rss,
      node: process.version,
      platform: process.platform,
      cpu: os.cpus()[0]?.model ?? "unknown",
    };
    if (args.includes("--json")) console.log(JSON.stringify(result));
    else
      console.log(
        `Scan of ${result.services} services: ${durationMs} ms; RSS ${Math.round(result.rssBytes / 1024 / 1024)} MiB (${result.node}, ${result.platform}, ${result.cpu}).`,
      );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
