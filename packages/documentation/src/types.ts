import type { Snapshot } from "@infrajournal/core";

export interface GenerateDocumentationOptions {
  snapshot: Snapshot;
  /** Absolute or relative output directory. It is created when missing. */
  outputDirectory: string;
  /** Reserved for callers that want decisions to be re-read from disk. */
  decisionsDirectory?: string;
}

export interface GenerateDocumentationResult {
  /** File names written, relative to the output directory, POSIX separators. */
  written: string[];
  /**
   * File names left untouched because they did not contain the generated
   * marker. InfraJournal never overwrites hand-written documentation.
   */
  preserved: string[];
}

export type DriftCategory =
  | "project"
  | "service"
  | "network"
  | "volume"
  | "domain"
  | "endpoint"
  | "external"
  | "dependency"
  | "warning"
  | "decision"
  | "file";

export type DriftChangeType = "added" | "removed" | "changed";

export interface DriftFieldChange {
  field: string;
  before: string;
  after: string;
}

export interface DriftChange {
  category: DriftCategory;
  /** Snapshot ID, or a stable synthetic key for files and project fields. */
  id: string;
  /** Human readable label used by the text formatter. */
  name: string;
  type: DriftChangeType;
  fields: DriftFieldChange[];
}

export interface DriftSide {
  schemaVersion: string;
  generatedAt: string;
  contentHash: string;
}

export type DriftCounts = Record<DriftCategory, number>;

export interface DriftSummary {
  added: number;
  removed: number;
  changed: number;
  total: number;
  byCategory: DriftCounts;
}

export interface DriftReport {
  identical: boolean;
  baseline: DriftSide;
  current: DriftSide;
  summary: DriftSummary;
  changes: DriftChange[];
}

export class DriftError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "DriftError";
  }
}
