# Contributing to InfraJournal

Thanks for helping improve InfraJournal. This project is a local-first,
read-only infrastructure documentation tool; accuracy and predictable output
matter more than feature count.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
For security vulnerabilities, do **not** open a public issue — follow
[SECURITY.md](SECURITY.md).

## Prerequisites

- Node.js **22.12 or newer** (the workspace targets Node 22; CI covers the
  declared minimum).
- pnpm **12** via Corepack:

```bash
corepack enable
corepack prepare pnpm@12 --activate
```

Docker is **not** required to develop or test the scanner. Tests read fixture
files; they do not start containers.

## Setup

```bash
git clone <repository-url> infrajournal
cd infrajournal
pnpm install
pnpm typecheck
pnpm test
```

`pnpm install` is the only step that needs network access. Documentation and
examples are designed to be readable offline.

## Workspace layout

| Path                     | Package                       | Purpose                                                                                  |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/core`          | `@infrajournal/core`          | Discovery, parsers, normalization, graph, diagnostics, decisions, snapshot serialization |
| `packages/documentation` | `@infrajournal/documentation` | Markdown generation and snapshot drift comparison                                        |
| `packages/cli`           | `infrajournal`                | Commander CLI, local dashboard server, packaged binary                                   |
| `apps/web`               | `@infrajournal/web`           | Local React dashboard built with Vite                                                    |
| `examples/`              | —                             | Parser-validated example stacks                                                          |
| `docs/`                  | —                             | User, architecture and release documentation                                             |
| `tests/`                 | —                             | Cross-package end-to-end tests                                                           |

The dependency direction is deliberate: `core` has no dependency on
`documentation`, the CLI or the web app. The CLI bundles the other packages at
build time.

## Commands

Run these from the repository root.

```bash
pnpm install         # install workspace dependencies
pnpm build           # build core, documentation, web and CLI
pnpm typecheck       # TypeScript strict checking
pnpm lint            # ESLint
pnpm test            # package tests plus cross-package tests
pnpm test:unit       # package tests only
pnpm test:e2e        # cross-package tests only
pnpm format          # write Prettier formatting
pnpm format:check    # verify formatting
pnpm schema          # regenerate the JSON Schema from the Zod contract
```

Focused examples:

```bash
pnpm --filter @infrajournal/core test
pnpm --filter @infrajournal/core typecheck
pnpm --filter infrajournal test
node packages/cli/dist/index.js scan --root examples/multi-service
```

`pnpm build` is required before CLI smoke tests because the package runs from
`packages/cli/dist`. The web build also produces the dashboard assets copied
into the CLI package.

## Coding standards

- TypeScript strict mode, ESM and `verbatimModuleSyntax`. Do not weaken
  `tsconfig` settings to work around a typing problem.
- Zod schemas in `packages/core/src/model` and `packages/core/src/config` are
  the source of truth. Change the schema first, then producers and consumers.
- Keep output deterministic. Sort collections by stable IDs, never by
  filesystem iteration order or timestamps.
- IDs must be derived from names and content, never from absolute paths, random
  values or the current time. Only `metadata.generatedAt` may vary between scans
  of unchanged inputs.
- Store relative POSIX paths in snapshots. Never leak absolute machine paths.
- Never read or store environment values, `env_file` contents, Compose secret
  files, private keys or bind-mounted host file contents.
- Treat parsed configuration as untrusted input. Escape before rendering
  Markdown; sanitize Mermaid labels; do not execute scanned content.
- Add diagnostics through `DIAGNOSTICS` in
  `packages/core/src/diagnostics/warnings.ts`. Codes are a public contract:
  never renumber or reuse one. Add the next free `IJnnn` code.
- Prefer small, typed functions and explicit result objects over thrown errors
  for expected parse failures.
- Run `pnpm format` before committing. Do not reformat unrelated files.

## Tests

- Tests use Vitest. Place package tests under `packages/<name>/test/` and
  cross-package tests under `tests/`.
- Use fixture files, not live Docker or network services.
- For snapshots, pass a fixed `now` value (for example
  `new Date("2026-01-01T00:00:00.000Z")`) so `generatedAt` does not make tests
  flaky. Compare canonical serialization or individual fields, not raw bytes
  containing a timestamp.
- Every parser change needs positive and negative cases: supported syntax,
  malformed syntax, and a warning with the expected diagnostic code and source
  location.
- Every CLI behavior change needs a test for exit codes and for stdout purity in
  `--format json` mode.
- Add regression tests with the smallest fixture that reproduces the bug.

## Parser contribution rules

Parsers should document only what they can prove from the configuration subset.

1. **Stay inside the documented subset.** If a construct is not supported,
   either ignore it quietly (when it cannot affect the inventory) or emit a
   stable diagnostic explaining why. Do not guess runtime behavior.
2. **Attach source locations.** Include file and 1-based line where possible;
   columns when the parser has them.
3. **Record evidence.** Mark values as `explicit`, `inferred` or `implicit`.
   Inference must never masquerade as an explicit declaration.
4. **Never resolve includes, imports or interpolation silently.** Emit the
   existing `INCLUDE_NOT_FOLLOWED`, `UNRESOLVED_INTERPOLATION` or related code.
   Multi-file merging is a roadmap item, not an undocumented side effect.
5. **Do not read referenced files** for environment values, secrets, mounts or
   certificates. Reference names and paths are metadata; contents are not.
6. **Keep output stable.** Deduplicate and sort routes, ports and resources with
   documented comparators.
7. **Update documentation.** Parser support changes require updates to
   [docs/configuration.md](docs/configuration.md),
   [docs/limitations.md](docs/limitations.md) and, when relevant,
   [docs/architecture.md](docs/architecture.md).
8. **Add or update an example only when it uses supported syntax.** Examples
   must remain valid for the parser subset.

If a new parser is proposed, open an issue first describing the supported
subset, the evidence model and the failure modes. A parser that silently
approximates a configuration format is worse than a smaller honest parser.

## Commit and pull request guidance

- Write imperative, scoped commit subjects, for example:
  `core: handle IPv6 port bindings` or `docs: clarify backup precedence`.
- Keep commits focused. Separate contract changes, implementation and
  documentation when that makes review easier.
- Rebase or merge from the default branch before opening a PR; do not rewrite
  other contributors' history.
- Fill in the pull request template, including the verification commands you
  ran and their results.
- Link the issue being fixed. Describe user-visible behavior and any change to
  snapshot, diagnostic or CLI contracts.
- Update `CHANGELOG.md` for user-visible changes under `Unreleased`.
- Do not include generated build output, local `infra-docs/`, editor files or
  secrets in a commit.

### Pull request checklist

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm format:check` passes (or changed files are formatted).
- [ ] New behavior has tests and fixtures.
- [ ] Parser/CLI/schema contract changes are documented.
- [ ] No secrets, absolute paths or environment values appear in output.
- [ ] Examples still parse with the documented subset.

## Release work

Release steps live in [docs/release-checklist.md](docs/release-checklist.md).
Only maintainers publish packages or create tagged releases. Do not run
`npm publish` from a pull request or local experiment.

## Security reporting

Report vulnerabilities privately through the repository's Security tab, as
described in [SECURITY.md](SECURITY.md). Include the affected version, a minimal
reproduction and the impact. Please do not include real credentials; redact
them. We will acknowledge reports as capacity allows and coordinate disclosure
after a fix is available.

## Questions

Open a discussion or an issue using the templates in `.github/ISSUE_TEMPLATE/`.
Usage questions should include the InfraJournal version, Node version, operating
system and a sanitized excerpt of the configuration. Never paste environment
values, private keys or production secrets.
