import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Snapshot } from "@infrajournal/core";
import {
  Activity,
  Boxes,
  Database,
  Globe2,
  LayoutDashboard,
  Lightbulb,
  Moon,
  Network,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { PAGE_DEFINITIONS, buildHash, parseHash, type PageId } from "./lib/route";
import { useTheme } from "./lib/theme";
import { Architecture } from "./pages/Architecture";
import { Inventory } from "./pages/Inventory";
import "./styles/index.css";

const icons = [LayoutDashboard, Network, Boxes, Database, Globe2, TriangleAlert, Lightbulb];

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const { theme, toggleTheme } = useTheme();
  useEffect(() => {
    const listener = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", listener);
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener("hashchange", listener);
      window.removeEventListener("popstate", listener);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let response: Response;
        try {
          response = await fetch("/api/snapshot");
          if (!response.ok) throw new Error(`API returned ${response.status}`);
        } catch {
          response = await fetch("/snapshot.json");
          if (!response.ok) throw new Error(`Snapshot returned ${response.status}`);
        }
        const data = (await response.json()) as Snapshot;
        if (active) setSnapshot(data);
      } catch (reason) {
        if (active)
          setError(reason instanceof Error ? reason.message : "Snapshot could not be loaded.");
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);
  const go = (page: PageId, focus?: string) => {
    window.history.pushState(null, "", buildHash({ page, focus }));
    setRoute({ page, focus });
  };

  if (error)
    return (
      <main aria-live="polite" className="app-backdrop grid min-h-screen place-items-center p-6">
        <section className="panel max-w-xl p-9">
          <div className="eyebrow text-bad">Snapshot unavailable</div>
          <h1 className="mt-5 text-3xl font-semibold">No infrastructure snapshot found</h1>
          <p className="mt-4 text-muted">
            The local API and static snapshot could not be loaded. Generate a snapshot, then reload
            this page. {error}
          </p>
          <code className="mono mt-6 block rounded-lg bg-canvas-2 p-4 text-sm">
            infrajournal generate
          </code>
        </section>
      </main>
    );
  if (!snapshot)
    return (
      <main aria-live="polite" className="app-backdrop grid min-h-screen place-items-center">
        <div className="panel w-80 p-8">
          <div className="eyebrow">InfraJournal</div>
          <div className="skeleton mt-5 h-7 rounded" />
          <p className="mt-5 text-sm text-muted">Loading snapshot…</p>
        </div>
      </main>
    );

  const title = PAGE_DEFINITIONS.find((entry) => entry.id === route.page)!;
  return (
    <div className="app-backdrop min-h-screen">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface/90 px-5 py-4">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
              <Activity size={22} />
            </div>
            <div>
              <div className="eyebrow text-accent">
                INFRAJOURNAL <span className="text-muted">/ LOCAL SNAPSHOT</span>
              </div>
              <h1 className="mt-1 text-base font-semibold">{snapshot.project.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted sm:block">
              SCHEMA {snapshot.schemaVersion}
            </span>
            <button
              aria-label={theme === "dark" ? "Light theme" : "Dark theme"}
              className="rounded-lg border border-line p-2.5 text-muted hover:text-ink"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-7 p-4 md:flex-row md:p-8">
        <nav
          aria-label="Dashboard sections"
          className="panel flex h-fit shrink-0 gap-1 overflow-x-auto p-2 md:sticky md:top-8 md:w-56 md:flex-col"
        >
          {PAGE_DEFINITIONS.map((entry, i) => {
            const Icon = icons[i]!;
            return (
              <button
                key={entry.id}
                onClick={() => go(entry.id)}
                aria-current={route.page === entry.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors md:w-full ${route.page === entry.id ? "bg-accent/12 font-medium text-accent" : "text-muted hover:bg-elevated hover:text-ink"}`}
              >
                <Icon size={16} />
                {entry.shortLabel}
              </button>
            );
          })}
        </nav>
        <main id="content" className="min-w-0 flex-1">
          <div className="mb-7 flex items-end justify-between gap-3">
            <div>
              <div className="eyebrow text-accent">WORKSPACE / {route.page.toUpperCase()}</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">{title.label}</h2>
              <p className="mt-2 text-sm text-muted">{title.description}</p>
            </div>
            <div className="mono hidden text-xs text-faint lg:block">
              {snapshot.metadata.contentHash.slice(0, 12)}
            </div>
          </div>
          {route.page === "architecture" ? (
            <Architecture snapshot={snapshot} focus={route.focus} navigate={go} />
          ) : (
            <Inventory snapshot={snapshot} page={route.page} focus={route.focus} navigate={go} />
          )}
        </main>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
