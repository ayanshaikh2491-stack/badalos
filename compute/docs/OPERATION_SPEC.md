# OPERATION_SPEC — Computational DSL (v0)

## Format
Ek line = ek op. `OP(arg, arg, ...)` — args: number, string, identifier (var ref), nested op.

## Grammar (compact)
```
program   := op (NEWLINE op)*
op        := NAME "(" args? ")"
args       := arg ("," arg)*
arg       := NUMBER | STRING | IDENT | op
```
Parsed output: `{ op:'MAP', args:[...] }` — deterministic, machine-friendly.

## Ops (v0 set)
| Op | Args | Parallel | Notes |
|---|---|---|---|
| LOAD / STORE / MOVE / COPY | (src[, dst]) | – | memory ops |
| ADD/SUB/MUL/DIV | (a, b) | – | scalar arith (constant folding targets) |
| COMPARE | (a, b) | – | → -1/0/1 |
| REDUCE | (data, SUM/MIN/MAX/AVG) | ✔ | chunked |
| SORT | (data) | ✔ (chunk-merge) | |
| SEARCH | (data, value) | ✔ | |
| MAP | (data, fn, value) | ✔ | fn ∈ {MUL,ADD,SUB,DIV} scalar |
| FILTER | (data, CMP, value) | ✔ | CMP ∈ {LT,GT,EQ} |
| SPLIT | (data, n) | ✔ | → chunks |
| MERGE | (chunks) | ✔ | concat |
| MATRIX_OP | (A, B, MUL/ADD) | ✔ (tiled) | shapes validated |
| VECTOR_OP | (A, B, op) | ✔ | |
| PARALLEL / SEQUENTIAL | (op…) | control | grouping |
| LOOP | (n, op) | – | unroll < 100 |
| CACHE / REUSE | (key, op) | – | result memo |
| CALL_SKILL | ("name", op, args) | – | skill dispatch |
| WAIT/RESUME/BATCH | control | – | planner-level |

## Examples
```
MAP(A, MUL, 2)
MATRIX_OP(A, B, MUL)
REDUCE(data, SUM)
CALL_SKILL("matrix_skill", op=MATRIX_MUL, input=A,B)
```

## Rules
- Unknown op → parse error (fail-closed)
- Nested: `ADD(x, MUL(2, 3))` allowed
- Comments: `# ...`
