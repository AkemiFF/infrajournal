import type { DiagnosticDefinition } from "../diagnostics/warnings.js";
import type { BuildReference, PortMapping } from "../model/schema.js";

export interface ParserIssue {
  definition: DiagnosticDefinition;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface ComposeServiceDraft {
  name: string;
  line?: number;
  image?: string;
  build?: BuildReference;
  ports: PortMapping[];
  networkNames: string[];
  /** True when no network_mode was set and Compose would attach the default network. */
  usesDefaultNetwork: boolean;
  mounts: Array<{
    type: "named" | "bind" | "anonymous";
    source?: string;
    target: string;
    readOnly: boolean;
    line?: number;
  }>;
  dependsOnNames: string[];
  healthcheck: boolean;
  restart?: string;
  environmentKeys: string[];
  envFiles: string[];
  labelKeys: string[];
  interpolatedFields: string[];
}

export interface ComposeNetworkDraft {
  name: string;
  line?: number;
  driver?: string;
  external: boolean;
}

export interface ComposeVolumeDraft {
  name: string;
  line?: number;
  driver?: string;
  external: boolean;
  backupLabel?: string;
}

export interface ComposeParseResult {
  composeProject: string;
  services: ComposeServiceDraft[];
  networks: ComposeNetworkDraft[];
  volumes: ComposeVolumeDraft[];
  issues: ParserIssue[];
}

export interface NginxRouteDraft {
  path?: string;
  upstream: string;
  line?: number;
}

export interface NginxServerDraft {
  serverNames: string[];
  listens: string[];
  tls: boolean;
  routes: NginxRouteDraft[];
  line?: number;
}

export interface NginxParseResult {
  servers: NginxServerDraft[];
  upstreams: Map<string, Array<{ target: string; line?: number }>>;
  issues: ParserIssue[];
}

export interface CaddyRouteDraft {
  path?: string;
  upstream: string;
  line?: number;
}

export interface CaddySiteDraft {
  addresses: string[];
  tls: boolean;
  routes: CaddyRouteDraft[];
  line?: number;
}

export interface CaddyParseResult {
  sites: CaddySiteDraft[];
  issues: ParserIssue[];
}

export function issue(
  definition: DiagnosticDefinition,
  message: string,
  options: { line?: number; column?: number; suggestion?: string } = {},
): ParserIssue {
  return {
    definition,
    message,
    ...(options.line !== undefined ? { line: options.line } : {}),
    ...(options.column !== undefined ? { column: options.column } : {}),
    ...(options.suggestion !== undefined ? { suggestion: options.suggestion } : {}),
  };
}
