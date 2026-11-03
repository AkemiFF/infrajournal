import { LineCounter, parseDocument } from "yaml";
import { DIAGNOSTICS } from "../diagnostics/warnings.js";
import type { BuildReference, PortMapping } from "../model/schema.js";
import {
  type ComposeNetworkDraft,
  type ComposeParseResult,
  type ComposeServiceDraft,
  type ComposeVolumeDraft,
  issue,
  type ParserIssue,
} from "./types.js";
import { isRecord, lineOf, mapPairs, pairKey, stringValue } from "./yaml-utils.js";

const PORT_PATTERN = /^\d+(-\d+)?$/;

interface ParsedPort {
  mapping?: PortMapping;
  error?: string;
}

function parseProtocol(value: unknown): "tcp" | "udp" | undefined {
  const protocol = stringValue(value)?.toLowerCase();
  if (!protocol || protocol === "tcp") return "tcp";
  if (protocol === "udp") return "udp";
  return undefined;
}

function parsePort(value: unknown, file: string, line?: number): ParsedPort {
  if (typeof value === "number") {
    return {
      mapping: {
        target: String(value),
        protocol: "tcp",
        ...(line !== undefined ? { source: { file, line } } : {}),
      },
    };
  }
  if (typeof value !== "string") {
    return { error: "Port entry is not a string or number" };
  }

  let rest = value.trim();
  let protocol: "tcp" | "udp" = "tcp";
  const slash = rest.lastIndexOf("/");
  if (slash !== -1) {
    const parsed = parseProtocol(rest.slice(slash + 1));
    if (!parsed) return { error: `Unsupported protocol "${rest.slice(slash + 1)}"` };
    protocol = parsed;
    rest = rest.slice(0, slash);
  }

  let hostIp: string | undefined;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1) return { error: "Unbalanced IPv6 bracket in port mapping" };
    hostIp = rest.slice(1, close);
    rest = rest.slice(close + 1);
    if (rest.startsWith(":")) rest = rest.slice(1);
  }

  const parts = rest.split(":");
  let published: string | undefined;
  let target: string | undefined;
  if (parts.length === 1) {
    target = parts[0];
  } else if (parts.length === 2) {
    published = parts[0];
    target = parts[1];
  } else {
    if (!hostIp) hostIp = parts.slice(0, -2).join(":");
    published = parts[parts.length - 2];
    target = parts[parts.length - 1];
  }

  if (!target || !PORT_PATTERN.test(target)) {
    return { error: "Container port is not a number or port range" };
  }
  if (published !== undefined && published !== "" && !PORT_PATTERN.test(published)) {
    return { error: "Published port is not a number or port range" };
  }

  return {
    mapping: {
      target,
      ...(published ? { published } : {}),
      ...(hostIp ? { hostIp } : {}),
      protocol,
      ...(line !== undefined ? { source: { file, line } } : {}),
    },
  };
}

function parsePortEntry(value: unknown, file: string, line?: number): ParsedPort {
  if (!isRecord(value)) return parsePort(value, file, line);
  const target = stringValue(value.target);
  const published = stringValue(value.published);
  const hostIp = stringValue(value.host_ip);
  const protocol = parseProtocol(value.protocol);
  if (!target || !PORT_PATTERN.test(target)) {
    return { error: "Long-syntax port is missing a valid target" };
  }
  if (!protocol) return { error: "Long-syntax port uses an unsupported protocol" };
  if (published !== undefined && !PORT_PATTERN.test(published)) {
    return { error: "Long-syntax port has an invalid published value" };
  }
  return {
    mapping: {
      target,
      protocol,
      ...(published ? { published } : {}),
      ...(hostIp ? { hostIp } : {}),
      ...(line !== undefined ? { source: { file, line } } : {}),
    },
  };
}

