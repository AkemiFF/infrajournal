#!/usr/bin/env node
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import pc from "picocolors";
import {
  ConfigError,
  CORE_VERSION,
  loadConfig,
  parseSnapshot,
  redactSensitiveText,
  scanFromConfig,
  serializeSnapshot,
} from "@infrajournal/core";
import {
  compareSnapshots,
  formatDriftReport,
  generateDocumentation,
} from "@infrajournal/documentation";

const VERSION = CORE_VERSION;
const EXIT_RUNTIME = 1;
const EXIT_USAGE = 2;
const EXIT_DRIFT = 3;
const EXIT_MISSING_BASELINE = 4;

interface CommonOptions {
  root?: string;
  config?: string;
  verbose?: boolean;
}

interface ScanOptions extends CommonOptions {
  format: "text" | "json";
  output?: string;
}

function stderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function output(message: string): void {
  process.stdout.write(`${message}\n`);
}

function displayPath(value: string): string {
  const relative = path.relative(process.cwd(), value);
  return relative && !relative.startsWith("..") ? relative : value;
}

function friendlyError(error: unknown, verbose = false): string {
  if (error instanceof ConfigError) {
    return `${error.message}${error.detail ? `\n${error.detail}` : ""}`;
  }
  if (error instanceof Error) {
    return verbose && error.stack ? error.stack : error.message;
  }
  return redactSensitiveText(String(error));
}

