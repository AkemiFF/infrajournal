# InfraJournal preliminary threat model and security requirements

Status: Phase 1 preliminary model. This is not the final audit.
Audit date: 2026-11-03
Auditor: `qa-security` subagent
Scope: the planned InfraJournal pipeline and the baseline implementation present
in `packages/core/src`, root configuration, examples and the task board.

Status legend used throughout:

- **IMPLEMENTED** — code exists in the current tree and the control was reviewed.
- **PARTIAL** — a control exists but has a known gap or is not yet covered by
  tests; Phase 2 must verify and assign severity.
- **PLANNED** — the module does not exist yet (`packages/cli`, `apps/web` and
  `packages/documentation` contain only manifests/configuration at audit time).
  Requirements below are constraints for those implementations, not findings.
- **RESIDUAL** — accepted risk or limitation that cannot be fully removed.

No implementation, test, manifest, lockfile or example was modified. The only
file written is this report. Local probes were run against copied fixtures under
`/tmp/opencode`; they are evidence only, not a substitute for the Phase 2 test
suite.

---

## 1. Executive summary

InfraJournal is a read-only, local-first tool that parses repository-owned
configuration and emits a shareable snapshot, documentation, drift reports and a
localhost dashboard. The highest-risk property is also its core feature: **it
reads and republishes attacker-controlled repository content**. A malicious
repository, Compose file, Nginx conf, Caddyfile, decision record or snapshot can
try to escape the scan root, exhaust the process, inject markup, or leak
metadata and credentials into artifacts that users may commit or share.

Highest-risk areas for implementation (details in §8):

1. **Config-driven root and output escape.** A repository's
   `infrajournal.yml` can set `scan.root` and `output.directory` outside the
   repository. `loadConfig` currently accepts both; a local probe resolved
   `root: /tmp` and `output: /tmp/opencode/ij-out` from a config inside a
   different directory. Once the documentation writer exists, this becomes an
   arbitrary-write path unless output containment is enforced. **High, PARTIAL.**
2. **Credential-bearing proxy targets in the snapshot and warnings.** A
   `proxy_pass http://alice:s3cr3t@backend:3000` is stored verbatim as a domain
   upstream and echoed in an unredacted warning. A local probe confirmed
   `s3cr3t` in both. **High, PARTIAL.**
3. **Output writer containment and preservation.** The Markdown writer is
   planned and does not yet exist. It must not inherit the current output-path
   gap, must not follow symlinks, and must never overwrite files lacking the
   generated marker. **High, PLANNED.**
4. **Local dashboard exposure.** The server is planned. Binding, `Host`/`Origin`
   validation, DNS-rebinding defense, static path traversal, MIME/security
   headers and snapshot input limits all remain to be implemented and tested.
   **High, PLANNED.**
5. **Render-time injection.** Service names, domains, upstreams, paths and
   decision text are untrusted. Markdown, Mermaid, raw HTML and dashboard links
   must treat them as data. **High for generated docs/UI, PLANNED.**
6. **Parser/resource exhaustion.** Compose YAML alias expansion and duplicate
   keys are partially bounded; Nginx nested blocks are not. A probe with 10,000
   nested `server {` blocks produced `RangeError: Maximum call stack size
exceeded`. File count, depth and size are capped, but total bytes, directory
   count, token count, nesting depth, resource count and graph size are not.
   **Medium, PARTIAL/PLANNED.**

The current core has several good foundations: no `child_process` or write APIs
in `packages/core/src`, realpath containment for discovered symlinks and the
decisions directory, `maxAliasCount: 100` for Compose, strict Zod contracts,
relative POSIX source paths, deterministic IDs/hashes, and a best-effort
redaction helper. Those controls must be preserved and extended, not replaced.

---

## 2. System, data flow and trust boundaries

```text
 untrusted repository / snapshot file
   │  compose.yml, Caddyfile, nginx/*.conf, infrajournal.yml,
   │  infra-decisions/*.yml, env_file references, bind paths, --snapshot
   ▼
 [B1] config discovery ──► [B2] filesystem discovery ──► [B3] file reads
   │                              │                         │
   │                              └── realpath / containment ┘
   ▼
 [B4] parsers (YAML, Nginx, Caddy) ──► normalization / graph / warnings
   │
   ▼
 [B5] snapshot JSON ──► Markdown docs / drift reports / CLI text/JSON
   │                              │
   ▼                              ▼
 [B6] local HTTP server ──► [B7] browser dashboard
   ▲
 CLI args (--root, --config, --output, --snapshot, --port)
```

Trust boundaries and assumptions:

- **B1 — repository config vs process.** `infrajournal.yml` is repository-owned
  and therefore untrusted. It selects the scan root, include/exclude globs,
  limits, output directory, decisions directory and backup policies.
- **B2/B3 — local filesystem.** Read access must be limited to files under the
  canonical scan root and to explicitly configured inputs. The process likely
  runs with the user's full filesystem privileges, so path containment is a
  security control, not a convenience.
- **B4 — parsers.** Parsers run in-process with no sandbox. Malformed or
  adversarial input must be bounded by size, token, nesting and time limits.
- **B5 — artifacts.** The snapshot, Markdown, drift reports and JSON exports are
  intended to be shareable. They contain topology, domains, paths, environment
  key names, decision text and possibly credentials embedded in upstreams.
- **B6/B7 — local server and browser.** The dashboard is a loopback service; the
  browser is a hostile environment because any web page can attempt DNS
  rebinding, cross-origin reads and navigation to loopback.
- **CLI arguments.** Treated as operator intent, but they may come from a shell
  wrapper, editor task or CI job. Validate all values; never interpolate them
  into a shell.
- **Dependencies and build chain.** npm packages, the bundled CLI and the Vite
  build are part of the trusted computing base. No CDN, remote font or telemetry
  call is acceptable in the dashboard.

Attacker models considered:

| Actor                                          | Capability                                                                                | Primary threats                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Malicious repository author                    | Controls all scanned files and `infrajournal.yml`; user clones and runs `scan`/`generate` | root/output escape, parser DoS, markup injection, secret-bearing fixtures, misleading warnings |
| Malicious website / local process              | Can run JavaScript in the user's browser or connect to loopback ports                     | DNS rebinding, cross-origin snapshot reads, server path traversal                              |
| Malicious snapshot recipient/author            | Supplies a schema-valid or invalid `--snapshot` file                                      | XSS via UI, memory exhaustion, misleading content                                              |
| Compromised dependency / build                 | Controls a package or build artifact                                                      | code execution, data exfiltration, tampered output                                             |
| Careless operator                              | Runs commands in the wrong directory, shares snapshots, overwrites docs                   | accidental writes, metadata leakage, baseline loss                                             |
| Local OS attacker / root / compromised browser | Full host control                                                                         | out of scope; cannot be defended by this tool                                                  |

---

## 3. Assets

