import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

async function availablePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No available TCP port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("dashboard server", () => {
  it("serves a real snapshot on localhost and rejects traversal", async () => {
    const port = await availablePort();
    const cli = path.join(process.cwd(), "packages/cli/dist/index.js");
    const child = spawn(
      process.execPath,
      [cli, "ui", "--root", "examples/simple-stack", "--port", String(port)],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          response = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
          break;
        } catch {
          if (child.exitCode !== null) throw new Error(`CLI stopped early: ${output}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(response?.status).toBe(200);
      const snapshot = await response?.json();
      expect(snapshot?.stats.services).toBe(2);
      const home = await fetch(`http://127.0.0.1:${port}/`);
      expect(home.status).toBe(200);
      expect(await home.text()).toContain("InfraJournal");
      const traversal = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/etc/passwd`);
      expect(traversal.status).toBe(404);
      const rebinding = await new Promise<number>((resolve, reject) => {
        const request = http.get(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/snapshot",
            headers: { Host: "attacker.example" },
          },
          (result) => {
            result.resume();
            resolve(result.statusCode ?? 0);
          },
        );
        request.on("error", reject);
      });
      expect(rebinding).toBe(403);
      const foreignOrigin = await new Promise<number>((resolve, reject) => {
        const request = http.get(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/snapshot",
            headers: { Origin: "http://attacker.example" },
          },
          (result) => {
            result.resume();
            resolve(result.statusCode ?? 0);
          },
        );
        request.on("error", reject);
      });
      expect(foreignOrigin).toBe(403);
      expect(output).toContain(`127.0.0.1:${port}`);
    } finally {
      child.kill("SIGINT");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 10_000);

  it("does not serve a symlinked asset outside web-dist", async () => {
    const port = await availablePort();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "infrajournal-ui-security-"));
    const privateFile = path.join(directory, "private.txt");
    const name = `__ij-test-${process.pid}.txt`;
    const link = path.join(process.cwd(), "packages/cli/web-dist", name);
    await fs.writeFile(privateFile, "IJ_PRIVATE_NEVER_SERVE");
    await fs.symlink(privateFile, link);
    const cli = path.join(process.cwd(), "packages/cli/dist/index.js");
    const child = spawn(
      process.execPath,
      [cli, "ui", "--root", "examples/simple-stack", "--port", String(port)],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          response = await fetch(`http://127.0.0.1:${port}/${name}`);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(response?.status).toBe(404);
      expect(await response?.text()).not.toContain("IJ_PRIVATE_NEVER_SERVE");
    } finally {
      child.kill("SIGINT");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      await fs.rm(link, { force: true });
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
