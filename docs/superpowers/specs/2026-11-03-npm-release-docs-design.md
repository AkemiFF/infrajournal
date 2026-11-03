# InfraJournal 0.1.1 documentation refresh — design

## Objective

Make authored documentation describe the published npm version `0.1.1` and
working global/npx commands without claiming that `0.1.0` works. Keep the
snapshot schema version `1.0.0` distinct from the npm package version.

## Scope

- Update `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md` and
  current product/release guides in `docs/` and `examples/` where their
  installation, availability, command, or version claims are outdated.
- Keep `docs/audit-*.md` as historical reports. In research documents, retain
  dated historical context and correct present-tense assertions only.
- Do not edit `examples/**/infra-docs/**` or `packages/cli/infra-docs/**`:
  those files are generated. Do not change runtime code, manifests, the
  changelog of earlier releases, or the npm registry.
- Do not include generated `packages/cli/README.md` in source changes; the
  package build copies the root README into it for the npm tarball.

## Content strategy

1. Confirm the registry's current `latest` package version and the repository's
   actual commands; use `npm view infrajournal@latest version` and CLI help.
2. Replace first-release/prepublication instructions with tested installation
   commands (`npm install --global infrajournal`, `npx infrajournal --help`) and
   a source-build alternative. Explain that `0.1.0` exits silently through npm
   bin symlinks, fixed by `0.1.1`.
3. Distinguish read-only scanning from writing commands (`init`, `generate`,
   `scan --output`); preserve the supported parser subsets, limits, security
   caveats and drift exit codes. Keep Markdown links valid for GitHub and npm
   where the linked material is published.
4. Align release notes and checklists with the already published `0.1.0` and
   `0.1.1` while keeping future publication manual and opt-in.

## Verification

- Search authored Markdown for stale present-tense claims such as “not yet
  published”, “unreleased” for `0.1.1`, and installation snippets that imply
  the user must build from source.
- Run `pnpm exec prettier --check` on changed Markdown.
- Confirm links, version numbers and command examples against repository source
  and npm metadata; do not invent images, timings or release assets.
- Do not push or publish anything as part of this documentation update.
