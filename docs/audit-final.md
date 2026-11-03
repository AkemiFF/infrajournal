# InfraJournal integrated V1 security and QA audit

Reviewed 2026-11-03 against the current source and existing built CLI. Scope: core discovery/parsers/snapshot, documentation generation and drift, CLI HTTP server and packaging, dashboard rendering, and tests. This is a source review plus focused disposable-directory reproductions, not a penetration test. No implementation files were changed.

## Findings (severity order)

### Critical — `scan --output` can destroy the infrastructure file it just inspected

**Location:** `packages/cli/src/index.ts:142-148`, `:63-72`; related `packages/core/src/config/load-config.ts:117-119`.

`--output` is resolved without excluding the scan root or discovered input files. `atomicWrite` unconditionally renames its temporary JSON over an existing target. **Reproduced:** in a disposable root containing `compose.yml`, run `node packages/cli/dist/index.js scan --root "$ROOT" --format json --output "$ROOT/compose.yml"`; exit status was 0 and `compose.yml` began with JSON (`{"decisions":...`) instead of Compose YAML. `generate --output "$ROOT"` likewise silently replaced a pre-existing `snapshot.json` with the generated snapshot. This breaks the read-only promise and can take services down if their source config is overwritten.

**Required:** refuse any output resolving to an inspected source/config/decision path, including aliases, hard links and symlinked parents; never overwrite arbitrary existing `snapshot.json` without an explicit ownership/force policy. Validate output destinations before scanning/writing and test both CLI options against real inputs and symlink aliases. Preserve deliberately supported in-root generated output directories without permitting replacement of input files.

### High — dashboard snapshot API accepts arbitrary Host headers (DNS rebinding)

**Location:** `packages/cli/src/index.ts:237-247`, `:291-302`.

Binding to `127.0.0.1` prevents direct remote connections but does not authenticate the browser origin after a hostname resolves/rebinds to loopback. The handler ignores `Host` and serves the entire snapshot to any request for `/api/snapshot`; CSP on the dashboard page does not protect this API. **Reproduced:** while `ui --snapshot ... --port 18197` served a disposable snapshot, an HTTP request to `127.0.0.1:18197/api/snapshot` with `Host: attacker.example` received HTTP 200 and the snapshot, including the deliberately planted backup-policy marker. Exploitability through a particular browser depends on its local-network protections, so the demonstrated issue is missing server-side origin/Host enforcement, not proof of successful browser exfiltration.

**Required:** reject unexpected `Host` values (including ports/IPv6 variants), validate `Origin` and Fetch Metadata for sensitive endpoints as appropriate, and use an unguessable per-session token for the API if a browser-exposed endpoint remains. Test hostile Host headers against `/api/snapshot` and static paths.

### High — static server follows symlinks out of its asset root

**Location:** `packages/cli/src/index.ts:254-277`.

The lexical `path.resolve`/prefix check verifies only the name under `web-dist`; `fs.stat` and `fs.readFile` follow symlinks. If an asset directory contains an unintended link, the local server can return arbitrary files readable by the CLI user. **Reproduced without modifying the repository:** copied the built CLI into a disposable package tree, created `web-dist/leak.txt -> ../private.txt`, served `ui`, and requested `/leak.txt`; HTTP 200 returned `IJ_PRIVATE_FILE_444` from outside `web-dist`. This requires a pre-existing malicious/accidental link in the installed asset tree (not an HTTP-only path traversal).

**Required:** realpath-check each served file against the real asset root immediately before open, reject symlinks/non-regular files, and consider a prepack asset verification. Test in-root normal assets, external symlink files/directories, and traversal/encoded paths.

### High — a selected Compose label value bypasses the keys-only secret boundary

**Location:** `packages/core/src/parsers/compose.ts:239-250`, `:569-579`; `packages/core/src/scan/scan.ts:363-380`; `packages/documentation/src/markdown/generate.ts:789-823`; `apps/web/src/pages/Inventory.tsx:30`.

