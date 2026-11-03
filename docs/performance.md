# Performance and benchmarking

One development-machine observation is recorded below; it is **not** a release
benchmark or comparative claim. Filesystem, CPU, cache state and input shape
affect results.

The repository includes a synthetic scanner exercise at
[`scripts/benchmark.mjs`](../scripts/benchmark.mjs). From the repository root:

```bash
pnpm --filter @infrajournal/core build
node scripts/benchmark.mjs --services 100 --json
# Or use the workspace script (builds core first):
pnpm benchmark
```

`--services` accepts 1–500 (default 100). The script creates **one synthetic
Compose file**, times a single core scan and prints service/file/dependency
counts, elapsed milliseconds, process RSS bytes and platform information. It
removes its temporary input afterward. It does not time CLI startup, Markdown
generation, dashboard rendering, multiple-run averages or real-world stacks.

For reproducible release measurements, record the commit, Node version, OS,
CPU, filesystem, service count, number of repetitions and method (warm/cold),
then report the raw distribution and limitations alongside results. Benchmark
results and any release-level performance claims require maintainer review.

## Single observed run (2026-11-03)

`pnpm benchmark` scanned one synthetic Compose file with 100 services on Linux,
Node.js v22.22.2, AMD Ryzen 7 5800X 8-Core Processor: **44.64 ms** core scan
time; **80 MiB** process RSS after scanning. One run only, with unspecified
filesystem and cache state; do not extrapolate to real stacks or CLI startup.
