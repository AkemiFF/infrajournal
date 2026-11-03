# Caddy reverse proxy example

Demonstrates Caddyfile site parsing, a shared edge network, and inferred
database/cache dependencies from environment variable names.

```bash
cd examples/reverse-proxy
infrajournal scan
infrajournal generate
```

The Compose file includes a literal placeholder password in an example
`DATABASE_URL` value. InfraJournal never stores or prints environment values;
only the `DATABASE_URL` and `REDIS_URL` key names appear in output.
