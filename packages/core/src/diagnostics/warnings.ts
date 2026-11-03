import type { Severity, SourceLocation, Warning } from "../model/schema.js";
import { ids } from "../model/ids.js";
import { redactSensitiveText } from "../utils/redact.js";

export interface DiagnosticDefinition {
  code: string;
  severity: Severity;
  title: string;
}

/**
 * Stable diagnostic codes. Codes are part of the public contract: do not
 * renumber them. Add new codes with the next free number.
 */
export const DIAGNOSTICS = {
  COMPOSE_PARSE_ERROR: {
    code: "IJ001",
    severity: "ERROR",
    title: "Docker Compose could not be parsed",
  },
  COMPOSE_SCHEMA_ERROR: {
    code: "IJ002",
    severity: "ERROR",
    title: "Unsupported Docker Compose structure",
  },
  UNRESOLVED_INTERPOLATION: {
    code: "IJ003",
    severity: "WARNING",
    title: "Unresolved interpolation",
  },
  DEPENDENCY_TARGET_MISSING: {
    code: "IJ004",
    severity: "ERROR",
    title: "Dependency target does not exist",
  },
  NETWORK_NOT_DECLARED: { code: "IJ005", severity: "WARNING", title: "Network is not declared" },
  VOLUME_NOT_DECLARED: { code: "IJ006", severity: "WARNING", title: "Volume is not declared" },
  DUPLICATE_PORT_BINDING: {
    code: "IJ007",
    severity: "WARNING",
    title: "Duplicate host port binding",
  },
  SERVICE_EXPOSED_PORT: { code: "IJ008", severity: "INFO", title: "Service publishes a host port" },
  VOLUME_BACKUP_NOT_DOCUMENTED: {
    code: "IJ009",
    severity: "INFO",
    title: "Backup policy is not documented",
  },
  NGINX_PARSE_ERROR: {
    code: "IJ010",
    severity: "ERROR",
    title: "Nginx configuration could not be parsed",
  },
  CADDY_PARSE_ERROR: { code: "IJ011", severity: "ERROR", title: "Caddyfile could not be parsed" },
  UNSUPPORTED_DIRECTIVE: { code: "IJ012", severity: "INFO", title: "Directive is not interpreted" },
  PROXY_UPSTREAM_UNRESOLVED: {
    code: "IJ013",
    severity: "WARNING",
    title: "Proxy upstream was not matched to a service",
  },
  PROXY_VARIABLE_UNRESOLVED: {
    code: "IJ014",
    severity: "WARNING",
    title: "Proxy target contains a variable",
  },
  INCLUDE_NOT_FOLLOWED: { code: "IJ015", severity: "INFO", title: "Include file was not followed" },
  DUPLICATE_DOMAIN_ROUTE: {
    code: "IJ016",
    severity: "WARNING",
    title: "Domain is declared more than once",
  },
  DECISION_INVALID: { code: "IJ017", severity: "ERROR", title: "Decision record is invalid" },
  DECISION_RELATED_SERVICE_MISSING: {
    code: "IJ018",
    severity: "WARNING",
    title: "Decision references an unknown service",
  },
  DECISION_DUPLICATE_ID: { code: "IJ019", severity: "ERROR", title: "Decision ID is duplicated" },
  FILE_TOO_LARGE: { code: "IJ020", severity: "WARNING", title: "File exceeds the size limit" },
  SYMLINK_ESCAPE: {
    code: "IJ021",
    severity: "WARNING",
    title: "Symlink points outside the scan root",
  },
  MAX_DEPTH_REACHED: { code: "IJ022", severity: "INFO", title: "Maximum scan depth reached" },
  MAX_FILES_REACHED: { code: "IJ023", severity: "WARNING", title: "Maximum file count reached" },
  UNSUPPORTED_FILE_TYPE: {
    code: "IJ024",
    severity: "INFO",
    title: "Included file type is not supported",
  },
  BIND_MOUNT_OUTSIDE_ROOT: {
    code: "IJ025",
    severity: "INFO",
    title: "Bind mount points outside the scan root",
  },
  COMPOSE_INCLUDE_UNSUPPORTED: {
    code: "IJ026",
    severity: "INFO",
    title: "Compose include files are not merged",
  },
  COMPOSE_EXTENDS_UNSUPPORTED: {
    code: "IJ027",
    severity: "INFO",
    title: "Compose extends is not resolved",
  },
  COMPOSE_SECRETS_NOT_ANALYZED: {
    code: "IJ028",
    severity: "INFO",
    title: "Compose secrets are not analyzed",
  },
  COMPOSE_NETWORK_MODE_UNSUPPORTED: {
    code: "IJ029",
    severity: "INFO",
    title: "Custom network mode is not modeled",
  },
  BACKUP_VOLUME_UNKNOWN: {
    code: "IJ030",
    severity: "WARNING",
    title: "Backup policy references an unknown volume",
  },
  ENV_FILE_NOT_READ: { code: "IJ031", severity: "INFO", title: "env_file contents are not read" },
  DUPLICATE_SERVICE: { code: "IJ032", severity: "ERROR", title: "Service name is duplicated" },
  NGINX_SERVER_WITHOUT_NAME: {
    code: "IJ033",
    severity: "INFO",
    title: "Nginx server block has no domain name",
  },
  CADDY_SITE_WITHOUT_HOST: {
    code: "IJ034",
    severity: "WARNING",
    title: "Caddy site has no host name",
  },
  PROXY_UPSTREAM_AMBIGUOUS: {
    code: "IJ035",
    severity: "WARNING",
    title: "Proxy upstream matches multiple services",
  },
  DECISION_DUPLICATE_RELATED_SERVICE: {
    code: "IJ036",
    severity: "INFO",
    title: "Decision lists a service more than once",
  },
  BINARY_FILE_SKIPPED: { code: "IJ037", severity: "WARNING", title: "Binary file was skipped" },
  UNSUPPORTED_PROXY_TARGET: {
    code: "IJ038",
    severity: "INFO",
    title: "Proxy target form is not modeled",
  },
  COMPOSE_DEPENDENCY_AMBIGUOUS: {
    code: "IJ039",
    severity: "ERROR",
    title: "Compose dependency is ambiguous",
  },
  DIRECTORY_READ_ERROR: {
    code: "IJ040",
    severity: "WARNING",
    title: "Directory could not be read",
  },
  COMPOSE_VERSION_OBSOLETE: {
    code: "IJ041",
    severity: "INFO",
    title: "Obsolete Compose version field",
  },
  SNAPSHOT_VALIDATION_ERROR: {
    code: "IJ042",
    severity: "ERROR",
    title: "Snapshot validation failed",
  },
  BROKEN_SYMLINK: { code: "IJ043", severity: "WARNING", title: "Broken symlink was skipped" },
  FILE_READ_ERROR: { code: "IJ044", severity: "WARNING", title: "File could not be read" },
} as const satisfies Record<string, DiagnosticDefinition>;

export type DiagnosticName = keyof typeof DIAGNOSTICS;

export interface WarningInput {
  definition: DiagnosticDefinition;
  message: string;
  related?: string[];
  source?: SourceLocation;
  suggestion?: string;
}

export function makeWarning(input: WarningInput): Warning {
  const location = input.source
    ? `${input.source.file}:${input.source.line ?? 0}:${input.source.column ?? 0}`
    : "global";
  const related = [...new Set(input.related ?? [])].sort();
  const message = redactSensitiveText(input.message);
  const suggestion = input.suggestion ? redactSensitiveText(input.suggestion) : undefined;
  return {
    id: ids.warning(input.definition.code, location, message),
    code: input.definition.code,
    severity: input.definition.severity,
    message,
    related,
    ...(input.source ? { source: input.source } : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

export function dedupeWarnings(warnings: Warning[]): Warning[] {
  const byId = new Map<string, Warning>();
  for (const warning of warnings) {
    if (!byId.has(warning.id)) byId.set(warning.id, warning);
  }
  return [...byId.values()].sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      (a.source?.file ?? "").localeCompare(b.source?.file ?? "") ||
      (a.source?.line ?? 0) - (b.source?.line ?? 0) ||
      a.message.localeCompare(b.message),
  );
}