| Asset                                 | Why it matters                                              | Where it appears                                                            |
| ------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Infrastructure topology               | Reveals service relationships, trust paths and blast radius | snapshot `services`, `networks`, `volumes`, `dependencies`, docs, graph, UI |
| Service names, images, build contexts | Internal naming, registries, source locations               | snapshot, docs, graph labels, UI                                            |
| Domains, routes, upstreams, TLS flags | Attack surface and internal DNS names                       | `domains`, `routes`, docs, UI                                               |
| Ports and published bindings          | Externally reachable services                               | `ports`, `endpoints`, warnings                                              |
| Filesystem paths                      | Usernames, project layout, secret-file locations            | `source.file`, `build.context`, `mounts.source`, `envFiles`, warnings       |
| Decision records                      | Free-text context, consequences, operational details        | `decisions`, docs, UI                                                       |
| Local filesystem outside the root     | Credentials, SSH keys, `/etc`, home directories             | must never be read                                                          |
| Local filesystem inside the root      | Source of truth; must remain unmodified                     | read-only scan                                                              |
| Credentials/secrets                   | Passwords, tokens, keys, DSNs, `env_file` contents          | must never be collected; may appear accidentally in raw fields/errors       |
| Snapshot JSON                         | Shareable, diffable artifact; content hash                  | output directory, `--snapshot`, API, docs                                   |
| Generated Markdown and drift reports  | Committed/published documentation                           | output directory, VCS, static sites                                         |
| Dashboard/server                      | Displays topology; loopback listener                        | browser, `/api/snapshot`, static assets                                     |
| Terminal/error output                 | May be pasted into issues or CI logs                        | CLI stdout/stderr, CI logs                                                  |
| Write targets                         | Inspected repository, generated docs, baseline snapshot     | `generate`, `scan --output`, `check`, `init`                                |
| Determinism/integrity                 | Reproducible docs and drift detection                       | IDs, canonical JSON, `contentHash`                                          |

---

## 4. Current controls (grounded in the baseline)

These controls exist today and should be retained. Line references are to the
audit date.

| Control                                                                       | Evidence                                                               | Status / note                                                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict config schema; unknown keys rejected; bounded numeric limits           | `packages/core/src/config/schema.ts:49-89`                             | IMPLEMENTED. `maxFileSizeBytes` 1 KiB–50 MiB, `maxDepth` 1–40, `maxFiles` 1–50,000.                                                               |
| Config file size cap (1 MiB) before read                                      | `config/load-config.ts:15,54-62`                                       | IMPLEMENTED. Stat-then-read; TOCTOU is residual.                                                                                                  |
| Scan root resolved with `realpath`                                            | `config/load-config.ts:95-108`                                         | IMPLEMENTED. Only checks existence/directory, not containment.                                                                                    |
| Decisions directory required inside root                                      | `config/load-config.ts:110-116`                                        | IMPLEMENTED. `isPathInside` uses `path.relative`.                                                                                                 |
| Output directory cannot be filesystem root                                    | `config/load-config.ts:117-119`                                        | PARTIAL. It may still be outside the scan root.                                                                                                   |
| Absolute include/exclude globs rejected                                       | `config/load-config.ts:121-127`                                        | IMPLEMENTED. `..` segments are not rejected; they are matched against relative paths.                                                             |
| Symlink resolution and containment during discovery                           | `discovery/discover.ts:59-65,110-136`                                  | PARTIAL. Realpath is checked against root, but excludes are evaluated before resolution.                                                          |
| Discovery limits: max depth, max files, max file size                         | `discovery/discover.ts:145-159,176-201`                                | IMPLEMENTED. No total-byte or directory-count budget; unsupported paths are unbounded.                                                            |
| Deterministic discovery order                                                 | `discovery/discover.ts:99,229`                                         | IMPLEMENTED. Locale-based sort; platform locale could theoretically vary.                                                                         |
| Binary/oversize read handling                                                 | `discovery/read-file.ts:7-20`                                          | PARTIAL. Reads the whole file before checking size; no total-byte budget.                                                                         |
| No execution of scanned content in core                                       | `packages/core/src` contains no `node:child_process` and no write APIs | IMPLEMENTED at audit time.                                                                                                                        |
| Compose YAML duplicate-key rejection and alias cap                            | `parsers/compose.ts:264-268,294`                                       | IMPLEMENTED for Compose: `uniqueKeys: true`, `toJS({ maxAliasCount: 100 })`.                                                                      |
| Config/decision YAML duplicate-key and alias handling                         | `config/load-config.ts:70`, `decisions/load-decisions.ts:166`          | PARTIAL. Uses `yaml` `parse` defaults; local probes reject duplicate keys and alias bombs, but there is no explicit policy or depth/token budget. |
| Compose: values not read                                                      | `parsers/compose.ts:202-213,215-228,230-237,339-346,441-449,459-467`   | IMPLEMENTED. Environment keys only, `env_file` path references only, label keys only, secrets/include/extends warned about and not followed.      |
| Nginx/Caddy: includes/imports not followed, variables not evaluated           | `parsers/nginx.ts:274-313`; `parsers/caddy.ts:255-267`                 | IMPLEMENTED by design. Includes/imports produce warnings.                                                                                         |
| Nginx/Caddy: no expression evaluation or command execution                    | `parsers/nginx.ts`, `parsers/caddy.ts`                                 | IMPLEMENTED. Regex locations/maps/conditionals are warned about or recorded without evaluation.                                                   |
| Decision records: strict schema, size cap, max 500 files, symlink containment | `decisions/load-decisions.ts:53-108,127-137,179-193`                   | IMPLEMENTED. No total-byte budget; free text is stored as-is.                                                                                     |
| Snapshot contract validated with strict Zod objects                           | `model/schema.ts:278-295`; `serialization/snapshot.ts:166-205`         | IMPLEMENTED. `parseSnapshot` has no input-size cap.                                                                                               |
| Relative POSIX source paths; absolute paths not written to `source.file`      | `model/schema.ts:23-29`; `utils/paths.ts:3-9`                          | IMPLEMENTED. Other raw fields may contain absolute host paths.                                                                                    |
| Deterministic IDs and canonical serialization/content hash                    | `model/ids.ts:4-32`; `serialization/snapshot.ts:38-164`                | IMPLEMENTED. Hash is integrity, not authenticity.                                                                                                 |
| Warnings redacted at construction                                             | `diagnostics/warnings.ts:72-88`; `utils/redact.ts:1-33`                | PARTIAL. Best-effort patterns; raw snapshot fields are not redacted.                                                                              |
| Generated output directories excluded from re-scan                            | `scan/from-config.ts:15-23`                                            | IMPLEMENTED when output/decisions are inside root.                                                                                                |
| Lockfile and build-script allowlist                                           | `pnpm-lock.yaml`; `pnpm-workspace.yaml` `allowBuilds: esbuild`         | PARTIAL. No CI workflow files were present at audit time.                                                                                         |

---

## 5. Preliminary observations

These are not the final severity-ordered findings; they are the concrete gaps
that shaped the requirements. Phase 2 must reproduce them with tests.

| Ref  | Observation                                                                                                                                                                             | Evidence                                                                           | Preliminary severity                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| P-01 | Repository config can set `scan.root` outside the config directory and `output.directory` outside the scan root. Probe accepted `root: /tmp` and output `/tmp/opencode/ij-out`.         | `config/load-config.ts:90-119`; probe on 2026-11-03                                | High (root escape); High (write escape once writer exists) |
| P-02 | Nginx proxy credential is stored and echoed unredacted. Probe: `alice:s3cr3t@backend:3000` appeared in the domain route and a warning.                                                  | `scan/scan.ts:636-682`; `utils/redact.ts:10`; probe                                | High                                                       |
| P-03 | Nginx parser has unbounded block recursion. Probe: 10,000 nested `server {` blocks threw `RangeError: Maximum call stack size exceeded`; `scanProject` does not catch parser throws.    | `parsers/nginx.ts:124-207,338-417`; `scan/scan.ts:226-227`                         | Medium/High (availability)                                 |
| P-04 | Unsupported matched files accumulate in an unbounded array, independent of `maxFiles`. A repository with many non-Compose/Nginx/Caddy files matching `scan.include` can exhaust memory. | `discovery/discover.ts:171-174,215-227`                                            | Medium                                                     |
| P-05 | No total-byte, directory-count, token-count, nesting-depth or parsed-resource budget. `maxFiles × maxFileSizeBytes` can be very large (default 5,000 × 1 MiB; maximum 50,000 × 50 MiB). | `config/schema.ts:61-68`; measurements absent                                      | Medium                                                     |
| P-06 | Bind mount sources, build contexts, `env_file` paths and decision free text are stored verbatim; these can reveal home paths or credentials.                                            | `scan/scan.ts:469-493`; `parsers/compose.ts:215-245`; `model/schema.ts:223-237`    | Medium (privacy)                                           |
| P-07 | `parseSnapshot` accepts an arbitrarily large JSON string before schema validation.                                                                                                      | `serialization/snapshot.ts:186-205`                                                | Medium (planned server exposure)                           |
| P-08 | Output writer, CLI, server and dashboard do not exist yet, so their controls are unverified.                                                                                            | No `src/` under `packages/cli`, `packages/documentation`, `apps/web` at audit time | High (planned)                                             |
| P-09 | No security-focused tests or CI workflows are present yet.                                                                                                                              | No test source files; `.github/workflows` empty at audit time                      | Medium                                                     |

