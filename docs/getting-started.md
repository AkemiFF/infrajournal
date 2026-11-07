# Getting started

InfraJournal reads infrastructure configuration on disk; it does not run
containers. Install the published `0.1.1` release with Node.js >=22.12:

```bash
npm install --global infrajournal
infrajournal --version
# Or run without a global installation:
npx infrajournal --help
```

The next patch release, `0.1.2`, fixes a configuration-template issue in
`infrajournal init`; use it when it becomes available.

Scanning is read-only. `init`, `generate` and `scan --output` write files only
when requested. Docker is not needed.

## Build from source

If you are contributing or want to run directly from a checkout, use pnpm 12
from the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js --help
```

Use `node packages/cli/dist/index.js` in place of `infrajournal` if you are
running the source build. The npm package already contains the web assets;
`pnpm build` is needed only for the source build.

## Start your own project

In the directory containing your Compose file, run:

```bash
infrajournal init
infrajournal scan
infrajournal scan --format json > scan.json
infrajournal generate
infrajournal check
infrajournal ui
```

`init` creates `infrajournal.yml` in the current directory and refuses to
replace one unless `--force` is supplied. A config is optional: `scan` also
works from defaults. The text scan prints inventory and diagnostics without
writing a snapshot. JSON scan prints a versioned snapshot; redirect it only
to a location you intend to retain. `generate` writes Markdown pages and
`infra-docs/snapshot.json` by default. `check` compares a new scan to that
baseline and does not update it: no change exits 0, drift exits 3, and a
missing baseline exits 4. Review changes before rerunning `generate`.
`ui` starts a local server, prints its URL and waits until interrupted.

## Try the bundled demo

From the repository root (whether using the npm CLI or a source build):

```bash
infrajournal scan --root examples/multi-service
infrajournal generate --root examples/multi-service
infrajournal check --root examples/multi-service
infrajournal ui --root examples/multi-service
```

This scenario includes Compose, Nginx, backup-policy notes and YAML decisions.
The scanner reports exposed host ports and an undocumented policy for the
`uploads` volume. Its test hostnames are examples, not live destinations.
Running `generate` writes `examples/multi-service/infra-docs/`, which is
**ignored by Git** rather than checked in. If you want to leave even the working
tree untouched, run `generate --root examples/multi-service --output ./demo-docs`
and `check --root examples/multi-service --baseline ./demo-docs/snapshot.json`.
Keep that directory outside the example scan root.

See [CLI reference](cli.md), [configuration](configuration.md),
[examples](../examples/README.md) and [limitations](limitations.md).
