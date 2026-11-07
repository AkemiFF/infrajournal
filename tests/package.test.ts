import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("publishable CLI package", () => {
  it("uses a new patch version because npm 0.1.0 is immutable", () => {
    const packageManifest = JSON.parse(readFileSync("packages/cli/package.json", "utf8")) as {
      version: string;
    };
    expect(packageManifest.version).toBe("0.1.3");
  });

  it("runs through an npm-style symlink instead of exiting silently", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "infrajournal-bin-"));
    try {
      const executable = path.join(directory, "infrajournal");
      await fs.symlink(path.resolve("packages/cli/dist/index.js"), executable);
      const help = execFileSync(executable, ["--help"], { encoding: "utf8", timeout: 10_000 });
      expect(help).toContain("Usage: infrajournal");
      const version = execFileSync(executable, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(version.trim()).toBe("0.1.3");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("ships executable, dashboard, README and MIT LICENSE", () => {
    const output = execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts", "./packages/cli"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    const [info] = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
    const files = new Set(info?.files.map((file) => file.path));
    expect(files).toContain("dist/index.js");
    expect(files).toContain("web-dist/index.html");
    expect(files).toContain("README.md");
    expect(files).toContain("LICENSE");
    expect(readFileSync("packages/cli/README.md", "utf8")).toContain(
      "https://raw.githubusercontent.com/AkemiFF/infrajournal/main/docs/assets/logo.svg",
    );
    expect(
      [...files].filter((file) => file.startsWith("web-dist/assets/") && file.endsWith(".js")),
    ).toHaveLength(1);
  });
});
