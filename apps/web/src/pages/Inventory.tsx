import { useState } from "react";
import type { Snapshot, SourceLocation } from "@infrajournal/core";
import { ArrowRight, FileText, HardDrive, Info, ShieldAlert } from "lucide-react";
import type { PageId } from "../lib/route";

type Props = {
  snapshot: Snapshot;
  page: PageId;
  focus?: string;
  navigate: (page: PageId, focus?: string) => void;
};
const sourceText = (source?: SourceLocation) =>
  source ? `${source.file}${source.line ? `:${source.line}` : ""}` : "Not recorded";
const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="mono inline-flex rounded-md border border-line bg-elevated px-2 py-1 text-xs text-muted">
    {children}
  </span>
);
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="panel p-12 text-center text-sm text-muted">{children}</div>
);
const Label = ({ children }: { children: React.ReactNode }) => (
  <h4 className="eyebrow mb-3">{children}</h4>
);
const WarningsFor = ({
  snapshot,
  id,
  navigate,
}: {
  snapshot: Snapshot;
  id: string;
  navigate: Props["navigate"];
}) => {
  const warnings = snapshot.warnings.filter((warning) => warning.related.includes(id));
  return warnings.length ? (
    <div className="mt-5 border-t border-line pt-5">
      <Label>Related warnings</Label>
      {warnings.map((warning) => (
        <button
          className="mb-2 block text-left text-sm text-warn hover:underline"
          key={warning.id}
          onClick={() => navigate("warnings")}
        >
          {warning.code} · {warning.message}
        </button>
      ))}
    </div>
  ) : null;
};

