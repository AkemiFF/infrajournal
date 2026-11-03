import type { ResolvedConfig } from "../config/schema.js";
import type { Snapshot } from "../model/schema.js";
import { relativePosix } from "../utils/paths.js";
import { scanProject, type ScanProjectOptions } from "./scan.js";

export interface ScanFromConfigOptions {
  now?: Date;
  generatorVersion?: string;
}

/**
 * Add generated output directories to the exclusion list so regenerated
 * documentation is never re-read as infrastructure input.
 */
export function buildScanExcludeList(config: ResolvedConfig): string[] {
  const exclude = [...config.config.scan.exclude];
  for (const directory of [config.decisionsDirectory, config.outputDirectory]) {
    const relative = relativePosix(config.root, directory);
    if (relative && relative !== "." && !relative.startsWith("..") && !relative.startsWith("/")) {
      exclude.push(relative, `${relative}/**`);
    }
  }
  return exclude;
}

export async function scanFromConfig(
  config: ResolvedConfig,
  options: ScanFromConfigOptions = {},
): Promise<Snapshot> {
  const scanOptions: ScanProjectOptions = {
    root: config.root,
    projectName: config.projectName,
    include: config.config.scan.include,
    exclude: buildScanExcludeList(config),
    maxFileSizeBytes: config.config.scan.maxFileSizeBytes,
    maxDepth: config.config.scan.maxDepth,
    maxFiles: config.config.scan.maxFiles,
    decisionsDirectory: config.decisionsDirectory,
    backups: config.backups,
    ...(options.now ? { now: options.now } : {}),
    ...(options.generatorVersion ? { generatorVersion: options.generatorVersion } : {}),
  };
  return scanProject(scanOptions);
}
