# ARCHITECTURE — Virtual Compute Engine (BadalOS)

## Premise
BadalOS = browser-OS (JS kernel). Engine OS ke **andar** subsystem hai —
plain Node/browser JS, koi native dep nahi. Baad mein Linux/WASM pe port possible.

## Stack (spec ke target architecture ka mapping)
```
App / shell (`compute.submit`)
   ↓
API (api.js) — jobs, status, pause/resume/cancel
   ↓
Planner (planner.js) — deterministic v0 | 100M model slot v1+
   ↓
DSL (dsl.js) parse → IR (ir.js) validate
   ↓
Optimizer (optimizer.js) — fold/CSE/strength/fuse/dead-code + VALIDATION
   ↓
Engine (engine.js) — DAG, dependency waves, parallel cap, checkpoint
   ↓
Skills (skills.js) — math/vector/matrix/parallel/memory
   ↓
Backend — JS CPU (v0); GPU/WASM slot (future)
```

## BOUNDARIES
- App ko CPU/GPU/threads ka pata NAHI — sirf workload
- Model kabhi seedha execute NAHI karta — sirf validated IR
- Optimization galat result de → **fail-closed fallback to reference plan** (spec §5)
- Model absent → deterministic v0 chalta rehta hai (spec §15)

## Existing OS reuse (no duplicate)
- Parallel/cap/queue → Parat Queue (pattern)
- Chunking → ChunkEngine pattern (engine mein inline minimal version)
- Persistence → VFS + localStorage (checkpoint), Cloudflare KV (sync)
