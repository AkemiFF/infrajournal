# Simple stack

A two-service Compose stack used to demonstrate InfraJournal without a reverse
proxy or decision records.

```bash
cd examples/simple-stack
infrajournal scan
infrajournal generate
infrajournal ui
```

The `db-data` volume intentionally has no documented backup policy, so the
generated warnings page has a real finding to display.
