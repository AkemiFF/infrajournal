import type {
  Dependency,
  Domain,
  Endpoint,
  ExternalDependency,
  GraphNode,
  Network,
  Service,
  Volume,
} from "../model/schema.js";

export interface GraphResources {
  services: Service[];
  networks: Network[];
  volumes: Volume[];
  domains: Domain[];
  endpoints: Endpoint[];
  external: ExternalDependency[];
}

export function buildGraphNodes(resources: GraphResources): GraphNode[] {
  const nodes: GraphNode[] = [];

  for (const service of resources.services) {
    const sublabel = service.image
      ? service.image
      : service.build
        ? "built from source"
        : "compose service";
    nodes.push({ id: service.id, kind: "service", label: service.name, sublabel });
  }
  for (const network of resources.networks) {
    nodes.push({
      id: network.id,
      kind: "network",
      label: network.name,
      sublabel: network.external ? "external network" : `${network.driver ?? "bridge"} network`,
    });
  }
  for (const volume of resources.volumes) {
    nodes.push({
      id: volume.id,
      kind: "volume",
      label: volume.name,
      sublabel: volume.external ? "external volume" : "named volume",
    });
  }
  for (const domain of resources.domains) {
    nodes.push({
      id: domain.id,
      kind: "domain",
      label: domain.name,
      sublabel: `${domain.proxy}${domain.tls ? " · TLS" : ""}`,
    });
  }
  for (const endpoint of resources.endpoints) {
    nodes.push({
      id: endpoint.id,
      kind: "endpoint",
      label: `${endpoint.port ?? endpoint.name}/${endpoint.transport}`,
      sublabel: endpoint.published ? `published ${endpoint.published}` : "container endpoint",
    });
  }
  for (const external of resources.external) {
    nodes.push({
      id: external.id,
      kind: "external",
      label: external.name,
      sublabel: external.category === "upstream" ? "external upstream" : "external file",
    });
  }

  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

const EVIDENCE_PRIORITY = { explicit: 3, implicit: 2, inferred: 1 } as const;

/**
 * Deduplicate edges and prefer the strongest evidence when the same edge is
 * discovered through multiple sources. Explicit facts always beat inference.
 */
export function mergeDependencies(dependencies: Dependency[]): Dependency[] {
  const byId = new Map<string, Dependency>();
  for (const dependency of dependencies) {
    const existing = byId.get(dependency.id);
    if (
      !existing ||
      EVIDENCE_PRIORITY[dependency.evidence.kind] > EVIDENCE_PRIORITY[existing.evidence.kind]
    ) {
      byId.set(dependency.id, dependency);
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
