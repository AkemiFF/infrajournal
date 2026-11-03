import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSnapshot } from "@infrajournal/core";
import { run } from "../src/index.js";

let directory: string;
let originalCwd: string;
let stdout: typeof process.stdout.write;
let stderr: typeof process.stderr.write;
let previousExitCode: typeof process.exitCode;
let out = "";
let err = "";

async function invoke(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  out = "";
  err = "";
  const code = await run(["node", "infrajournal", ...args]);
  return { code, out, err };
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "infrajournal-cli-"));
  originalCwd = process.cwd();
  previousExitCode = process.exitCode;
  process.chdir(directory);
  stdout = process.stdout.write;
  stderr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  await fs.writeFile(
    path.join(directory, "compose.yml"),
    "services:\n  web:\n    image: nginx:1.27\n    ports:\n      - '8080:80'\n",
  );
});

afterEach(async () => {
  process.stdout.write = stdout;
  process.stderr.write = stderr;
  process.exitCode = previousExitCode;
  process.chdir(originalCwd);
  await fs.rm(directory, { recursive: true, force: true });
});

describe("CLI commands", () => {
  it("prints version and help", async () => {
    expect(await invoke("--version")).toMatchObject({
      code: 0,
      out: expect.stringContaining("0.1.1"),
    });
    expect(await invoke("--help")).toMatchObject({
      code: 0,
      out: expect.stringContaining("generate"),
    });
  });

  it("reports unknown commands as usage errors", async () => {
    const result = await invoke("not-a-command");
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown command");
  });

  it("rejects invalid formats and missing roots with usage code 2", async () => {
    expect(await invoke("scan", "--format", "xml")).toMatchObject({
      code: 2,
      err: expect.stringContaining("--format"),
    });
    expect(await invoke("scan", "--root", "missing")).toMatchObject({
      code: 2,
      err: expect.stringContaining("Scan root"),
    });
  });

  it("does not print sensitive values from malformed configuration", async () => {
    await fs.writeFile(
      "infrajournal.yml",
      "project:\n  name: safe\npassword: secret-needle-123\nunknown: [\n",
    );
    const result = await invoke("scan");
    expect(result.code).toBe(2);
    expect(result.err).not.toContain("secret-needle-123");
  });

  it("exports valid JSON without banners and writes snapshots only on request", async () => {
    const scanned = await invoke("scan", "--format", "json");
    expect(scanned.code).toBe(0);
    expect(scanned.err).toBe("");
    expect(parseSnapshot(scanned.out).services[0]?.name).toBe("web");
    await expect(fs.stat(path.join(directory, "infra-docs"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const written = await invoke("scan", "--format", "json", "--output", "baseline.json");
    expect(written.code).toBe(0);
    expect(parseSnapshot(await fs.readFile("baseline.json", "utf8")).services).toHaveLength(1);
    if (process.platform !== "win32") {
      expect((await fs.stat("baseline.json")).mode & 0o077).toBe(0);
    }
  });

  it("loads the configuration inside --root when no --config is given", async () => {
    const nested = path.join(directory, "nested-project");
    await fs.mkdir(nested);
    await fs.writeFile(
      path.join(nested, "compose.yml"),
      "services:\n  web:\n    image: nginx:1.27\n",
    );
    await fs.writeFile(
      path.join(nested, "infrajournal.yml"),
      "version: 1\nproject:\n  name: configured-name\n",
    );
    const result = await invoke("scan", "--root", nested, "--format", "json");
    expect(result.code).toBe(0);
    expect(parseSnapshot(result.out).project.name).toBe("configured-name");
  });

  it("does not overwrite configuration without --force", async () => {
    expect((await invoke("init")).code).toBe(0);
    const first = await fs.readFile("infrajournal.yml", "utf8");
    expect((await invoke("init")).code).toBe(2);
    expect(await fs.readFile("infrajournal.yml", "utf8")).toBe(first);
    expect((await invoke("init", "--force")).code).toBe(0);
  });

  it("checks missing, unchanged and changed baselines with stable exit codes", async () => {
    expect((await invoke("check")).code).toBe(4);
    expect((await invoke("generate")).code).toBe(0);
    const baseline = await fs.readFile("infra-docs/snapshot.json", "utf8");
    expect((await invoke("check")).code).toBe(0);
    await fs.writeFile(
      "compose.yml",
      "services:\n  web:\n    image: nginx:1.29\n    ports:\n      - '8080:80'\n",
    );
    const changed = await invoke("check", "--format", "json");
    expect(changed.code).toBe(3);
    expect(JSON.parse(changed.out).changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "service", type: "changed" })]),
    );
    expect(await fs.readFile("infra-docs/snapshot.json", "utf8")).toBe(baseline);
    expect((await invoke("scan")).code).toBe(0);
  });

  it("never overwrites scanned input files or hard-link aliases", async () => {
    const original = await fs.readFile("compose.yml", "utf8");
    expect((await invoke("scan", "--output", "compose.yml")).code).toBe(2);
    expect(await fs.readFile("compose.yml", "utf8")).toBe(original);
    await fs.link("compose.yml", "alias.json");
    expect((await invoke("scan", "--output", "alias.json")).code).toBe(2);
    expect(await fs.readFile("compose.yml", "utf8")).toBe(original);
    if (process.platform !== "win32") {
      await fs.symlink("compose.yml", "symlink.json");
      expect((await invoke("scan", "--output", "symlink.json")).code).toBe(2);
      expect(await fs.readFile("compose.yml", "utf8")).toBe(original);
    }
  });

  it("preserves unrelated output files and arbitrary snapshot.json on generate", async () => {
    await fs.writeFile("notes.json", "private notes");
    expect((await invoke("scan", "--output", "notes.json")).code).toBe(2);
    expect(await fs.readFile("notes.json", "utf8")).toBe("private notes");
    await fs.mkdir("infra-docs");
    await fs.writeFile("infra-docs/snapshot.json", "private notes");
    expect((await invoke("generate")).code).toBe(2);
    expect(await fs.readFile("infra-docs/snapshot.json", "utf8")).toBe("private notes");
  });
});