function parseMount(
  value: unknown,
  line?: number,
): { mount?: ComposeServiceDraft["mounts"][number]; error?: string } {
  if (isRecord(value)) {
    const target = stringValue(value.target);
    if (!target) return { error: "Mount entry is missing a target path" };
    const readOnly =
      value.read_only === true || value.read_only === "true" || value.read_only === "yes";
    if (value.type === "tmpfs") {
      return { mount: { type: "anonymous", target, readOnly, ...(line ? { line } : {}) } };
    }
    const source = stringValue(value.source);
    if (!source) return { error: "Mount entry is missing a source" };
    if (value.type === "bind" || value.type === undefined) {
      return { mount: { type: "bind", source, target, readOnly, ...(line ? { line } : {}) } };
    }
    if (value.type === "volume") {
      return { mount: { type: "named", source, target, readOnly, ...(line ? { line } : {}) } };
    }
    return { error: `Unsupported mount type "${String(value.type)}"` };
  }

  if (typeof value !== "string") return { error: "Mount entry is not a string or object" };

  let rest = value.trim();
  let drive = "";
  const driveMatch = /^([a-zA-Z]:[\\/])/.exec(rest);
  if (driveMatch) {
    drive = driveMatch[1] ?? "";
    rest = rest.slice(drive.length);
  }

  const parts = rest.split(":");
  if (parts.length === 1) {
    const target = parts[0];
    if (!target) return { error: "Anonymous volume is missing a target path" };
    return { mount: { type: "anonymous", target, readOnly: false, ...(line ? { line } : {}) } };
  }

  const sourcePart = `${drive}${parts[0] ?? ""}`;
  const target = parts[1];
  if (!target) return { error: "Mount entry is missing a target path" };
  const mode = parts.slice(2).join(":");
  const readOnly = mode.split(",").includes("ro");
  const isBind =
    drive.length > 0 ||
    sourcePart.startsWith("/") ||
    sourcePart.startsWith("./") ||
    sourcePart.startsWith("../") ||
    sourcePart.startsWith("~");
  if (!sourcePart) return { error: "Mount entry is missing a source" };
  return {
    mount: {
      type: isBind ? "bind" : "named",
      source: sourcePart,
      target,
      readOnly,
      ...(line ? { line } : {}),
    },
  };
}

function parseNetworkNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item)) return stringValue(item.name);
        return undefined;
      })
      .filter((item): item is string => !!item);
  }
  if (isRecord(value)) return Object.keys(value);
  return [];
}

function parseDependsOn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (isRecord(value)) return Object.keys(value);
  return [];
}

function parseEnvironment(value: unknown): string[] {
  if (isRecord(value)) return Object.keys(value);
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const equals = item.indexOf("=");
    const key = (equals === -1 ? item : item.slice(0, equals)).trim();
    if (key) keys.push(key);
  }
  return keys;
}

function parseEnvFiles(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) {
        const filePath = stringValue(item.path);
        return filePath ? filePath : undefined;
      }
      return undefined;
    })
    .filter((item): item is string => !!item);
}

function parseLabelKeys(value: unknown): string[] {
  if (isRecord(value)) return Object.keys(value);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.split("=", 1)[0]?.trim() ?? "")
    .filter((item) => item.length > 0);
}

/** Read one allowlisted label value from either Compose label form. */
function parseLabelValue(value: unknown, key: string): string | undefined {
  if (isRecord(value)) return stringValue(value[key]);
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (typeof item !== "string") continue;
    const equals = item.indexOf("=");
    const name = (equals === -1 ? item : item.slice(0, equals)).trim();
    if (name !== key) continue;
    return equals === -1 ? undefined : item.slice(equals + 1);
  }
  return undefined;
}

function parseBuild(value: unknown): BuildReference | undefined {
  if (typeof value === "string") return { context: value };
  if (!isRecord(value)) return undefined;
  const context = stringValue(value.context) ?? ".";
  const dockerfile = stringValue(value.dockerfile);
  return { context, ...(dockerfile ? { dockerfile } : {}) };
}

