import path from "node:path";
import {
  DIAGNOSTICS,
  dedupeWarnings,
  makeWarning,
  type DiagnosticDefinition,
} from "../diagnostics/warnings.js";
import { analyzeBackups, analyzePorts } from "../diagnostics/analyze.js";
import { loadDecisions } from "../decisions/load-decisions.js";
import { discoverFiles, type DiscoveredFile } from "../discovery/discover.js";
import { readUntrustedText } from "../discovery/read-file.js";
import { buildGraphNodes, mergeDependencies } from "../graph/build.js";
import { ids, normalizeHost } from "../model/ids.js";
import type { ComposeParseResult } from "../parsers/types.js";
import { parseCaddy } from "../parsers/caddy.js";
import { parseCompose } from "../parsers/compose.js";
import { parseNginx } from "../parsers/nginx.js";
import type { CaddyParseResult, NginxParseResult, ParserIssue } from "../parsers/types.js";
import {
  type Dependency,
  type Domain,
  type DomainRoute,
  type Endpoint,
  type ExternalDependency,
  type Network,
  type ScannedFile,
  type Service,
  type Snapshot,
  type SnapshotContent,
  type Volume,
  type Warning,
} from "../model/schema.js";
import { buildSnapshot } from "../serialization/snapshot.js";
import { isPathInside } from "../utils/paths.js";

export const CORE_VERSION = "0.1.1";

export interface ScanProjectOptions {
  /** Absolute, symlink-resolved scan root. */
  root: string;
  projectName: string;
  include: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  maxFiles: number;
  decisionsDirectory: string;
  backups: Array<{ volume: string; policy: string }>;
  generatorVersion?: string;
  now?: Date;
}

interface ComposeFileParsed {
  relativePath: string;
  result: ComposeParseResult;
}

interface ProxyFileParsed<T> {
  relativePath: string;
  result: T;
}

interface ServiceEntry {
  id: string;
  file: string;
  composeProject: string;
  draft: ComposeParseResult["services"][number];
}

interface DeclaredNetwork {
  file: string;
  draft: ComposeParseResult["networks"][number];
}

interface DeclaredVolume {
  file: string;
  draft: ComposeParseResult["volumes"][number];
}

interface DomainDraft {
  name: string;
  proxy: "nginx" | "caddy";
  tls: boolean;
  routes: Array<{
    path?: string;
    upstream: string;
    line?: number;
    source: { file: string; line?: number };
  }>;
  source: { file: string; line?: number };
}

const DB_IMAGE = /(postgres|postgresql|mysql|mariadb|mongo|mongodb)/;
const POSTGRES_IMAGE = /(postgres|postgresql)/;
const MYSQL_IMAGE = /(mysql|mariadb)/;
const MONGO_IMAGE = /(mongo|mongodb)/;
const REDIS_IMAGE = /(redis|valkey|keydb)/;

function defaultComposeProject(relativePath: string, fallback: string): string {
  const directory = path.posix.dirname(relativePath);
  if (directory === "." || directory === "") return fallback;
  return path.posix.basename(directory);
}

function sourceFor(file: string, line?: number): { file: string; line?: number } {
  return line !== undefined ? { file, line } : { file };
}

function parseIssueToWarning(parserIssue: ParserIssue, file: string, related: string[]): Warning {
  return makeWarning({
    definition: parserIssue.definition,
    message: parserIssue.message,
    related,
    source: {
      file,
      ...(parserIssue.line !== undefined ? { line: parserIssue.line } : {}),
      ...(parserIssue.column !== undefined ? { column: parserIssue.column } : {}),
    },
    ...(parserIssue.suggestion ? { suggestion: parserIssue.suggestion } : {}),
  });
}

function isHostAbsolute(source: string): boolean {
  return source.startsWith("/") || source.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(source);
}

function normalizedServiceName(name: string): string {
  return name.toLowerCase().replace(/_/g, "-");
}

