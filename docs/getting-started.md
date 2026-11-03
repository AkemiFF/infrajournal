# Getting started

InfraJournal reads infrastructure configuration on disk; it does not run
containers. These steps use the source checkout because the npm package has
**not** been published. Requires Node.js >=22.12 and pnpm 12.

## Build from source

From the repository root:

```bash
corepack enable
pnpm install
pnpm build
node packages/cli/dist/index.js --help
```

Use `node packages/cli/dist/index.js` as the `infrajournal` command below.
The web assets are built with `pnpm build`; without them `ui` cannot start.

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

After building at the repository root:

```bash
cd examples/multi-service
node ../../packages/cli/dist/index.js scan
node ../../packages/cli/dist/index.js generate
node ../../packages/cli/dist/index.js check
node ../../packages/cli/dist/index.js ui
```

This scenario includes Compose, Nginx, backup-policy notes and YAML decisions.
The scanner reports exposed host ports and an undocumented policy for the
`uploads` volume. Its test hostnames are examples, not live destinations.
Running `generate` changes the example's checked-in `infra-docs/`; if you want
to leave the checkout untouched, use `generate --output <your-temporary-dir>`
and `check --baseline <your-temporary-dir>/snapshot.json` instead. Keep that
temporary directory outside the example scan root.

See [CLI reference](cli.md), [configuration](configuration.md),
[examples](../examples/README.md) and [limitations](limitations.md).
