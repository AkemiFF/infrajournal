import { z } from "zod";

/**
 * Version of the exported snapshot contract. Bump the major version for
 * breaking changes and document migrations in docs/architecture.md.
 */
export const SNAPSHOT_SCHEMA_VERSION = "1.0.0" as const;

export const resourceKindSchema = z.enum([
  "service",
  "network",
  "volume",
  "domain",
  "endpoint",
  "external",
]);

export type ResourceKind = z.infer<typeof resourceKindSchema>;

export const evidenceKindSchema = z.enum(["explicit", "inferred", "implicit"]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const sourceLocationSchema = z.strictObject({
  /** POSIX path relative to the scan root. Never an absolute machine path. */
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

export const evidenceSchema = z.strictObject({
  kind: evidenceKindSchema,
  reason: z.string().min(1).optional(),
  source: sourceLocationSchema.optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const idSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9:_./@-]*$/i, {
    message: "IDs must contain only letters, numbers and : _ . / @ - characters",
  });

export const portProtocolSchema = z.enum(["tcp", "udp"]);
export type PortProtocol = z.infer<typeof portProtocolSchema>;

export const portMappingSchema = z.strictObject({
  /** Container-side port, e.g. "3000" or "8000-8010". */
  target: z.string().min(1),
  /** Host-side port when one is published. */
  published: z.string().min(1).optional(),
  hostIp: z.string().min(1).optional(),
  protocol: portProtocolSchema,
  source: sourceLocationSchema.optional(),
});
export type PortMapping = z.infer<typeof portMappingSchema>;

export const buildReferenceSchema = z.strictObject({
  context: z.string().min(1),
  dockerfile: z.string().min(1).optional(),
});
export type BuildReference = z.infer<typeof buildReferenceSchema>;

export const volumeMountSchema = z.strictObject({
  type: z.enum(["named", "bind", "anonymous"]),
  /** Named volume name or bind source path as written in the source file. */
  source: z.string().min(1).optional(),
  target: z.string().min(1),
  readOnly: z.boolean(),
  /** Resolved named-volume ID when applicable. */
  volumeId: idSchema.optional(),
  sourceLocation: sourceLocationSchema.optional(),
});
export type VolumeMount = z.infer<typeof volumeMountSchema>;

export const serviceSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("service"),
  name: z.string().min(1),
  composeProject: z.string().min(1),
  image: z.string().min(1).optional(),
  build: buildReferenceSchema.optional(),
  ports: z.array(portMappingSchema),
  networkIds: z.array(idSchema),
  mounts: z.array(volumeMountSchema),
  /** Explicit `depends_on` service IDs only. Inferred edges live in dependencies. */
  dependsOn: z.array(idSchema),
  healthcheck: z.boolean(),
  restart: z.string().min(1).optional(),
  /** Environment variable names only. Values are deliberately never stored. */
  environmentKeys: z.array(z.string()),
  /** Referenced paths only. env_file contents are never read. */
  envFiles: z.array(z.string()),
  /** Label names only. Values are deliberately not stored except backup policies. */
  labelKeys: z.array(z.string()),
  source: sourceLocationSchema,
  evidence: evidenceSchema,
});
export type Service = z.infer<typeof serviceSchema>;

export const networkSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("network"),
  name: z.string().min(1),
  composeProject: z.string().min(1).optional(),
  driver: z.string().min(1).optional(),
  external: z.boolean(),
  /** True when Docker Compose creates this network implicitly. */
  implicit: z.boolean(),
  source: sourceLocationSchema.optional(),
  evidence: evidenceSchema,
});
export type Network = z.infer<typeof networkSchema>;

export const backupPolicySchema = z.strictObject({
  policy: z.string().min(1),
  source: z.enum(["config", "label"]),
});
export type BackupPolicy = z.infer<typeof backupPolicySchema>;

export const volumeSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("volume"),
  name: z.string().min(1),
  composeProject: z.string().min(1).optional(),
  driver: z.string().min(1).optional(),
  external: z.boolean(),
  implicit: z.boolean(),
  backup: backupPolicySchema.optional(),
  source: sourceLocationSchema.optional(),
  evidence: evidenceSchema,
});
export type Volume = z.infer<typeof volumeSchema>;

export const domainRouteSchema = z.strictObject({
  path: z.string().min(1).optional(),
  /** Upstream exactly as expressed in the supported configuration subset. */
  upstream: z.string().min(1),
  serviceId: idSchema.optional(),
  externalId: idSchema.optional(),
  source: sourceLocationSchema.optional(),
});
export type DomainRoute = z.infer<typeof domainRouteSchema>;

export const domainSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("domain"),
  name: z.string().min(1),
  proxy: z.enum(["nginx", "caddy"]),
  tls: z.boolean(),
  routes: z.array(domainRouteSchema),
  source: sourceLocationSchema,
  evidence: evidenceSchema,
});
export type Domain = z.infer<typeof domainSchema>;

