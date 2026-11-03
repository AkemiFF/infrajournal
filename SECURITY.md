# Security policy

InfraJournal reads infrastructure configuration and produces documentation. It
is designed to be safe to run against untrusted configuration: it does not
execute scanned files, start containers, install plugins from scanned input, or
contact external services. It is not a sandbox, and its output can still reveal
sensitive architecture. This policy describes the supported versions, how to
report a vulnerability, and the security properties and residual risks you
should evaluate before using it.

## Supported versions

InfraJournal has not published a stable release yet. Security fixes target the
current development line and, once releases exist, the latest minor release.

| Version   | Status      | Notes                                                   |
| --------- | ----------- | ------------------------------------------------------- |
| `0.1.x`   | Pre-release | Current development line. No stable support window yet. |
| `< 0.1.0` | Unsupported | No released versions exist.                             |

When `1.0.0` ships, this table will be updated with the supported minor versions
and the end-of-support policy. Pre-release builds may change contracts without a
deprecation period.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Preferred: use the repository's **Security → Report a vulnerability** flow
(GitHub private security advisory). Include:

- affected version or commit;
- a minimal reproduction, with secrets and production hostnames redacted;
- the impact you believe is possible;
- your operating system and Node.js version;
- any suggested fix or mitigation.

Fallback contact: `security@example.com` — **placeholder to be replaced with
the maintainers' real security address before public release.** Do not send real
credentials; redact them.

We will acknowledge reports as capacity allows, investigate, and coordinate
disclosure after a fix or mitigation is available. Please give us a reasonable
window before publishing details. We will credit reporters who want credit.

## Threat model summary

InfraJournal assumes:

- The person running the tool chooses the scan root and can read the resulting
  documentation and snapshot.
- Files inside the scan root are **untrusted**. They may contain malicious
  Markdown, HTML, Mermaid syntax, very large files, symlink farms, malformed
  YAML or credentials.
- The local machine and the user account are trusted. InfraJournal is not a
  privilege boundary and does not defend against a compromised host, a
  malicious Node.js runtime or a malicious package in the dependency tree.
- Generated output may be committed to a repository or published. Users are
  responsible for reviewing it before doing so.

Security-relevant boundaries:

| Boundary           | Behavior                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Scan root          | Files are matched under the configured root. Symlinks that resolve outside the root are skipped with `IJ021`.         |
| Referenced content | `env_file` contents, Compose `secrets`, bind-mounted host files and certificates are not read.                        |
| Execution          | Scanned configuration is parsed, never executed. Docker is never invoked.                                             |
| Network            | No telemetry, registry lookups, DNS resolution or outbound HTTP from the scanner. The dashboard binds localhost only. |
| Output rendering   | Generated Markdown escapes untrusted values; Mermaid labels are sanitized.                                            |
| Resource use       | File size, depth and count limits bound discovery; decisions are capped separately.                                   |

## What InfraJournal does and does not do

**Does**

- Read matched Compose, Nginx, Caddy and decision files inside the scan root.
- Record service names, images, ports, mounts, network names, domain routes,
  environment variable **names**, label names, relative file paths and line
  numbers.
- Record backup policies from `infrajournal.yml` or explicit volume labels.
- Write documentation and snapshots only to configured output locations when
  you run a writing command.
- Bind the dashboard to `127.0.0.1` only and serve an in-memory snapshot.
- Apply best-effort redaction to diagnostic messages and CLI errors.

**Does not**

- Execute Docker, Compose, Nginx, Caddy or any scanned command.
- Read environment variable values, `.env` files, `env_file` contents, Compose
  secret files, private keys or bind-mounted host files.
- Follow Nginx `include`, Caddy `import` or Compose `include` automatically.
- Resolve interpolation or shell expansion.
- Validate TLS certificates, contact upstreams or check whether a host is
  reachable.
- Upload snapshots, send analytics, or call a hosted service.
- Guarantee that generated output is free of sensitive information.

