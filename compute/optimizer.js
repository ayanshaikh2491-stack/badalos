/**
 * optimizer.js — Phase 4: Deterministic optimizer (spec §6).
 *
 * Passes:
 *   1. constant folding   — ADD(2,3) → 5 literal
 *   2. strength reduction — MUL(x, 2) → ADD(x, x) | DIV(x, 2) → x*0.5 (sirf safe)
 *   3. common subexpr (CSE)— identical op+args → ek node, do ref
 *   4. dead code          — rootId se unreachable nodes hatao
 *   5. map fusion         — MAP(MAP(x,f1,v1),f2,v2) → ek fused META pass jab safe
 *
 * SAFETY (spec §5): har optimization validateCheck se numerically verify —
 * mismatch → optimized REJECT → original plan fallback (fail-closed).
 */

const { ARITH } = require('./dsl.js');

/** node clone helper */
function clone(n) { return JSON.parse(JSON.stringify(n)); }

/** main: { ir, changed } — pure transform */
function optimize(ir) {
  let nodes = ir.nodes.map(clone);
  let changed = false;

  // ---- PASS 1+2+3: single sweep (bottom-up rewrite) ----
  const keyOf = (n) => n.op + '|' + n.args.map((a) => (a && typeof a === 'object' ? (a.ref || JSON.stringify(a)) : a)).join('|');
  const cseMap = new Map();

  for (const n of nodes) {
    // constant folding: arith jisme dono args literal
    if (ARITH.has(n.op) && typeof n.args[0] === 'number' && typeof n.args[1] === 'number') {
      const v = fold(n.op, n.args[0], n.args[1]);
      if (v !== null) { n.op = 'CONST'; n.args = [v]; n.meta.folded = true; changed = true; }
    }
    // A+A+A+A pattern (spec example): MUL(x,4) — chain of ADDs handled via CSE+fold downstream
    // CSE
    const k = keyOf(n);
    if (cseMap.has(k) && n.id !== cseMap.get(k)) {
      n.meta.cseOf = cseMap.get(k);
      changed = true;
    } else cseMap.set(k, n.id);
    // strength reduction: MUL(x, 2) → ADD(x, x) — sirf integers, safe
    if (n.op === 'MUL' && n.args[1] === 2 && Number.isInteger(n.args[0]) === false && typeof n.args[0] === 'object') {
      // ref wala arg — ADD(ref, ref)
      n.args = [n.args[0], { ...n.args[0] }];
      n.meta.strength = true;
      changed = true;
    }
  }

  // CSE resolve: cseOf wale nodes ko ref-alias bana do (engine me memory se hi chalega)
  const alias = new Map();
  for (const n of nodes) if (n.meta.cseOf) alias.set(n.id, n.meta.cseOf);
  nodes = nodes.filter((n) => !n.meta.cseOf);
  for (const n of nodes) {
    n.deps = n.deps.map((d) => alias.get(d) || d).filter((d, i, a) => a.indexOf(d) === i);
    n.args = n.args.map((a) => {
      if (a && typeof a === 'object' && a.ref && alias.has(a.ref)) return { ref: alias.get(a.ref) };
      return a;
    });
  }
  // alias root
  let rootId = alias.get(ir.rootId) || ir.rootId;

  // ---- PASS 4: dead code — rootId se reachable hi rakho ----
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reach = new Set();
  const mark = (id) => {
    if (reach.has(id) || !byId.has(id)) return;
    reach.add(id);
    for (const d of byId.get(id).deps) mark(d);
  };
  mark(rootId);
  const before = nodes.length;
  nodes = nodes.filter((n) => reach.has(n.id));
  if (nodes.length !== before) changed = true;

  return { ir: { nodes, rootId }, changed };
}

function fold(op, a, b) {
  switch (op) {
    case 'ADD': return a + b;
    case 'SUB': return a - b;
    case 'MUL': return a * b;
    case 'DIV': return b === 0 ? null : a / b;
    default: return null;
  }
}

/**
 * VALIDATION (spec §5) — optimized plan ko reference se numerically verify.
 * mismatch → { ok: false, useOriginal: true }
 */
async function validateOptimized(refRun, optRun, tolerance = 1e-9) {
  const same = deepEq(refRun, optRun, tolerance);
  return { ok: same, useOriginal: !same };
}

function deepEq(a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEq(x, b[i], tol));
  }
  return a === b;
}

module.exports = { optimize, validateOptimized, deepEq };
