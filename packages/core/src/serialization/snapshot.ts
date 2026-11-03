import { createHash } from "node:crypto";
import type { ZodError } from "zod";
import {
  type Snapshot,
  type SnapshotContent,
  type SnapshotMetadata,
  snapshotSchema,
  SNAPSHOT_SCHEMA_VERSION,
  type Warning,
} from "../model/schema.js";
import { dedupeWarnings } from "../diagnostics/warnings.js";

export class SnapshotValidationError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortObjectKeys(item)]));
  }
  return value;
}

/** Stable JSON rendering with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value), null, 2) + "\n";
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

function sortWarnings(warnings: Warning[]): Warning[] {
  return dedupeWarnings(warnings);
}

/**
 * Normalize ordering so that logically equivalent snapshots serialize to the
 * same bytes. Timestamps are intentionally not considered here.
 */
export function canonicalizeSnapshotContent(content: SnapshotContent): SnapshotContent {
  const services = content.services
    .map((service) => ({
      ...service,
      networkIds: uniqueSorted(service.networkIds),
      dependsOn: uniqueSorted(service.dependsOn),
      environmentKeys: uniqueSorted(service.environmentKeys),
      envFiles: uniqueSorted(service.envFiles),
      labelKeys: uniqueSorted(service.labelKeys),
      ports: dedupeBy(
        service.ports.map((port) => ({ ...port })),
        (port) => `${port.hostIp ?? ""}:${port.published ?? ""}:${port.target}/${port.protocol}`,
      ).sort(
        (a, b) =>
          a.protocol.localeCompare(b.protocol) ||
          a.target.localeCompare(b.target, undefined, { numeric: true }) ||
          (a.published ?? "").localeCompare(b.published ?? "", undefined, { numeric: true }),
      ),
      mounts: service.mounts
        .map((mount) => ({ ...mount }))
        .sort(
          (a, b) =>
            a.target.localeCompare(b.target) || (a.source ?? "").localeCompare(b.source ?? ""),
        ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const domains = content.domains
    .map((domain) => ({
      ...domain,
      routes: domain.routes
        .map((route) => ({ ...route }))
        .sort(
          (a, b) =>
            (a.path ?? "").localeCompare(b.path ?? "") || a.upstream.localeCompare(b.upstream),
        ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const networks = content.networks
    .map((item) => ({ ...item }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const volumes = content.volumes
    .map((item) => ({ ...item }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const endpoints = content.endpoints
    .map((item) => ({ ...item }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const external = content.external
    .map((item) => ({ ...item }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const dependencies = dedupeBy(
    content.dependencies.map((item) => ({ ...item })),
    (item) => item.id,
  ).sort((a, b) => a.id.localeCompare(b.id));
  const graphNodes = dedupeBy(
    content.graphNodes.map((item) => ({ ...item })),
    (item) => item.id,
  ).sort((a, b) => a.id.localeCompare(b.id));
  const decisions = content.decisions
    .map((item) => ({
      ...item,
      relatedServices: uniqueSorted(item.relatedServices),
      unresolvedRelatedServices: uniqueSorted(item.unresolvedRelatedServices),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const warnings = sortWarnings(content.warnings);

  return {
    ...content,
    project: {
      ...content.project,
      composeProjects: uniqueSorted(content.project.composeProjects),
    },
    services,
    networks,
    volumes,
    domains,
    endpoints,
    external,
    dependencies,
    graphNodes,
    warnings,
    decisions,
    files: content.files.map((file) => ({ ...file })).sort((a, b) => a.path.localeCompare(b.path)),
    stats: {
      ...content.stats,
      services: services.length,
      networks: networks.length,
      volumes: volumes.length,
      domains: domains.length,
      endpoints: endpoints.length,
      dependencies: dependencies.length,
      files: content.files.length,
      warnings: {
        info: warnings.filter((warning) => warning.severity === "INFO").length,
        warning: warnings.filter((warning) => warning.severity === "WARNING").length,
        error: warnings.filter((warning) => warning.severity === "ERROR").length,
      },
    },
  };
}

export function computeContentHash(content: SnapshotContent): string {
  return createHash("sha256")
    .update(stableStringify(canonicalizeSnapshotContent(content)))
    .digest("hex");
}

export function buildSnapshot(
  content: SnapshotContent,
  metadata: Omit<SnapshotMetadata, "contentHash">,
): Snapshot {
  const canonical = canonicalizeSnapshotContent(content);
  const snapshot: Snapshot = {
    ...canonical,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    metadata: {
      ...metadata,
      contentHash: computeContentHash(canonical),
    },
  };
  return snapshotSchema.parse(snapshot);
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return stableStringify(canonicalizeSnapshotContent(snapshot));
}

export function parseSnapshot(text: string): Snapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SnapshotValidationError(
      "Snapshot is not valid JSON.",
      error instanceof Error ? error.message : undefined,
    );
  }
  const result = snapshotSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 8)
      .map((item) => `${item.path.join(".") || "(root)"}: ${item.message}`)
      .join("; ");
    throw new SnapshotValidationError("Snapshot does not match the InfraJournal schema.", detail);
  }
  return result.data;
}

export function zodErrorDetail(error: ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((item) => `${item.path.join(".") || "(root)"}: ${item.message}`)
    .join("; ");
}
