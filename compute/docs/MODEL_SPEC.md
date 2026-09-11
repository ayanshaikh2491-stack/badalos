# MODEL_SPEC — 100M Specialized Planner Model (SLOT)

## Role
Chatbot NAHI. Input: workload description → Output: **structured IR plan**.
System component — spec §3 ke mutabik.

## Interface (v0 deterministic | v1 model)
```js
{
  plan(input) -> { ir, confidence }   // ir = IR_SPEC nodes
  name, version, isModel: false
}
```
Deterministic v0: rule-based interpreter (pattern match → canonical IR).
Model drop-in: same interface, `isModel: true`, outputs validated same pipeline.

## Training targets (jab GPU available)
- op recognition, decomposition, fusion, CSE, parallelism detection,
  chunk sizing, skill selection, memory-aware planning
- Output = IR only (never free text, never machine code)

## Safety (spec §16)
```
Model → IR → validator → optimizer-validate → runtime (permission-scoped)
```
- Model output invalid → reject → deterministic v0 fallback
- Model kabhi directly execute nahi karta

## Lifecycle
load/unload/version/quantized slot — v0 meens `modelAvailable:false` hamesha kaam karta hai.

## Params budget (v1)
~100M: embedding 8k ops × 64 + tiny transformer (4 layer, d=512, ff=2048) ≈ 100M weights. Defer — pehle deterministic system (spec §18: model LAST).