---

## 6. Threat register

Each threat maps to controls in §7 and acceptance criteria in §8. “Status”
describes the baseline at audit time.

### 6.1 Filesystem and path handling

| ID    | Threat and concrete example                                                                                                                                                                        | Impact                                                          | Status                                                                                      | Controls               | AC                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------- | -------------------------- |
| TM-01 | **Config-driven root escape.** A cloned repo contains `scan.root: /home/user` or `/`; the user runs `infrajournal scan` without `--root`. The scanner walks and reads outside the repository.      | Read of unrelated files; metadata leakage; DoS; misleading docs | PARTIAL (root accepted; see P-01)                                                           | C-01, C-02, C-04       | AC-01, AC-03               |
| TM-02 | **Symlink escape during discovery.** `compose.yml -> /etc/passwd`, or a directory symlink to `/etc/nginx`; or a symlink inside root to an excluded `node_modules`/`secrets` directory.             | Read outside root; bypass of exclude policy; source disclosure  | PARTIAL (outside-root symlinks rejected; post-resolution exclude and hardlinks not covered) | C-02, C-04             | AC-04, AC-05, AC-06        |
| TM-03 | **Decisions traversal.** `decisions.directory: ../outside` or a decision file symlink to a file outside root.                                                                                      | Read outside root; arbitrary YAML parsed                        | IMPLEMENTED for containment; PARTIAL for total bytes                                        | C-01, C-02, C-05       | AC-07, AC-25               |
| TM-04 | **Include/env_file/secret reads.** Compose `include: [../../secrets.yml]`, `env_file: /home/user/.env`, `secrets: { file: /etc/passwd }`; Nginx `include /etc/nginx/...`; Caddy `import /etc/...`. | Secret disclosure; unexpected filesystem access                 | IMPLEMENTED (not followed; warnings)                                                        | C-03, C-04             | AC-08, AC-09               |
| TM-05 | **Output traversal/arbitrary write.** `output.directory: ../../.ssh`; `--output /etc`; a service name `../../authorized_keys` used as a filename; an `infra-docs` symlink to a home directory.     | Overwrite user files; corrupt repository; data loss             | PARTIAL (output containment absent; writer planned)                                         | C-01, C-03, C-13, C-18 | AC-02, AC-11, AC-12, AC-13 |
| TM-21 | **TOCTOU/symlink race.** A symlink is replaced after `realpath`/`stat` but before `readFile`/write; hardlink to an outside file is treated as an in-root file.                                     | Read/write outside intended root                                | RESIDUAL/PARTIAL                                                                            | C-02, C-04, C-13       | AC-04, AC-13               |
| TM-22 | **Cross-platform path confusion.** Windows drive paths, UNC `\\server\share`, case-insensitive paths, backslash traversal, reserved names, long paths.                                             | Containment bypass or failed writes on Windows                  | PARTIAL (POSIX normalization exists; no Windows tests)                                      | C-02, C-18, C-19       | AC-46                      |

### 6.2 Secrets and privacy

| ID    | Threat and concrete example                                                                                                                                                                            | Impact                                                                         | Status                                                                            | Controls               | AC                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------- | ------------------- |
| TM-06 | **Secret exposure in snapshot fields.** Compose `environment` values, `env_file` contents, label values, `proxy_pass http://alice:s3cr3t@backend`, DSNs in build contexts/routes, absolute bind paths. | Credentials and host metadata published in shareable artifacts                 | PARTIAL (env values avoided; raw upstream/build/mount fields leak; see P-02/P-06) | C-06, C-07, C-21       | AC-16, AC-17, AC-19 |
| TM-07 | **Secret exposure in errors/logs.** Malformed YAML line containing `PASSWORD=...`; CLI `--verbose` dumps a parser error; CI log captures stderr.                                                       | Secret leakage to terminal, CI, issue trackers                                 | PARTIAL (warning redaction exists; CLI/docs/UI planned)                           | C-06, C-07             | AC-18               |
| TM-12 | **Secret exposure through generated docs/UI.** A warning or decision free-text field contains a token; the docs generator writes it into Markdown; the dashboard renders it.                           | Secret persisted or displayed broadly                                          | PLANNED (no docs/UI source yet)                                                   | C-06, C-07, C-08, C-10 | AC-16, AC-18        |
| TM-23 | **Metadata privacy.** Snapshot reveals internal domains, service names, usernames in absolute paths, backup policies and decision context.                                                             | Reconnaissance; embarrassing/internal data in a “share this snapshot” workflow | PARTIAL (source paths relative; other raw fields)                                 | C-06, C-21             | AC-19, AC-20        |

### 6.3 Parser robustness and denial of service

| ID    | Threat and concrete example                                                                                                                                                                                                 | Impact                                                                   | Status                                                                                    | Controls   | AC                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------- | ------------------- |
| TM-08 | **Malicious YAML.** Billion-laughs anchors, duplicate `services` keys, a 50 MiB scalar, deeply nested sequences/maps, alias expansion in config/decisions.                                                                  | Memory/CPU exhaustion; parser crash; ambiguous data                      | PARTIAL (Compose alias cap/unique keys; config/decisions defaults; no total/depth budget) | C-05, C-14 | AC-21, AC-24        |
| TM-09 | **Nginx/Caddy token bombs and recursion.** 10,000 nested `server {` blocks; a 50 MiB file of tokens; an unterminated quote that swallows the rest of the file; deeply nested Caddy blocks.                                  | Stack overflow, process crash, hang, memory exhaustion                   | PARTIAL (no token/depth cap; Nginx stack overflow confirmed)                              | C-05, C-14 | AC-22, AC-23, AC-24 |
| TM-17 | **File/directory exhaustion.** 100,000 empty directories; `include: ["**/*"]` with millions of unsupported files; 5,000 files of 1 MiB; 500 decision files of 50 MiB.                                                       | Disk/CPU/memory DoS; long hangs; unbounded memory for `unsupportedPaths` | PARTIAL (max depth/files/size; no total bytes/dirs/unsupported cap; see P-04/P-05)        | C-14       | AC-24, AC-25        |
| TM-18 | **Algorithmic/pathological graph.** A Compose file with 50,000 services; inferred dependency loop `services × keys × services`; enormous `dependencies`/`graphNodes` arrays; UI dagre layout of tens of thousands of nodes. | O(n²) time, huge snapshot, frozen dashboard                              | PARTIAL (deterministic graph; no resource caps; UI planned)                               | C-14, C-15 | AC-26, AC-27        |
| TM-20 | **Untrusted snapshot input.** `ui --snapshot huge.json` with a 1 GiB JSON, deeply nested JSON, or schema-valid strings containing markup; `parseSnapshot` reads it all.                                                     | Memory exhaustion; XSS/injection through UI                              | PARTIAL (`parseSnapshot` validates schema; no size cap; UI planned)                       | C-12, C-17 | AC-27, AC-36        |

