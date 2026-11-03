import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("publishable CLI package", () => {
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
    expect(
      [...files].filter((file) => file.startsWith("web-dist/assets/") && file.endsWith(".js")),
    ).toHaveLength(1);
  });
});
