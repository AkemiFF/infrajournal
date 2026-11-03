import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, scanProject, serializeSnapshot } from "../src/index.js";
import { discoverFiles } from "../src/discovery/discover.js";

const temporary: string[] = [];
async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ij-core-"));
  temporary.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function options(root: string) {
  return {
    root,
    projectName: "demo",
    include: ["**/compose.yml", "**/Caddyfile", "**/*.conf"],
    exclude: [],
    maxFileSizeBytes: 1024,
    maxDepth: 8,
    maxFiles: 100,
    decisionsDirectory: path.join(root, "infra-decisions"),
    backups: [],
    now: new Date("2026-11-03T00:00:00.000Z"),
  };
}
const warningCodes = (snapshot: { warnings: Array<{ code: string }> }) =>
  snapshot.warnings.map((warning) => warning.code);

describe("untrusted scan input", () => {
  it("retains only explicitly allowlisted backup-policy values, which must not contain secrets", async () => {
    const root = await sandbox();
    await fs.writeFile(
      path.join(root, "compose.yml"),
      `services:\n  db:\n    image: postgres:16\n    volumes: [data:/var/lib/postgresql/data]\nvolumes:\n  data:\n    labels:\n      infrajournal.backup: nightly-offsite\n      private.owner: hidden-value-423\n`,
    );
    const snapshot = await scanProject(options(root));
    expect(snapshot.volumes[0]?.backup?.policy).toBe("nightly-offsite");
    expect(serializeSnapshot(snapshot)).not.toContain("hidden-value-423");
  });

  it("never serializes env values, env_file contents, private labels, secret file contents or literal passwords", async () => {
    const root = await sandbox();
    await fs.writeFile(
      path.join(root, "compose.yml"),
      `services:
  api:
    image: example:1
    environment: {PASSWORD: "super-secret-value-728", TOKEN: "another-secret-value-312"}
    env_file: [.env.local]
    labels: {owner: "private-label-value-842"}
    secrets: [credentials]
secrets: {credentials: {file: ./private.txt}}
`,
    );
    await fs.writeFile(path.join(root, ".env.local"), "PASSWORD=env-file-secret-411\n");
    await fs.writeFile(path.join(root, "private.txt"), "secret-file-value-397");
    await fs.writeFile(path.join(root, "Caddyfile"), `example.test { reverse_proxy api:80 }\n`);
    const snapshot = await scanProject(options(root));
    const serialized = serializeSnapshot(snapshot);
    for (const secret of [
      "super-secret-value-728",
      "another-secret-value-312",
      "env-file-secret-411",
      "private-label-value-842",
      "secret-file-value-397",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(snapshot.services[0]?.environmentKeys).toEqual(["PASSWORD", "TOKEN"]);
    expect(snapshot.services[0]?.envFiles).toEqual([".env.local"]);
  });

  it("does not serialize proxy URL credentials", async () => {
    const root = await sandbox();
    await fs.writeFile(
      path.join(root, "nginx.conf"),
      `server { server_name example.test; location / { proxy_pass http://alice:literal-password-719@api:80; } }`,
    );
    await fs.writeFile(
      path.join(root, "Caddyfile"),
      `another.test {\n reverse_proxy http://alice:another-password-271@api:80\n}\n`,
    );
    const serialized = serializeSnapshot(await scanProject(options(root)));
    expect(serialized).not.toContain("literal-password-719");
    expect(serialized).not.toContain("another-password-271");
    expect(serialized).not.toContain("alice:");
  });

  it("never echoes unsupported proxy targets with embedded credentials in diagnostics", async () => {
    const root = await sandbox();
    await fs.writeFile(
      path.join(root, "nginx.conf"),
      "server { server_name example.test; proxy_pass alice:ftp-password-819@api:80; }",
    );
    expect(serializeSnapshot(await scanProject(options(root)))).not.toContain("ftp-password-819");
  });

  it("rejects traversal glob patterns and decisions directory traversal", async () => {
    const root = await sandbox();
    await fs.writeFile(
      path.join(root, "infrajournal.yml"),
      "scan:\n  include: ['../**/compose.yml']\n",
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("Invalid glob pattern");
    await fs.writeFile(path.join(root, "infrajournal.yml"), "decisions:\n  directory: ../other\n");
    await expect(loadConfig({ cwd: root })).rejects.toThrow("decisions directory must be inside");
  });

  it("skips escaping symlinks, oversized files and binary files", async () => {
    const root = await sandbox();
    const outside = await sandbox();
    await fs.writeFile(path.join(outside, "compose.yml"), "services: {stolen: {image: private}}\n");
    await fs.symlink(path.join(outside, "compose.yml"), path.join(root, "compose.yml"));
    await fs.writeFile(path.join(root, "Caddyfile"), "x".repeat(1025));
    await fs.writeFile(path.join(root, "nginx.conf"), Buffer.from([0, 1, 2, 3]));
    const snapshot = await scanProject(options(root));
    expect(snapshot.files).toEqual([]);
    expect(warningCodes(snapshot)).toEqual(expect.arrayContaining(["IJ020", "IJ021", "IJ037"]));
  });

  it("limits traversal depth and files, and returns files in stable sorted order", async () => {
    const root = await sandbox();
    for (const directory of ["a", "b", "b/deep"])
      await fs.mkdir(path.join(root, directory), { recursive: true });
    for (const file of ["a/compose.yml", "b/compose.yml", "b/deep/compose.yml"]) {
      await fs.writeFile(path.join(root, file), "services: {api: {image: api}}\n");
    }
    const limited = await discoverFiles({ ...options(root), maxDepth: 1, maxFiles: 1 });
    expect(limited.files).toHaveLength(1);
    expect(limited.warnings.map((warning) => warning.code)).toContain("IJ023");
    const depthLimited = await discoverFiles({ ...options(root), maxDepth: 1 });
    expect(depthLimited.warnings.map((warning) => warning.code)).toContain("IJ022");
    const all = await discoverFiles(options(root));
    expect(all.files.map((file) => file.relativePath)).toEqual([
      "a/compose.yml",
      "b/compose.yml",
      "b/deep/compose.yml",
    ]);
  });

  it("does not follow a decisions directory symlink outside the root", async () => {
    const root = await sandbox();
    const outside = await sandbox();
    await fs.writeFile(path.join(outside, "secret.yml"), "id: leaked\n");
    await fs.symlink(outside, path.join(root, "infra-decisions"));
    const snapshot = await scanProject(options(root));
    expect(snapshot.decisions).toEqual([]);
    expect(snapshot.files).toEqual([]);
    expect(warningCodes(snapshot)).toContain("IJ017");
  });
});
