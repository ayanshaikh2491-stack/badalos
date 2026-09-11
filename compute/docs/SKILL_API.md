# SKILL_API — External Skills

## Interface (strict)
```js
{
  name: 'matrix_skill',
  version: 1,
  handles: (irNode) => bool,
  run: async (irNode, ctx) => any,   // ctx = { memory, backend, stats }
}
```

## Registry rules
- `CALL_SKILL("x", ...)` → registry lookup; missing skill → **fail-closed rejection**
- Skill replaceable/upgradable independently (version bump)
- Skill ke andar sirf apna domain — cross-skill call allowed via registry only

## v0 skills
| Skill | Ops | Parallel |
|---|---|---|
| math_skill | ADD/SUB/MUL/DIV/COMPARE/LOOP | – |
| vector_skill | VECTOR_OP, SEARCH | ✔ |
| matrix_skill | MATRIX_OP (tiled MUL/ADD) | ✔ |
| parallel_skill | MAP/FILTER/SORT/REDUCE/SPLIT/MERGE (chunk waves) | ✔ |
| memory_skill | LOAD/STORE/MOVE/COPY/CACHE/REUSE | – |

## ctx.memory
Virtual memory abstraction: get/set/delete/pressure — engine checkpoint/resume ismein hi persist hota hai (VFS-backed optional).

## Model ↔ skill
Model IR mein `CALL_SKILL` emit karta hai — skill ka implementation model parameters mein NAHI hota (spec §8).
