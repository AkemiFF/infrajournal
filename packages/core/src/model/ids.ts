import { createHash } from "node:crypto";

/** Produce a deterministic, filesystem-safe identifier component. */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (slug.length > 0) return slug;
  return `x-${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

export const ids = {
  project: (name: string) => `project:${slugify(name)}`,
  service: (composeProject: string, name: string) =>
    `service:${slugify(composeProject)}:${slugify(name)}`,
  network: (composeProject: string, name: string) =>
    `network:${slugify(composeProject)}:${slugify(name)}`,
  volume: (composeProject: string, name: string) =>
    `volume:${slugify(composeProject)}:${slugify(name)}`,
  domain: (host: string) => `domain:${slugify(host)}`,
  endpoint: (serviceId: string, protocol: string, port: string) =>
    `endpoint:${serviceId}:${protocol}-${slugify(port)}`,
  external: (host: string) => `external:${slugify(host)}`,
  decision: (decisionId: string) => `decision:${slugify(decisionId)}`,
  dependency: (type: string, from: string, to: string) =>
    `edge:${type}:${createHash("sha256").update(`${from}\u0000${to}`).digest("hex").slice(0, 16)}`,
  warning: (code: string, location: string, message: string) =>
    `warning:${code}:${createHash("sha256").update(`${location}\u0000${message}`).digest("hex").slice(0, 12)}`,
} as const;

export function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}
