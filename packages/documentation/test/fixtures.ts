import {
  buildGraphNodes,
  buildSnapshot,
  type Decision,
  type Dependency,
  type Domain,
  type Endpoint,
  type Network,
  type Service,
  type Snapshot,
  type SnapshotContent,
  type Volume,
  type Warning,
} from "@infrajournal/core";

export const service = (overrides: Partial<Service> = {}): Service => ({
  id: "service:demo:web",
  kind: "service",
  name: "web",
  composeProject: "demo",
  image: "nginx:1.27-alpine",
  ports: [
    { target: "80", published: "8080", protocol: "tcp", source: { file: "compose.yml", line: 4 } },
  ],
  networkIds: ["network:demo:edge"],
  mounts: [
    {
      type: "named",
      source: "uploads",
      target: "/app/uploads",
      readOnly: false,
      volumeId: "volume:demo:uploads",
      sourceLocation: { file: "compose.yml", line: 9 },
    },
  ],
  dependsOn: [],
  healthcheck: true,
  restart: "unless-stopped",
  environmentKeys: ["DATABASE_URL", "SESSION_SECRET"],
  envFiles: [".env"],
  labelKeys: ["com.example.owner"],
  source: { file: "compose.yml", line: 3 },
  evidence: { kind: "explicit", reason: "Declared in Docker Compose." },
  ...overrides,
});

export const network = (overrides: Partial<Network> = {}): Network => ({
  id: "network:demo:edge",
  kind: "network",
  name: "edge",
  composeProject: "demo",
  driver: "bridge",
  external: false,
  implicit: false,
  source: { file: "compose.yml", line: 20 },
  evidence: { kind: "explicit", reason: "Declared in Docker Compose." },
  ...overrides,
});

export const volume = (overrides: Partial<Volume> = {}): Volume => ({
  id: "volume:demo:uploads",
  kind: "volume",
  name: "uploads",
  composeProject: "demo",
  external: false,
  implicit: false,
  backup: { policy: "Nightly snapshot.", source: "config" },
  source: { file: "compose.yml", line: 22 },
  evidence: { kind: "explicit", reason: "Declared in Docker Compose." },
  ...overrides,
});

export const domain = (overrides: Partial<Domain> = {}): Domain => ({
  id: "domain:app.example.com",
  kind: "domain",
  name: "app.example.com",
  proxy: "nginx",
  tls: true,
  routes: [
    {
      path: "/",
      upstream: "web:80",
      serviceId: "service:demo:web",
      source: { file: "nginx/app.conf", line: 8 },
    },
  ],
  source: { file: "nginx/app.conf", line: 2 },
  evidence: { kind: "explicit", reason: "Declared in nginx configuration." },
  ...overrides,
});

export const endpoint = (overrides: Partial<Endpoint> = {}): Endpoint => ({
  id: "endpoint:service:demo:web:tcp-80",
  kind: "endpoint",
  name: "web:80",
  transport: "tcp",
  port: "80",
  serviceId: "service:demo:web",
  published: "8080",
  source: { file: "compose.yml", line: 5 },
  ...overrides,
});

export const warning = (overrides: Partial<Warning> = {}): Warning => ({
  id: "warning:IJ008:abc123def456",
  code: "IJ008",
  severity: "INFO",
  message: "Service web publishes host port 8080.",
  related: ["service:demo:web"],
  source: { file: "compose.yml", line: 5 },
  suggestion: "Confirm that this port should be reachable from the host.",
  ...overrides,
});

export const dependency = (overrides: Partial<Dependency> = {}): Dependency => ({
  id: "edge:DEPENDS_ON:abc123",
  type: "DEPENDS_ON",
  from: "service:demo:web",
  to: "network:demo:edge",
  evidence: { kind: "explicit", reason: "Explicit dependency." },
  ...overrides,
});

export const decision = (overrides: Partial<Decision> = {}): Decision => ({
  id: "decision:adr-001",
  title: "Use PostgreSQL",
  status: "accepted",
  date: "2026-10-12",
  context: "Shared persistent data is required.",
  decision: "Use PostgreSQL 16.",
  consequences: ["Backups are required."],
  relatedServices: ["service:demo:web"],
  unresolvedRelatedServices: [],
  source: { file: "infra-decisions/adr-001.yml" },
  ...overrides,
});

export function makeContent(overrides: Partial<SnapshotContent> = {}): SnapshotContent {
  const services = overrides.services ?? [service()];
  const networks = overrides.networks ?? [network()];
  const volumes = overrides.volumes ?? [volume()];
  const domains = overrides.domains ?? [domain()];
  const endpoints = overrides.endpoints ?? [endpoint()];
  const external = overrides.external ?? [];
  return {
    schemaVersion: "1.0.0",
    project: { id: "project:demo", name: "demo", composeProjects: ["demo"] },
    services,
    networks,
    volumes,
    domains,
    endpoints,
    external,
    dependencies: overrides.dependencies ?? [dependency()],
    graphNodes:
      overrides.graphNodes ??
      buildGraphNodes({ services, networks, volumes, domains, endpoints, external }),
    warnings: overrides.warnings ?? [warning()],
    decisions: overrides.decisions ?? [decision()],
    files: overrides.files ?? [
      { path: "compose.yml", kind: "compose", bytes: 500 },
      { path: "nginx/app.conf", kind: "nginx", bytes: 120 },
    ],
    stats: {
      services: 0,
      networks: 0,
      volumes: 0,
      domains: 0,
      endpoints: 0,
      dependencies: 0,
      files: 0,
      warnings: { info: 0, warning: 0, error: 0 },
    },
    ...overrides,
  };
}

export function makeSnapshot(
  overrides: Partial<SnapshotContent> = {},
  generatedAt = "2026-11-03T10:00:00.000Z",
): Snapshot {
  const content = makeContent(overrides);
  return buildSnapshot(content, {
    generator: "InfraJournal",
    generatorVersion: "0.1.0",
    generatedAt,
  });
}
