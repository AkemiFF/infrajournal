# Examples

Each directory is a self-contained, parser-validated InfraJournal scenario. The
Compose files use example image names, fake hosts and placeholder credentials;
none of them is a deployable production stack. Environment variable **values**
are never stored by InfraJournal — only their names appear in snapshots.

Install the published CLI 0.1.3 (Node.js >=22.12):

```bash
npm install --global infrajournal
infrajournal --version
```

Alternatively use `npx infrajournal` in place of `infrajournal` below. If
working from source, run `pnpm install --frozen-lockfile && pnpm build` at the
repository root, then use `node ../../packages/cli/dist/index.js` from an
example directory. No Docker daemon is required.

## `simple-stack`

The smallest useful stack: an Nginx web server and PostgreSQL on one network.

```bash
cd examples/simple-stack
infrajournal scan
infrajournal generate
infrajournal ui
```

- **Demonstrates:** Compose services, a published port, a named volume mounted
  read-only, a database with a healthcheck, and warnings.
- **Expected findings:** `web` publishes host port `8080`; neither `site` nor
  `db-data` has a documented backup policy. The second finding is intentional —
  it gives the warnings view a real result.
- **No decision records** and no reverse proxy, which keeps the graph small.

## `reverse-proxy`

Caddy terminating HTTP for an application, with PostgreSQL and Redis on a
private network.

```bash
cd examples/reverse-proxy
infrajournal scan
infrajournal generate
```

- **Demonstrates:** a Caddyfile with two sites, `reverse_proxy` targets, path
  matchers, a shared edge network, and environment-key inference.
- **Expected findings:** Caddy publishes ports 80, 443/tcp and 443/udp; four
  named volumes have no documented backup policy.
- **Why the URLs use `.test`:** `notes.example.test` and
  `api.notes.example.test` are documentation-only hostnames. No certificate is
  requested and nothing is contacted.
- The literal `secret` in the example `DATABASE_URL` is a placeholder. Only the
  key name `DATABASE_URL` is recorded, never the value.

## `multi-service`

The main demo: Nginx in front of a web app and worker, PostgreSQL, Redis, three
named volumes, healthchecks, two networks and three decision records.

```bash
cd examples/multi-service
infrajournal scan
infrajournal generate
infrajournal check
infrajournal ui
```

- **Demonstrates:** Compose `depends_on` in both list and mapping form, named
  volumes with descriptions, an Nginx `upstream` block, two server names, TLS
  presence, environment-key inference, backup policies from `infrajournal.yml`,
  and linked ADRs.
- **Expected findings:** Nginx publishes host ports; the `uploads` volume has no
  documented backup policy. Decision records are included in documentation.
- **ADRs:** `infra-decisions/adr-001-postgresql.yml`,
  `adr-002-reverse-proxy.yml` and `adr-003-backups.yml`. They intentionally
  reference services that exist in the Compose file.
- **Configuration:** `infrajournal.yml` narrows `scan.include` to the Compose
  file and `nginx/**/*.conf`, and configures backup policies for `pgdata` and
  `redisdata`.

## Validating the examples

From the repository root, the installed CLI loads the example's
`infrajournal.yml` when given `--root`:

```bash
infrajournal scan --root examples/multi-service --format json \
  | jq '{project: .project.name, stats: .stats}'
```

If the CLI is not built, the examples are also used by the core test suite
during integration. Do not edit example Compose or proxy files to make output
look better; changes must remain valid for the documented parser subsets.

## What the examples deliberately do not cover

- Compose interpolation or `.env` values.
- Multi-file Compose merging, `include` or `extends`.
- Nginx `include`, `map`, regex locations or conditional routing.
- Caddy `import` or plugins.
- TLS certificate validation or runtime container state.

These are documented limitations, not bugs in the examples. See
[`docs/limitations.md`](../docs/limitations.md).
