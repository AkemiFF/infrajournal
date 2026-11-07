# CLI reference

Install version `0.1.1` with `npm install --global infrajournal`, or run
`npx infrajournal --help` without a global installation. From a built source
checkout, substitute `node packages/cli/dist/index.js` for `infrajournal`
when running from the repository root. `--help` lists current options;
`--version` prints the CLI version. The global `--verbose` shows error stacks
where available and can reveal sensitive input: use with care.

| Command    | Options                                                                       | Effect                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`     | `--force`                                                                     | Write `infrajournal.yml` in the current directory. Refuses to replace an existing file without `--force`.                                           |
| `scan`     | `--root <dir>`, `--config <file>`, `--format text\|json`, `--output <file>`   | Print summary (text default) or snapshot JSON. `--output` atomically writes snapshot JSON in either format; text mode also prints the written path. |
| `generate` | `--root <dir>`, `--config <file>`, `--output <dir>`                           | Scan and write generated Markdown and `snapshot.json`. `--output` overrides the configured output directory.                                        |
| `check`    | `--root <dir>`, `--config <file>`, `--baseline <file>`, `--format text\|json` | Compare current scan to the baseline (default `<output.directory>/snapshot.json`). Never updates baseline.                                          |
| `ui`       | `--root <dir>`, `--config <file>`, `--snapshot <file>`, `--port <number>`     | Serve a new scan or a supplied snapshot locally. `--snapshot` bypasses scanning.                                                                    |

`--root` overrides `scan.root` and is resolved from the current working
directory. `--config` chooses a YAML config relative to the current working
directory. Without `--config`, InfraJournal looks for `infrajournal.yml`, then
`infrajournal.yaml`, **in `--root` when provided**, or in the current working
directory otherwise. Generated output and decisions paths are relative to the
resolved scan root (not to the config file). `--output` and `--baseline` are
relative to the current working directory. `init` always writes in the current
working directory.

## Exit codes

| Code | Meaning                                                     |
| ---: | ----------------------------------------------------------- |
|    0 | Success; for `check`, no drift.                             |
|    1 | Unexpected runtime error (including invalid baseline JSON). |
|    2 | Command usage or configuration error.                       |
|    3 | `check` found drift.                                        |
|    4 | `check` could not find the baseline.                        |

If you use `set -e` or CI, allow exit 3 when you want to inspect a drift
report: it is not a successful run. CLI errors go to stderr; text/JSON scan and
check output go to stdout. For an unsupported `--format`, the CLI exits 2.

## JSON modes

`scan --format json` writes **only** a versioned snapshot to stdout. The
snapshot has `schemaVersion`, `project`, `services`, `networks`, `volumes`,
`domains`, `endpoints`, `external`, `dependencies`, `graphNodes`, `warnings`,
`decisions`, `files`, `stats` and `metadata`. Each warning has a code, severity,
message and related IDs; metadata includes `generatedAt` and `contentHash`.
See [architecture](architecture.md) for the full snapshot contract.

`check --format json` emits a drift report, not a snapshot:

```json
{
  "identical": true,
  "baseline": { "schemaVersion": "1.0.0", "generatedAt": "...", "contentHash": "..." },
  "current": { "schemaVersion": "1.0.0", "generatedAt": "...", "contentHash": "..." },
  "summary": {
    "added": 0,
    "removed": 0,
    "changed": 0,
    "total": 0,
    "byCategory": {
      "project": 0,
      "service": 0,
      "network": 0,
      "volume": 0,
      "domain": 0,
      "endpoint": 0,
      "external": 0,
      "dependency": 0,
      "warning": 0,
      "decision": 0,
      "file": 0
    }
  },
  "changes": []
}
```

This is a **shape illustration**, not a captured result; timestamps and hashes
are placeholders. A changed entry has `category`, `id`, `name`, `type`
(`added`, `removed`, `changed`) and `fields` (each with `field`, `before`,
`after` strings). Drift comparison ignores snapshot metadata, evidence reason
and source locations; it compares modeled resources, warning messages, decisions
and file paths/kinds. An unchanged comment alone is not drift.

## Examples

```bash
infrajournal scan --root examples/multi-service --format json > snapshot.json
infrajournal generate --root examples/multi-service --output ./demo-docs
infrajournal check --root examples/multi-service --baseline ./demo-docs/snapshot.json
infrajournal ui --snapshot ./demo-docs/snapshot.json
```

With `--root examples/multi-service`, the example's `infrajournal.yml` is
loaded automatically, including its project name and backup policies. To use a
different configuration, pass `--config <file>` explicitly.

`ui` binds only to `127.0.0.1`. Its default is port 4173; on collision it tries
up to 20 higher ports and prints the selected URL. With `--port`, a busy port
is an error; valid explicit ports are 1–65535. It serves an in-memory snapshot
at `/api/snapshot`, does not hot reload and stops with Ctrl+C. Build the web
bundle with `pnpm build` first **only when working from source**; the npm package
already includes dashboard assets.

### Windows

Use PowerShell paths for `--root`, `--config`, `--output` and `--baseline` and
quote paths containing spaces. For example, from the repository root:

```powershell
node .\packages\cli\dist\index.js scan --root .\examples\multi-service --format json > snapshot.json
```

Snapshot source paths use `/` on every OS. On older PowerShell versions,
redirected JSON may be UTF-16; use a UTF-8 redirect or `Out-File -Encoding
utf8` when passing it back to `--snapshot` or `--baseline`.