### 6.4 Rendering and browser

| ID     | Threat and concrete example                                                                                                                                                                                     | Impact                                                   | Status                                                                  | Controls                      | AC           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------- | ------------ |
| TM-10  | **Markdown/HTML injection.** Service name `web\n\n## Admin\n<script>alert(1)</script>`; domain `evil.test](javascript:alert(1))`; table cell containing `                                                       | `; code fence breakout; YAML front-matter `---`.         | Stored XSS in docs, malicious links, corrupted docs, misleading content | PLANNED (docs package absent) | C-08, C-18   | AC-28 |
| TM-11  | **Mermaid/graph label injection.** Label `x"]; click x "javascript:alert(1)`; newline in node label; unescaped quotes in a graph definition.                                                                    | Script execution or unsafe link in rendered docs/UI      | PLANNED (docs/UI absent)                                                | C-08, C-09, C-10              | AC-29, AC-30 |
| TM-04b | **Dashboard XSS.** React text escaping bypassed by `dangerouslySetInnerHTML`, `rehype-raw`, raw SVG/Mermaid, or an `href` built from a domain such as `javascript:...`; warning/decision text rendered as HTML. | Session compromise; snapshot exfiltration; UI defacement | PLANNED (no web source)                                                 | C-10, C-08                    | AC-30, AC-31 |
| TM-14  | **Static server traversal/MIME.** `GET /..%2f..%2fetc/passwd`, `%00`, backslash traversal, symlink in `web-dist`, directory listing, `.js` served as `text/html`, missing CSP.                                  | File disclosure; XSS via MIME confusion                  | PLANNED                                                                 | C-11                          | AC-34, AC-35 |
| TM-13  | **DNS rebinding/public exposure.** Malicious site resolves `evil.com` to `127.0.0.1` and fetches `http://127.0.0.1:4173/api/snapshot`; server binds `0.0.0.0`; wildcard CORS.                                   | Snapshot/topology exfiltration; LAN exposure             | PLANNED                                                                 | C-11, C-20                    | AC-32, AC-33 |

### 6.5 Execution, writes and supply chain

| ID    | Threat and concrete example                                                                                                                                                                                                                                                           | Impact                                                     | Status                                                        | Controls         | AC                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- | ---------------- | -------------------------- |
| TM-15 | **Command injection/shell interpolation.** CLI opens a browser with `exec("xdg-open " + url)`; `--port` or `--snapshot` is interpolated into a shell; a future plugin/generator shells out to a parser.                                                                               | Arbitrary command execution with user privileges           | IMPLEMENTED in core (no exec); PLANNED CLI                    | C-12             | AC-39, AC-40               |
| TM-16 | **Accidental writes/preservation failure.** `generate` writes into the inspected repo; a generated `compose.yml` is re-scanned; a non-generated `README.md` is overwritten; `check` rewrites the baseline; `init --force` destroys a user config; symlink output writes outside root. | Data loss; corrupt infrastructure docs; scan feedback loop | PARTIAL (core no writes; config output gap; docs/CLI planned) | C-03, C-13, C-18 | AC-11, AC-12, AC-14, AC-15 |
| TM-19 | **Supply chain.** Compromised `yaml`, `minimatch`, `zod`, React or xyflow package; install script; tampered Vite bundle; dashboard loading a CDN/font; unreviewed transitive dependency in the bundled CLI.                                                                           | Code execution; data exfiltration; tampered docs           | PARTIAL (lockfile, `allowBuilds`; no CI/audit/provenance)     | C-16, C-22       | AC-41, AC-42               |
| TM-25 | **Baseline/drift confusion.** An attacker-supplied baseline snapshot makes drift look clean; `check` compares against a schema-valid but malicious baseline.                                                                                                                          | False assurance; missed changes                            | PARTIAL (schema validation; no authenticity)                  | C-12, C-17       | AC-45                      |

---

## 7. Required controls

Controls are normative. “MUST” means required before the corresponding feature
is considered releasable. Each control should have a named owner module.

### C-01 — Config trust boundary

- Treat `infrajournal.yml`, decision files and snapshots as untrusted input.
- `scan.root` from repository config MUST be constrained to the config file’s
  directory (or cwd when no config file) by default. An explicit `--root` may
  select another directory because that is operator intent; a config-only root
  outside the repository MUST require an explicit opt-in flag or be rejected.
- `output.directory` and `decisions.directory` MUST resolve inside the canonical
  scan root by default. If output outside root is supported, it MUST require an
  explicit CLI option and MUST NOT be silently inherited from a repo config.
- Include/exclude patterns MUST be relative, MUST NOT contain a leading slash,
  drive letter or UNC prefix, and SHOULD reject `..` segments.
- Config errors MUST NOT echo file contents or secret-bearing values.

### C-02 — Canonical path containment

- Resolve the scan root with `realpath` once and use it for every containment
  check.
- Resolve every candidate file with `realpath` (or open with no-follow semantics)
  and verify it is inside the canonical root before reading.
- Re-evaluate exclude patterns against the resolved real path, not only the
  lexical path, to prevent a symlink from re-introducing an excluded directory.
- Use `path.relative` containment, not string prefix checks. Handle `..`,
  absolute paths, Windows drive paths, UNC paths, trailing separators and
  case-insensitive filesystems.
- Deduplicate directories and files by canonical path; consider inode/device
  deduplication for hardlinks as a residual improvement.

### C-03 — Read allowlist and no-follow policy

- Only classified Compose, Nginx and Caddy files, decision YAML, the config file
  and the snapshot explicitly passed to `ui` may be read.
- Never follow Compose `include`/`extends`, `env_file`, `secrets`, Nginx
  `include` or Caddy `import`. Emit a warning and continue.
- Never read bind-mount contents. Document the mount source and warn when it is
  outside root, but do not open it.
- Never call Docker, a shell, a network API or a package manager from the
  scanner.

### C-04 — File preflight and TOCTOU reduction

- Use `lstat`/`realpath` and a size check before reading where possible; enforce
  the limit again after reading.
- Reject binary/NUL content, oversized files, non-regular files, dangling
  symlinks and unsupported encodings with a warning.
- Apply a total-byte budget in addition to per-file limits.
- Do not assume `stat` and `readFile` describe the same object. Prefer opening
  the resolved path once and reading from that handle. Document remaining
  TOCTOU as residual.

### C-05 — Parser resource limits

- Every parser MUST have explicit limits for: input bytes, line count, token
  count, nesting depth, mapping/sequence size, alias expansion count and total
  output nodes.
- Wrap every parser invocation in a `try/catch`; a `RangeError`, timeout or
  unexpected exception MUST become a warning for that file, not a process crash.
- Compose YAML MUST keep `uniqueKeys: true` and `maxAliasCount: 100` (or
  stricter). Config/decision YAML MUST use the same explicit options rather than
  relying on defaults.
- Reject or truncate pathological nesting with a clear diagnostic. Do not rely
  on the JS call stack as a limit.
- Nginx/Caddy tokenizers MUST cap token count and must not recursively descend
  without a depth counter.

### C-06 — Secret minimization

- Never store Compose environment values, `env_file` contents, `secrets`
  contents, arbitrary label values, command lines, healthcheck command bodies or
  file contents.
- Store only allowlisted metadata: key names, paths, ports, image references,
  build context (subject to C-21), upstreams (redacted), evidence and source
  locations.
