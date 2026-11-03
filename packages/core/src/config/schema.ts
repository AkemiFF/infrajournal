import path from "node:path";
import { z } from "zod";

export const DEFAULT_INCLUDE = [
  "**/compose.yml",
  "**/compose.yaml",
  "**/docker-compose.yml",
  "**/docker-compose.yaml",
  "**/Caddyfile",
  "**/Caddyfile.*",
  "**/nginx/*.conf",
  "**/nginx/**/*.conf",
] as const;

export const DEFAULT_EXCLUDE = [
  "**/node_modules",
  "**/node_modules/**",
  "**/.git",
  "**/.git/**",
  "**/.hg",
  "**/.hg/**",
  "**/.svn",
  "**/.svn/**",
  "**/dist",
  "**/dist/**",
  "**/build",
  "**/build/**",
  "**/coverage",
  "**/coverage/**",
  "**/.next",
  "**/.next/**",
  "**/.cache",
  "**/.cache/**",
  "**/infra-docs",
  "**/infra-docs/**",
  "**/secrets",
  "**/secrets/**",
  "**/.env",
  "**/.env.*",
] as const;

export const backupPolicyConfigSchema = z.strictObject({
  /** Named volume name as declared in Docker Compose. */
  volume: z.string().min(1),
  /** Human-readable description of the backup policy. */
  policy: z.string().min(1),
});

export const infrajournalConfigSchema = z.strictObject({
  version: z.literal(1).default(1),
  project: z
    .strictObject({
      name: z.string().min(1).optional(),
    })
    .default({}),
  scan: z
    .strictObject({
      root: z.string().min(1).default("."),
      include: z.array(z.string().min(1)).default([...DEFAULT_INCLUDE]),
      exclude: z.array(z.string().min(1)).default([...DEFAULT_EXCLUDE]),
      maxFileSizeBytes: z.number().int().min(1024).max(52_428_800).default(1_048_576),
      maxDepth: z.number().int().min(1).max(40).default(12),
      maxFiles: z.number().int().min(1).max(50_000).default(5_000),
    })
    .default({
      root: ".",
      include: [...DEFAULT_INCLUDE],
      exclude: [...DEFAULT_EXCLUDE],
      maxFileSizeBytes: 1_048_576,
      maxDepth: 12,
      maxFiles: 5_000,
    }),
  output: z
    .strictObject({
      directory: z.string().min(1).default("./infra-docs"),
    })
    .default({ directory: "./infra-docs" }),
  decisions: z
    .strictObject({
      directory: z.string().min(1).default("./infra-decisions"),
    })
    .default({ directory: "./infra-decisions" }),
  backups: z.array(backupPolicyConfigSchema).default([]),
});

export type InfraJournalConfig = z.infer<typeof infrajournalConfigSchema>;
export type InfraJournalConfigInput = z.input<typeof infrajournalConfigSchema>;

export interface ResolvedConfig {
  config: InfraJournalConfig;
  /** Absolute, symlink-resolved scan root. Never written to a snapshot. */
  root: string;
  projectName: string;
  outputDirectory: string;
  decisionsDirectory: string;
  configFile?: string;
  backups: Array<{ volume: string; policy: string }>;
}

export class ConfigError extends Error {
  readonly exitCode = 2;

  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

export function formatConfigError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

export function normalizeConfigPaths(
  config: InfraJournalConfig,
  root: string,
): Pick<ResolvedConfig, "outputDirectory" | "decisionsDirectory"> {
  return {
    outputDirectory: path.resolve(root, config.output.directory),
    decisionsDirectory: path.resolve(root, config.decisions.directory),
  };
}
