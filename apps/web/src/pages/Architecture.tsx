import { useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Snapshot, ResourceKind } from "@infrajournal/core";
import { Boxes, Database, Globe2, HardDrive, Link2, Network, Waypoints } from "lucide-react";
import type { PageId } from "../lib/route";

const kinds: ResourceKind[] = ["service", "network", "volume", "domain", "endpoint", "external"];
const colors: Record<ResourceKind, string> = {
  service: "var(--ij-accent)",
  network: "var(--ij-info)",
  volume: "var(--ij-warn)",
  domain: "var(--ij-good)",
  endpoint: "var(--ij-rose)",
  external: "var(--ij-faint)",
};
const icons = {
  service: Boxes,
  network: Network,
  volume: Database,
  domain: Globe2,
  endpoint: Waypoints,
  external: Link2,
};
type Data = {
  label: string;
  sublabel?: string;
  kind: ResourceKind;
  warnings: number;
  focus: "selected" | "connected" | "";
  dimmed: boolean;
  match: boolean;
};
function ResourceNode({ data }: NodeProps<Node<Data>>) {
  const Icon = icons[data.kind];
  return (
    <div
      className="flow-node"
      style={{ "--node-accent": colors[data.kind] } as React.CSSProperties}
      data-focus={data.focus}
      data-dimmed={data.dimmed}
      data-search-match={data.match}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-icon">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flow-node-kind">{data.kind}</div>
        <div className="flow-node-label" title={data.label}>
          {data.label}
        </div>
        <div className="flow-node-sublabel">{data.sublabel}</div>
      </div>
      {data.warnings > 0 && <span className="flow-node-warning">{data.warnings}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { resource: ResourceNode };

export function Architecture({
  snapshot,
  focus,
  navigate,
}: {
  snapshot: Snapshot;
  focus?: string;
  navigate: (page: PageId, focus?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const visible = useMemo(
    () =>
      snapshot.graphNodes.filter(
        (node) =>
          (kind === "all" || node.kind === kind) &&
          `${node.label} ${node.id}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [snapshot.graphNodes, kind, query],
  );
  const layout = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: 44, ranksep: 110, marginx: 48, marginy: 48 });
    graph.setDefaultEdgeLabel(() => ({}));
    const ids = new Set(visible.map((node) => node.id));
    visible.forEach((node) => graph.setNode(node.id, { width: 232, height: 76 }));
    snapshot.dependencies
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .forEach((edge) => graph.setEdge(edge.from, edge.to));
    dagre.layout(graph);
    return graph;
  }, [visible, snapshot.dependencies]);
  const connections = new Set(
    snapshot.dependencies
      .filter((edge) => edge.from === selected || edge.to === selected)
      .flatMap((edge) => [edge.from, edge.to]),
  );
  const nodes: Node<Data>[] = visible.map((node) => {
    const point = layout.node(node.id) as { x: number; y: number };
    return {
      id: node.id,
      type: "resource",
      position: { x: point.x - 116, y: point.y - 38 },
      data: {
        label: node.label,
        sublabel: node.sublabel,
        kind: node.kind,
        warnings: snapshot.warnings.filter((warning) => warning.related.includes(node.id)).length,
        focus: selected === node.id ? "selected" : connections.has(node.id) ? "connected" : "",
        dimmed: !!selected && !connections.has(node.id),
        match: !!query,
      },
      draggable: false,
    };
  });
  const ids = new Set(visible.map((node) => node.id));
  const edges: Edge[] = snapshot.dependencies
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.type.replaceAll("_", " ").toLowerCase(),
      animated: false,
      style: {
        stroke: "var(--ij-line-strong)",
        strokeWidth: selected && (edge.from === selected || edge.to === selected) ? 2.5 : 1.5,
        strokeDasharray: edge.evidence.kind === "inferred" ? "6 5" : undefined,
        opacity: selected && edge.from !== selected && edge.to !== selected ? 0.18 : 1,
      },
      labelStyle: { fill: "var(--ij-muted)" },
    }));
  const resource = snapshot.graphNodes.find((node) => node.id === selected);
  const service = snapshot.services.find((node) => node.id === selected);
  const relation = snapshot.dependencies.filter(
    (edge) => edge.from === selected || edge.to === selected,
  );
  const source =
    snapshot.services.find((node) => node.id === selected)?.source ??
    snapshot.networks.find((node) => node.id === selected)?.source ??
    snapshot.volumes.find((node) => node.id === selected)?.source ??
    snapshot.domains.find((node) => node.id === selected)?.source ??
    snapshot.endpoints.find((node) => node.id === selected)?.source ??
    snapshot.external.find((node) => node.id === selected)?.source;
  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <label className="sr-only" htmlFor="node-search">
          Search nodes
        </label>
        <input
          id="node-search"
          type="search"
          value={query}
          placeholder="Search nodes or IDs…"
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-40 flex-1 rounded-lg border border-line bg-canvas-2 px-4 py-2.5 text-sm text-ink placeholder:text-faint"
        />
        <label className="sr-only" htmlFor="node-kind">
          Node kind
        </label>
        <select
          id="node-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="rounded-lg border border-line bg-elevated px-3 py-2.5 text-sm"
        >
          <option value="all">All kinds</option>
          {kinds.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className="mono text-xs text-muted">
          Showing {visible.length} {kind === "all" ? "nodes" : kind} / {snapshot.graphNodes.length}
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Architecture graph" className="panel min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="eyebrow">Topology / {snapshot.dependencies.length} edges</div>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted">
              {kinds.map((value) => (
                <span key={value} className="capitalize">
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full"
                    style={{ background: colors[value] }}
                  />
                  {value}
                </span>
              ))}
            </div>
          </div>
          {visible.length ? (
            <div className="graph-shell h-[min(70vh,700px)] min-h-[420px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.12}
                maxZoom={2}
                onNodeClick={(_, node) => setSelected(node.id)}
                onPaneClick={() => setSelected(null)}
                nodesDraggable={false}
                colorMode={document.documentElement.dataset.theme === "light" ? "light" : "dark"}
              >
                <Background color="var(--ij-line-strong)" gap={22} size={1} />
                <MiniMap pannable zoomable nodeColor={(node) => colors[(node.data as Data).kind]} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          ) : (
            <div className="grid min-h-96 place-items-center text-sm text-muted">
              {snapshot.graphNodes.length
                ? "No matching nodes. Try another search or kind."
                : "No graph nodes discovered."}
            </div>
          )}
        </section>
        <aside className="panel h-fit min-w-0 p-5" aria-label="Node details">
          {resource ? (
            <>
              <div className="eyebrow text-accent">{resource.kind} / evidence</div>
              <h3 className="mt-3 text-xl font-semibold">{resource.label}</h3>
              <code className="mono mt-2 block break-all text-xs text-muted">{resource.id}</code>
              <p className="mono mt-5 break-all text-xs text-muted">
                Source:{" "}
                {source ? `${source.file}${source.line ? `:${source.line}` : ""}` : "Not recorded"}
              </p>
              {service && (
                <div className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
                  <p>
                    Image / build:{" "}
                    <span className="mono">
                      {service.image ?? service.build?.context ?? "Not recorded"}
                    </span>
                  </p>
                  <p>
                    Ports:{" "}
                    {service.ports
                      .map(
                        (port) =>
                          `${port.published ? `${port.published} → ` : ""}${port.target}/${port.protocol}`,
                      )
                      .join(", ") || "None"}
                  </p>
                  <p>
                    Mounts:{" "}
                    {service.mounts
                      .map((mount) => `${mount.source ?? "anonymous"} → ${mount.target}`)
                      .join(", ") || "None"}
                  </p>
                  <p>
                    Explicit dependencies:{" "}
                    {service.dependsOn
                      .map((id) => snapshot.services.find((entry) => entry.id === id)?.name ?? id)
                      .join(", ") || "None"}
                  </p>
                  <button
                    className="text-accent hover:underline"
                    onClick={() => navigate("services", service.id)}
                  >
                    Open service details →
                  </button>
                </div>
              )}
              <div className="mt-5 border-t border-line pt-5">
                <h4 className="eyebrow mb-3">Connections · {relation.length}</h4>
                {relation.map((edge) => (
                  <div key={edge.id} className="mb-3 rounded-lg border border-line p-3 text-xs">
                    <div className="mono break-all">
                      {edge.type}:{" "}
                      {snapshot.graphNodes.find(
                        (node) => node.id === (edge.from === selected ? edge.to : edge.from),
                      )?.label ?? (edge.from === selected ? edge.to : edge.from)}
                    </div>
                    <div className="mt-2 text-muted">
                      {edge.evidence.kind}
                      {edge.evidence.reason ? ` · ${edge.evidence.reason}` : ""}
                      {edge.evidence.source
                        ? ` · ${edge.evidence.source.file}${edge.evidence.source.line ? `:${edge.evidence.source.line}` : ""}`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-line pt-5">
                <h4 className="eyebrow mb-3">Related warnings</h4>
                {snapshot.warnings
                  .filter((warning) => warning.related.includes(resource.id))
                  .map((warning) => (
                    <p className="mb-2 text-xs text-warn" key={warning.id}>
                      {warning.code}: {warning.message}
                    </p>
                  ))}
                {!snapshot.warnings.some((warning) => warning.related.includes(resource.id)) && (
                  <p className="text-xs text-muted">None recorded.</p>
                )}
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted">
              <HardDrive className="mx-auto mb-3 text-accent" size={24} />
              Select a node for source evidence, connections and warnings.
            </div>
          )}
        </aside>
      </div>
      <div className="panel p-4">
        <div className="eyebrow mb-3">Node index · keyboard accessible</div>
        <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
          {visible.map((node) => (
            <button
              key={node.id}
              aria-label={`Inspect ${node.label}`}
              onClick={() => setSelected(node.id)}
              className={`rounded-md border px-2 py-1 text-xs hover:border-accent ${selected === node.id ? "border-accent text-accent" : "border-line text-muted"}`}
            >
              {node.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mono text-xs text-muted">
        Solid edges = explicit or implicit evidence · Dashed edges = inferred evidence · Pan to
        explore, scroll to zoom.
      </p>
    </div>
  );
}
