import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("release scripts", () => {
  it("benchmarks a generated fixture and reports actual measurements", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/benchmark.mjs", "--services", "4", "--json"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    const result = JSON.parse(output) as Record<string, unknown>;
    expect(result.services).toBe(4);
    expect(result.durationMs).toEqual(expect.any(Number));
    expect(result.rssBytes).toEqual(expect.any(Number));
    expect(result.node).toMatch(/^v\d+/);
  });

  it("runs scan, generate and check without modifying the example", () => {
    const output = execFileSync(process.execPath, ["scripts/demo.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(output).toContain("Result: no drift detected.");
  });
});