function splitHostAndPort(target: string): { host: string; port?: string } {
  const withoutScheme = target.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/", 1)[0] ?? "";
  if (withoutScheme.startsWith("[")) {
    const close = withoutScheme.indexOf("]");
    if (close !== -1) {
      const host = withoutScheme.slice(1, close);
      const rest = withoutScheme.slice(close + 1);
      return {
        host: host.toLowerCase(),
        ...(rest.startsWith(":") ? { port: rest.slice(1) } : {}),
      };
    }
  }
  const colon = withoutScheme.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(withoutScheme.slice(colon + 1))) {
    return {
      host: withoutScheme.slice(0, colon).toLowerCase(),
      port: withoutScheme.slice(colon + 1),
    };
  }
  return { host: withoutScheme.toLowerCase() };
}

function inferCategoryForKey(key: string): RegExp | undefined {
  const upper = key.toUpperCase();
  if (upper === "DATABASE_URL" || upper === "DB_URL" || upper === "DATABASE_HOST") {
    return DB_IMAGE;
  }
  if (upper.startsWith("POSTGRES") || upper === "PGHOST" || upper === "PGDATABASE") {
    return POSTGRES_IMAGE;
  }
  if (upper.startsWith("MYSQL") || upper.startsWith("MARIADB")) return MYSQL_IMAGE;
  if (upper.startsWith("MONGO") || upper === "MONGODB_URI") return MONGO_IMAGE;
  if (upper.startsWith("REDIS") || upper === "CACHE_URL") return REDIS_IMAGE;
  return undefined;
}

