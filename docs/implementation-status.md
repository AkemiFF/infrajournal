# InfraJournal implementation status

Last updated: 2026-11-03

This is the orchestrator's task board. It tracks actual delivery state, not
aspirations. Update it when a wave closes.

## Architecture decisions

- pnpm workspace with `packages/core`, `packages/documentation`, `packages/cli`,
  and `apps/web`.
- TypeScript strict mode, ESM, Node.js >= 22.12.
- Zod schemas are the source of truth for the snapshot and config contracts.
- Snapshot schema version: `1.0.0`.
- Deterministic IDs are derived from Compose project/service names, resource
  names and content, never from timestamps or absolute paths.
- The CLI bundles internal packages and runtime dependencies with tsup so the
  published package has no workspace dependency gaps.
- The web dashboard is built by Vite and served by a localhost-only Node HTTP
  server from the CLI.
- Generated Markdown must carry the generated marker; files without it are
  preserved rather than overwritten.
- Drift compares normalized snapshots, ignoring ordering and metadata.

## Module ownership

| Area                                                       | Owner                  | Paths                                                                                                   |
| ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Contracts, integration, documentation package, CI, release | Orchestrator           | `packages/core/src/model`, `packages/core/src/config`, `packages/documentation`, root config, `.github` |
| Core hardening and tests                                   | `core` subagent        | `packages/core`                                                                                         |
| CLI                                                        | `cli` subagent         | `packages/cli`                                                                                          |
| Dashboard                                                  | `frontend` subagent    | `apps/web`                                                                                              |
| Docs, examples, community files                            | `docs` subagent        | README, `docs/**` (except research/audit/status), `examples/**`, `.github/ISSUE_TEMPLATE`, PR template  |
| Research                                                   | `research` subagent    | `docs/research.md`, `docs/competitive-analysis.md`                                                      |
| Security audit                                             | `qa-security` subagent | `docs/audit-*.md`                                                                                       |

## Wave status

| Wave | Task                                                                                 | Owner          | Status        | Notes                                                                          |
| ---- | ------------------------------------------------------------------------------------ | -------------- | ------------- | ------------------------------------------------------------------------------ |
| 0    | Repository inspection, architecture, contracts                                       | Orchestrator   | Done          | Empty repo confirmed; OpenCode 2.0.29; agents in `.opencode/agents/`           |
| 0    | Monorepo scaffold, dependencies, shared schemas                                      | Orchestrator   | Done          | pnpm 12, Node 22.22, TS 5.9, Vitest 5.0.5, Vite 7                              |
| 0    | Core discovery, parsers, normalization, graph, diagnostics, decisions, serialization | Orchestrator   | Baseline done | Smoke-tested against all three examples                                        |
| 1    | Competitive research                                                                 | Research agent | Done          | Verified primary sources in `docs/research.md`, `docs/competitive-analysis.md` |
| 1    | Threat model                                                                         | QA agent       | Done          | `docs/audit-threat-model.md`                                                   |
| 2    | Core tests and hardening                                                             | Core agent     | Done          | 28 core tests; parser credential handling hardened                             |
| 2    | CLI commands, local server, packaging tests                                          | Orchestrator   | Done          | `packages/cli`                                                                 |
| 2    | Dashboard                                                                            | Frontend agent | Done          | Interactive XYFlow graph and 11 web tests                                      |
| 2    | Documentation and examples                                                           | Docs agent     | Done          | README, reference docs, examples, license, community files                     |
| 2    | Markdown generators and drift engine                                                 | Orchestrator   | Done          | `packages/documentation`                                                       |
| 3    | Integration: CLI ↔ core ↔ docs ↔ UI                                                  | Orchestrator   | Done          | Full build and example workflow verified                                       |
| 4    | QA/security audit of integrated result                                               | QA agent       | Done          | `docs/audit-final.md`; original blockers addressed and re-reviewed             |
| 4    | Research claim verification                                                          | Research agent | Done          | Snapshot drift scope clarified                                                 |
| 5    | Fixes, final verification, release prep                                              | Orchestrator   | In progress   | CI/build/tests/packaging verified; public release requires contacts            |

## P0 checklist

- [x] Functional pnpm monorepo
- [x] Shared TypeScript snapshot/config schema with stable IDs
- [x] Docker Compose parser with explicit/inferred evidence
- [x] Nginx documented-subset parser
- [x] Caddy documented-subset parser
- [x] Deterministic graph, warnings, decisions
- [x] Core scan pipeline
- [x] Examples for simple, reverse-proxy and multi-service stacks
- [x] Core test suite
- [x] CLI `scan` command
- [x] JSON export command path
- [x] Markdown documentation generator
- [x] Drift detection
- [x] End-to-end demo
- [x] Dashboard
- [x] README, CI and release preparation
- [x] Final QA re-review of original critical/high findings
- [ ] Replace maintainer contacts and repository URL before public release

## Verification commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node packages/cli/dist/index.js scan --root examples/multi-service
node packages/cli/dist/index.js generate --root examples/multi-service
node packages/cli/dist/index.js check --root examples/multi-service
node packages/cli/dist/index.js ui --root examples/multi-service
```

## Known constraints

- The published npm package does not exist yet. README must say installation
  from source until the user approves publication.
- The dashboard requires a web build; `pnpm build` produces it before the CLI
  copies `apps/web/dist` to `packages/cli/web-dist`.
- The scanner never executes Docker or Compose interpolation.
- Environment values and `env_file` contents are never read or stored.