export function Inventory({ snapshot, page, focus, navigate }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [severity, setSeverity] = useState("ALL");
  const selectedService = snapshot.services.find((item) => item.id === selected);

  if (page === "overview") {
    const stats = [
      ["Services", snapshot.stats.services],
      ["Networks", snapshot.stats.networks],
      ["Volumes", snapshot.stats.volumes],
      ["Domains", snapshot.stats.domains],
      ["Warnings", snapshot.warnings.length],
      ["Scanned files", snapshot.stats.files],
    ] as const;
    return (
      <div className="space-y-6">
        <section className="panel relative overflow-hidden p-7 md:p-9">
          <div className="hero-grid pointer-events-none absolute inset-0" />
          <div className="relative">
            <div className="eyebrow text-accent">PROJECT / {snapshot.project.id}</div>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              {snapshot.project.name}
            </h3>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
              A local, source-backed view of your infrastructure. Generated{" "}
              {new Date(snapshot.metadata.generatedAt).toLocaleString()}.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Pill>SHA256 {snapshot.metadata.contentHash.slice(0, 16)}</Pill>
              <Pill>{snapshot.project.composeProjects.length} compose projects</Pill>
            </div>
          </div>
        </section>
        <section aria-label="Snapshot counts" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map(([name, count]) => (
            <div className="panel p-5" key={name}>
              <div className="eyebrow">{name}</div>
              <div className="mt-3 text-3xl font-semibold tabular-nums">{count}</div>
            </div>
          ))}
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="panel p-6">
            <Label>Warning severity</Label>
            <div className="grid grid-cols-3 gap-3">
              {(["error", "warning", "info"] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => navigate("warnings")}
                  className="rounded-lg border border-line bg-elevated p-4 text-left hover:border-accent"
                >
                  <span
                    className={`block text-2xl font-semibold ${key === "error" ? "text-bad" : key === "warning" ? "text-warn" : "text-info"}`}
                  >
                    {snapshot.stats.warnings[key]}
                  </span>
                  <span className="mt-1 block text-xs uppercase text-muted">{key}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel p-6">
            <Label>Explore the snapshot</Label>
            <div className="space-y-2">
              {(["architecture", "services", "storage", "domains", "decisions"] as PageId[]).map(
                (id) => (
                  <button
                    key={id}
                    onClick={() => navigate(id)}
                    className="flex w-full items-center justify-between rounded-lg border border-line px-4 py-2.5 text-left text-sm capitalize hover:border-accent"
                  >
                    {id === "architecture" ? "Architecture map" : id}
                    <ArrowRight size={15} className="text-accent" />
                  </button>
                ),
              )}
            </div>
          </section>
        </div>
        <section className="panel p-6">
          <Label>Scanned source files · {snapshot.files.length}</Label>
          {snapshot.files.length ? (
            <div className="divide-y divide-line">
              {snapshot.files.map((file) => (
                <div key={file.path} className="flex items-center gap-3 py-3 text-sm">
                  <FileText size={16} className="shrink-0 text-accent" />
                  <code className="mono min-w-0 flex-1 break-all">{file.path}</code>
                  <span className="text-xs text-muted">
                    {file.kind} · {file.bytes.toLocaleString()} B
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No source files recorded.</p>
          )}
        </section>
      </div>
    );
  }
  if (page === "services") {
    const matches = snapshot.services.filter((service) =>
      `${service.name} ${service.image ?? ""} ${service.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    return (
      <div className="space-y-5">
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <label className="sr-only" htmlFor="service-search">
            Search services
          </label>
          <input
            id="service-search"
            type="search"
            placeholder="Search services, images or IDs…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas-2 px-4 py-2.5 text-sm text-ink placeholder:text-faint"
          />
          <span className="mono text-xs text-muted">
            {matches.length} / {snapshot.services.length}
          </span>
        </div>
        {!matches.length ? (
          <Empty>{query ? "No matching services." : "No services discovered."}</Empty>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(290px,0.8fr)]">
            <section className="space-y-3" aria-label="Service inventory">
              {matches.map((service) => (
                <button
                  key={service.id}
                  aria-label={`Inspect ${service.name}`}
                  onClick={() => setSelected(service.id)}
                  className={`panel block w-full p-5 text-left hover:border-accent ${selected === service.id ? "!border-accent" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong>{service.name}</strong>
                    <span className="text-xs text-muted">{service.ports.length} ports</span>
                  </div>
                  <code className="mono mt-2 block break-all text-xs text-muted">
                    {service.image ?? service.build?.context ?? "No image or build"}
                  </code>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Pill>{service.healthcheck ? "healthcheck" : "no healthcheck"}</Pill>
                    <Pill>{service.mounts.length} mounts</Pill>
                    <Pill>{service.networkIds.length} networks</Pill>
                  </div>
                </button>
              ))}
            </section>
            {selectedService ? (
              <aside className="panel h-fit p-6" aria-label="Service details">
                <Label>Service details</Label>
                <h3 className="text-xl font-semibold">{selectedService.name}</h3>
                <p className="mono mt-2 break-all text-xs text-muted">{selectedService.id}</p>
                <div className="mt-5 space-y-5 text-sm">
                  <div>
                    <Label>Image / build</Label>
                    {selectedService.image ?? selectedService.build?.context ?? "Not recorded"}
                    {selectedService.build?.dockerfile && (
                      <p className="mono mt-1 text-xs text-muted">
                        {selectedService.build.dockerfile}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>Ports</Label>
                    {selectedService.ports.length
                      ? selectedService.ports.map((port, i) => (
                          <p key={i} className="mono mb-1">
                            {port.published ? `${port.published} → ` : ""}
                            {port.target}/{port.protocol}
                          </p>
                        ))
                      : "No published ports"}
                  </div>
                  <div>
                    <Label>Networks</Label>
                    <div className="flex flex-wrap gap-2">
                      {selectedService.networkIds.map((id) => (
                        <Pill key={id}>
                          {snapshot.networks.find((network) => network.id === id)?.name ?? id}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Volumes / mounts</Label>
                    {selectedService.mounts.map((mount, i) => (
                      <p className="mono mb-2 break-all text-xs" key={i}>
                        {mount.type}: {mount.source ?? "anonymous"} → {mount.target}{" "}
                        {mount.readOnly ? "(read-only)" : ""}
                      </p>
                    ))}
                  </div>
                  <div>
                    <Label>Explicit dependencies</Label>
                    {selectedService.dependsOn.length
                      ? selectedService.dependsOn.map((id) => (
                          <button
                            key={id}
                            className="mr-2 text-accent hover:underline"
                            onClick={() => setSelected(id)}
                          >
                            {snapshot.services.find((service) => service.id === id)?.name ?? id}
                          </button>
                        ))
                      : "None"}
                  </div>
                  <div>
                    <Label>Environment keys</Label>
                    <div className="flex flex-wrap gap-2">
                      {selectedService.environmentKeys.map((key) => (
                        <Pill key={key}>{key}</Pill>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Env file references</Label>
                    {selectedService.envFiles.map((file) => (
                      <p className="mono break-all text-xs" key={file}>
                        {file}
                      </p>
                    ))}
                  </div>
                  <div>
                    <Label>Label keys</Label>
                    <div className="flex flex-wrap gap-2">
                      {selectedService.labelKeys.map((key) => (
                        <Pill key={key}>{key}</Pill>
                      ))}
                    </div>
                  </div>
                  <p>
                    Restart: {selectedService.restart ?? "not specified"} · Healthcheck:{" "}
                    {selectedService.healthcheck ? "declared" : "not declared"}
                  </p>
                  <p className="mono break-all text-xs text-muted">
                    Source: {sourceText(selectedService.source)}
                  </p>
                </div>
                <WarningsFor snapshot={snapshot} id={selectedService.id} navigate={navigate} />
              </aside>
            ) : (
              <aside className="panel grid min-h-40 place-items-center p-5 text-center text-sm text-muted">
                Select a service to inspect its configuration.
              </aside>
            )}
          </div>
        )}
      </div>
    );
  }
  if (page === "storage")
    return (
      <div className="space-y-6">
        <section>
          <h3 className="mb-4 text-lg font-semibold">
            Named volumes <span className="text-sm text-muted">/ {snapshot.volumes.length}</span>
          </h3>
          {snapshot.volumes.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {snapshot.volumes.map((volume) => (
                <article className="panel p-5" key={volume.id}>
                  <div className="flex items-center gap-3">
                    <HardDrive size={18} className="text-accent" />
                    <h4 className="font-semibold">{volume.name}</h4>
                  </div>
                  <p className={`mt-3 text-sm ${volume.backup ? "text-good" : "text-warn"}`}>
                    {volume.backup
                      ? `Backup policy: ${volume.backup.policy} (${volume.backup.source})`
                      : "Backup policy not documented"}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Pill>{volume.external ? "external" : "local"}</Pill>
                    {volume.implicit && <Pill>implicit</Pill>}
                  </div>
                  <p className="mono mt-4 text-xs text-muted">{sourceText(volume.source)}</p>
                  <WarningsFor snapshot={snapshot} id={volume.id} navigate={navigate} />
                </article>
              ))}
            </div>
          ) : (
            <Empty>No named volumes discovered.</Empty>
          )}
        </section>
        <section>
          <h3 className="mb-4 text-lg font-semibold">Service mounts</h3>
          {snapshot.services.flatMap((service) =>
            service.mounts.map((mount, i) => ({ service, mount, i })),
          ).length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {snapshot.services.flatMap((service) =>
                service.mounts.map((mount, i) => (
                  <article className="panel p-5" key={`${service.id}-${i}`}>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        className="font-medium hover:text-accent"
                        onClick={() => navigate("services", service.id)}
                      >
                        {service.name}
                      </button>
                      <Pill>{mount.type}</Pill>
                    </div>
                    <p className="mono mt-3 break-all text-sm">
                      {mount.source ?? "anonymous"} → {mount.target}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {mount.readOnly ? "Read-only" : "Read-write"}
                    </p>
                    <p className="mono mt-3 break-all text-xs text-muted">
                      {sourceText(mount.sourceLocation ?? service.source)}
                    </p>
                  </article>
                )),
              )}
            </div>
          ) : (
            <Empty>No mounts discovered.</Empty>
          )}
        </section>
      </div>
    );
  if (page === "domains")
    return snapshot.domains.length ? (
      <div className="grid gap-4">
        {snapshot.domains.map((domain) => (
          <article className="panel p-6" key={domain.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-semibold">{domain.name}</h3>
              <div className="flex gap-2">
                <Pill>{domain.proxy}</Pill>
                <Pill>{domain.tls ? "TLS enabled" : "No TLS"}</Pill>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {domain.routes.map((route, i) => (
                <div className="rounded-lg border border-line bg-elevated p-4 text-sm" key={i}>
                  <div className="flex flex-wrap items-center gap-3">
                    <code className="mono text-accent">{route.path ?? "/"}</code>
                    <ArrowRight size={14} />
                    <span className="mono break-all">{route.upstream}</span>
                    {route.serviceId ? (
                      <button
                        onClick={() => navigate("services", route.serviceId)}
                        className="text-accent hover:underline"
                      >
                        {snapshot.services.find((service) => service.id === route.serviceId)
                          ?.name ?? route.serviceId}
                      </button>
                    ) : (
                      <Pill>{route.externalId ? "external" : "unresolved"}</Pill>
                    )}
                  </div>
                  <p className="mono mt-2 text-xs text-muted">{sourceText(route.source)}</p>
                </div>
              ))}
            </div>
            <p className="mono mt-4 text-xs text-muted">{sourceText(domain.source)}</p>
            <WarningsFor snapshot={snapshot} id={domain.id} navigate={navigate} />
          </article>
        ))}
      </div>
    ) : (
      <Empty>No domains discovered.</Empty>
    );
  if (page === "warnings") {
    const matches = snapshot.warnings.filter(
      (warning) => severity === "ALL" || warning.severity === severity,
    );
    return (
      <div className="space-y-4">
        <div className="panel flex items-center justify-between gap-3 p-4">
          <span className="mono text-sm text-muted">{matches.length} diagnostics</span>
          <label className="text-sm text-muted" htmlFor="severity">
            Severity
          </label>
          <select
            id="severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            className="rounded-lg border border-line bg-elevated px-3 py-2 text-sm"
          >
            <option value="ALL">All severities</option>
            <option value="ERROR">Error</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </select>
        </div>
        {matches.length ? (
          matches.map((warning) => (
            <article className="panel p-5" key={warning.id}>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`eyebrow ${warning.severity === "ERROR" ? "text-bad" : warning.severity === "WARNING" ? "text-warn" : "text-info"}`}
                >
                  {warning.severity}
                </span>
                <code className="mono text-xs">{warning.code}</code>
              </div>
              <h3 className="mt-3 font-medium">{warning.message}</h3>
              <p className="mono mt-3 text-xs text-muted">{sourceText(warning.source)}</p>
              {warning.suggestion && (
                <p className="mt-3 flex gap-2 text-sm text-muted">
                  <Info size={16} className="shrink-0 text-accent" />
                  {warning.suggestion}
                </p>
              )}
              {warning.related.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {warning.related.map((id) => (
                    <button
                      key={id}
                      onClick={() =>
                        navigate(
                          snapshot.services.some((service) => service.id === id)
                            ? "services"
                            : "architecture",
                          id,
                        )
                      }
                      className="mono rounded border border-line px-2 py-1 text-xs text-accent hover:border-accent"
                    >
                      {snapshot.graphNodes.find((node) => node.id === id)?.label ?? id}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))
        ) : (
          <Empty>No {severity === "ALL" ? "" : `${severity.toLowerCase()} `}warnings found.</Empty>
        )}
      </div>
    );
  }
  if (page === "decisions")
    return snapshot.decisions.length ? (
      <div className="grid gap-4">
        {snapshot.decisions.map((decision) => (
          <article className="panel p-6" key={decision.id}>
            <div className="flex flex-wrap items-center gap-3">
              <Pill>{decision.status}</Pill>
              <time className="mono text-xs text-muted" dateTime={decision.date}>
                {decision.date}
              </time>
              <span className="mono text-xs text-faint">{decision.id}</span>
            </div>
            <h3 className="mt-4 text-xl font-semibold">{decision.title}</h3>
            <div className="mt-5 grid gap-5 text-sm leading-relaxed md:grid-cols-2">
              <div>
                <Label>Context</Label>
                <p>{decision.context}</p>
              </div>
              <div>
                <Label>Decision</Label>
                <p>{decision.decision}</p>
              </div>
            </div>
            <div className="mt-5">
              <Label>Consequences</Label>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                {decision.consequences.map((value, i) => (
                  <li key={i}>{value}</li>
                ))}
              </ul>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {decision.relatedServices.map((id) => (
                <button
                  key={id}
                  className="rounded border border-line px-2 py-1 text-xs text-accent hover:border-accent"
                  onClick={() => navigate("services", id)}
                >
                  {snapshot.services.find((service) => service.id === id)?.name ?? id}
                </button>
              ))}
              {decision.unresolvedRelatedServices.map((name) => (
                <span className="flex items-center gap-1 text-xs text-warn" key={name}>
                  <ShieldAlert size={13} />
                  Unresolved: {name}
                </span>
              ))}
            </div>
            <p className="mono mt-5 text-xs text-muted">{sourceText(decision.source)}</p>
          </article>
        ))}
      </div>
    ) : (
      <Empty>No architecture decisions discovered.</Empty>
    );
  return null;
}