export const endpointSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("endpoint"),
  name: z.string().min(1),
  transport: z.enum(["tcp", "udp", "http", "https"]),
  port: z.string().min(1).optional(),
  serviceId: idSchema.optional(),
  published: z.string().min(1).optional(),
  hostIp: z.string().min(1).optional(),
  source: sourceLocationSchema.optional(),
});
export type Endpoint = z.infer<typeof endpointSchema>;

export const externalSchema = z.strictObject({
  id: idSchema,
  kind: z.literal("external"),
  name: z.string().min(1),
  category: z.enum(["upstream", "file"]),
  detail: z.string().min(1).optional(),
  source: sourceLocationSchema.optional(),
});
export type ExternalDependency = z.infer<typeof externalSchema>;

export const dependencyTypeSchema = z.enum([
  "DEPENDS_ON",
  "CONNECTED_TO",
  "MOUNTS",
  "EXPOSES",
  "ROUTES_TO",
  "REFERENCES",
]);
export type DependencyType = z.infer<typeof dependencyTypeSchema>;

export const dependencySchema = z.strictObject({
  id: idSchema,
  type: dependencyTypeSchema,
  from: idSchema,
  to: idSchema,
  evidence: evidenceSchema,
});
export type Dependency = z.infer<typeof dependencySchema>;

export const graphNodeSchema = z.strictObject({
  id: idSchema,
  kind: resourceKindSchema,
  label: z.string().min(1),
  sublabel: z.string().min(1).optional(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const severitySchema = z.enum(["INFO", "WARNING", "ERROR"]);
export type Severity = z.infer<typeof severitySchema>;

export const warningSchema = z.strictObject({
  id: z.string().min(1),
  code: z.string().regex(/^IJ\d{3}$/),
  severity: severitySchema,
  message: z.string().min(1),
  /** IDs of resources this warning applies to, when known. */
  related: z.array(idSchema),
  source: sourceLocationSchema.optional(),
  suggestion: z.string().min(1).optional(),
});
export type Warning = z.infer<typeof warningSchema>;

export const decisionStatusSchema = z.enum(["proposed", "accepted", "deprecated", "superseded"]);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

export const decisionSchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  status: decisionStatusSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)"),
  context: z.string().min(1),
  decision: z.string().min(1),
  consequences: z.array(z.string()),
  /** Resolved service IDs. */
  relatedServices: z.array(idSchema),
  /** Names that could not be resolved to a scanned service. */
  unresolvedRelatedServices: z.array(z.string()),
  source: sourceLocationSchema,
});
export type Decision = z.infer<typeof decisionSchema>;

export const scannedFileSchema = z.strictObject({
  path: z.string().min(1),
  kind: z.enum(["compose", "nginx", "caddy", "decision"]),
  bytes: z.number().int().nonnegative(),
});
export type ScannedFile = z.infer<typeof scannedFileSchema>;

export const projectInfoSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  composeProjects: z.array(z.string()),
});
export type ProjectInfo = z.infer<typeof projectInfoSchema>;

export const snapshotStatsSchema = z.strictObject({
  services: z.number().int().nonnegative(),
  networks: z.number().int().nonnegative(),
  volumes: z.number().int().nonnegative(),
  domains: z.number().int().nonnegative(),
  endpoints: z.number().int().nonnegative(),
  dependencies: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  warnings: z.strictObject({
    info: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
});
export type SnapshotStats = z.infer<typeof snapshotStatsSchema>;

export const snapshotMetadataSchema = z.strictObject({
  generator: z.literal("InfraJournal"),
  generatorVersion: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  /** SHA-256 of the snapshot content, excluding this metadata block. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SnapshotMetadata = z.infer<typeof snapshotMetadataSchema>;

export const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  project: projectInfoSchema,
  services: z.array(serviceSchema),
  networks: z.array(networkSchema),
  volumes: z.array(volumeSchema),
  domains: z.array(domainSchema),
  endpoints: z.array(endpointSchema),
  external: z.array(externalSchema),
  dependencies: z.array(dependencySchema),
  graphNodes: z.array(graphNodeSchema),
  warnings: z.array(warningSchema),
  decisions: z.array(decisionSchema),
  files: z.array(scannedFileSchema),
  stats: snapshotStatsSchema,
  metadata: snapshotMetadataSchema,
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type SnapshotContent = Omit<Snapshot, "metadata">;

export const decisionFileSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "Decision IDs must be filename-safe identifiers"),
  title: z.string().min(1),
  status: decisionStatusSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)"),
  context: z.string().min(1),
  decision: z.string().min(1),
  consequences: z.array(z.string()).default([]),
  related_services: z.array(z.string()).default([]),
});
export type DecisionFile = z.infer<typeof decisionFileSchema>;
