import type { Snapshot } from "@infrajournal/core";
import {
  DriftError,
  type DriftCategory,
  type DriftChange,
  type DriftChangeType,
  type DriftCounts,
  type DriftFieldChange,
  type DriftReport,
} from "../types.js";

const CATEGORY_ORDER: DriftCategory[] = [
  "project",
  "service",
  "network",
  "volume",
  "domain",
  "endpoint",
  "external",
  "dependency",
  "warning",
  "decision",
  "file",
];

const CATEGORY_TITLES: Record<DriftCategory, string> = {
  project: "Project",
  service: "Services",
  network: "Networks",
  volume: "Volumes",
  domain: "Domains",
  endpoint: "Endpoints",
  external: "External dependencies",
  dependency: "Dependencies",
  warning: "Warnings",
  decision: "Decisions",
  file: "Scanned files",
};

function emptyCounts(): DriftCounts {
  return {
    project: 0,
    service: 0,
    network: 0,
    volume: 0,
    domain: 0,
    endpoint: 0,
    external: 0,
    dependency: 0,
    warning: 0,
    decision: 0,
    file: 0,
  };
}

/**
 * Remove source locations and other non-semantic noise before comparing. A
 * comment inserted above a service should not look like an infrastructure
 * change, and evidence wording is not part of the documented topology.
 */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value === null || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "source" || key === "sourceLocation") continue;
    if (key === "evidence" && item !== null && typeof item === "object") {
      const kind = (item as { kind?: unknown }).kind;
      result.evidence = { kind };
      continue;
    }
    result[key] = comparable(item);
  }
  return result;
}

function display(value: unknown): string {
  let rendered: string;
  if (value === undefined) {
    rendered = "(none)";
  } else if (typeof value === "string") {
    rendered = value;
  } else if (Array.isArray(value)) {
    rendered = value.length === 0 ? "(none)" : value.map(display).join(", ");
  } else if (value !== null && typeof value === "object") {
    rendered = JSON.stringify(value);
  } else {
    rendered = String(value);
  }
  return rendered.length > 240 ? `${rendered.slice(0, 237)}...` : rendered;
}

function fieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DriftFieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const fields: DriftFieldChange[] = [];
  for (const key of keys) {
    const left = JSON.stringify(before[key]);
    const right = JSON.stringify(after[key]);
    if (left === right) continue;
    fields.push({ field: key, before: display(before[key]), after: display(after[key]) });
  }
  return fields;
}

interface CollectionItem {
  id: string;
}

interface DiffCollectionOptions<T extends CollectionItem> {
  category: DriftCategory;
  baseline: T[];
  current: T[];
  name: (item: T) => string;
}