Most environment and label values are discarded, but `infrajournal.backup` / `infrajournal.backup-policy` label **values** become `volumes[].backup.policy` and are rendered in generated Markdown/UI. Config `backups[].policy` is likewise copied from `packages/core/src/scan/scan.ts:292-295`. **Reproduced:** a Compose volume with `labels: { infrajournal.backup: IJ_SECRET_BACKUP_73 }` produced that marker in `snapshot.json`; `storage.md` rendered the escaped equivalent `IJ\_SECRET\_BACKUP\_73`. Ordinary environment and unrelated label _values_ planted in the same Compose file did **not** appear. This is an allowlisted, documented policy field, not indiscriminate label ingestion, but a user treating the blanket “label values are not stored” claim as absolute can leak a credential or other confidential text into disk artifacts and the unauthenticated local API.

**Required:** state explicitly that backup policy values are retained and must not contain secrets, or replace arbitrary policy text with a bounded non-sensitive enum/flag. Add a regression test for this exception and review any future value-bearing fields before advertising keys-only behavior.

### Medium — snapshots and generated documentation are world-readable by default

**Location:** `packages/cli/src/index.ts:63-68`, `:164`; `packages/documentation/src/markdown/generate.ts:1148-1153`; `packages/core/src/scan/scan.ts:838-875`.

Both atomic writers explicitly use mode `0o644`; snapshots contain decision narratives and topology, and generated pages reproduce those details. **Reproduced:** the generated `snapshot.json` was mode `644` in a disposable root. On shared hosts, other local users may read this content unless directory permissions happen to block traversal; this is separate from the DNS rebinding issue.

**Required:** choose/document an intended confidentiality model, default to owner-only permissions for sensitive artifacts (or explicitly require a secure output directory), and test resulting permissions under a permissive umask. If public docs are intentional, provide an explicit opt-in/publication step instead.

## Evidence, coverage and non-findings

- `pnpm test` passed: core 28, documentation 13, CLI 6, web 11, root integration 4 tests. `pnpm typecheck` and `pnpm lint` passed. These results do not cover the above adversarial cases.
- Static inspection found root canonicalization and symlink containment checks during ordinary discovery (`packages/core/src/discovery/discover.ts:67-135`) and decision loading (`packages/core/src/decisions/load-decisions.ts:54-108`); no reproducible outside-root read from a stable symlink was found. Concurrent filesystem substitution between discovery and `readFile` remains a **residual race**, not a claimed proven exploit (`packages/core/src/discovery/read-file.ts:11-19`, `packages/core/src/scan/scan.ts:195-196`).
- Compose env-file references and includes are documented rather than opened (`packages/core/src/parsers/compose.ts:343-350`, `:451-462`); tested regular environment and unrelated label values did not enter the snapshot. Malformed Compose YAML with a planted environment value yielded a generic warning without that value. This does not prove universal secret redaction: decisions, names, source paths, and human-authored backup policies are persisted by design.
- React components render snapshot strings as text rather than `dangerouslySetInnerHTML`; Markdown uses dedicated escaping helpers and Mermaid node IDs are generated (`packages/documentation/src/markdown/escape.ts`, `generate.ts:314-350`). No confirmed XSS or Markdown-to-HTML injection is reported here. The architecture graph also offers keyboard-operated node index buttons (`apps/web/src/pages/Architecture.tsx:46`); a full assistive-technology audit was not performed.
- The CLI package declares built `dist` and `web-dist` in its publish list (`packages/cli/package.json`) and copies dashboard assets during build (`packages/cli/scripts/copy-web.mjs`); a published tarball was not independently packed or tested. No supply-chain vulnerability is asserted without dependency advisory evidence.

## Release decision

**Do not label this build read-only or safe to expose via the local dashboard until the critical overwrite and high server-boundary issues are addressed.** After fixes, add adversarial regression tests and repeat the same disposable-root reproductions; verify the actual packed npm artifact and dashboard UI as a separate release gate.

## Remediation update (2026-11-03, after original review)

The findings above describe the **pre-fix build**. Subsequent changes reject
output aliases of scanned source files, require existing snapshot output to be
an InfraJournal snapshot, restrict dashboard Host/Origin/Fetch Metadata, and
realpath-check served static files. Generated files are owner-only on POSIX.
Regression tests cover overwrite/hard-link protection, hostile Host and Origin
requests, symlink escape and file permissions. A read-only QA re-review found
no reproducible remaining critical/high issue among the original five findings.
Backup policy descriptions from explicit labels/configuration remain in
artifacts **by design**; never put secrets in them. Static files linked to
other assets _inside_ the asset root remain servable. This is not a complete
penetration test, and publishing still requires maintainer review.
