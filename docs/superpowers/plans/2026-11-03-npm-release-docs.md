# InfraJournal 0.1.1 documentation refresh implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align authored InfraJournal Markdown with the published npm package `0.1.1`, its working commands, and the existing Git tag without altering generated documentation.

**Architecture:** The root README supplies both GitHub and npm package-facing documentation. Guides and examples link to that canonical quickstart. Historical security audits stay unchanged, while dated research gains a present-tense correction where necessary.

**Tech Stack:** Markdown, Prettier, pnpm, npm metadata, GitHub tag/release metadata.

---

### Task 1: Product quickstart and install

**Files:** `README.md`, `docs/getting-started.md`, `examples/README.md`, `examples/simple-stack/README.md`, `examples/reverse-proxy/README.md`.

- [ ] Locate prepublication language and references to source-only commands using `rg -n 'not.*published|source-built|unreleased|0\.1\.0|npx infrajournal|npm install' README.md docs/getting-started.md examples --glob '*.md'`.
- [ ] In `README.md`, replace the prepublication block with `**Install from npm (Node.js >=22.12):**` and runnable commands `npm install --global infrajournal`, `infrajournal --version`, `npx infrajournal --help`.
- [ ] In `docs/getting-started.md`, lead with the npm commands and keep a separate `## Build from source` showing `pnpm install --frozen-lockfile`, `pnpm build`, and `node packages/cli/dist/index.js --help`.
- [ ] In example READMEs, keep demo commands valid from their respective working directories, explain that the same commands can be prefixed with `npx infrajournal`, and do not claim any generated `infra-docs/` is version-controlled.
- [ ] Run `pnpm exec prettier --check README.md docs/getting-started.md examples/README.md examples/simple-stack/README.md examples/reverse-proxy/README.md`; expected: all files use Prettier style.

### Task 2: Technical guides and package-facing links

**Files:** `docs/cli.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/limitations.md`, `README.md`.

- [ ] Verify command names, default root/output and exit codes against `packages/cli/src/index.ts` and `packages/core/src/config/schema.ts`.
- [ ] Keep `schemaVersion: 1.0.0` separate from CLI version `0.1.1` in `docs/architecture.md` and `README.md`.
- [ ] Update install/usage examples in `docs/cli.md` to show `infrajournal scan --root examples/multi-service`, `infrajournal generate --root examples/multi-service`, `infrajournal check --root examples/multi-service`, and `infrajournal ui --root examples/multi-service`.
- [ ] Check relative links in the root README: a file absent from `packages/cli` must use `https://github.com/AkemiFF/infrajournal/blob/main/` as a prefix to work from the npm copy. Preserve the logo's already-absolute image URL.
- [ ] Run `pnpm exec prettier --check README.md docs/cli.md docs/configuration.md docs/architecture.md docs/limitations.md`; expected: all pass.

### Task 3: Release, security and community status

**Files:** `CHANGELOG.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `docs/release-checklist.md`, `docs/implementation-status.md`.

- [ ] Confirm `npm view infrajournal@latest version` returns `0.1.1`; confirm `git ls-remote --tags origin 'v0.1.1*'` contains the tag.
- [ ] Date the published `0.1.1` changelog entry `2026-11-03`, keep its CLI symlink fix, and place an `## [Unreleased]` section above it with no invented entries.
- [ ] Keep `SECURITY.md` clear that `0.1.0` is affected by the silent npm CLI bug and recommend upgrading to `0.1.1`; remove only demonstrably obsolete “before first public release” text, preserving working private-vulnerability reporting and warning that fallback addresses are placeholders until supplied.
- [ ] Replace `git clone <repository-url> infrajournal` with `git clone https://github.com/AkemiFF/infrajournal.git infrajournal` in `CONTRIBUTING.md`.
- [ ] Convert `docs/release-checklist.md` from first-publication wording into a reusable manual patch-release checklist; never run `npm publish` or create a release during documentation changes.
- [ ] Record published npm status and remaining maintainer contact work in `docs/implementation-status.md`.
- [ ] Run `pnpm exec prettier --check` on the changed Markdown; expected: all pass.

### Task 4: Research, final consistency and handoff

**Files:** `docs/research.md`, `docs/competitive-analysis.md`, `docs/performance.md`.

- [ ] Keep source research dated; change present-tense claims like `npm not yet published` to `published as 0.1.1` without rewriting what was verified on the original date.
- [ ] Keep benchmark measurements unchanged: they document the run observed at the time, not a new release guarantee.
- [ ] Search authored docs for `not published|not yet published|0.1.1.*unreleased|<repository-url>` using `rg -n` and explain any remaining historical/template references in the handoff.
- [ ] Run `pnpm format:check` and verify the diff excludes `examples/**/infra-docs/**`, `packages/cli/infra-docs/**`, `docs/audit-*.md` and source code; expected: format passes and only authored Markdown changed.
- [ ] Report which docs were changed and that `v0.1.1` GitHub release creation is optional for npm use but recommended for release notes; do not push or publish.