function diffCollection<T extends CollectionItem>(
  options: DiffCollectionOptions<T>,
): DriftChange[] {
  const before = new Map(options.baseline.map((item) => [item.id, item]));
  const after = new Map(options.current.map((item) => [item.id, item]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: DriftChange[] = [];

  for (const id of ids) {
    const left = before.get(id);
    const right = after.get(id);
    if (left && !right) {
      changes.push({
        category: options.category,
        id,
        name: options.name(left),
        type: "removed",
        fields: [],
      });
      continue;
    }
    if (!left && right) {
      changes.push({
        category: options.category,
        id,
        name: options.name(right),
        type: "added",
        fields: [],
      });
      continue;
    }
    if (!left || !right) continue;

    const fields = fieldChanges(
      comparable(left) as Record<string, unknown>,
      comparable(right) as Record<string, unknown>,
    );
    if (fields.length > 0) {
      changes.push({
        category: options.category,
        id,
        name: options.name(right),
        type: "changed",
        fields,
      });
    }
  }

  return changes;
}

function side(snapshot: Snapshot): DriftReport["baseline"] {
  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.metadata.generatedAt,
    contentHash: snapshot.metadata.contentHash,
  };
}

export function compareSnapshots(baseline: Snapshot, current: Snapshot): DriftReport {
  if (baseline.schemaVersion !== current.schemaVersion) {
    throw new DriftError(
      "Snapshots use different schema versions and cannot be compared.",
      `baseline ${baseline.schemaVersion}, current ${current.schemaVersion}. Regenerate the baseline with this InfraJournal version.`,
    );
  }

  const labels = new Map<string, string>();
  for (const node of [...baseline.graphNodes, ...current.graphNodes]) {
    labels.set(node.id, node.label);
  }

  const changes: DriftChange[] = [];
  if (
    JSON.stringify(comparable(baseline.project)) !== JSON.stringify(comparable(current.project))
  ) {
    const before = comparable(baseline.project) as Record<string, unknown>;
    const after = comparable(current.project) as Record<string, unknown>;
    changes.push({
      category: "project",
      id: current.project.id,
      name: current.project.name,
      type: "changed",
      fields: fieldChanges(before, after),
    });
  }

  changes.push(
    ...diffCollection({
      category: "service",
      baseline: baseline.services,
      current: current.services,
      name: (item) => item.name,
    }),
    ...diffCollection({
      category: "network",
      baseline: baseline.networks,
      current: current.networks,
      name: (item) => item.name,
    }),
    ...diffCollection({
      category: "volume",
      baseline: baseline.volumes,
      current: current.volumes,
      name: (item) => item.name,
    }),
    ...diffCollection({
      category: "domain",
      baseline: baseline.domains,
      current: current.domains,
      name: (item) => item.name,
    }),
    ...diffCollection({
      category: "endpoint",
      baseline: baseline.endpoints,
      current: current.endpoints,
      name: (item) => item.name,
    }),
    ...diffCollection({
      category: "external",
      baseline: baseline.external,
      current: current.external,
      name: (item) => item.name,
    }),
    ...diffCollection({
      category: "dependency",
      baseline: baseline.dependencies,
      current: current.dependencies,
      name: (item) => {
        const from = labels.get(item.from) ?? item.from;
        const to = labels.get(item.to) ?? item.to;
        return `${from} ${item.type} ${to}`;
      },
    }),
    ...diffCollection({
      category: "warning",
      baseline: baseline.warnings,
      current: current.warnings,
      name: (item) => `${item.code} ${item.message}`,
    }),
    ...diffCollection({
      category: "decision",
      baseline: baseline.decisions,
      current: current.decisions,
      name: (item) => item.title,
    }),
    ...diffCollection({
      category: "file",
      baseline: baseline.files.map((file) => ({
        id: file.path,
        path: file.path,
        kind: file.kind,
      })),
      current: current.files.map((file) => ({
        id: file.path,
        path: file.path,
        kind: file.kind,
      })),
      name: (item) => item.path,
    }),
  );

  changes.sort((a, b) => {
    const category = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (category !== 0) return category;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.id.localeCompare(b.id);
  });

  const byCategory = emptyCounts();
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const change of changes) {
    byCategory[change.category] += 1;
    counts[change.type] += 1;
  }

  const identical =
    changes.length === 0 ||
    (baseline.metadata.contentHash === current.metadata.contentHash && changes.length === 0);

  return {
    identical,
    baseline: side(baseline),
    current: side(current),
    summary: {
      ...counts,
      total: changes.length,
      byCategory,
    },
    changes,
  };
}

const CHANGE_MARKER: Record<DriftChangeType, string> = {
  added: "+",
  removed: "-",
  changed: "~",
};

export interface FormatDriftReportOptions {
  /** Include the snapshot hashes in the header. Defaults to true. */
  hashes?: boolean;
}

export function formatDriftReport(
  report: DriftReport,
  options: FormatDriftReportOptions = {},
): string {
  const lines: string[] = ["InfraJournal drift report", ""];
  if (options.hashes !== false) {
    lines.push(
      `Baseline: ${report.baseline.contentHash.slice(0, 12)} (${report.baseline.generatedAt})`,
    );
    lines.push(
      `Current:  ${report.current.contentHash.slice(0, 12)} (${report.current.generatedAt})`,
    );
    lines.push("");
  }

  if (report.identical) {
    lines.push("Result: no drift detected.");
    return lines.join("\n");
  }

  lines.push(
    `Result: drift detected — ${report.summary.added} added, ${report.summary.removed} removed, ${report.summary.changed} changed.`,
  );

  for (const category of CATEGORY_ORDER) {
    const changes = report.changes.filter((change) => change.category === category);
    if (changes.length === 0) continue;
    lines.push("", `${CATEGORY_TITLES[category]} (${changes.length})`);
    for (const change of changes) {
      lines.push(`  ${CHANGE_MARKER[change.type]} ${change.name} [${change.id}]`);
      for (const field of change.fields) {
        lines.push(`      ${field.field}: ${field.before} -> ${field.after}`);
      }
    }
  }

  return lines.join("\n");
}
