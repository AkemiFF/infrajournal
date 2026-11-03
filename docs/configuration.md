# Configuration

`infrajournal.yml` or `infrajournal.yaml` is optional. InfraJournal looks only
in the current working directory (`.yml` takes precedence). Run `init` to make
a starter `infrajournal.yml`; `init --force` overwrites it. You can select a
file elsewhere with `--config`. The YAML schema is strict: unknown keys are
rejected. `version` must be `1` (default `1`). A config file over 1 MiB is
rejected.

```yaml
version: 1
project:
  name: journal-demo
scan:
  root: .
  include:
    - "**/compose.yml"
    - "**/compose.yaml"
    - "**/docker-compose.yml"
    - "**/docker-compose.yaml"
    - "**/Caddyfile"
    - "**/Caddyfile.*"
    - "**/nginx/*.conf"
    - "**/nginx/**/*.conf"
  exclude:
    - "**/node_modules/**"
    - "**/.git/**"
    - "**/infra-docs/**"
    - "**/secrets/**"
  maxFileSizeBytes: 1048576
  maxDepth: 12
  maxFiles: 5000
output:
  directory: ./infra-docs
decisions:
  directory: ./infra-decisions
backups:
  - volume: pgdata
    policy: Nightly encrypted backup; restore-tested quarterly.
```

This is an illustrative **custom** exclusion list, not the full built-in list.
Omitting `scan.exclude` uses defaults; supplying it **replaces** the defaults.
For the authoritative default globs, see
[`packages/core/src/config/schema.ts`](../packages/core/src/config/schema.ts).

| Field                   | Default                                                                                                              | Meaning                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `project.name`          | Basename of resolved scan root                                                                                       | Project name and part of the project ID.                                                                      |
| `scan.root`             | `.`                                                                                                                  | Directory scanned, relative to config directory; `--root` overrides it relative to current working directory. |
| `scan.include`          | Compose filenames, Caddyfiles and `nginx/**/*.conf` (and direct `nginx/*.conf`)                                      | Relative glob allowlist.                                                                                      |
| `scan.exclude`          | `node_modules`, VCS dirs, `dist`, `build`, `coverage`, `.next`, `.cache`, `infra-docs`, `secrets`, `.env` / `.env.*` | Relative glob denylist, checked before include.                                                               |
| `scan.maxFileSizeBytes` | 1,048,576                                                                                                            | Maximum file size, 1,024–52,428,800 bytes.                                                                    |
| `scan.maxDepth`         | 12                                                                                                                   | Directory recursion bound, 1–40.                                                                              |
| `scan.maxFiles`         | 5,000                                                                                                                | Matching input files, 1–50,000.                                                                               |
| `output.directory`      | `./infra-docs`                                                                                                       | Generated files; resolved from scan root. May be outside root but not filesystem root.                        |
| `decisions.directory`   | `./infra-decisions`                                                                                                  | YAML decisions, resolved from scan root and required to be inside it.                                         |
| `backups`               | `[]`                                                                                                                 | Human-written policies keyed by Compose named volume name.                                                    |

All globs must be relative to the scan root and cannot contain `..` traversal
segments. Matching uses minimatch with dotfiles included. Traversal still
enters non-excluded directories before testing whether an individual file
matches `include`; narrow roots and exclusions help avoid unnecessary walking.
A matched file must also be classifiable as Compose, Caddyfile or `*.conf`;
including a different extension produces an unsupported-file warning instead
of parsing it. An included `*.conf` is treated as Nginx syntax. Symlinks
resolving outside the scan root are skipped. Named `infra-docs` directories
are excluded by **default**, but if you override exclusions or change output
directory, explicitly exclude your output path. Decision files are loaded
separately even when excluded from normal discovery.

## Backup notes

`backups` entries take precedence over volume labels
`infrajournal.backup` and `infrajournal.backup-policy` when names match. Policies
are descriptions, not proof that backup jobs ran. A missing policy produces a
finding even when a backup exists outside the scanned configuration. Duplicate
volume names in different Compose projects share the same configured policy
name; disambiguate in your notes. Values of other labels are not retained.

## Decision records

Add `.yml` or `.yaml` files in `decisions.directory`:

```yaml
id: adr-001-database
title: Keep PostgreSQL as the primary database
status: accepted
date: 2026-01-01
context: The application requires transactional persistence.
decision: Use PostgreSQL for primary storage.
consequences:
  - Document a restore procedure.
related_services:
  - postgres
```

Required: filename-safe `id`, nonempty `title`, `context`, `decision`,
`status` (`proposed`, `accepted`, `deprecated`, `superseded`) and `date` in
`YYYY-MM-DD` form. `consequences` and `related_services` default to empty
arrays. Service names must resolve uniquely to a scanned service; unresolved
names remain in the snapshot with a warning. The decisions loader limits files
to 500 or `scan.maxFiles`, whichever is lower. Decision text is written into
snapshots and Markdown: do not put secrets there.

## Output and preservation

`generate` writes these Markdown pages under `output.directory`: `README.md`,
`architecture.md`, `services.md`, `networks.md`, `storage.md`, `domains.md`,
`warnings.md` and `decisions.md`. It also writes `snapshot.json` as the drift
baseline. A Markdown file is replaced only if missing or its first three lines
contain exactly:

```text
<!-- Generated by InfraJournal. Manual edits will be overwritten. -->
```

An existing Markdown page without that marker is preserved, even if it has
the same generated filename. `generate` replaces `snapshot.json` only if it is
already a valid InfraJournal snapshot; an unrelated file or inspected source
file is not overwritten. Save or review your valid baseline before rerunning
generate. Generated files default to owner-only permissions on POSIX systems.
`scan` writes nothing unless `--output` is supplied. See
[CLI reference](cli.md) for command-specific path handling.
