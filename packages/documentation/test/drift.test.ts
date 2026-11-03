import { describe, expect, it } from "vitest";
import { DriftError, compareSnapshots, formatDriftReport } from "../src/index.js";
import type { Snapshot } from "@infrajournal/core";
import {
  decision,
  dependency,
  domain,
  makeSnapshot,
  network,
  service,
  volume,
  warning,
} from "./fixtures.js";

describe("compareSnapshots", () => {
  it("reports no drift when content is identical, even with a new timestamp", () => {
    const baseline = makeSnapshot({}, "2026-11-01T00:00:00.000Z");
    const current = makeSnapshot({}, "2026-11-03T12:00:00.000Z");

    const report = compareSnapshots(baseline, current);

    expect(report.identical).toBe(true);
    expect(report.changes).toEqual([]);
    expect(report.summary.total).toBe(0);
    expect(report.baseline.generatedAt).not.toBe(report.current.generatedAt);
  });

  it("ignores source line moves but keeps semantic changes", () => {
    const baseline = makeSnapshot();
    const current = makeSnapshot({
      services: [service({ source: { file: "compose.yml", line: 300 } })],
    });

    expect(compareSnapshots(baseline, current).identical).toBe(true);

    const changed = makeSnapshot({ services: [service({ image: "nginx:1.29-alpine" })] });
    const report = compareSnapshots(baseline, changed);
    expect(report.identical).toBe(false);
    expect(report.summary.changed).toBe(1);
    expect(report.changes[0]).toMatchObject({
      category: "service",
      id: "service:demo:web",
      type: "changed",
    });
    expect(report.changes[0]?.fields).toEqual([
      {
        field: "image",
        before: "nginx:1.27-alpine",
        after: "nginx:1.29-alpine",
      },
    ]);
  });

  it("detects added and removed resources across categories", () => {
    const baseline = makeSnapshot();
    const current = makeSnapshot({
      services: [
        service(),
        service({
          id: "service:demo:worker",
          name: "worker",
          image: "worker:1.0",
          ports: [],
          networkIds: [],
          mounts: [],
          environmentKeys: [],
          envFiles: [],
          labelKeys: [],
          healthcheck: false,
          source: { file: "compose.yml", line: 50 },
        }),
      ],
      networks: [network(), network({ id: "network:demo:internal", name: "internal" })],
      volumes: [],
      domains: [],
      endpoints: [],
      dependencies: [],
      warnings: [],
      decisions: [],
      files: [],
    });

    const report = compareSnapshots(baseline, current);

    expect(report.summary.added).toBe(2);
    expect(report.summary.removed).toBe(8);
    expect(report.summary.byCategory.service).toBe(1);
    expect(report.summary.byCategory.network).toBe(1);
    expect(report.summary.byCategory.volume).toBe(1);
    expect(report.summary.byCategory.domain).toBe(1);
    expect(report.summary.byCategory.endpoint).toBe(1);
    expect(report.changes).toContainEqual(
      expect.objectContaining({ category: "service", name: "worker", type: "added" }),
    );
    expect(report.changes).toContainEqual(
      expect.objectContaining({ category: "volume", name: "uploads", type: "removed" }),
    );
  });

  it("detects dependency evidence, warnings, decisions and files", () => {
    const baseline = makeSnapshot({
      dependencies: [dependency({ evidence: { kind: "inferred" } })],
    });
    const current = makeSnapshot({
      dependencies: [dependency({ evidence: { kind: "explicit" } })],
      warnings: [warning({ message: "Changed warning message." })],
      decisions: [decision({ status: "superseded" })],
      files: [{ path: "compose.yml", kind: "compose", bytes: 500 }],
    });

    const report = compareSnapshots(baseline, current);
    const categories = report.changes.map((change) => change.category);

    expect(categories).toContain("dependency");
    expect(categories).toContain("warning");
    expect(categories).toContain("decision");
    expect(categories).toContain("file");

    const dependencyChange = report.changes.find((change) => change.category === "dependency");
    expect(dependencyChange?.fields[0]?.field).toBe("evidence");
    expect(dependencyChange?.fields[0]?.before).toContain("inferred");
    expect(dependencyChange?.fields[0]?.after).toContain("explicit");

    const decisionChange = report.changes.find((change) => change.category === "decision");
    expect(decisionChange?.fields).toEqual([
      { field: "status", before: "accepted", after: "superseded" },
    ]);
  });

  it("detects project, domain and volume changes", () => {
    const baseline = makeSnapshot();
    const current = makeSnapshot({
      project: { id: "project:demo", name: "renamed", composeProjects: ["demo"] },
      domains: [domain({ tls: false })],
      volumes: [volume({ backup: undefined })],
    });

    const report = compareSnapshots(baseline, current);
    expect(report.summary.byCategory.project).toBe(1);
    expect(report.summary.byCategory.domain).toBe(1);
    expect(report.summary.byCategory.volume).toBe(1);
  });

  it("rejects snapshots with different schema versions", () => {
    const baseline = makeSnapshot();
    const current = { ...makeSnapshot(), schemaVersion: "2.0.0" } as unknown as Snapshot;

    expect(() => compareSnapshots(baseline, current)).toThrow(DriftError);
  });
});

describe("formatDriftReport", () => {
  it("formats a no-drift report", () => {
    const report = compareSnapshots(makeSnapshot(), makeSnapshot());
    const output = formatDriftReport(report);

    expect(output).toContain("InfraJournal drift report");
    expect(output).toContain("Result: no drift detected.");
  });

  it("formats grouped changes and field transitions", () => {
    const baseline = makeSnapshot();
    const current = makeSnapshot({
      services: [service({ image: "nginx:1.29-alpine" })],
      networks: [],
      volumes: [],
      domains: [],
      endpoints: [],
      dependencies: [],
      warnings: [],
      decisions: [],
      files: [],
    });

    const output = formatDriftReport(compareSnapshots(baseline, current));
    expect(output).toContain("Result: drift detected");
    expect(output).toContain("Services (1)");
    expect(output).toContain("~ web [service:demo:web]");
    expect(output).toContain("image: nginx:1.27-alpine -> nginx:1.29-alpine");
    expect(output).toContain("Networks (1)");
  });
});
