## What changed

Describe user-visible behavior and link the issue, if any.

## Contract and safety review

- [ ] Snapshot schema, stable IDs, diagnostic codes and CLI exits are unchanged,
      or changes are explained and documented.
- [ ] No secret values, absolute paths or unsafe Markdown/Mermaid rendering are
      introduced.
- [ ] Parser limits, examples and changelog are updated when relevant.

## Verification

List commands run and results (or explain why a command could not be run):

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm format:check` or Prettier check for changed files
- [ ] Scan a relevant example; review output and exit codes.

## Notes for reviewers

Include sanitized reproduction steps; never attach credentials or production snapshots.
