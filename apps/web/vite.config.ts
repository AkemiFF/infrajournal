import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(appRoot, "../..");

/**
 * Resolve the dev snapshot in this order:
 *   1. INFRAJOURNAL_SNAPSHOT (absolute, or relative to the shell cwd)
 *   2. The generated multi-service demo snapshot
 *
 * The middleware deliberately does not create or synthesize data. A missing
 * snapshot must reach the UI as a 404 so the dashboard can explain how to
 * generate one.
 */
function findSnapshotFile(): string | undefined {
  const configured = process.env.INFRAJOURNAL_SNAPSHOT?.trim();
  const candidates: string[] = [];

  if (configured) {
    candidates.push(
      path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured),
    );
    candidates.push(path.resolve(appRoot, configured));
  }

  candidates.push(path.resolve(repositoryRoot, "examples/multi-service/infra-docs/snapshot.json"));

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function snapshotDevServer(): Plugin {
  return {
    name: "infrajournal-dev-snapshot",
    apply: "serve",
    configureServer(server) {
      const serveSnapshot = (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          response.end("Method Not Allowed");
          return;
        }

        const snapshotFile = findSnapshotFile();
        if (!snapshotFile) {
          response.statusCode = 404;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(
            JSON.stringify({
              error: "No snapshot available.",
              hint: "Run `infrajournal generate` or set INFRAJOURNAL_SNAPSHOT to a snapshot file.",
            }),
          );
          return;
        }

        try {
          const body = fs.readFileSync(snapshotFile, "utf8");
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(body);
        } catch (error) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(
            JSON.stringify({
              error: "The snapshot file could not be read.",
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      };

      server.middlewares.use("/api/snapshot", serveSnapshot);
      server.middlewares.use("/snapshot.json", serveSnapshot);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), snapshotDevServer()],
  resolve: {
    alias: {
      "@infrajournal/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
