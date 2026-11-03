import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { DIAGNOSTICS, makeWarning } from "../diagnostics/warnings.js";
import { ids } from "../model/ids.js";
import type { DecisionFile, ScannedFile, Warning } from "../model/schema.js";
import { decisionFileSchema } from "../model/schema.js";
import { isPathInside, toPosixPath } from "../utils/paths.js";

export interface LoadedDecision {
  file: DecisionFile;
  source: { file: string; line?: number };
  relatedServiceNames: string[];
}

export interface DecisionLoadResult {
  decisions: LoadedDecision[];
  files: ScannedFile[];
  warnings: Warning[];
}

export interface LoadDecisionsOptions {
  root: string;
  directory: string;
  maxFileSizeBytes: number;
  maxDepth?: number;
  maxFiles?: number;
}

export async function loadDecisions(options: LoadDecisionsOptions): Promise<DecisionLoadResult> {
  const warnings: Warning[] = [];
  const files: ScannedFile[] = [];
  const decisions: LoadedDecision[] = [];
  const seenIds = new Set<string>();
  const seenRealDirectories = new Set<string>();
  let directoryStat;
  try {
    directoryStat = await fs.stat(options.directory);
  } catch {
    return { decisions, files, warnings };
  }
  if (!directoryStat.isDirectory()) {
    warnings.push(
      makeWarning({
        definition: DIAGNOSTICS.DECISION_INVALID,
        message: "The configured decisions path is not a directory.",
        source: { file: toPosixPath(path.relative(options.root, options.directory)) || "." },
        suggestion: "Create the directory or update decisions.directory in infrajournal.yml.",
      }),
    );
    return { decisions, files, warnings };
  }

  const realDirectory = await fs.realpath(options.directory);
  if (!isPathInside(options.root, realDirectory)) {
    warnings.push(
      makeWarning({
        definition: DIAGNOSTICS.DECISION_INVALID,
        message: "The decisions directory resolves outside the scan root and was skipped.",
        suggestion: "Keep decision records inside the scan root.",
      }),
    );
    return { decisions, files, warnings };
  }
  seenRealDirectories.add(realDirectory);

  const maxDepth = options.maxDepth ?? 8;
  const maxFiles = options.maxFiles ?? 500;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosixPath(path.relative(options.root, absolutePath));
      let realPath = absolutePath;
      if (entry.isSymbolicLink()) {
        let resolved: string;
        try {
          resolved = await fs.realpath(absolutePath);
        } catch {
          warnings.push(
            makeWarning({
              definition: DIAGNOSTICS.BROKEN_SYMLINK,
              message: `Broken symlink in decisions directory was skipped: ${relativePath}`,
              source: { file: relativePath },
            }),
          );
          continue;
        }
        if (!isPathInside(options.root, resolved)) {
          warnings.push(
            makeWarning({
              definition: DIAGNOSTICS.SYMLINK_ESCAPE,
              message: `Decision symlink points outside the scan root and was skipped: ${relativePath}`,
              source: { file: relativePath },
            }),
          );
          continue;
        }
        realPath = resolved;
      }

      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (depth >= maxDepth) continue;
        const real = realPath;
        if (seenRealDirectories.has(real)) continue;
        seenRealDirectories.add(real);
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension !== ".yml" && extension !== ".yaml") continue;
      if (stat.size > options.maxFileSizeBytes) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.FILE_TOO_LARGE,
            message: `Decision file exceeds the size limit and was skipped: ${relativePath}`,
            source: { file: relativePath },
            suggestion: "Increase scan.maxFileSizeBytes or split the decision file.",
          }),
        );
        continue;
      }

      let text: string;
      try {
        text = await fs.readFile(realPath, "utf8");
      } catch {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DECISION_INVALID,
            message: `Decision file could not be read: ${relativePath}`,
            source: { file: relativePath },
          }),
        );
        continue;
      }
      if (text.includes("\u0000")) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.BINARY_FILE_SKIPPED,
            message: `Decision file appears to be binary and was skipped: ${relativePath}`,
            source: { file: relativePath },
          }),
        );
        continue;
      }
      files.push({ path: relativePath, kind: "decision", bytes: stat.size });

      let raw: unknown;
      try {
        raw = parse(text);
      } catch (error) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DECISION_INVALID,
            message: `Decision file is not valid YAML: ${error instanceof Error ? error.message : "unknown error"}`,
            source: { file: relativePath },
            suggestion: "Fix the YAML syntax.",
          }),
        );
        continue;
      }

      const result = decisionFileSchema.safeParse(raw);
      if (!result.success) {
        const detail = result.error.issues
          .map((item) => `${item.path.join(".") || "(root)"}: ${item.message}`)
          .join("; ");
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DECISION_INVALID,
            message: `Decision file is invalid: ${detail}`,
            source: { file: relativePath },
            suggestion: "See docs/configuration.md for the decision schema.",
          }),
        );
        continue;
      }

      const file = result.data;
      if (seenIds.has(file.id)) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DECISION_DUPLICATE_ID,
            message: `Decision ID "${file.id}" appears more than once; this record was skipped.`,
            source: { file: relativePath },
            suggestion: "Use a unique id for every decision record.",
          }),
        );
        continue;
      }
      seenIds.add(file.id);

      const uniqueRelated = [...new Set(file.related_services)];
      if (uniqueRelated.length !== file.related_services.length) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DECISION_DUPLICATE_RELATED_SERVICE,
            message: `Decision "${file.id}" lists a related service more than once.`,
            source: { file: relativePath },
            related: [ids.decision(file.id)],
          }),
        );
      }

      decisions.push({
        file,
        source: { file: relativePath, line: 1 },
        relatedServiceNames: uniqueRelated,
      });
    }
  };

  await walk(options.directory, 0);
  decisions.sort((a, b) => a.file.id.localeCompare(b.file.id));
  return { decisions, files, warnings };
}
