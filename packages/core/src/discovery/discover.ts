import fs from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import { DIAGNOSTICS, makeWarning } from "../diagnostics/warnings.js";
import type { Warning } from "../model/schema.js";
import { isPathInside, toPosixPath } from "../utils/paths.js";

export type FileKind = "compose" | "nginx" | "caddy";

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  kind: FileKind;
  size: number;
}

export interface DiscoveryOptions {
  root: string;
  include: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  maxFiles: number;
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  warnings: Warning[];
}

export function classifyFile(filePath: string): FileKind | undefined {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  if (
    lower === "compose.yml" ||
    lower === "compose.yaml" ||
    lower === "docker-compose.yml" ||
    lower === "docker-compose.yaml"
  ) {
    return "compose";
  }
  if (base === "Caddyfile" || base.startsWith("Caddyfile.")) return "caddy";
  if (lower.endsWith(".conf")) return "nginx";
  return undefined;
}

function matchesAny(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(relativePath, pattern, { dot: true }));
}

function isExcluded(relativePath: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) =>
      minimatch(relativePath, pattern, { dot: true }) ||
      minimatch(`${relativePath}/`, pattern, { dot: true }),
  );
}

async function safeRealpath(filePath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return undefined;
  }
}

export async function discoverFiles(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const root = await safeRealpath(options.root);
  if (!root) {
    throw new Error("Scan root could not be resolved");
  }

  const warnings: Warning[] = [];
  const files: DiscoveredFile[] = [];
  const visitedDirectories = new Set<string>([root]);
  const seenRealFiles = new Set<string>();
  const unsupportedPaths: string[] = [];
  let stoppedForFileLimit = false;
  let reportedDepth = false;

  const walk = async (
    directory: string,
    relativeDirectory: string,
    depth: number,
  ): Promise<void> => {
    if (stoppedForFileLimit) return;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      warnings.push(
        makeWarning({
          definition: DIAGNOSTICS.DIRECTORY_READ_ERROR,
          message: `Directory could not be read and was skipped: ${relativeDirectory || "."}`,
          source: { file: relativeDirectory || "." },
          suggestion: "Check filesystem permissions or exclude this directory explicitly.",
        }),
      );
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (stoppedForFileLimit) return;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosixPath(path.join(relativeDirectory, entry.name)).replace(
        /^\.\//,
        "",
      );

      if (isExcluded(relativePath, options.exclude)) continue;

      let realPath = absolutePath;
      if (entry.isSymbolicLink()) {
        const resolved = await safeRealpath(absolutePath);
        if (!resolved) {
          warnings.push(
            makeWarning({
              definition: DIAGNOSTICS.BROKEN_SYMLINK,
              message: `Broken symlink was skipped: ${relativePath}`,
              source: { file: relativePath },
              suggestion: "Remove the link or point it at an existing file.",
            }),
          );
          continue;
        }
        if (!isPathInside(root, resolved)) {
          warnings.push(
            makeWarning({
              definition: DIAGNOSTICS.SYMLINK_ESCAPE,
              message: `Symlink points outside the scan root and was skipped: ${relativePath}`,
              source: { file: relativePath },
              suggestion: "Replace the symlink with a file inside the scan root.",
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
        if (depth + 1 > options.maxDepth) {
          if (!reportedDepth) {
            warnings.push(
              makeWarning({
                definition: DIAGNOSTICS.MAX_DEPTH_REACHED,
                message: `Maximum scan depth (${options.maxDepth}) reached; deeper directories were skipped.`,
                source: { file: relativePath },
                suggestion: "Increase scan.maxDepth or narrow scan.include.",
              }),
            );
            reportedDepth = true;
          }
          continue;
        }
        const realDirectory = realPath;
        if (visitedDirectories.has(realDirectory)) continue;
        visitedDirectories.add(realDirectory);
        await walk(absolutePath, relativePath, depth + 1);
        continue;
      }

      if (!stat.isFile()) continue;
      if (!matchesAny(relativePath, options.include)) continue;

      const kind = classifyFile(relativePath);
      if (!kind) {
        unsupportedPaths.push(relativePath);
        continue;
      }

      if (stat.size > options.maxFileSizeBytes) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.FILE_TOO_LARGE,
            message: `File was skipped because it exceeds the size limit (${stat.size} > ${options.maxFileSizeBytes} bytes): ${relativePath}`,
            source: { file: relativePath },
            suggestion: "Increase scan.maxFileSizeBytes or exclude the file.",
          }),
        );
        continue;
      }

      if (seenRealFiles.has(realPath)) continue;
      if (files.length >= options.maxFiles) {
        if (!stoppedForFileLimit) {
          warnings.push(
            makeWarning({
              definition: DIAGNOSTICS.MAX_FILES_REACHED,
              message: `Maximum file count (${options.maxFiles}) reached; remaining matches were skipped.`,
              suggestion: "Narrow scan.include or increase scan.maxFiles.",
            }),
          );
          stoppedForFileLimit = true;
        }
        return;
      }

      seenRealFiles.add(realPath);
      files.push({
        absolutePath: realPath,
        relativePath,
        kind,
        size: stat.size,
      });
    }
  };

  await walk(root, "", 0);

  if (unsupportedPaths.length > 0) {
    const preview = unsupportedPaths.slice(0, 3).join(", ");
    const suffix = unsupportedPaths.length > 3 ? ` and ${unsupportedPaths.length - 3} more` : "";
    warnings.push(
      makeWarning({
        definition: DIAGNOSTICS.UNSUPPORTED_FILE_TYPE,
        message: `Included files are not supported and were ignored: ${preview}${suffix}`,
        source: { file: unsupportedPaths[0] ?? "." },
        suggestion: "Narrow scan.include to Compose files, Caddyfiles and Nginx *.conf files.",
      }),
    );
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, warnings };
}