export async function scanProject(options: ScanProjectOptions): Promise<Snapshot> {
  const warnings: Warning[] = [];
  const files: ScannedFile[] = [];
  const composeFiles: ComposeFileParsed[] = [];
  const nginxFiles: ProxyFileParsed<NginxParseResult>[] = [];
  const caddyFiles: ProxyFileParsed<CaddyParseResult>[] = [];

  const discovery = await discoverFiles({
    root: options.root,
    include: options.include,
    exclude: options.exclude,
    maxFileSizeBytes: options.maxFileSizeBytes,
    maxDepth: options.maxDepth,
    maxFiles: options.maxFiles,
  });
  warnings.push(...discovery.warnings);

  for (const discovered of discovery.files) {
    const read = await readUntrustedText(discovered.absolutePath, options.maxFileSizeBytes);
    if (!read.ok) {
      const definition =
        read.reason === "binary"
          ? DIAGNOSTICS.BINARY_FILE_SKIPPED
          : read.reason === "too-large"
            ? DIAGNOSTICS.FILE_TOO_LARGE
            : DIAGNOSTICS.FILE_READ_ERROR;
      warnings.push(
        makeWarning({
          definition,
          message: `File was not analyzed (${read.reason}): ${discovered.relativePath}`,
          source: { file: discovered.relativePath },
        }),
      );
      continue;
    }

    files.push({
      path: discovered.relativePath,
      kind: discovered.kind,
      bytes: discovered.size,
    });

    if (discovered.kind === "compose") {
      const suggestedProject = defaultComposeProject(discovered.relativePath, options.projectName);
      composeFiles.push({
        relativePath: discovered.relativePath,
        result: parseCompose(read.text, suggestedProject, discovered.relativePath),
      });
    } else if (discovered.kind === "nginx") {
      nginxFiles.push({ relativePath: discovered.relativePath, result: parseNginx(read.text) });
    } else {
      caddyFiles.push({ relativePath: discovered.relativePath, result: parseCaddy(read.text) });
    }
  }

  // --- Compose inventory -------------------------------------------------
  const composeProjects = new Set<string>();
  const declaredNetworks = new Map<string, DeclaredNetwork>();
  const declaredVolumes = new Map<string, DeclaredVolume>();
  const serviceEntries = new Map<string, ServiceEntry>();
  const fileServiceIds = new Map<string, string[]>();
  const serviceIdsByProjectAndName = new Map<string, Map<string, string[]>>();

  for (const composeFile of composeFiles) {
    composeProjects.add(composeFile.result.composeProject);
    for (const draft of composeFile.result.networks) {
      const id = ids.network(composeFile.result.composeProject, draft.name);
      if (!declaredNetworks.has(id)) {
        declaredNetworks.set(id, { file: composeFile.relativePath, draft });
      }
    }
    for (const draft of composeFile.result.volumes) {
      const id = ids.volume(composeFile.result.composeProject, draft.name);
      if (!declaredVolumes.has(id)) {
        declaredVolumes.set(id, { file: composeFile.relativePath, draft });
      }
    }

    const fileIds: string[] = [];
    for (const draft of composeFile.result.services) {
      const id = ids.service(composeFile.result.composeProject, draft.name);
      const existing = serviceEntries.get(id);
      if (existing) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DUPLICATE_SERVICE,
            message: `Service "${draft.name}" in Compose project "${composeFile.result.composeProject}" is defined more than once; the later definition was skipped.`,
            related: [id],
            source: sourceFor(composeFile.relativePath, draft.line),
            suggestion: "Merge Compose files before scanning; multi-file merging is not supported.",
          }),
        );
        continue;
      }
      serviceEntries.set(id, {
        id,
        file: composeFile.relativePath,
        composeProject: composeFile.result.composeProject,
        draft,
      });
      fileIds.push(id);

      const projectKey = composeFile.result.composeProject;
      const byName = serviceIdsByProjectAndName.get(projectKey) ?? new Map<string, string[]>();
      const idsForName = byName.get(draft.name) ?? [];
      idsForName.push(id);
      byName.set(draft.name, idsForName);
      serviceIdsByProjectAndName.set(projectKey, byName);
    }
    fileServiceIds.set(composeFile.relativePath, fileIds);
  }

  const networks = new Map<string, Network>();
  const volumes = new Map<string, Volume>();
  const backupByName = new Map<string, string>();
  for (const backup of options.backups) {
    if (!backupByName.has(backup.volume)) backupByName.set(backup.volume, backup.policy);
  }
  const usedBackupVolumes = new Set<string>();

  const ensureNetwork = (
    composeProject: string,
    name: string,
    source: { file: string; line?: number },
    serviceId?: string,
  ): Network => {
    const id = ids.network(composeProject, name);
    const existing = networks.get(id);
    if (existing) return existing;
    const declared = declaredNetworks.get(id);
    if (declared) {
      const network: Network = {
        id,
        kind: "network",
        name,
        composeProject,
        ...(declared.draft.driver ? { driver: declared.draft.driver } : {}),
        external: declared.draft.external,
        implicit: false,
        source: sourceFor(declared.file, declared.draft.line),
        evidence: { kind: "explicit", reason: "Declared in Docker Compose." },
      };
      networks.set(id, network);
      return network;
    }
    const isDefault = name === "default";
    if (!isDefault) {
      warnings.push(
        makeWarning({
          definition: DIAGNOSTICS.NETWORK_NOT_DECLARED,
          message: `Network "${name}" is referenced by a service but not declared in the Compose file.`,
          related: serviceId ? [id, serviceId] : [id],
          source,
          suggestion: "Declare the network under the top-level networks: section.",
        }),
      );
    }
    const network: Network = {
      id,
      kind: "network",
      name,
      composeProject,
      external: false,
      implicit: true,
      source,
      evidence: {
        kind: isDefault ? "implicit" : "inferred",
        reason: isDefault
          ? "Docker Compose attaches a default network when no network is declared."
          : "Referenced by a service but not declared.",
      },
    };
    networks.set(id, network);
    return network;
  };

  const ensureVolume = (
    composeProject: string,
    name: string,
    source: { file: string; line?: number },
    serviceId?: string,
  ): Volume => {
    const id = ids.volume(composeProject, name);
    const existing = volumes.get(id);
    if (existing) return existing;
    const declared = declaredVolumes.get(id);
    const configPolicy = backupByName.get(name);
    if (configPolicy) usedBackupVolumes.add(name);
    if (declared) {
      const labelPolicy = declared.draft.backupLabel;
      const volume: Volume = {
        id,
        kind: "volume",
        name,
        composeProject,
        ...(declared.draft.driver ? { driver: declared.draft.driver } : {}),
        external: declared.draft.external,
        implicit: false,
        ...(configPolicy
          ? { backup: { policy: configPolicy, source: "config" as const } }
          : labelPolicy
            ? { backup: { policy: labelPolicy, source: "label" as const } }
            : {}),
        source: sourceFor(declared.file, declared.draft.line),
        evidence: { kind: "explicit", reason: "Declared in Docker Compose." },
      };
      volumes.set(id, volume);
      return volume;
    }

    warnings.push(
      makeWarning({
        definition: DIAGNOSTICS.VOLUME_NOT_DECLARED,
        message: `Named volume "${name}" is mounted by a service but not declared in the Compose file.`,
        related: serviceId ? [id, serviceId] : [id],
        source,
        suggestion: "Declare the volume under the top-level volumes: section.",
      }),
    );
    const volume: Volume = {
      id,
      kind: "volume",
      name,
      composeProject,
      external: false,
      implicit: true,
      ...(configPolicy ? { backup: { policy: configPolicy, source: "config" as const } } : {}),
      source,
      evidence: { kind: "inferred", reason: "Mounted by a service but not declared." },
    };
    volumes.set(id, volume);
    return volume;
  };

  // Build all declared resources deterministically with their real project names.
  for (const composeFile of composeFiles) {
    for (const draft of composeFile.result.networks) {
      ensureNetwork(
        composeFile.result.composeProject,
        draft.name,
        sourceFor(composeFile.relativePath, draft.line),
      );
    }
    for (const draft of composeFile.result.volumes) {
      ensureVolume(
        composeFile.result.composeProject,
        draft.name,
        sourceFor(composeFile.relativePath, draft.line),
      );
    }
  }

  const endpoints = new Map<string, Endpoint>();
  const dependencies: Dependency[] = [];
  const addDependency = (
    type: Dependency["type"],
    from: string,
    to: string,
    evidence: Dependency["evidence"],
  ) => {
    dependencies.push({
      id: ids.dependency(type, from, to),
      type,
      from,
      to,
      evidence,
    });
  };

  const services: Service[] = [];
  for (const entry of [...serviceEntries.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const { draft, file, composeProject } = entry;
    const source = sourceFor(file, draft.line);
    const networkIds = new Set<string>();

    if (draft.usesDefaultNetwork) {
      const network = ensureNetwork(composeProject, "default", source, entry.id);
      networkIds.add(network.id);
    }
    for (const name of draft.networkNames) {
      const network = ensureNetwork(composeProject, name, source, entry.id);
      networkIds.add(network.id);
    }

    const mounts: Service["mounts"] = [];
    for (const mount of draft.mounts) {
      const sourceLocation = sourceFor(file, mount.line);
      if (mount.type === "named" && mount.source) {
        const volume = ensureVolume(composeProject, mount.source, source, entry.id);
        mounts.push({
          type: "named",
          source: mount.source,
          target: mount.target,
          readOnly: mount.readOnly,
          volumeId: volume.id,
          sourceLocation,
        });
      } else if (mount.type === "bind") {
        if (mount.source && isHostAbsolute(mount.source)) {
          const outside =
            mount.source.startsWith("~") ||
            /^[a-zA-Z]:[\\/]/.test(mount.source) ||
            !isPathInside(options.root, mount.source);
          if (outside) {
            warnings.push(
              makeWarning({
                definition: DIAGNOSTICS.BIND_MOUNT_OUTSIDE_ROOT,
                message: `Service "${draft.name}" bind-mounts a host path outside the scan root (${mount.source}); InfraJournal did not read it.`,
                related: [entry.id],
                source: sourceLocation,
                suggestion: "Keep documented bind mounts inside the scan root when possible.",
              }),
            );
          }
        }
        mounts.push({
          type: "bind",
          ...(mount.source ? { source: mount.source } : {}),
          target: mount.target,
          readOnly: mount.readOnly,
          sourceLocation,
        });
      } else {
        mounts.push({
          type: "anonymous",
          target: mount.target,
          readOnly: mount.readOnly,
          sourceLocation,
        });
      }
    }

    const dependsOn: string[] = [];
    const byName = serviceIdsByProjectAndName.get(composeProject);
    for (const name of draft.dependsOnNames) {
      const candidates = byName?.get(name) ?? [];
      if (candidates.length === 0) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DEPENDENCY_TARGET_MISSING,
            message: `Service "${draft.name}" depends on "${name}", which is not a service in the same Compose project.`,
            related: [entry.id],
            source,
            suggestion: "Fix the depends_on target or scan the missing Compose file.",
          }),
        );
      } else if (candidates.length > 1) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.COMPOSE_DEPENDENCY_AMBIGUOUS,
            message: `Service "${draft.name}" depends on "${name}", which matches multiple services.`,
            related: [entry.id, ...candidates],
            source,
          }),
        );
      } else if (candidates[0]) {
        dependsOn.push(candidates[0]);
      }
    }

    const service: Service = {
      id: entry.id,
      kind: "service",
      name: draft.name,
      composeProject,
      ...(draft.image ? { image: draft.image } : {}),
      ...(draft.build ? { build: draft.build } : {}),
      ports: draft.ports,
      networkIds: [...networkIds].sort(),
      mounts,
      dependsOn: [...new Set(dependsOn)].sort(),
      healthcheck: draft.healthcheck,
      ...(draft.restart ? { restart: draft.restart } : {}),
      environmentKeys: [...new Set(draft.environmentKeys)].sort(),
      envFiles: [...new Set(draft.envFiles)].sort(),
      labelKeys: [...new Set(draft.labelKeys)].sort(),
      source,
      evidence: { kind: "explicit", reason: "Declared in Docker Compose." },
    };
    services.push(service);

    for (const port of draft.ports) {
      const endpointId = ids.endpoint(service.id, port.protocol, port.target);
      if (!endpoints.has(endpointId)) {
        endpoints.set(endpointId, {
          id: endpointId,
          kind: "endpoint",
          name: `${service.name}:${port.target}/${port.protocol}`,
          transport: port.protocol,
          port: port.target,
          serviceId: service.id,
          ...(port.published ? { published: port.published } : {}),
          ...(port.hostIp ? { hostIp: port.hostIp } : {}),
          ...(port.source ? { source: port.source } : {}),
        });
      }
    }

    for (const networkId of service.networkIds) {
      const network = networks.get(networkId);
      addDependency("CONNECTED_TO", service.id, networkId, {
        kind: network?.implicit ? "implicit" : "explicit",
        ...(network?.implicit
          ? { reason: network.evidence.reason ?? "Implicit Docker Compose network." }
          : {}),
        source: service.source,
      });
    }
    for (const mount of service.mounts) {
      if (mount.volumeId) {
        addDependency("MOUNTS", service.id, mount.volumeId, {
          kind: "explicit",
          reason: "Named volume mount.",
          ...(mount.sourceLocation ? { source: mount.sourceLocation } : { source: service.source }),
        });
      }
    }
    for (const target of service.dependsOn) {
      addDependency("DEPENDS_ON", service.id, target, {
        kind: "explicit",
        reason: "Declared in depends_on.",
        source: service.source,
      });
    }
    for (const endpoint of endpoints.values()) {
      if (endpoint.serviceId === service.id) {
        addDependency("EXPOSES", service.id, endpoint.id, {
          kind: "explicit",
          reason: "Declared port mapping.",
          ...(endpoint.source ? { source: endpoint.source } : { source: service.source }),
        });
      }
    }
  }

  // --- Proxy domains -----------------------------------------------------
  const domains = new Map<string, Domain>();
  const external = new Map<string, ExternalDependency>();
  const fileDomainIds = new Map<string, string[]>();
  const serviceNameIndex = new Map<string, Service[]>();
  for (const service of services) {
    for (const key of new Set([service.name.toLowerCase(), normalizedServiceName(service.name)])) {
      const list = serviceNameIndex.get(key) ?? [];
      if (!list.some((candidate) => candidate.id === service.id)) list.push(service);
      serviceNameIndex.set(key, list);
    }
  }

  const ensureExternal = (
    host: string,
    source: { file: string; line?: number },
  ): ExternalDependency => {
    const id = ids.external(host);
    const existing = external.get(id);
    if (existing) return existing;
    const created: ExternalDependency = {
      id,
      kind: "external",
      name: host,
      category: "upstream",
      detail: "Proxy upstream not matched to a scanned service.",
      source,
    };
    external.set(id, created);
    return created;
  };

  const resolveUpstream = (
    upstream: string,
    domainName: string,
    domainId: string,
    source: { file: string; line?: number },
  ): Pick<DomainRoute, "serviceId" | "externalId"> => {
    const { host } = splitHostAndPort(upstream);
    if (!host) {
      warnings.push(
        makeWarning({
          definition: DIAGNOSTICS.PROXY_UPSTREAM_UNRESOLVED,
          message: `Proxy route for "${domainName}" has an upstream without a host and could not be resolved.`,
          related: [domainId],
          source,
        }),
      );
      return {};
    }
    const candidates =
      serviceNameIndex.get(host) ?? serviceNameIndex.get(normalizedServiceName(host)) ?? [];
    if (candidates.length === 1 && candidates[0]) {
      return { serviceId: candidates[0].id };
    }
    const externalNode = ensureExternal(host, source);
    if (candidates.length > 1) {
      warnings.push(
        makeWarning({
          definition: DIAGNOSTICS.PROXY_UPSTREAM_AMBIGUOUS,
          message: `Proxy route for "${domainName}" targets "${host}", which matches ${candidates.length} services.`,
          related: [
            domainId,
            externalNode.id,
            ...candidates.map((candidate) => candidate.id),
          ].sort(),
          source,
          suggestion: "Give the intended upstream service a unique name.",
        }),
      );
    } else {
      warnings.push(
        makeWarning({
          definition: DIAGNOSTICS.PROXY_UPSTREAM_UNRESOLVED,
          message: `Proxy route for "${domainName}" targets "${upstream}", which does not match a scanned service.`,
          related: [domainId, externalNode.id],
          source,
          suggestion: "Add the upstream service to the scan or use a literal service name.",
        }),
      );
    }
    return { externalId: externalNode.id };
  };

  const collectDomain = (draft: DomainDraft): string => {
    const name = normalizeHost(draft.name);
    const id = ids.domain(name);
    const routes: DomainRoute[] = draft.routes.map((route) => {
      const resolution = resolveUpstream(route.upstream, name, id, route.source);
      return {
        ...(route.path ? { path: route.path } : {}),
        upstream: route.upstream,
        ...resolution,
        source: route.source,
      };
    });
    const routeKey = (route: DomainRoute) =>
      `${route.path ?? ""}\u0000${route.upstream}\u0000${route.serviceId ?? route.externalId ?? ""}`;
    const uniqueRoutes = new Map<string, DomainRoute>();
    for (const route of routes) uniqueRoutes.set(routeKey(route), route);
    const sortedRoutes = [...uniqueRoutes.values()].sort(
      (a, b) => (a.path ?? "").localeCompare(b.path ?? "") || a.upstream.localeCompare(b.upstream),
    );

    const existing = domains.get(id);
    if (existing) {
      const before = JSON.stringify(existing.routes.map(routeKey).sort());
      const after = JSON.stringify(sortedRoutes.map(routeKey).sort());
      if (before !== after || existing.tls !== draft.tls || existing.proxy !== draft.proxy) {
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DUPLICATE_DOMAIN_ROUTE,
            message: `Domain "${name}" is declared in more than one proxy block with differing configuration; routes were merged.`,
            related: [id],
            source: draft.source,
            suggestion: "Keep one authoritative server block per domain.",
          }),
        );
      }
      existing.tls = existing.tls || draft.tls;
      const merged = new Map<string, DomainRoute>();
      for (const route of [...existing.routes, ...sortedRoutes]) merged.set(routeKey(route), route);
      existing.routes = [...merged.values()].sort(
        (a, b) =>
          (a.path ?? "").localeCompare(b.path ?? "") || a.upstream.localeCompare(b.upstream),
      );
      return id;
    }

    const domain: Domain = {
      id,
      kind: "domain",
      name,
      proxy: draft.proxy,
      tls: draft.tls,
      routes: sortedRoutes,
      source: draft.source,
      evidence: { kind: "explicit", reason: `Declared in ${draft.proxy} configuration.` },
    };
    domains.set(id, domain);
    return id;
  };

  for (const nginxFile of nginxFiles) {
    const domainIds = new Set<string>();
    for (const server of nginxFile.result.servers) {
      for (const serverName of new Set(server.serverNames.map((name) => name.toLowerCase()))) {
        const domainId = collectDomain({
          name: serverName,
          proxy: "nginx",
          tls: server.tls,
          routes: server.routes.map((route) => ({
            ...(route.path ? { path: route.path } : {}),
            upstream: route.upstream,
            ...(route.line !== undefined ? { line: route.line } : {}),
            source: sourceFor(nginxFile.relativePath, route.line ?? server.line),
          })),
          source: sourceFor(nginxFile.relativePath, server.line),
        });
        domainIds.add(domainId);
      }
    }
    fileDomainIds.set(nginxFile.relativePath, [...domainIds].sort());
  }

  for (const caddyFile of caddyFiles) {
    const domainIds = new Set<string>();
    for (const site of caddyFile.result.sites) {
      for (const address of site.addresses) {
        const domainId = collectDomain({
          name: address,
          proxy: "caddy",
          tls: site.tls,
          routes: site.routes.map((route) => ({
            ...(route.path ? { path: route.path } : {}),
            upstream: route.upstream,
            ...(route.line !== undefined ? { line: route.line } : {}),
            source: sourceFor(caddyFile.relativePath, route.line ?? site.line),
          })),
          source: sourceFor(caddyFile.relativePath, site.line),
        });
        domainIds.add(domainId);
      }
    }
    fileDomainIds.set(caddyFile.relativePath, [...domainIds].sort());
  }

  for (const domain of domains.values()) {
    for (const route of domain.routes) {
      const target = route.serviceId ?? route.externalId;
      if (!target) continue;
      addDependency("ROUTES_TO", domain.id, target, {
        kind: "explicit",
        reason: `${domain.proxy} proxy route${route.path ? ` for ${route.path}` : ""}.`,
        source: route.source ?? domain.source,
      });
    }
  }

  // --- Inferred dependencies --------------------------------------------
  const inferredPairs = new Set<string>();
  const explicitPairs = new Set(
    dependencies
      .filter((dependency) => dependency.type === "DEPENDS_ON")
      .map((dependency) => `${dependency.from}\u0000${dependency.to}`),
  );
  for (const service of services) {
    for (const key of service.environmentKeys) {
      const category = inferCategoryForKey(key);
      if (!category) continue;
      const candidates = services.filter((candidate) => {
        if (candidate.id === service.id) return false;
        const haystack = `${candidate.name} ${candidate.image ?? ""}`.toLowerCase();
        return category.test(haystack);
      });
      if (candidates.length !== 1) continue;
      const target = candidates[0];
      if (!target) continue;
      const pair = `${service.id}\u0000${target.id}`;
      if (explicitPairs.has(pair) || inferredPairs.has(pair)) continue;
      inferredPairs.add(pair);
      addDependency("DEPENDS_ON", service.id, target.id, {
        kind: "inferred",
        reason: `Environment key "${key}" suggests a dependency on "${target.name}", the only matching service. The variable value was not read.`,
        source: service.source,
      });
    }
  }

  // --- Decisions --------------------------------------------------------
  const decisionsLoad = await loadDecisions({
    root: options.root,
    directory: options.decisionsDirectory,
    maxFileSizeBytes: options.maxFileSizeBytes,
    maxFiles: Math.min(options.maxFiles, 500),
  });
  warnings.push(...decisionsLoad.warnings);
  files.push(...decisionsLoad.files);

  const decisions = decisionsLoad.decisions.map((loaded) => {
    const related = new Set<string>();
    const unresolved = new Set<string>();
    for (const name of loaded.relatedServiceNames) {
      const candidates =
        serviceNameIndex.get(name.toLowerCase()) ??
        serviceNameIndex.get(normalizedServiceName(name)) ??
        [];
      if (candidates.length === 1 && candidates[0]) {
        related.add(candidates[0].id);
      } else {
        unresolved.add(name);
        warnings.push(
          makeWarning({
            definition: DIAGNOSTICS.DECISION_RELATED_SERVICE_MISSING,
            message:
              candidates.length > 1
                ? `Decision "${loaded.file.id}" references "${name}", which matches multiple services.`
                : `Decision "${loaded.file.id}" references "${name}", which is not a scanned service.`,
            related: [ids.decision(loaded.file.id)],
            source: loaded.source,
            suggestion: "Update related_services or scan the missing service.",
          }),
        );
      }
    }
    return {
      id: ids.decision(loaded.file.id),
      title: loaded.file.title,
      status: loaded.file.status,
      date: loaded.file.date,
      context: loaded.file.context,
      decision: loaded.file.decision,
      consequences: loaded.file.consequences,
      relatedServices: [...related].sort(),
      unresolvedRelatedServices: [...unresolved].sort(),
      source: loaded.source,
    };
  });

  // --- Warnings from parsers -------------------------------------------
  for (const composeFile of composeFiles) {
    const related = fileServiceIds.get(composeFile.relativePath) ?? [];
    for (const parserIssue of composeFile.result.issues) {
      warnings.push(parseIssueToWarning(parserIssue, composeFile.relativePath, related));
    }
  }
  for (const nginxFile of nginxFiles) {
    const related = fileDomainIds.get(nginxFile.relativePath) ?? [];
    for (const parserIssue of nginxFile.result.issues) {
      warnings.push(parseIssueToWarning(parserIssue, nginxFile.relativePath, related));
    }
  }
  for (const caddyFile of caddyFiles) {
    const related = fileDomainIds.get(caddyFile.relativePath) ?? [];
    for (const parserIssue of caddyFile.result.issues) {
      warnings.push(parseIssueToWarning(parserIssue, caddyFile.relativePath, related));
    }
  }

  warnings.push(...analyzePorts(services));
  warnings.push(...analyzeBackups([...volumes.values()]));

  for (const backup of options.backups) {
    if (!usedBackupVolumes.has(backup.volume)) {
      warnings.push(
        makeWarning({
          definition: DIAGNOSTICS.BACKUP_VOLUME_UNKNOWN,
          message: `Backup policy for volume "${backup.volume}" does not match any declared or mounted volume.`,
          suggestion: "Check the volume name in the backups section of infrajournal.yml.",
        }),
      );
    }
  }

  // --- Graph and snapshot ----------------------------------------------
  const allDependencies = mergeDependencies(dependencies);
  const graphNodes = buildGraphNodes({
    services,
    networks: [...networks.values()],
    volumes: [...volumes.values()],
    domains: [...domains.values()],
    endpoints: [...endpoints.values()],
    external: [...external.values()],
  });

  const dedupedWarnings = dedupeWarnings(warnings);
  const warningCounts = {
    info: dedupedWarnings.filter((warning) => warning.severity === "INFO").length,
    warning: dedupedWarnings.filter((warning) => warning.severity === "WARNING").length,
    error: dedupedWarnings.filter((warning) => warning.severity === "ERROR").length,
  };
  const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()];

  const content: SnapshotContent = {
    schemaVersion: "1.0.0",
    project: {
      id: ids.project(options.projectName),
      name: options.projectName,
      composeProjects: [...composeProjects],
    },
    services,
    networks: [...networks.values()],
    volumes: [...volumes.values()],
    domains: [...domains.values()],
    endpoints: [...endpoints.values()],
    external: [...external.values()],
    dependencies: allDependencies,
    graphNodes,
    warnings: dedupedWarnings,
    decisions,
    files: uniqueFiles,
    stats: {
      services: services.length,
      networks: networks.size,
      volumes: volumes.size,
      domains: domains.size,
      endpoints: endpoints.size,
      dependencies: allDependencies.length,
      files: uniqueFiles.length,
      warnings: warningCounts,
    },
  };

  return buildSnapshot(content, {
    generator: "InfraJournal",
    generatorVersion: options.generatorVersion ?? CORE_VERSION,
    generatedAt: (options.now ?? new Date()).toISOString(),
  });
}

// Keep the discovered file type exported through the scan module for tooling.
export type { DiscoveredFile };
export type { DiagnosticDefinition };