## Secret-handling guarantees

These are design guarantees in the core scanner, not absolute promises about
every possible input:

1. **Environment values are never stored.** The Compose parser records only
   environment key names. Values are not parsed for inference; environment-key
   inference uses the key name and the candidate services' names/images.
2. **`env_file` contents are never read.** Only the referenced path is stored,
   and a diagnostic notes that the file was not opened.
3. **Compose secrets are not analyzed.** Secret names and referenced files are
   not resolved; a diagnostic records that they were skipped.
4. **Bind-mounted host paths are not read.** The path string is recorded for
   documentation. Paths outside the scan root produce `IJ025`; none are opened.
5. **Volume label values are not stored**, except the documented
   `infrajournal.backup` / `infrajournal.backup-policy` label used as a backup
   policy. Other label names are retained; values are not. Backup policies
   from labels or `backups[].policy` are written verbatim to the snapshot,
   Markdown and dashboard: **never put credentials in policy text**.
6. **Decision text is stored as written.** ADRs are documentation, not secret
   storage. Do not put credentials in an ADR.
7. **Errors are redacted best-effort.** `redactSensitiveText` removes common
   key/value patterns, private-key blocks, cloud keys, GitHub/Slack tokens,
   bearer tokens and URL passwords. It is not a complete secret detector.

## Residual risks

- **Topology disclosure.** A snapshot reveals service names, images, internal
  hostnames, ports, networks and relationships. Treat generated documentation as
  internal material until reviewed.
- **Sensitive literals in configuration.** A password embedded directly in an
  image name, URL, comment, decision record or unsupported field may still end
  up in a warning or generated page if the parser records that text. The scanner
  avoids collecting values it does not need, but it cannot recognize every
  secret format.
- **Markdown injection.** Values from configuration are escaped before
  rendering. If you modify templates or add raw HTML, you own that risk. Mermaid
  labels are sanitized, but Mermaid itself is a rendering dependency.
- **Filesystem races.** Discovery resolves symlinks and limits traversal, but a
  hostile local process could change files between discovery and reading. Run
  against a trusted checkout when possible.
- **Resource exhaustion.** Limits reduce but do not eliminate CPU/memory cost
  from deeply nested or large-but-under-limit YAML. Set stricter limits for
  untrusted inputs.
- **Dashboard exposure.** The server binds `127.0.0.1` and is not designed for
  multi-user or remote access. Do not put it behind a public reverse proxy.
- **Supply chain.** Dependencies and build tooling are outside the scanner's
  threat boundary. Review lockfile changes and use trusted package sources.

## Secure usage guidance

- Run InfraJournal with the least-privileged account that can read the scan
  root.
- Keep `scan.root` narrow. Do not scan a home directory or a shared filesystem
  unless necessary.
- Keep secrets in files that are excluded or never referenced by value. Use
  environment files or a secret manager outside the scan root.
- Review `infra-docs/`, `snapshot.json` and generated decision pages before
  committing or publishing them.
- Use `scan.exclude` for secret directories and generated output. Default globs
  exclude `infra-docs`, `.env` files and `secrets` directories; if you customize
  exclusions or output location, add explicit exclusions. Decision YAML files
  are read separately from the configured decisions directory.
- Keep the dashboard on localhost. Stop it when finished.
- Snapshot and generated Markdown files default to owner-only permissions on
  POSIX systems. Review permissions if you copy or publish them elsewhere.
- Update dependencies deliberately and review lockfile diffs.

## Dependency and vulnerability handling

Security fixes may be released as patch versions. Breaking changes to the
snapshot schema require a major schema version and a documented migration. If
you believe a dependency advisory affects InfraJournal, report it privately with
the dependency name and version; do not assume the scanner is exploitable
without a path from untrusted input.

## No warranty

InfraJournal is provided under the MIT License, without warranty. This policy
describes intended behavior and known risks; it does not guarantee that the tool
is free of vulnerabilities or that generated documentation is safe to publish.
