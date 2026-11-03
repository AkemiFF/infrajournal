import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import {
  ConfigError,
  formatConfigError,
  infrajournalConfigSchema,
  normalizeConfigPaths,
  type InfraJournalConfig,
  type ResolvedConfig,
} from "./schema.js";
import { hasTraversalSegment, isPathInside } from "../utils/paths.js";

const CONFIG_FILENAMES = ["infrajournal.yml", "infrajournal.yaml"] as const;
const MAX_CONFIG_BYTES = 1_048_576;

export interface LoadConfigOptions {
  cwd: string;
  configPath?: string;
  /** Overrides scan.root when provided (resolved from cwd). */
  root?: string;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function findConfigFile(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name);
    if (await fileExists(candidate)) return candidate;
  }
  return undefined;
}

export async function loadConfig(options: LoadConfigOptions): Promise<ResolvedConfig> {
  let configFile: string | undefined;
  if (options.configPath) {
    configFile = path.resolve(options.cwd, options.configPath);
    if (!(await fileExists(configFile))) {
      throw new ConfigError(`Configuration file not found: ${options.configPath}`);
    }
  } else {
    configFile = await findConfigFile(options.cwd);
  }

  let rawConfig: unknown = {};
  if (configFile) {
    const stat = await fs.stat(configFile);
    if (stat.size > MAX_CONFIG_BYTES) {
      throw new ConfigError(
        `Configuration file is too large (${stat.size} bytes, limit ${MAX_CONFIG_BYTES}).`,
      );
    }
    let text: string;
    try {
      text = await fs.readFile(configFile, "utf8");
    } catch (error) {
      throw new ConfigError(
        `Unable to read configuration file: ${configFile}`,
        error instanceof Error ? error.message : undefined,
      );
    }
    try {
      rawConfig = parse(text) ?? {};
    } catch (error) {
      throw new ConfigError(
        `Invalid YAML in configuration file: ${configFile}`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  const result = infrajournalConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    throw new ConfigError(
      configFile
        ? `Invalid InfraJournal configuration in ${configFile}`
        : "Invalid InfraJournal configuration",
      formatConfigError(result.error),
    );
  }
  const config: InfraJournalConfig = result.data;

  const configBase = configFile ? path.dirname(configFile) : options.cwd;
  const requestedRoot = options.root
    ? path.resolve(options.cwd, options.root)
    : path.resolve(configBase, config.scan.root);

  let root: string;
  try {
    const stat = await fs.stat(requestedRoot);
    if (!stat.isDirectory()) {
      throw new ConfigError(`Scan root is not a directory: ${requestedRoot}`);
    }
    root = await fs.realpath(requestedRoot);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `Scan root does not exist or is not accessible: ${requestedRoot}`,
      error instanceof Error ? error.message : undefined,
    );
  }

  const paths = normalizeConfigPaths(config, root);
  if (!isPathInside(root, paths.decisionsDirectory)) {
    throw new ConfigError(
      "The decisions directory must be inside the scan root.",
      `Refusing to read ${paths.decisionsDirectory} because it is outside ${root}.`,
    );
  }
  if (path.resolve(paths.outputDirectory) === path.parse(paths.outputDirectory).root) {
    throw new ConfigError("The output directory cannot be the filesystem root.");
  }

  for (const pattern of [...config.scan.include, ...config.scan.exclude]) {
    if (
      pattern.startsWith("/") ||
      /^[a-zA-Z]:[\\/]/.test(pattern) ||
      hasTraversalSegment(pattern)
    ) {
      throw new ConfigError(
        `Invalid glob pattern "${pattern}". Patterns must be relative to the scan root and must not contain "..".`,
      );
    }
  }

  return {
    config,
    root,
    projectName: config.project.name ?? path.basename(root),
    ...paths,
    configFile,
    backups: config.backups,
  };
}
