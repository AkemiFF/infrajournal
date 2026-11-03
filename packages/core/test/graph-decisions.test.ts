import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  scanProject,
  parseSnapshot,
  serializeSnapshot,
  buildSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
} from "../src/index.js";
import { mergeDependencies } from "../src/graph/build.js";
import { infrajournalConfigSchema } from "../src/config/schema.js";
import { snapshotSchema } from "../src/model/schema.js";

const roots: string[] = [];
async function fixture(compose: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ij-graph-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "compose.yml"), compose);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const scan = (root: string, now = new Date("2026-11-03T00:00:00.000Z")) =>
  scanProject({
    root,
    projectName: "demo",
    include: ["**/compose.yml", "**/Caddyfile"],
    exclude: [],
    maxFileSizeBytes: 4096,
    maxFiles: 100,
    maxDepth: 8,
    decisionsDirectory: path.join(root, "infra-decisions"),
    backups: [],
    now,
  });
const edges = (snapshot: Awaited<ReturnType<typeof scan>>, type: string) =>
  snapshot.dependencies.filter((dependency) => dependency.type === type);

describe("graph evidence and determinism", () => {
  it("keeps stable IDs and content hash across scans regardless of timestamps", async () => {
    const root = await fixture(
      "services: {api: {image: api, depends_on: [db]}, db: {image: postgres:16}}\n",
    );
    const first = await scan(root);
    const second = await scan(root, new Date("2026-11-04T00:00:00.000Z"));
    expect(first.metadata.contentHash).toBe(second.metadata.contentHash);
    expect(first.metadata.generatedAt).not.toBe(second.metadata.generatedAt);
    expect(first.graphNodes.map((node) => node.id)).toEqual(
      second.graphNodes.map((node) => node.id),
    );
    expect(first.dependencies.map((dependency) => dependency.id)).toEqual(
      second.dependencies.map((dependency) => dependency.id),
    );
    expect(serializeSnapshot(first)).toBe(serializeSnapshot(await scan(root)));
    expect(parseSnapshot(serializeSnapshot(first))).toEqual(first);
    expect(first.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
  });

  it("does not fabricate service or proxy edges without explicit or unique inference", async () => {
    const root = await fixture("services: {api: {image: api}, worker: {image: worker}}\n");
    const snapshot = await scan(root);
    expect(edges(snapshot, "DEPENDS_ON")).toEqual([]);
    expect(edges(snapshot, "ROUTES_TO")).toEqual([]);
    expect(snapshot.domains).toEqual([]);
    expect(edges(snapshot, "CONNECTED_TO")).toHaveLength(2); // Compose's implicit default network
    expect(
      snapshot.dependencies.every(
        (edge) =>
          snapshot.graphNodes.some((node) => node.id === edge.from) &&
          snapshot.graphNodes.some((node) => node.id === edge.to),
      ),
    ).toBe(true);
  });

  it("infers only for recognized key names with exactly one candidate, never from values", async () => {
    const root = await fixture(`services:
  api:
    image: api
    environment: {DATABASE_URL: 'postgres://not-the-target:secret@nowhere', RANDOM_URL: 'redis://redis:6379'}
  db: {image: postgres:16}
  redis: {image: redis:7}
`);
    const snapshot = await scan(root);
    const inferred = edges(snapshot, "DEPENDS_ON");
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toMatchObject({
      from: snapshot.services.find((service) => service.name === "api")?.id,
      to: snapshot.services.find((service) => service.name === "db")?.id,
      evidence: { kind: "inferred" },
    });
    expect(serializeSnapshot(snapshot)).not.toContain("not-the-target:secret");
  });

  it("does not infer ambiguous targets or duplicate an explicit dependency", async () => {
    const root = await fixture(`services:
  api: {image: api, environment: [DATABASE_URL=do-not-read, REDIS_URL=do-not-read], depends_on: [postgres]}
  postgres: {image: postgres:16}
  postgres_replica: {image: postgres:16}
  redis_one: {image: redis:7}
  redis_two: {image: redis:7}
`);
    const snapshot = await scan(root);
    const apiId = snapshot.services.find((service) => service.name === "api")!.id;
    expect(edges(snapshot, "DEPENDS_ON").filter((edge) => edge.from === apiId)).toEqual([
      expect.objectContaining({ evidence: expect.objectContaining({ kind: "explicit" }) }),
    ]);
  });

  it("deduplicates identical edges and prefers explicit evidence", () => {
    const base = {
      id: "edge:sample",
      type: "DEPENDS_ON" as const,
      from: "service:a",
      to: "service:b",
    };
    expect(
      mergeDependencies([
        { ...base, evidence: { kind: "inferred" } },
        { ...base, evidence: { kind: "explicit" } },
        { ...base, evidence: { kind: "inferred" } },
      ]),
    ).toEqual([{ ...base, evidence: { kind: "explicit" } }]);
  });

  it("warns when two services publish the same host port", async () => {
    const root = await fixture(
      "services: {api: {image: api, ports: ['8080:80']}, web: {image: web, ports: ['8080:80']}}\n",
    );
    expect((await scan(root)).warnings.map((warning) => warning.code)).toContain("IJ007");
  });

  it("reports warning stats after warning deduplication", () => {
    const warning = {
      id: "warning:duplicate",
      code: "IJ001",
      severity: "ERROR" as const,
      message: "invalid file",
      related: [],
    };
    const snapshot = buildSnapshot(
      {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        project: { id: "project:demo", name: "demo", composeProjects: [] },
        services: [],
        networks: [],
        volumes: [],
        domains: [],
        endpoints: [],
        external: [],
        dependencies: [],
        graphNodes: [],
        warnings: [warning, warning],
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
          warnings: { info: 0, warning: 0, error: 2 },
        },
      },
      {
        generator: "InfraJournal",
        generatorVersion: "0.1.0",
        generatedAt: "2026-11-03T00:00:00.000Z",
      },
    );
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.stats.warnings.error).toBe(1);
  });
});