async function atomicWrite(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readSnapshot(target: string) {
  return parseSnapshot(await fs.readFile(target, "utf8"));
}

/** Only snapshots already owned by InfraJournal may be replaced. Never write over source files. */
async function assertSafeSnapshotOutput(
  target: string,
  result: Awaited<ReturnType<typeof scan>>,
): Promise<void> {
  if (path.extname(target).toLowerCase() !== ".json") {
    throw new ConfigError(
      "Snapshot output must end in .json; refusing to overwrite an infrastructure file.",
    );
  }

  let existing;
  try {
    existing = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!existing) return;
  if (!existing.isFile() || existing.isSymbolicLink()) {
    throw new ConfigError("Snapshot output is not a regular file; refusing to overwrite it.");
  }

  const sources = [
    ...result.snapshot.files.map((file) => path.join(result.config.root, file.path)),
    ...(result.config.configFile ? [result.config.configFile] : []),
  ];
  for (const source of sources) {
    try {
      const sourceStat = await fs.stat(source);
      if (existing.dev === sourceStat.dev && existing.ino === sourceStat.ino) {
        throw new ConfigError(
          "Snapshot output aliases an inspected input file; refusing to overwrite it.",
        );
      }
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  try {
    await readSnapshot(target);
  } catch {
    throw new ConfigError(
      "Output already exists and is not an InfraJournal snapshot; refusing to overwrite it.",
    );
  }
}

async function scan(options: CommonOptions) {
  const root = options.root ? path.resolve(process.cwd(), options.root) : undefined;
  const config = await loadConfig({
    cwd: root && !options.config ? root : process.cwd(),
    ...(options.config ? { configPath: options.config } : {}),
    ...(root ? { root } : {}),
  });
  return { config, snapshot: await scanFromConfig(config, { generatorVersion: VERSION }) };
}

function printSummary(snapshot: Awaited<ReturnType<typeof scan>>["snapshot"]): void {
  output(`${pc.bold(snapshot.project.name)} infrastructure scan`);
  output(
    `${snapshot.stats.services} services · ${snapshot.stats.networks} networks · ${snapshot.stats.volumes} volumes · ${snapshot.stats.domains} domains · ${snapshot.stats.dependencies} dependencies`,
  );
  output(
    `Scanned ${snapshot.stats.files} files. Warnings: ${snapshot.stats.warnings.error} errors, ${snapshot.stats.warnings.warning} warnings, ${snapshot.stats.warnings.info} info.`,
  );
  if (snapshot.warnings.length > 0) {
    for (const warning of snapshot.warnings.slice(0, 12)) {
      output(`  ${warning.severity} ${warning.code}: ${warning.message}`);
    }
    if (snapshot.warnings.length > 12) output(`  …and ${snapshot.warnings.length - 12} more.`);
  }
}

async function commandInit(force: boolean): Promise<void> {
  const target = path.resolve(process.cwd(), "infrajournal.yml");
  if (!force) {
    try {
      await fs.access(target);
      throw new ConfigError("infrajournal.yml already exists. Use --force to replace it.");
    } catch (error) {
      if (error instanceof ConfigError) throw error;
    }
  }
  const content = `version: 1

project: {}

scan:
  root: .
  include:
    - "**/compose.yml"
    - "**/compose.yaml"
    - "**/Caddyfile"
    - "**/nginx/**/*.conf"
  exclude:
    - "**/node_modules/**"
    - "**/.git/**"
    - "**/secrets/**"

output:
  directory: ./infra-docs

decisions:
  directory: ./infra-decisions
`;
  await atomicWrite(target, content);
  output(`Created ${displayPath(target)}.`);
  output("Next: infrajournal scan, then infrajournal generate.");
}

async function commandScan(options: ScanOptions): Promise<void> {
  const result = await scan(options);
  const serialized = serializeSnapshot(result.snapshot);
  if (options.output) {
    const target = path.resolve(process.cwd(), options.output);
    await assertSafeSnapshotOutput(target, result);
    await atomicWrite(target, serialized);
    if (options.format === "text") output(`Wrote ${displayPath(target)}.`);
  }
  if (options.format === "json") output(serialized.trimEnd());
  else printSummary(result.snapshot);
}

async function commandGenerate(options: CommonOptions & { output?: string }): Promise<void> {
  const result = await scan(options);
  const directory = options.output
    ? path.resolve(process.cwd(), options.output)
    : result.config.outputDirectory;
  await assertSafeSnapshotOutput(path.join(directory, "snapshot.json"), result);
  const documentation = await generateDocumentation({
    snapshot: result.snapshot,
    outputDirectory: directory,
    decisionsDirectory: result.config.decisionsDirectory,
  });
  await atomicWrite(path.join(directory, "snapshot.json"), serializeSnapshot(result.snapshot));
  output(`Generated documentation in ${displayPath(directory)}.`);
  for (const file of documentation.written) output(`  wrote ${file}`);
  for (const file of documentation.preserved) output(`  preserved ${file}`);
  output("  wrote snapshot.json");
}

async function commandCheck(
  options: CommonOptions & { baseline?: string; format: "text" | "json" },
): Promise<number> {
  const result = await scan(options);
  const baseline = path.resolve(
    process.cwd(),
    options.baseline ??
      path.relative(process.cwd(), path.join(result.config.outputDirectory, "snapshot.json")),
  );
  let baselineSnapshot;
  try {
    baselineSnapshot = await readSnapshot(baseline);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      stderr(`Baseline not found: ${displayPath(baseline)}. Run infrajournal generate first.`);
      return EXIT_MISSING_BASELINE;
    }
    throw error;
  }
  const report = compareSnapshots(baselineSnapshot, result.snapshot);
  if (options.format === "json") output(JSON.stringify(report, null, 2));
  else output(formatDriftReport(report));
  return report.identical ? 0 : EXIT_DRIFT;
}

function contentType(file: string): string {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };
  return types[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

async function commandUi(
  options: CommonOptions & { snapshot?: string; port?: number },
): Promise<void> {
  const snapshot = options.snapshot
    ? await readSnapshot(path.resolve(process.cwd(), options.snapshot))
    : (await scan(options)).snapshot;
  const cliDirectory = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = path.resolve(cliDirectory, "../web-dist");
  let realWebRoot: string;
  try {
    await fs.access(path.join(webRoot, "index.html"));
    realWebRoot = await fs.realpath(webRoot);
  } catch {
    throw new Error("Dashboard assets are missing. Run `pnpm build` before `infrajournal ui`.");
  }

  const explicitPort = options.port !== undefined;
  let port = options.port ?? 4173;
  let server: http.Server | undefined;
  for (let attempt = 0; attempt < (explicitPort ? 1 : 21); attempt += 1) {
    const candidate = port + attempt;
    try {
      server = await listen(candidate);
      port = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || explicitPort) {
        throw new Error(`Unable to bind dashboard to 127.0.0.1:${candidate}.`, { cause: error });
      }
    }
  }
  if (!server) throw new Error("No available dashboard port in the requested range.");

  server.on("request", async (request, response) => {
    try {
      const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
      if (
        (request.headers.host !== `127.0.0.1:${port}` &&
          request.headers.host !== `localhost:${port}`) ||
        (request.headers.origin !== undefined && !allowedOrigins.has(request.headers.origin)) ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        response.writeHead(403, { "cache-control": "no-store" });
        response.end("Forbidden");
        return;
      }
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/api/snapshot") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(serializeSnapshot(snapshot));
        return;
      }
      if (/%2e|%2f|%5c/i.test(requestUrl.pathname)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const requested = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const relative = decodeURIComponent(requested).replace(/^\/+/, "");
      const target = path.resolve(webRoot, relative);
      if (!target.startsWith(`${webRoot}${path.sep}`)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      let file = target;
      try {
        const stat = await fs.stat(file);
        if (stat.isDirectory()) file = path.join(file, "index.html");
      } catch {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const realFile = await fs.realpath(file);
      if (
        !realFile.startsWith(`${realWebRoot}${path.sep}`) ||
        !(await fs.stat(realFile)).isFile()
      ) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "content-type": contentType(realFile),
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
        "referrer-policy": "no-referrer",
      });
      response.end(await fs.readFile(realFile));
    } catch {
      response.writeHead(500);
      response.end("Internal server error");
    }
  });
  output(`InfraJournal dashboard: http://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => {
    const close = () => server?.close(() => resolve());
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

function listen(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server);
    });
  });
}

function buildProgram(setExitCode: (code: number) => void): Command {
  const program = new Command();
  program
    .name("infrajournal")
    .description("Your infrastructure, automatically documented.")
    .version(VERSION)
    .option("--verbose", "show detailed errors")
    .showSuggestionAfterError()
    .exitOverride();

  program
    .command("init")
    .description("create a starter infrajournal.yml")
    .option("--force", "replace an existing configuration")
    .action(async (options: { force?: boolean }) => commandInit(Boolean(options.force)));

  program
    .command("scan")
    .description("scan infrastructure and optionally write a snapshot")
    .option("--root <dir>", "scan root")
    .option("--config <file>", "configuration file")
    .option("--format <format>", "text or json", "text")
    .option("--output <file>", "snapshot output file")
    .action(async (options: ScanOptions) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ConfigError("--format must be text or json.");
      }
      await commandScan(options);
    });

  program
    .command("generate")
    .description("scan and generate Markdown documentation")
    .option("--root <dir>", "scan root")
    .option("--config <file>", "configuration file")
    .option("--output <dir>", "documentation output directory")
    .action(async (options: CommonOptions & { output?: string }) => commandGenerate(options));

  program
    .command("check")
    .description("compare the current scan with a snapshot baseline")
    .option("--root <dir>", "scan root")
    .option("--config <file>", "configuration file")
    .option("--baseline <file>", "baseline snapshot")
    .option("--format <format>", "text or json", "text")
    .action(async (options: CommonOptions & { baseline?: string; format: "text" | "json" }) => {
      if (options.format !== "text" && options.format !== "json") {
        throw new ConfigError("--format must be text or json.");
      }
      const code = await commandCheck(options);
      setExitCode(code);
    });

  program
    .command("ui")
    .description("serve the local dashboard")
    .option("--root <dir>", "scan root")
    .option("--config <file>", "configuration file")
    .option("--snapshot <file>", "use an existing snapshot")
    .option("--port <number>", "localhost port", (value) => Number.parseInt(value, 10))
    .action(async (options: CommonOptions & { snapshot?: string; port?: number }) => {
      if (
        options.port !== undefined &&
        (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
      ) {
        throw new ConfigError("--port must be an integer between 1 and 65535.");
      }
      await commandUi(options);
    });
  return program;
}

export async function run(argv = process.argv): Promise<number> {
  let commandExitCode = 0;
  const program = buildProgram((code) => {
    commandExitCode = code;
  });
  try {
    await program.parseAsync(argv);
    return commandExitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : EXIT_USAGE;
    const verbose = program.opts<{ verbose?: boolean }>().verbose;
    stderr(pc.red(`Error: ${friendlyError(error, verbose)}`));
    return error instanceof ConfigError ? EXIT_USAGE : EXIT_RUNTIME;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}
