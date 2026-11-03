import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  loadConfig,
  parseSnapshot,
  scanFromConfig,
  serializeSnapshot,
} from "../src/index.js";

const root = path.resolve(process.cwd(), "../../examples");

describe("scan pipeline", () => {
  it("scans the multi-service example without exposing values", async () => {
    const config = await loadConfig({ cwd: path.join(root, "multi-service") });
    const snapshot = await scanFromConfig(config, { now: new Date("2026-11-03T00:00:00.000Z") });
    const serialized = serializeSnapshot(snapshot);

    expect(snapshot.services).toHaveLength(5);
    expect(snapshot.domains).toHaveLength(2);
    expect(snapshot.stats.dependencies).toBeGreaterThan(0);
    expect(serialized).not.toContain("POSTGRES_PASSWORD=");
    expect(serialized).not.toContain("journal:${POSTGRES_PASSWORD}");
    expect(parseSnapshot(serialized).metadata.contentHash).toBe(snapshot.metadata.contentHash);
  });

  it("scans Caddy and simple Compose examples", async () => {
    const reverseProxy = await scanFromConfig(
      await loadConfig({ cwd: path.join(root, "reverse-proxy") }),
    );
    const simple = await scanFromConfig(await loadConfig({ cwd: path.join(root, "simple-stack") }));
    expect(reverseProxy.domains.some((domain) => domain.proxy === "caddy")).toBe(true);
    expect(simple.services.length).toBeGreaterThan(0);
  });

  it("rejects malformed snapshots", () => {
    expect(() => parseSnapshot("{}")).toThrow("Snapshot does not match the InfraJournal schema");
  });
});

describe("determinism", () => {
  it("does not include generated time in the content hash", () => {
    const content = {
      schemaVersion: "1.0.0" as const,
      project: { id: "project:test", name: "test", composeProjects: [] },
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
      stats: {
        services: 0,
        networks: 0,
        volumes: 0,
        domains: 0,
        endpoints: 0,
        dependencies: 0,
        files: 0,
        warnings: { info: 0, warning: 0, error: 0 },
      },
    };
    const first = buildSnapshot(content, {
      generator: "InfraJournal",
      generatorVersion: "0.1.0",
      generatedAt: "2026-11-03T00:00:00.000Z",
    });
    const second = buildSnapshot(content, {
      generator: "InfraJournal",
      generatorVersion: "0.1.0",
      generatedAt: "2026-11-04T00:00:00.000Z",
    });
    expect(first.metadata.contentHash).toBe(second.metadata.contentHash);
  });
});