function hasInterpolation(value: string): boolean {
  return /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/.test(value);
}

function externalFlag(value: unknown): boolean {
  if (value === true) return true;
  if (isRecord(value) && value.external === true) return true;
  return false;
}

export function parseCompose(
  text: string,
  suggestedProjectName: string,
  relativePath: string,
): ComposeParseResult {
  const issues: ParserIssue[] = [];
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    lineCounter,
    uniqueKeys: true,
    prettyErrors: false,
  });

  for (const error of document.errors) {
    const position = error.linePos?.[0];
    issues.push(
      issue(DIAGNOSTICS.COMPOSE_PARSE_ERROR, error.message, {
        ...(position ? { line: position.line, column: position.col } : {}),
        suggestion: "Fix the YAML syntax; this file was skipped.",
      }),
    );
  }
  for (const warning of document.warnings) {
    const position = warning.linePos?.[0];
    issues.push(
      issue(DIAGNOSTICS.COMPOSE_SCHEMA_ERROR, warning.message, {
        ...(position ? { line: position.line, column: position.col } : {}),
      }),
    );
  }

  if (document.errors.length > 0) {
    return {
      composeProject: suggestedProjectName,
      services: [],
      networks: [],
      volumes: [],
      issues,
    };
  }

  let raw: unknown;
  try {
    raw = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    issues.push(
      issue(
        DIAGNOSTICS.COMPOSE_PARSE_ERROR,
        `YAML document could not be converted: ${error instanceof Error ? error.message : "unknown error"}`,
      ),
    );
    return {
      composeProject: suggestedProjectName,
      services: [],
      networks: [],
      volumes: [],
      issues,
    };
  }

  if (!isRecord(raw)) {
    issues.push(
      issue(DIAGNOSTICS.COMPOSE_SCHEMA_ERROR, "Compose document must be a YAML mapping."),
    );
    return {
      composeProject: suggestedProjectName,
      services: [],
      networks: [],
      volumes: [],
      issues,
    };
  }

  const composeProject = stringValue(raw.name) ?? suggestedProjectName;
  const servicesRaw = raw.services;
  if (!isRecord(servicesRaw)) {
    issues.push(
      issue(DIAGNOSTICS.COMPOSE_SCHEMA_ERROR, "Compose document has no services mapping.", {
        suggestion: "Add a top-level services: block.",
      }),
    );
    return { composeProject, services: [], networks: [], volumes: [], issues };
  }

  if (raw.version !== undefined) {
    issues.push(
      issue(
        DIAGNOSTICS.COMPOSE_VERSION_OBSOLETE,
        "The Compose version field is obsolete and was ignored.",
        {
          suggestion: "Remove the top-level version field.",
        },
      ),
    );
  }
  if (raw.include !== undefined) {
    issues.push(
      issue(
        DIAGNOSTICS.COMPOSE_INCLUDE_UNSUPPORTED,
        "Compose include files are not merged; only this file was analyzed.",
        { suggestion: "Scan the included files directly or merge them before analysis." },
      ),
    );
  }
  if (raw.secrets !== undefined) {
    issues.push(
      issue(
        DIAGNOSTICS.COMPOSE_SECRETS_NOT_ANALYZED,
        "Top-level Compose secrets are not analyzed and their referenced files are not read.",
      ),
    );
  }

  const servicesNode = document.get("services", true);
  const serviceLines = new Map<string, number | undefined>();
  for (const pair of mapPairs(servicesNode)) {
    const key = pairKey(pair);
    if (key) serviceLines.set(key, lineOf(lineCounter, pair.key));
  }

  const services: ComposeServiceDraft[] = [];
  for (const [name, rawService] of Object.entries(servicesRaw)) {
    const line = serviceLines.get(name);
    if (!isRecord(rawService)) {
      issues.push(
        issue(DIAGNOSTICS.COMPOSE_SCHEMA_ERROR, `Service "${name}" must be a mapping.`, {
          ...(line ? { line } : {}),
        }),
      );
      continue;
    }

    const image = stringValue(rawService.image);
    const build = parseBuild(rawService.build);
    if (!image && !build) {
      issues.push(
        issue(
          DIAGNOSTICS.COMPOSE_SCHEMA_ERROR,
          `Service "${name}" defines neither image nor build.`,
          {
            ...(line ? { line } : {}),
            suggestion: "Add an image or a build context.",
          },
        ),
      );
    }

    const ports: PortMapping[] = [];
    const rawPorts = Array.isArray(rawService.ports) ? rawService.ports : [];
    if (rawService.ports !== undefined && !Array.isArray(rawService.ports)) {
      issues.push(
        issue(DIAGNOSTICS.COMPOSE_SCHEMA_ERROR, `Service "${name}" has a non-list ports value.`, {
          ...(line ? { line } : {}),
        }),
      );
    }
    for (const rawPort of rawPorts) {
      const parsed = parsePortEntry(rawPort, relativePath, line);
      if (parsed.mapping) ports.push(parsed.mapping);
      else {
        issues.push(
          issue(
            DIAGNOSTICS.COMPOSE_SCHEMA_ERROR,
            `Service "${name}" has an unsupported port entry: ${parsed.error ?? "unknown error"}.`,
            { ...(line ? { line } : {}), suggestion: "Use Compose short or long port syntax." },
          ),
        );
      }
    }

    const mounts: ComposeServiceDraft["mounts"] = [];
    const rawVolumes = Array.isArray(rawService.volumes) ? rawService.volumes : [];
    if (rawService.volumes !== undefined && !Array.isArray(rawService.volumes)) {
      issues.push(
        issue(DIAGNOSTICS.COMPOSE_SCHEMA_ERROR, `Service "${name}" has a non-list volumes value.`, {
          ...(line ? { line } : {}),
        }),
      );
    }
    for (const rawMount of rawVolumes) {
      const parsed = parseMount(rawMount, line);
      if (parsed.mount) mounts.push(parsed.mount);
      else {
        issues.push(
          issue(
            DIAGNOSTICS.COMPOSE_SCHEMA_ERROR,
            `Service "${name}" has an unsupported volume entry: ${parsed.error ?? "unknown error"}.`,
            { ...(line ? { line } : {}) },
          ),
        );
      }
    }

    const networkMode = stringValue(rawService.network_mode);
    const networkNames = parseNetworkNames(rawService.networks);
    if (networkMode) {
      issues.push(
        issue(
          DIAGNOSTICS.COMPOSE_NETWORK_MODE_UNSUPPORTED,
          `Service "${name}" uses network_mode "${networkMode}"; only named networks are modeled.`,
          { ...(line ? { line } : {}) },
        ),
      );
    }
    const usesDefaultNetwork = !networkMode && networkNames.length === 0;

    const dependsOnNames = parseDependsOn(rawService.depends_on);
    const environmentKeys = parseEnvironment(rawService.environment);
    const envFiles = parseEnvFiles(rawService.env_file);
    const labelKeys = parseLabelKeys(rawService.labels);
    if (envFiles.length > 0) {
      issues.push(
        issue(
          DIAGNOSTICS.ENV_FILE_NOT_READ,
          `Service "${name}" references env_file; referenced files were not read.`,
          { ...(line ? { line } : {}), suggestion: "Review env_file contents manually." },
        ),
      );
    }
    if (rawService.extends !== undefined) {
      issues.push(
        issue(
          DIAGNOSTICS.COMPOSE_EXTENDS_UNSUPPORTED,
          `Service "${name}" uses extends; inherited configuration was not resolved.`,
          { ...(line ? { line } : {}) },
        ),
      );
    }
    if (rawService.secrets !== undefined) {
      issues.push(
        issue(
          DIAGNOSTICS.COMPOSE_SECRETS_NOT_ANALYZED,
          `Service "${name}" declares secrets; secret files are not read.`,
          { ...(line ? { line } : {}) },
        ),
      );
    }

    const interpolatedFields: string[] = [];
    const checkInterpolation = (field: string, value: unknown) => {
      if (typeof value === "string" && hasInterpolation(value)) interpolatedFields.push(field);
    };
    checkInterpolation("image", rawService.image);
    checkInterpolation(
      "build",
      typeof rawService.build === "string" ? rawService.build : undefined,
    );
    for (const port of rawPorts) {
      if (typeof port === "string") checkInterpolation("ports", port);
    }
    for (const mount of rawVolumes) {
      if (typeof mount === "string") checkInterpolation("volumes", mount);
    }
    for (const network of networkNames) checkInterpolation("networks", network);
    for (const dependency of dependsOnNames) checkInterpolation("depends_on", dependency);
    if (interpolatedFields.length > 0) {
      const uniqueFields = [...new Set(interpolatedFields)];
      issues.push(
        issue(
          DIAGNOSTICS.UNRESOLVED_INTERPOLATION,
          `Service "${name}" contains unresolved interpolation in: ${uniqueFields.join(", ")}. No variables were evaluated.`,
          {
            ...(line ? { line } : {}),
            suggestion:
              "Provide resolved configuration or accept that interpolated values stay literal.",
          },
        ),
      );
    }

    const healthcheckRaw = rawService.healthcheck;
    const healthcheck =
      isRecord(healthcheckRaw) &&
      healthcheckRaw.disable !== true &&
      healthcheckRaw.test !== undefined;
    const restart = stringValue(rawService.restart);

    services.push({
      name,
      ...(line ? { line } : {}),
      ...(image ? { image } : {}),
      ...(build ? { build } : {}),
      ports,
      networkNames,
      usesDefaultNetwork,
      mounts,
      dependsOnNames,
      healthcheck,
      ...(restart ? { restart } : {}),
      environmentKeys,
      envFiles,
      labelKeys,
      interpolatedFields: [...new Set(interpolatedFields)],
    });
  }

  const networksNode = document.get("networks", true);
  const networkLines = new Map<string, number | undefined>();
  for (const pair of mapPairs(networksNode)) {
    const key = pairKey(pair);
    if (key) networkLines.set(key, lineOf(lineCounter, pair.key));
  }
  const networks: ComposeNetworkDraft[] = [];
  if (isRecord(raw.networks)) {
    for (const [name, value] of Object.entries(raw.networks)) {
      const record = isRecord(value) ? value : {};
      const driver = stringValue(record.driver);
      const line = networkLines.get(name);
      networks.push({
        name,
        ...(line ? { line } : {}),
        ...(driver ? { driver } : {}),
        external: externalFlag(record),
      });
    }
  }

  const volumesNode = document.get("volumes", true);
  const volumeLines = new Map<string, number | undefined>();
  for (const pair of mapPairs(volumesNode)) {
    const key = pairKey(pair);
    if (key) volumeLines.set(key, lineOf(lineCounter, pair.key));
  }
  const volumes: ComposeVolumeDraft[] = [];
  if (isRecord(raw.volumes)) {
    for (const [name, value] of Object.entries(raw.volumes)) {
      const record = isRecord(value) ? value : {};
      const driver = stringValue(record.driver);
      const backupLabel =
        parseLabelValue(record.labels, "infrajournal.backup") ??
        parseLabelValue(record.labels, "infrajournal.backup-policy");
      const line = volumeLines.get(name);
      volumes.push({
        name,
        ...(line ? { line } : {}),
        ...(driver ? { driver } : {}),
        external: externalFlag(record),
        ...(backupLabel ? { backupLabel } : {}),
      });
    }
  }

  return { composeProject, services, networks, volumes, issues };
}