describe("decision loading", () => {
  const decision = (id: string, related: string[]) =>
    `id: ${id}\ntitle: A decision\nstatus: accepted\ndate: 2026-11-03\ncontext: why\ndecision: use it\nrelated_services: [${related.join(", ")}]\n`;

  it("loads valid records and resolves known services while warning about unknown ones", async () => {
    const root = await fixture("services: {api: {image: api}}\n");
    await fs.mkdir(path.join(root, "infra-decisions"));
    await fs.writeFile(
      path.join(root, "infra-decisions", "a.yml"),
      decision("adr-001", ["api", "unknown", "api"]),
    );
    const snapshot = await scan(root);
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.decisions[0]?.relatedServices).toEqual([snapshot.services[0]?.id]);
    expect(snapshot.decisions[0]?.unresolvedRelatedServices).toEqual(["unknown"]);
    expect(snapshot.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["IJ018", "IJ036"]),
    );
  });

  it("rejects invalid records and duplicate IDs without adding extra decisions", async () => {
    const root = await fixture("services: {api: {image: api}}\n");
    const directory = path.join(root, "infra-decisions");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "a.yml"), decision("adr-001", []));
    await fs.writeFile(path.join(directory, "b.yml"), decision("adr-001", []));
    await fs.writeFile(path.join(directory, "c.yml"), "id: invalid\nstatus: magical\n");
    const snapshot = await scan(root);
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["IJ017", "IJ019"]),
    );
  });
});

describe("generated JSON schemas", () => {
  it("exist and exactly match the current Zod schemas", async () => {
    const schemaDirectory = path.resolve(process.cwd(), "schema");
    const [snapshot, config] = await Promise.all(
      ["snapshot", "config"].map(async (name) =>
        JSON.parse(await fs.readFile(path.join(schemaDirectory, `${name}.schema.json`), "utf8")),
      ),
    );
    expect(snapshot).toEqual({
      $id: "https://infrajournal.dev/schema/snapshot-1.0.0.json",
      title: "InfraJournal Snapshot",
      description:
        "Versioned infrastructure snapshot produced by InfraJournal. Paths are relative to the scan root.",
      ...z.toJSONSchema(snapshotSchema, { target: "draft-2020-12", io: "output" }),
    });
    expect(config).toEqual({
      $id: "https://infrajournal.dev/schema/config-1.json",
      title: "InfraJournal Configuration",
      description: "Configuration schema for infrajournal.yml.",
      ...z.toJSONSchema(infrajournalConfigSchema, { target: "draft-2020-12", io: "input" }),
    });
    expect(snapshot.properties.schemaVersion.const).toBe(SNAPSHOT_SCHEMA_VERSION);
  });
});
