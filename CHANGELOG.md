# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

The first release is not yet cut. Entries are added only as work lands; the CLI,
documentation generator, drift command and dashboard are still being integrated.

### Added

- pnpm workspace with `@infrajournal/core`, `@infrajournal/documentation`,
  `infrajournal` (CLI) and `@infrajournal/web`.
- Versioned Zod contracts for the snapshot (`1.0.0`) and `infrajournal.yml`
  configuration.
- Deterministic ID generation for projects, services, networks, volumes,
  domains, endpoints, external dependencies, decisions, edges and warnings.
- Docker Compose parser for the documented subset: services, images and build
  references, ports, mounts, networks, `depends_on`, healthchecks, restart
  policies, environment keys, `env_file` references and labels.
- Nginx parser for `server`, literal `server_name`, `location`, `proxy_pass`,
  `upstream` blocks and TLS presence.
- Caddy parser for site addresses, `reverse_proxy`, basic matchers,
  `handle`/`handle_path` and TLS presence.
- Graph builder with typed edges (`DEPENDS_ON`, `CONNECTED_TO`, `MOUNTS`,
  `EXPOSES`, `ROUTES_TO`, `REFERENCES`) and explicit/inferred/implicit evidence.
- Diagnostics registry with stable codes `IJ001`–`IJ044`, including source
  locations and suggestions.
- Read-only file discovery with include/exclude globs, size/depth/file limits,
  symlink escape protection and deterministic ordering.
- Host-port exposure, duplicate binding and missing-backup-policy analysis.
- YAML decision records with linked services, duplicate detection and
  unresolved-reference warnings.
- Canonical snapshot serialization with recursively sorted keys, relative POSIX
  paths and a SHA-256 content hash.
- Three validated example stacks: `simple-stack`, `reverse-proxy` and
  `multi-service` with three ADRs.
- Documentation for configuration, CLI contract, limitations, architecture and
  release process.
- Contributor Covenant 2.1 code of conduct, security policy, contribution guide
  and GitHub issue/PR templates.

### Security

- Environment values, `env_file` contents, Compose secret files and
  bind-mounted host files are never read or stored.
- Diagnostics and CLI errors pass through best-effort secret redaction.
- Discovery refuses symlinks that resolve outside the scan root.

[0.1.0]: https://github.com/OWNER/REPO/compare/v0.0.0...v0.1.0
