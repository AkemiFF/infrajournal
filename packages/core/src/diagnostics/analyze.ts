import { DIAGNOSTICS, makeWarning } from "./warnings.js";
import type { Service, Volume, Warning } from "../model/schema.js";

function isLoopback(hostIp: string | undefined): boolean {
  if (!hostIp) return false;
  const value = hostIp.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}

function formatPorts(service: Service): string {
  return service.ports
    .map((port) => {
      const host = port.hostIp ? `${port.hostIp}:` : "";
      const published = port.published ? `${port.published}->` : "";
      return `${host}${published}${port.target}/${port.protocol}`;
    })
    .join(", ");
}

export function analyzePorts(services: Service[]): Warning[] {
  const warnings: Warning[] = [];

  for (const service of services) {
    const published = service.ports.filter((port) => port.published);
    if (published.length === 0) continue;
    const externallyReachable = published.some((port) => !isLoopback(port.hostIp));
    if (!externallyReachable) continue;
    warnings.push(
      makeWarning({
        definition: DIAGNOSTICS.SERVICE_EXPOSED_PORT,
        message: `Service "${service.name}" publishes host ports (${formatPorts(service)}). Confirm this exposure is intentional and firewalled.`,
        related: [service.id],
        source: service.source,
        suggestion: "Bind to 127.0.0.1 when a host port is only needed locally.",
      }),
    );
  }

  const bindings = new Map<string, Array<{ service: Service; display: string }>>();
  for (const service of services) {
    for (const port of service.ports) {
      if (!port.published) continue;
      const key = `${port.hostIp ?? "*"}:${port.published}/${port.protocol}`;
      const entries = bindings.get(key) ?? [];
      entries.push({
        service,
        display: `${port.hostIp ?? "*"}:${port.published}->${port.target}/${port.protocol}`,
      });
      bindings.set(key, entries);
    }
  }

  for (const [key, entries] of bindings) {
    if (entries.length < 2) continue;
    const services = [...new Set(entries.map((entry) => entry.service))];
    const names = services.map((service) => service.name).sort();
    warnings.push(
      makeWarning({
        definition: DIAGNOSTICS.DUPLICATE_PORT_BINDING,
        message: `Multiple containers publish the same host binding ${key} (${names.join(", ")}).`,
        related: services.map((service) => service.id).sort(),
        source: services[0]?.source,
        suggestion: "Publish each host port from only one service.",
      }),
    );
  }

  return warnings;
}

export function analyzeBackups(volumes: Volume[]): Warning[] {
  const warnings: Warning[] = [];
  for (const volume of volumes) {
    if (volume.backup) continue;
    warnings.push(
      makeWarning({
        definition: DIAGNOSTICS.VOLUME_BACKUP_NOT_DOCUMENTED,
        message: `Named volume "${volume.name}" has no documented backup policy. This does not prove that no backup exists.`,
        related: [volume.id],
        ...(volume.source ? { source: volume.source } : {}),
        suggestion:
          "Add a backups entry in infrajournal.yml or an infrajournal.backup label on the volume.",
      }),
    );
  }
  return warnings;
}
