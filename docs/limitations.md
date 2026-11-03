# Limitations

InfraJournal is a **static documentation tool**, not a Compose, Nginx or Caddy
runtime. A clean scan does not certify that a stack starts, is secure, or has
working backups. Unknown configuration fields may be silently ignored. Keep
the [security policy](../SECURITY.md) in mind before publishing results.

| Input          | Modeled                                                                                                                                                                                                                     | Not resolved or validated                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Compose | Single-file services, images/build references, short/long ports, short/long mounts, named/default networks, `depends_on` names, healthcheck presence, restart, environment **key names**, `env_file` paths and label names. | Environment values, `.env` and `env_file` contents, interpolation, multi-file merge/overrides, `include`, inherited `extends`, profiles, `configs`, secret files, runtime `network_mode` behavior and unknown fields.                                    |
| Nginx `*.conf` | Server blocks with literal `server_name`, simple locations, literal HTTP(S)/gRPC `proxy_pass`, simple `upstream` blocks and declared TLS presence.                                                                          | `include` expansion, `map`, variable evaluation, `if` conditions, regex matching semantics, dynamically resolved backends, certificate validity and most directives. A conditional proxy route may be listed even though its condition is not evaluated. |
| Caddyfile      | Named sites, `reverse_proxy`, simple path matchers, `handle`/`handle_path` and TLS presence from site address/directive.                                                                                                    | `import`, plugins, custom matchers, placeholders, Unix socket targets, automatic TLS issuance/actual certificate state and most directives.                                                                                                              |
| Decisions      | YAML records with service-name linkage.                                                                                                                                                                                     | Semantic validation of your decisions; duplicate or unresolved names may trigger warnings. Decision text is included in output.                                                                                                                          |

Compose files are parsed independently. A duplicate service in the same
Compose project is warned about and the later definition is skipped; this is
**not** Compose multi-file merge behavior. `include` and `extends` can leave
inventory incomplete. Interpolated values in selected Compose fields remain
literal with a warning; do not assume a printed image/port is the effective
runtime value. `environment` **values** are not recorded or used for inference.
Named volume labels are read only for `infrajournal.backup` and
`infrajournal.backup-policy` backup policy descriptions; other label values
are omitted.

Proxy upstream resolution matches a literal host to a unique scanned service
name. Ambiguous or missing names become external nodes and warnings; upstream
port reachability and proxy routing semantics are not verified. TLS presence
means only that the supported subset declares it. Certificate files are not
opened or tested.

Inference from environment key names (for example `DATABASE_URL`) and matching
service names/images is heuristic. An inferred dependency can be wrong or
missing; check source evidence and the actual deployment before acting on it.
Warnings about publicly published ports do not prove internet reachability.
Undocumented backup policies do not prove that no backup exists.

No Docker daemon, Compose execution, running containers, DNS, firewalls,
registries, cloud APIs or live endpoints are inspected. The tool does not
request certificates or contact upstream servers. Its server is local-only,
not authenticated: keep it off shared/public proxies.

Security controls reduce but do not eliminate risk: source literals and ADR
text may disclose secrets or internal topology; redaction is best-effort;
filesystem races and hostile YAML can consume resources within configured
limits; generated Markdown and Mermaid are an output/rendering boundary.
Review generated pages and JSON before committing or publishing them. See
[architecture](architecture.md) and [SECURITY.md](../SECURITY.md).