- Redact credentials from proxy targets before storing:
  `scheme://user:pass@host` and bare `user:pass@host` forms. Prefer storing
  `host` plus a `credentialPresent: true` marker rather than the raw value.
- Treat decision free text as user-authored content that may contain secrets;
  document that snapshots/docs are not a secret store.
- The backup-policy label value is currently stored; keep it only for the
  documented `infrajournal.backup`/`infrajournal.backup-policy` keys, and warn
  that arbitrary label values are not collected.

### C-07 — Redaction and safe diagnostics

- Apply redaction to every human-visible string: warnings, suggestions, config
  errors, parser errors, CLI stderr, `--verbose` output, docs and UI.
- Redact at the boundary where text is emitted, not only when constructing
  warnings.
- Never include raw file contents or multi-line source snippets in errors.
- Test with sentinel secrets in environment values, `env_file`, labels, YAML
  malformed lines, URLs with userinfo, bearer tokens, private keys and query
  parameters.
- Treat redaction as best-effort; do not claim it is a secret scanner.

### C-08 — Markdown and HTML encoding

- Treat every snapshot string as untrusted text. Escape Markdown metacharacters
  in inline text, headings, tables, link labels and code fences.
- Do not emit raw HTML from untrusted values. If raw HTML is ever required, it
  MUST be generated from a fixed template and never interpolate untrusted
  strings.
- Encode link destinations; allow only `https:`, `http:` and relative links for
  untrusted values. Reject `javascript:`, `data:`, `vbscript:` and control
  characters.
- Prevent fence breakout (backticks/tildes), table-cell breakout (`|`, newlines),
  HTML tag injection (`<`, `>`, `&`) and YAML front-matter injection (`---` at
  line start).
- Prefer a documented, tested escaping function over ad-hoc `replace` calls.

### C-09 — Mermaid and graph encoding

- Prefer React-rendered graph labels over raw Mermaid for the dashboard.
- If Mermaid is generated, quote and entity-encode every label, strip newlines
  and quotes, and never emit `click`, `href` or `linkStyle` directives from
  untrusted data.
- Do not interpolate untrusted strings into Mermaid syntax positions (node IDs,
  subgraph names, direction statements, class names).
- Test labels containing quotes, brackets, braces, semicolons, `#`, newlines and
  `javascript:`.

### C-10 — Dashboard safe rendering

- Use React text interpolation for all snapshot strings. No
  `dangerouslySetInnerHTML`, no raw HTML renderer (`rehype-raw`), no
  `innerHTML`, no `eval`/`new Function`.
- Build links from an allowlist: relative paths, `https:` only, and never
  interpolate an untrusted domain directly into an `href` without a scheme
  allowlist.
- Do not load external scripts, fonts, images, styles or telemetry. All assets
  ship in the build.
- Validate the snapshot against the shared schema before rendering; show a safe
  error state for invalid data.
- Apply a restrictive CSP (`default-src 'self'`, no `unsafe-eval`; `style-src`
  only as required by the build) and standard security headers.
- Cap displayed graph size and provide a safe fallback for very large snapshots.

### C-11 — Local server isolation

- Bind only `127.0.0.1` (and, if supported, `::1`); never `0.0.0.0`, LAN
  interfaces or a user-controlled host.
