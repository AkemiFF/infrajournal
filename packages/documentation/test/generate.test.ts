import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GENERATED_MARKER, generateDocumentation } from "../src/index.js";
import { makeSnapshot, service } from "./fixtures.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "infrajournal-docs-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("generateDocumentation", () => {
  it("writes the complete documentation set with a generated marker", async () => {
    const directory = await temporaryDirectory();
    const snapshot = makeSnapshot();

    const result = await generateDocumentation({ snapshot, outputDirectory: directory });

    expect(result.written).toEqual([
      "README.md",
      "architecture.md",
      "services.md",
      "networks.md",
      "storage.md",
      "domains.md",
      "warnings.md",
      "decisions.md",
    ]);
    expect(result.preserved).toEqual([]);

    for (const file of result.written) {
      const content = await fs.readFile(path.join(directory, file), "utf8");
      expect(content.startsWith(GENERATED_MARKER)).toBe(true);
      if (process.platform !== "win32") {
        expect((await fs.stat(path.join(directory, file))).mode & 0o077).toBe(0);
      }
    }

    const readme = await fs.readFile(path.join(directory, "README.md"), "utf8");
    expect(readme).toContain("Docker Compose projects: `demo`");
    expect(readme).toContain("`compose.yml`");

    const services = await fs.readFile(path.join(directory, "services.md"), "utf8");
    expect(services).toContain("## web");
    expect(services).toContain("`DATABASE_URL`, `SESSION_SECRET`");
    expect(services).toContain("`nginx:1.27-alpine`");

    const architecture = await fs.readFile(path.join(directory, "architecture.md"), "utf8");
    expect(architecture).toContain("```mermaid");
    expect(architecture).toContain("flowchart LR");
    expect(architecture).toContain("DEPENDS_ON");
    expect(architecture).toContain("| Evidence | Count |");

    const domains = await fs.readFile(path.join(directory, "domains.md"), "utf8");
    expect(domains).toContain("app.example.com");
    expect(domains).toContain("web:80");

    const decisions = await fs.readFile(path.join(directory, "decisions.md"), "utf8");
    expect(decisions).toContain("Use PostgreSQL");
    expect(decisions).toContain("accepted");
  });

  it("is deterministic for identical snapshots", async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();
    const snapshot = makeSnapshot();

    await generateDocumentation({ snapshot, outputDirectory: first });
    await generateDocumentation({ snapshot, outputDirectory: second });

    for (const file of [
      "README.md",
      "architecture.md",
      "services.md",
      "networks.md",
      "storage.md",
      "domains.md",
      "warnings.md",
      "decisions.md",
    ]) {
      const left = await fs.readFile(path.join(first, file), "utf8");
      const right = await fs.readFile(path.join(second, file), "utf8");
      expect(right).toBe(left);
    }
  });

  it("preserves hand-written files and overwrites generated files", async () => {
    const directory = await temporaryDirectory();
    await fs.writeFile(path.join(directory, "README.md"), "# Our own docs\n", "utf8");
    await fs.writeFile(
      path.join(directory, "services.md"),
      `${GENERATED_MARKER}\n\n# Old generated content\n`,
      "utf8",
    );

    const result = await generateDocumentation({
      snapshot: makeSnapshot(),
      outputDirectory: directory,
    });

    expect(result.preserved).toContain("README.md");
    expect(result.written).toContain("services.md");
    expect(await fs.readFile(path.join(directory, "README.md"), "utf8")).toBe("# Our own docs\n");
    expect(await fs.readFile(path.join(directory, "services.md"), "utf8")).toContain("## web");
  });

  it("escapes untrusted service and domain names from HTML and Markdown", async () => {
    const directory = await temporaryDirectory();
    const snapshot = makeSnapshot({
      services: [
        service({
          id: "service:demo:xss",
          name: '"><script>alert("x")</script>|[*evil*]',
        }),
      ],
      domains: [],
      endpoints: [],
      dependencies: [],
      warnings: [],
      decisions: [],
    });

    await generateDocumentation({ snapshot, outputDirectory: directory });

    const services = await fs.readFile(path.join(directory, "services.md"), "utf8");
    expect(services).not.toContain("<script>");
    expect(services).toContain("&lt;script&gt;");
  });

  it("renders empty states without failing", async () => {
    const directory = await temporaryDirectory();
    const snapshot = makeSnapshot({
      services: [],
      networks: [],
      volumes: [],
      domains: [],
      endpoints: [],
      external: [],
      dependencies: [],
      graphNodes: [],
      warnings: [],
      decisions: [],
      files: [],
    });

    const result = await generateDocumentation({ snapshot, outputDirectory: directory });
    expect(result.written).toHaveLength(8);

    const readme = await fs.readFile(path.join(directory, "README.md"), "utf8");
    expect(readme).toContain("No warnings were produced for this snapshot.");
    expect(readme).toContain("No supported configuration files were found.");
    expect(await fs.readFile(path.join(directory, "services.md"), "utf8")).toContain(
      "No services were discovered.",
    );
  });
});
