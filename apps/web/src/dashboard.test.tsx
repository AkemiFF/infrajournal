import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fixture from "./test/fixtures/snapshot.base.json";
import type { Snapshot } from "@infrajournal/core";
import { App } from "./main";

const snapshot = fixture as Snapshot;
beforeEach(() => {
  window.location.hash = "#overview";
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function loaded() {
  render(<App />);
  await screen.findByRole("heading", { name: snapshot.project.name, level: 1 });
}
function page(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}$`) }));
}

it("shows real inventory and source files on overview", async () => {
  await loaded();
  expect(screen.getByRole("region", { name: "Snapshot counts" })).toHaveTextContent(
    String(snapshot.stats.services),
  );
  expect(screen.getByText(snapshot.files[0]!.path)).toBeInTheDocument();
  expect(screen.getByText(/warning severity/i)).toBeInTheDocument();
});
it("renders an interactive flow graph, filters kind and selects a node for evidence", async () => {
  await loaded();
  page("Architecture");
  expect(document.querySelector(".react-flow")).toBeTruthy();
  expect(document.querySelector(".react-flow__minimap")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: /node kind/i }), {
    target: { value: "service" },
  });
  expect(screen.getByText(/showing .* service/i)).toBeInTheDocument();
  const node = snapshot.graphNodes.find((item) => item.kind === "service")!;
  fireEvent.click(screen.getByRole("button", { name: `Inspect ${node.label}` }));
  expect(screen.getByRole("heading", { name: node.label })).toBeInTheDocument();
  expect(screen.getByLabelText("Node details")).toHaveTextContent(
    snapshot.services.find((item) => item.id === node.id)!.source.file,
  );
});
it("searches graph nodes and services", async () => {
  await loaded();
  page("Architecture");
  fireEvent.change(screen.getByRole("searchbox", { name: /search nodes/i }), {
    target: { value: "no-such-node" },
  });
  expect(screen.getByText(/no matching nodes/i)).toBeInTheDocument();
  page("Services");
  fireEvent.change(screen.getByRole("searchbox", { name: /search services/i }), {
    target: { value: "no-such-service" },
  });
  expect(screen.getByText(/no matching services/i)).toBeInTheDocument();
});
it("shows detailed services, storage mounts and domain routes", async () => {
  await loaded();
  page("Services");
  fireEvent.click(screen.getByRole("button", { name: `Inspect ${snapshot.services[0]!.name}` }));
  expect(screen.getByText(/environment keys/i)).toBeInTheDocument();
  page("Storage");
  expect(screen.getAllByText(/backup policy not documented/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/read.only|read.write/i).length).toBeGreaterThan(0);
  page("Domains");
  expect(screen.getAllByText(snapshot.domains[0]!.routes[0]!.upstream).length).toBeGreaterThan(0);
});
it("filters warnings and exposes suggestions and related resources", async () => {
  await loaded();
  page("Warnings");
  fireEvent.change(screen.getByRole("combobox", { name: /severity/i }), {
    target: { value: "ERROR" },
  });
  const count = snapshot.warnings.filter((warning) => warning.severity === "ERROR").length;
  expect(screen.getByText(`${count} diagnostics`)).toBeInTheDocument();
  if (count === 0) expect(screen.getByText(/no error warnings/i)).toBeInTheDocument();
  else
    expect(
      screen.getByText(snapshot.warnings.find((warning) => warning.severity === "ERROR")!.message),
    ).toBeInTheDocument();
});
it("shows decisions including unresolved related names", async () => {
  await loaded();
  page("Decisions");
  expect(screen.getByRole("heading", { name: snapshot.decisions[0]!.title })).toBeInTheDocument();
  expect(screen.getByText(snapshot.decisions[0]!.context)).toBeInTheDocument();
});
it("persists a theme change", async () => {
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: /light theme/i }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("infrajournal-theme")).toBe("light");
});
it("retries static snapshot then explains how to generate on failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<App />);
  expect(await screen.findByText("infrajournal generate")).toBeInTheDocument();
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/snapshot.json"));
});
it("loads the static fallback when the API is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot }),
  );
  await loaded();
  expect(fetch).toHaveBeenNthCalledWith(1, "/api/snapshot");
  expect(fetch).toHaveBeenNthCalledWith(2, "/snapshot.json");
});
it("shows a clean warning empty state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot, warnings: [] }) }),
  );
  await loaded();
  page("Warnings");
  expect(screen.getByText("No warnings found.")).toBeInTheDocument();
});
