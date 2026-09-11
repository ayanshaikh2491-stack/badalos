# BENCHMARK_SPEC

## Modes (spec §12)
| Mode | Kya |
|---|---|
| A | Plain JS (naive loop) — reference |
| B | DSL → optimizer (deterministic) → engine |
| C | B + planner model (v0 = deterministic, slot) |
| D | C + skills (matrix tile/parallel) |

## Metrics
wallMs, opsCount, JS heap used (engine stats), throughput (items/ms), correctness (vs A).

## Sizes
1k / 10k / 100k / 1M logical ops (MAP+REDUCE, MATRIX_MUL 128², FILTER+SORT).

## Rules
- Har benchmark: **correctness check pehle** — fail = benchmark invalid
- 3 runs, median report
- Claim sirf numbers se — "Xx faster" tabhi bolna jab median dikhe

## CLI
`node bench.js` — table output JSON + console.
