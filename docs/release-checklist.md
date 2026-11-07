# Release checklist (maintainers)

This checklist is **manual**. Never publish without maintainer authorization. Use an isolated,
clean checkout and verify the version and registry account before any upload.

## Before tagging a new patch release

- [ ] Review [implementation status](implementation-status.md), open audit
      findings, [limitations](limitations.md), and user-facing claims.
- [ ] Replace `maintainers@example.com` in the Code of Conduct and
      `security@example.com` in the security policy with working private
      contacts. Enable and test the repository's private vulnerability report
      flow; confirm links and issue templates point to the right repository.
- [ ] Confirm `README.md`, `docs/`, CLI `--help` and examples match the built
      product. Capture an actual dashboard image before adding a screenshot.
- [ ] Review `LICENSE`, license metadata, `CHANGELOG.md` and package contents.
- [ ] Run from the workspace root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm build
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js --version
node packages/cli/dist/index.js scan --root examples/multi-service --format json
node packages/cli/dist/index.js check --root examples/multi-service
```

- [ ] Run `generate` and `ui` against a **copy** of the example (or a suitable
      temporary scan root). Inspect generated Markdown and `snapshot.json`, and
      open the printed localhost URL. Test a drift case and confirm check exits
      3; check a missing baseline exits 4. Do not accidentally refresh an
      existing example baseline while testing drift.
- [ ] Inspect `pnpm --filter infrajournal pack --dry-run` (if supported by the
      installed pnpm) or use `npm pack --dry-run` from `packages/cli` after a
      build. Confirm the archive contains the CLI binary, web assets, README
      and **LICENSE**; verify a temporary install starts without workspace
      dependencies. `packages/cli/package.json` lists `README.md` and `LICENSE`
      in `files`: these must be present inside that package at pack time.
- [ ] Verify no credentials, internal absolute paths, test data or unwanted
      artifacts are included in the archive. Review dependency audit results.

## Version and publication (manual)

- [ ] Decide the release version using SemVer. Update root and package versions
      consistently, any lockfile references and generator version as needed;
      preserve snapshot schema compatibility unless a migration is documented.
- [ ] Move confirmed entries from `CHANGELOG.md`'s `Unreleased` section to a
      dated release, add a fresh Unreleased section, and review the release
      notes. Do not mark an unreleased build as published.
- [ ] Commit the approved changes, run verification again and review the
      packaging dry run. Check the npm account, registry URL, package name and
      2FA. Confirm the release owner explicitly authorizes publication.
- [ ] From the CLI package, run `npm publish --dry-run` and inspect its files.
      Only then, and only when approved, run `npm publish` with the intended
      tag and access settings. Do **not** run publish as part of this checklist
      review or in CI.
- [ ] Verify the installed package from the registry on a fresh machine/clean
      directory, including `--help`, `scan`, `generate`, `check` and `ui`.
- [ ] Manually create the matching Git tag and GitHub release after verifying
      the published version. A GitHub release is recommended for release notes
      and traceability but is not required for npm installation. Paste reviewed
      release notes, link the changelog and limitations; upload only approved
      artifacts.
- [ ] Update README install wording only when the new version is visible on npm;
      confirm both links and license in the published tarball.
