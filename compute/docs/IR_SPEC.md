# IR_SPEC — Internal Representation

## Node
```js
{
  id: 'op7',
  op: 'MAP',                    // OPERATION_SPEC ka op
  args: [...],                  // literals | {ref:'op3'} | nested IR node
  deps: ['op3'],               // data dependencies (DAG edges)
  parallelizable: true,         // engine hint
  meta: { fn:'MUL', value:2 }  // op-specific
}
```

## Properties
- Hardware-independent (CPU/GPU don't interpret karte hain)
- Graph = list of nodes + `rootId`
- Topological order engine banata hai (deps se)
- **Validation (parse ke baad, execution se PEHLE):**
  - known op, correct arity, numeric/shape checks (MATRIX mul shapes)
  - shape: `shapeA[1] === shapeB[0]` warna invalid → reference fallback nahi, *rejection* (galat workload hai)

## Example
Input: `MAP(A, MUL, 2)`
```js
{ id:'op1', op:'LOAD', args:['A'], deps:[] }
{ id:'op2', op:'MAP', args:[{ref:'op1'},'MUL',2], deps:['op1'], parallelizable:true }
```

Input: `MATRIX_OP(A, B, MUL)` → deps [loadA, loadB], `parallelizable:true`, meta.shapes
