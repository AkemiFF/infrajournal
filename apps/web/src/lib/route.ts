export const PAGE_DEFINITIONS = [
  {
    id: "overview",
    label: "Overview",
    shortLabel: "Overview",
    description: "Snapshot health, inventory and the files InfraJournal read.",
  },
  {
    id: "architecture",
    label: "Architecture map",
    shortLabel: "Architecture",
    description: "Explore services, networks, volumes and routing as one graph.",
  },
  {
    id: "services",
    label: "Services",
    shortLabel: "Services",
    description: "Compose services, their runtime wiring and recorded warnings.",
  },
  {
    id: "storage",
    label: "Storage",
    shortLabel: "Storage",
    description: "Named volumes, declared backup policies and every mount.",
  },
  {
    id: "domains",
    label: "Domains",
    shortLabel: "Domains",
    description: "Proxy domains, TLS, route paths and resolved upstreams.",
  },
  {
    id: "warnings",
    label: "Warnings",
    shortLabel: "Warnings",
    description: "Diagnostics with source evidence and suggested next steps.",
  },
  {
    id: "decisions",
    label: "Decisions",
    shortLabel: "Decisions",
    description: "Architecture decision records found in the scan.",
  },
] as const;

export type PageId = (typeof PAGE_DEFINITIONS)[number]["id"];

export interface AppRoute {
  page: PageId;
  focus?: string;
}

const PAGE_IDS = new Set<string>(PAGE_DEFINITIONS.map((page) => page.id));

export function pageDefinition(page: PageId) {
  return PAGE_DEFINITIONS.find((definition) => definition.id === page) ?? PAGE_DEFINITIONS[0];
}

export function parseHash(hash: string): AppRoute {
  const raw = hash.replace(/^#/, "");
  const queryStart = raw.indexOf("?");
  const path = queryStart === -1 ? raw : raw.slice(0, queryStart);
  const query = queryStart === -1 ? "" : raw.slice(queryStart + 1);
  const page = PAGE_IDS.has(path) ? (path as PageId) : "overview";
  const focus = new URLSearchParams(query).get("focus") ?? undefined;
  return focus ? { page, focus } : { page };
}

export function buildHash(route: AppRoute): string {
  const params = new URLSearchParams();
  if (route.focus) params.set("focus", route.focus);
  const query = params.toString();
  return `#${route.page}${query ? `?${query}` : ""}`;
}