- Validate the `Host` header against an allowlist of loopback names/ports
  (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`). Reject others with
  403 to mitigate DNS rebinding.
- Validate `Origin` for `/api/*`; do not emit wildcard CORS. Prefer no CORS at
  all, since the UI is same-origin.
- Allow only `GET`/`HEAD` (and reject request bodies). No directory listing, no
  dotfiles, no source maps unless explicitly intended.
- Normalize and canonicalize static paths; reject `..`, encoded separators,
  null bytes, backslashes on Windows, absolute paths and symlinks that escape
  the web root.
- Serve explicit MIME types with `X-Content-Type-Options: nosniff`; set
  `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`,
  `Cache-Control: no-store` for the API and a restrictive CSP for HTML.
- Cap snapshot and request sizes; return a clear error rather than buffering
  unbounded input.

### C-12 — Process execution safety

- Do not use `child_process.exec`, `execSync`, shell strings or `eval`/
  `new Function` anywhere in the CLI.
- If a browser must be opened, use `spawn`/`execFile` with an argument array and
  `shell: false`; construct the URL only from a validated numeric port and a
  fixed loopback host.
- Never pass scanned paths, service names, domains or snapshot text to a shell.
- Do not dynamically import or execute scanned files or generated content.

### C-13 — Write containment and preservation

- The documentation writer MUST resolve the output directory once, verify it is
  inside the allowed output root, and create files only with filenames derived
  from slugified IDs (never raw service/domain/decision names).
- Refuse to follow a symlink in the output path; use `lstat`/no-follow and write
  a temporary file in the same directory followed by an atomic rename.
- Before overwriting an existing file, require the exact generated marker.
  Files without the marker MUST be preserved and reported.
- Never write to the scan input tree except the configured output/decisions
  directories. Never rewrite the baseline in `check`.
- `init` MUST NOT overwrite an existing config without `--force`, and `--force`
  must be explicit.
- Do not create a generated `compose.yml`/`Caddyfile`/Nginx conf inside the
  scanned tree, or ensure generated output is always excluded from scanning.

### C-14 — Bounded resource use

- Enforce per-file, total-byte, file-count, directory-count, depth, unsupported
  path count, token count, parser node count and elapsed-time budgets.
- Enforce snapshot size and resource-count limits (services, networks, volumes,
  domains, endpoints, edges, graph nodes, decisions, warnings).
- Fail gracefully: skip the offending file/directory with a warning, or abort
  with a clear config/resource error when the global budget is exceeded.
- Do not let `maxFiles` be bypassed by unsupported files or by decision reads.

### C-15 — Graph complexity

- Make inferred-dependency detection linear or bounded (index services by name
  and image category; cap candidate scans).
- Cap edges/nodes and document truncation. The UI must not attempt to lay out an
  unbounded graph; provide filtering/paging or a safe “too large” state.
- Ensure deterministic ordering remains stable under truncation.

### C-16 — Supply chain

- Commit and use `pnpm-lock.yaml`; CI MUST install with `--frozen-lockfile`.
- Keep `allowBuilds` minimal; review any install script.
- Run dependency audit/license checks in CI; document accepted exceptions.
- Pin the registry and avoid `latest`; review transitive dependencies of the
  bundled CLI and the Vite build.
- No CDN, remote font, remote image or telemetry call in the dashboard.
- Publish with provenance/SBOM when the npm package is released; verify
  `pnpm pack --dry-run` contains only intended files.
- CI workflows were absent at audit time; add least-privilege permissions and no
  secrets for pull requests from forks.

### C-17 — Snapshot input trust

- `parseSnapshot` MUST cap input bytes and JSON parse depth before/while
  parsing.
- Validate with the strict schema; reject unknown fields and invalid IDs.
- `contentHash` is an integrity check, not a signature. Do not present a
  matching hash as proof of authenticity.
- Warn when loading an external snapshot and show its source path without
  reflecting it as HTML.
- Treat schema-valid snapshot strings as untrusted for rendering.

### C-18 — Determinism and filename safety

- IDs MUST remain deterministic, filesystem-safe and collision-resistant enough
  for filenames. Continue using `slugify`/hashes; never use raw names as paths.
- Document how collisions are handled (e.g., hash suffix) and test them.
- Source paths in snapshots MUST be POSIX-relative to root; never absolute.
- Keep timestamps out of IDs and content hashes.

### C-19 — Cross-platform behavior

- Unit-test `path.win32` behavior for drive letters, UNC paths, backslashes,
  case-insensitivity and reserved names.
- Test on Linux and Windows in CI once workflows exist.
- Normalize paths for display but never lose the distinction between host and
  container paths in evidence.

### C-20 — Server lifecycle

- Bind/announce only loopback URLs. Port fallback applies only when no explicit
  port was requested; an explicit busy port fails clearly.
- Handle `SIGINT` by closing the listener and exiting cleanly.
- Do not keep a listener alive after the command exits or write a PID/socket
  file outside a temp directory.
- Do not open a browser automatically unless it is a documented, opt-in
  behavior; use C-12.

### C-21 — Privacy of generated artifacts

- Document that snapshots and docs contain topology, domains, image names,
  paths and decision context, and should be reviewed before publishing.
- Decide and document a policy for host paths outside root: either store the raw
  value (current behavior) with a warning, or normalize to a placeholder such as
  `[outside scan root]`. Consistency matters more than the choice.
- Do not store absolute paths in `source.file`; keep `mounts.source`,
  `build.context` and `envFiles` subject to the chosen policy.
- Provide a “share safely” note in `README`/`SECURITY.md`/`docs/limitations.md`.

### C-22 — Security regression suite

- Add tests for every AC in §8 before Phase 2 sign-off. Security tests belong in
  `packages/core/test/security/`, `packages/cli/test/`,
  `packages/documentation/test/` and `apps/web/src/**/*.test.tsx`.
- Use sentinel secrets in fixtures; assert absence in serialized output, not
  only in UI text.
- Add property/fuzz tests for path handling, YAML aliases, parser nesting and
  Markdown escaping if feasible.
- Keep fixtures small and deterministic; do not commit real credentials.

---

## 8. Testable acceptance criteria

Each criterion is written to be automated. “Test” means a Vitest test (unit or
integration) or a static check in CI. A criterion is not satisfied by a code
comment or documentation alone.

### Paths and reads

- **AC-01 (TM-01):** Given a config in a temporary directory with
  `scan.root: /tmp/outside`, `loadConfig` rejects it by default (or requires an
  explicit `--allow-outside-root`); a test asserts no file outside the config
  directory appears in `files[]`. A config with `scan.root: .` still works.
- **AC-02 (TM-05):** Given `output.directory: ../outside` or an absolute path
  outside the scan root, config loading or `generate` rejects it by default
  (unless an explicit operator flag is supplied); a test asserts no file is
  created outside the root.
- **AC-03 (TM-01):** Include/exclude patterns with a leading `/`, drive letter,
  UNC prefix or `..` segment are rejected with `ConfigError`; a test covers each
  form.
- **AC-04 (TM-02, TM-21):** A symlink inside root pointing to `/etc/passwd` (or a
  temp sentinel outside root) is skipped with `IJ021`/`BROKEN_SYMLINK`; a spy on
  `fs.readFile` shows the target was never read.
- **AC-05 (TM-02):** A directory symlink inside root pointing outside root is
  skipped; `walk` does not descend into it and does not emit outside paths.
- **AC-06 (TM-02):** A symlink inside root pointing to an excluded directory
  inside root (e.g., `node_modules`) is excluded after realpath resolution; its
  files do not appear in `files[]`.
- **AC-07 (TM-03):** `decisions.directory: ../outside` is rejected; a decision
  file symlink outside root is skipped with `SYMLINK_ESCAPE` and not parsed.
- **AC-08 (TM-04):** Fixtures with Compose `include`, `env_file`, `secrets`, an
  Nginx `include` and a Caddy `import` produce warnings; a read spy proves the
  referenced files are never opened.
- **AC-09 (TM-04):** A Compose bind mount to a sentinel file outside root is
  recorded as a mount and produces `IJ025`; the sentinel is never read.
- **AC-10 (TM-17):** Binary, oversized, unreadable, non-regular and unsupported
  files are skipped with the expected diagnostic; only classified files reach a
  parser.

### Writes and preservation

- **AC-11 (TM-05):** The documentation generator writes only under the resolved
  output directory. A service named `../../escape` or `a/b` produces a slugified
  filename, never a path traversal.
- **AC-12 (TM-16):** A pre-existing non-generated file in the output directory is
  preserved byte-for-byte and reported as preserved; a generated file carrying
  the exact marker is replaced.
- **AC-13 (TM-05, TM-21):** If the output directory or a target file is a symlink
  to outside root, generation fails or skips with a clear error; the outside
  target is not modified.
- **AC-14 (TM-16):** `scan` performs no writes by default; `check` never writes
  the baseline; `init` refuses to overwrite without `--force`. Tests spy on
  `fs.writeFile`/`fs.rename` and assert the expected call set.
- **AC-15 (TM-16):** A simulated write failure leaves no partial generated file;
  a temporary file is cleaned up and the original is unchanged.

### Secrets

- **AC-16 (TM-06, TM-12):** A fixture containing sentinel environment values,
  `env_file` contents, label values and secret files produces a serialized
  snapshot, Markdown docs and JSON export that do not contain any sentinel.
- **AC-17 (TM-06):** `proxy_pass http://alice:s3cr3t@backend:3000` and
  `http://alice:s3cr3t@backend` are stored/reported without `s3cr3t`; the
  snapshot and warnings contain a redacted host/marker instead. This test fails
  against the current baseline and must pass before release.
- **AC-18 (TM-07):** A malformed YAML line containing a sentinel secret produces
  CLI stderr (normal and `--verbose`) without the sentinel; no raw file content
  or multi-line snippet is printed.
- **AC-19 (TM-23):** The snapshot contains no absolute host path in
  `source.file`; `mounts.source`, `build.context` and `envFiles` follow the
  documented outside-root policy, and a test asserts the chosen representation.
- **AC-20 (TM-23):** Decision records with free-text sentinels are either
  intentionally included with a documented warning or redacted per policy; the
  test asserts the documented behavior, including docs/UI output.

### Parser robustness

- **AC-21 (TM-08):** YAML alias bombs, duplicate keys, deep nesting and huge
  scalars in Compose/config/decision files produce a bounded error/warning
  within the test timeout; no uncaught exception escapes `scanProject`.
- **AC-22 (TM-09):** A generated Nginx file with 10,000 nested `server {` blocks
  returns a parse error/warning instead of `RangeError`; the test asserts
  `scanProject` resolves and the warning code is present.
- **AC-23 (TM-09):** Caddy nested blocks and unterminated quotes at the limit
  produce a warning, not a crash; token count and depth are capped.
- **AC-24 (TM-08, TM-17):** A file larger than `maxFileSizeBytes` is rejected
  before a full read (or with a bounded read); a total-byte budget stops a
  multi-file scan with a clear warning.
- **AC-25 (TM-17):** `maxFiles`, `maxDepth`, `maxDirectories` and
  `maxUnsupportedPaths` are enforced; a tree of 100,000 empty directories and a
  directory full of unsupported files do not exhaust memory or exceed the
  timeout.
- **AC-26 (TM-18):** A generated Compose file with a large number of services is
  processed in bounded time; inferred-dependency detection is linear or capped;
  a resource cap warning is emitted when the graph is truncated.
- **AC-27 (TM-18, TM-20):** A snapshot above the configured byte/node limit is
  rejected before rendering; a valid large snapshot produces a safe UI state
  rather than a freeze.

### Rendering

- **AC-28 (TM-10):** A fixture with service/domain names containing
  `</script>`, `<img onerror=...>`, `[x](javascript:...)`, `|`, backticks,
  newlines, `---` and HTML entities produces Markdown with no raw HTML, no
  executable link, intact tables and intact fences.
- **AC-29 (TM-11):** A Mermaid fixture with quotes, brackets, semicolons,
  newlines and `javascript:` is encoded/neutralized; no `click` or `href`
  directive derived from untrusted data is emitted.
- **AC-30 (TM-04b, TM-11):** A UI test renders a snapshot with malicious names,
  warnings and decision text; no script executes, no `dangerouslySetInnerHTML`
  is used, and every link has an allowed scheme.
- **AC-31 (TM-04b):** The built dashboard makes no external network request and
  includes the documented CSP; a test or build assertion checks for CDN/font
  URLs and `dangerouslySetInnerHTML`.

### Server

- **AC-32 (TM-13):** `ui` binds only `127.0.0.1`/`::1`; the test inspects the
  listener address and asserts a non-loopback address is never used.
- **AC-33 (TM-13):** A request with `Host: evil.example` or a cross-site
  `Origin` receives 403; no `Access-Control-Allow-Origin: *` is emitted.
- **AC-34 (TM-14):** Requests for `../`, `..%2f`, `%2e%2e`, `%00`, backslash
  traversal, absolute paths and symlinked files outside `web-dist` return 404;
  no directory listing is served.
- **AC-35 (TM-14):** Static responses include correct MIME types and
  `X-Content-Type-Options: nosniff`, CSP, `Referrer-Policy`,
  `Cross-Origin-Resource-Policy` and `Cache-Control: no-store` for the API.
- **AC-36 (TM-20):** `--snapshot` rejects an oversized or invalid JSON file with
  a clear error; a valid snapshot is served without reflecting its path as HTML.
- **AC-37 (TM-13, TM-20):** An explicit busy `--port` fails clearly; the default
  port fallback tries the documented range and prints a loopback URL only.
- **AC-38 (TM-13):** `SIGINT` closes the listener and the process exits; no
  orphan listener remains.

### Execution and packaging

- **AC-39 (TM-15):** A static test asserts no `child_process.exec`/`execSync`,
  shell string, `eval`, `new Function` or dynamic import of scanned content in
  `packages/cli`/`packages/core`.
- **AC-40 (TM-15):** If browser opening exists, it uses `spawn`/`execFile` with
  `shell: false` and an argument array; a test stubs the spawn and asserts the
  URL contains only the validated loopback host and numeric port.
- **AC-41 (TM-19):** `pnpm pack --dry-run` contains only intended files
  (`dist`, `web-dist` when built, README, LICENSE), the bin is executable, and
  the bundle contains no unexpected runtime dependency.
- **AC-42 (TM-19):** CI uses `pnpm install --frozen-lockfile`, runs lint,
  typecheck, tests, build and a dependency audit; no install script runs outside
  the allowlist.

### Determinism and cross-platform

- **AC-43 (TM-18):** Two scans of the same fixture produce identical IDs, graph
  nodes/edges and content hashes; only `generatedAt` differs.
- **AC-44 (TM-18):** `computeContentHash` is stable across key insertion order
  and excludes `metadata`; a modified resource changes the hash.
- **AC-45 (TM-25):** `parseSnapshot` accepts a canonical round trip and rejects
  unknown fields, invalid IDs, invalid dates and invalid hashes; `check` reports
  missing/invalid baselines distinctly.
- **AC-46 (TM-22):** `path.win32` tests cover drive letters, UNC paths,
  backslashes, mixed case and reserved names; a Windows CI job (once workflows
  exist) runs the same containment tests.

---

## 9. Non-goals

InfraJournal explicitly does **not** provide, and this threat model does not
assume:

1. **Runtime discovery or security assessment.** It reads static configuration
   files. It does not query Docker, Kubernetes, a cloud API or a live host. A
   warning such as “service publishes a host port” is documentation, not proof
   that a port is reachable or vulnerable.
2. **A secret scanner or DLP system.** Redaction is best-effort. Snapshot fields
   and decision text may contain sensitive metadata; users must review artifacts
   before sharing them.
3. **A sandbox.** Parsers run in the same Node.js process with the user's
   privileges. Resource limits reduce, but do not eliminate, denial-of-service
   risk. There is no seccomp/container isolation.
4. **Authentication or multi-user authorization.** The dashboard is a
   single-user loopback tool. Any local process or user that can reach the
   loopback port may be able to read the snapshot; loopback binding and Host/
   Origin checks are mitigations, not authentication.
5. **Protection against a compromised host, root, browser extension, terminal,
   editor, shell wrapper or dependency.** Those are outside the tool's trust
   boundary.
6. **Following includes, imports, `env_file`, secrets or bind mounts.** This is
   deliberate. InfraJournal documents references and warns; it does not read the
   referenced content.
7. **Compose interpolation, multi-file merging, `extends`, Nginx `map`/
   `if`/regex evaluation, or Caddy plugin evaluation.** Unsupported constructs
   are warned about and left literal.
8. **Writing to or remediating inspected infrastructure.** The tool is
   read-only with respect to infrastructure; it only writes documentation and
   snapshots under the configured output.
9. **Guaranteeing the safety of third-party Markdown/Mermaid renderers.**
   GitHub, GitLab, VS Code, static-site generators and IDE previews differ.
   Generated docs should be reviewed before publishing.
10. **A substitute for a professional security audit, penetration test or
    compliance assessment.**

---

## 10. Residual risks

These remain after the controls above are implemented:

- **Bind mounts are documented but never read.** A bind mount may point at a
  secret directory; InfraJournal records the path and warns, but cannot know
  what is there. The path itself may be sensitive.
- **Symlink/TOCTOU races.** A malicious local process can swap a symlink between
  resolution and open/write. Using resolved paths and no-follow writes reduces
  but does not eliminate this. A same-user attacker is outside the threat model.
- **Parser denial of service within limits.** A sufficiently large but
  under-budget file can still consume CPU. The limits bound the worst case; they
  do not make parsing free.
- **Redaction false negatives and false positives.** The regex-based helper
  cannot recognize every credential format (JWTs, base64 blobs, custom schemes,
  multi-line secrets) and may over-redact legitimate values. Secret
  minimization is the primary control; redaction is secondary.
- **Snapshot metadata is inherently sensitive.** Even with credentials removed,
  topology, internal domains, image names, backup policies and decision text can
  aid reconnaissance.
- **Local server exposure.** Loopback binding and Host/Origin checks mitigate
  DNS rebinding, but a local process, a malicious browser extension, a
  compromised browser or an OS-level attacker may still read the API. There is
  no authentication.
- **Generated-marker spoofing.** A user or attacker can copy the marker into an
  unrelated file; the writer will treat it as generated. The marker is a
  safety heuristic, not an authenticity proof.
- **Supply-chain compromise.** A compromised dependency, build tool, registry
  or CI credential can produce malicious output despite source review. Lockfile
  pinning, audits, minimal install scripts and provenance reduce but do not
  remove this.
- **Renderer differences.** Escaping that is safe for CommonMark may behave
  differently in a renderer that enables raw HTML or Mermaid. Documentation
  should state the supported renderer assumptions.
- **Decision free text.** Users can paste secrets into decision records; the tool
  will faithfully publish them. Documentation must warn about this.
- **External snapshots are untrusted even when schema-valid.** A valid snapshot
  can contain malicious strings; validation does not sanitize content.
- **Windows path semantics** may differ from the POSIX CI environment; until
  Windows tests exist, containment is not fully verified there.
- **Integrity is not authenticity.** `contentHash` detects accidental changes; it
  does not prove who produced a snapshot.

---

## 11. Review checklist for Phase 2

Use this checklist once the implementation exists. “Status” is intentionally
blank for planned modules; fill it during the final audit.

### Core and configuration

- [ ] `packages/core/src/config/schema.ts` — strict objects, bounded limits,
      no unbounded string/path fields, output/decisions policy documented.
- [ ] `packages/core/src/config/load-config.ts` — root containment, output
      containment, absolute/`..` glob rejection, config size, duplicate-key and
      alias policy, redacted errors, no file-content echo.
- [ ] `packages/core/src/discovery/discover.ts` — realpath containment, exclude
      re-check after resolution, directory/file dedupe, depth/file/dir/
      unsupported budgets, deterministic order, no follow of outside symlinks.
- [ ] `packages/core/src/discovery/read-file.ts` — preflight size/type, binary
      rejection, total-byte budget, TOCTOU note, encoding behavior.
- [ ] `packages/core/src/decisions/load-decisions.ts` — directory containment,
      symlink handling, file/depth/size/total budgets, strict schema, duplicate
      IDs, free-text policy.
- [ ] `packages/core/src/parsers/compose.ts` — `uniqueKeys`, `maxAliasCount`,
      nesting/token limits, no interpolation evaluation, env values/env_file/
      secrets not read, label allowlist, build context policy, parser try/catch.
- [ ] `packages/core/src/parsers/nginx.ts` — token/depth caps, unterminated
      string handling, no include following, no variable/regex/conditional
      evaluation, credential redaction in messages/upstreams.
- [ ] `packages/core/src/parsers/caddy.ts` — token/depth caps, unterminated
      string handling, no import following, no placeholder evaluation, target
      redaction.
- [ ] `packages/core/src/scan/scan.ts` — no writes/exec, resource caps, linear
      inference, raw-field redaction, warning redaction, source paths relative,
      parser exceptions contained.
- [ ] `packages/core/src/scan/from-config.ts` — output/decisions excluded from
      scanning, root containment preserved.
- [ ] `packages/core/src/model/ids.ts` — filename-safe slugs, collision policy,
      no raw names in filenames.
- [ ] `packages/core/src/model/schema.ts` — strict objects, ID regex, no
      secret-bearing fields, snapshot size/shape limits.
- [ ] `packages/core/src/serialization/snapshot.ts` — input-size cap, strict
      parse, canonical hash, no secret leakage, error redaction.
- [ ] `packages/core/src/diagnostics/*.ts` and `utils/redact.ts` — redaction
      coverage, sentinel tests, no file-content snippets.
- [ ] `packages/core/src/graph/build.ts` — node/edge caps, deterministic order,
      label safety.

### CLI (planned)

- [ ] `packages/cli/src/index.ts` and command modules — argument validation,
      exit codes 0/1/2/3/4, JSON stdout isolation, no shell, no `eval`.
- [ ] `init` — no overwrite without `--force`, template validates.
- [ ] `scan` — no writes by default; `--output` atomic and redacted.
- [ ] `generate` — containment, marker preservation, atomic writes, symlink
      refusal.
- [ ] `check` — baseline read-only, size/schema validation, missing/invalid
      baseline behavior, no false-clean report.
- [ ] `ui` — loopback bind, Host/Origin checks, port behavior, static traversal,
      MIME/headers, snapshot size cap, SIGINT cleanup.
- [ ] `tsup.config.ts` / `scripts/copy-web.mjs` — bundle contents, shebang,
      no unexpected runtime deps, web-dist absent handling.

### Documentation package (planned)

- [ ] `packages/documentation/src/**` — Markdown escaping, table/fence/front-
      matter safety, Mermaid encoding, no raw HTML, link scheme allowlist.
- [ ] Generated marker exactness and preservation logic.
- [ ] Output filename derivation from IDs only; collision handling.
- [ ] Drift report escaping and baseline trust model.
- [ ] Tests with malicious service/domain/decision fixtures.

### Web dashboard (planned)

- [ ] `apps/web/src/**` — React escaping, no `dangerouslySetInnerHTML`/raw HTML,
      href scheme allowlist, no external network calls.
- [ ] Snapshot schema validation and safe error states.
- [ ] Graph label/tooltip/detail-panel safety; large-graph cap.
- [ ] CSP/security headers and production build behavior.
- [ ] Accessibility of warnings/decisions (not security-critical but part of QA).
- [ ] Tests with XSS/HTML/Mermaid fixtures.

### Packaging, CI and docs

- [ ] `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` — frozen lockfile,
      minimal `allowBuilds`, no unnecessary postinstall.
- [ ] `.github/workflows/**` — least privilege, no secrets on forks, matrix
      including Windows, audit/typecheck/test/build.
- [ ] `README.md`, `SECURITY.md`, `docs/limitations.md` — snapshot sensitivity,
      local-server threat model, read-only scope, non-goals, reporting channel.
- [ ] `examples/**` — no real credentials; sentinel secrets only.
- [ ] `docs/audit-final.md` — reproduce every AC, record pass/fail and evidence,
      assign severity, and list residual risks.

---

## 12. Questions for the orchestrator

1. **Root policy.** Should a repository `infrajournal.yml` be allowed to set
   `scan.root` outside the repository? If yes, what explicit opt-in flag or
   confirmation is required? If no, `loadConfig` needs a containment check before
   release.
2. **Output policy.** Should `output.directory` be required inside the scan root?
   Current code only rejects the filesystem root. A writer that follows the
   current contract could write anywhere the user can write.
3. **Generated marker contract.** What is the exact marker line, and where must
   it appear for preservation? This must be fixed before docs tests can assert
   “non-generated files are preserved.”
4. **Path privacy policy.** Should `mounts.source`, `build.context`, `envFiles`
   and similar outside-root paths be stored verbatim (current behavior) or
   normalized to a placeholder? This affects snapshot usefulness and privacy.
5. **Local server authentication.** Is Host/Origin validation considered
   sufficient for a loopback-only dashboard, or should `ui` generate a per-run
   token in the URL/API? Token-based access adds friction but strengthens the
   local threat model.
6. **`--snapshot` limits.** What maximum snapshot size and resource count should
   `ui` accept? Should a snapshot from an arbitrary path require confirmation?
7. **Renderer contract.** Which Markdown/Mermaid renderer is authoritative for
   the generated docs (GitHub, GitLab, VS Code, static site)? Escaping and
   feature choices depend on whether raw HTML/Mermaid is enabled.
8. **Windows support.** Is Windows a first-class target for the first release?
   If yes, CI must include it and containment tests must use `path.win32`.
9. **Supply-chain baseline.** What audit/provenance policy is expected for the
   first npm release (frozen lockfile, `pnpm audit`, SBOM, provenance), and
   which accepted advisories are tolerable?
10. **Test ownership.** The core/CLI/frontend agents own their tests; should the
    QA pass add security tests under `packages/*/test/security/`, or only report
    failures with suggested tests? The current agent contract forbids QA edits
    outside `docs/audit-*.md`, so the orchestrator must apply the tests.

---

## Appendix A — Phase 2 verification plan

1. Re-inventory the tree; confirm which modules moved from PLANNED to
   IMPLEMENTED.
2. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and record
   evidence.
3. Execute every AC in §8, including negative and adversarial fixtures; record
   pass/fail with file/line references.
4. Reproduce P-01 through P-09 and assign final severity (Critical/High/Medium/
   Low) with exploitability and impact.
5. Inspect generated Markdown and the built dashboard with malicious fixtures;
   verify escaping and CSP.
6. Probe the local server with traversal, Host/Origin, oversized snapshot and
   port-conflict cases.
7. Verify packaging with `pnpm pack --dry-run` and inspect the bundled CLI for
   unexpected dependencies.
8. Produce `docs/audit-final.md` with severity-ordered actionable findings,
   file/line references, test evidence and residual risks.
