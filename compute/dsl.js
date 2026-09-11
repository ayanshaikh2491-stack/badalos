/**
 * dsl.js — Phase 1: Computational DSL parser.
 * Phase 2: IR builder + validator.
 *
 * Text → AST → validated IR (IR_SPEC format).
 * Fail-closed: unknown op / bad arity → throw.
 */

const OPS = {
  LOAD: 1, STORE: 2, MOVE: 1, COPY: 1,
  ADD: 2, SUB: 2, MUL: 2, DIV: 2, COMPARE: 2,
  REDUCE: 2, SORT: 1, SEARCH: 2,
  MAP: 3, FILTER: 3,
  SPLIT: 2, MERGE: 1,
  LOOP: 2, CACHE: 2, REUSE: 1, CALL_SKILL: 1,
  PARALLEL: 1, SEQUENTIAL: 1, BATCH: 1, WAIT: 1, RESUME: 1,
  MATRIX_OP: 3, VECTOR_OP: 3,
};

const PARALLEL_OPS = new Set(['MAP', 'FILTER', 'SORT', 'REDUCE', 'SPLIT', 'MERGE', 'SEARCH', 'MATRIX_OP', 'VECTOR_OP', 'PARALLEL', 'BATCH']);
const ARITH = new Set(['ADD', 'SUB', 'MUL', 'DIV']);
/** ye identifiers KEYWORD literals hain (fn/cmp/mode names), var-ref NAHI */
const KEYWORD_LITERALS = new Set(['MUL', 'ADD', 'SUB', 'DIV', 'LT', 'GT', 'EQ', 'SUM', 'MIN', 'MAX', 'AVG']);

/* ---------- tokenizer + recursive-descent parser ---------- */

function tokenize(src) {
  const toks = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (c === '#' || (c === '/' && s[i + 1] === '/')) { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ t: 'ident', v: s.slice(i, j) }); i = j; continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1; while (j < s.length && s[j] !== '"') j++;
      toks.push({ t: 'str', v: s.slice(i + 1, j) }); i = j + 1; continue;
    }
    if ('(),'.includes(c)) { toks.push({ t: c }); i++; continue; }
    throw new Error('DSL: bad char "' + c + '" @' + i);
  }
  return toks;
}

/** ek op parse: NAME(args) — recursive */
function parseOp(toks, posRef) {
  const t = toks[posRef.p];
  if (!t || t.t !== 'ident') throw new Error('DSL: op name expected');
  const name = t.v.toUpperCase();
  if (!(name in OPS)) throw new Error('DSL: unknown op ' + name);
  posRef.p++;
  expect(toks, posRef, '(');
  const args = [];
  if (peek(toks, posRef) !== ')') {
    while (true) {
      args.push(parseArg(toks, posRef));
      if (peek(toks, posRef) === ',') { posRef.p++; continue; }
      break;
    }
  }
  expect(toks, posRef, ')');
  // arity check AT PARSE (fail-closed early)
  if (ast_args_len(args) !== OPS[name]) {
    throw new Error('DSL: ' + name + ' ko ' + OPS[name] + ' args chahiye, mile ' + args.length);
  }
  return { op: name, args };
}
function ast_args_len(a) { return a.length; }

function parseArg(toks, posRef) {
  const t = toks[posRef.p];
  if (!t) throw new Error('DSL: arg expected');
  if (t.t === 'num' || t.t === 'str') { posRef.p++; return t.v; }
  if (t.t === 'ident' && toks[posRef.p + 1] && toks[posRef.p + 1].t === '(') return parseOp(toks, posRef);
  // keyword literals (MUL/SUM/GT...) — string value, var-ref NAHI
  if (t.t === 'ident' && KEYWORD_LITERALS.has(t.v.toUpperCase())) { posRef.p++; return t.v.toUpperCase(); }
  if (t.t === 'ident') { posRef.p++; return { var: t.v }; }
  throw new Error('DSL: bad arg @' + posRef.p);
}

function peek(toks, posRef) { const t = toks[posRef.p]; return t ? t.t : null; }
function expect(toks, posRef, kind) {
  const t = toks[posRef.p];
  if (!t || t.t !== kind) throw new Error('DSL: expected "' + kind + '"');
  posRef.p++;
}

/** program: lines of ops (top-level = sequential steps; nested = data deps) */
function parse(src) {
  const toks = tokenize(src);
  const stmts = [];
  const posRef = { p: 0 };
  while (posRef.p < toks.length) stmts.push(parseOp(toks, posRef));
  if (!stmts.length) throw new Error('DSL: empty program');
  return stmts;
}

/* ---------- IR builder + validator (Phase 2) ---------- */

let _id = 0;
function nextId() { return 'op' + (++_id); }

/** nested AST → IR nodes. Returns { lastId, nodes } — flat list. */
function buildIR(stmts) {
  const nodes = [];
  const varMap = {}; // var name -> node id (LOAD se bind)
  function emit(ast, deps) {
    validateArity(ast);
    const node = {
      id: nextId(),
      op: ast.op,
      args: [],
      deps: [...deps],
      parallelizable: PARALLEL_OPS.has(ast.op),
      meta: {},
    };
    for (const a of ast.args) {
      // LOAD ka first arg = KEY (memory name), var-ref NAHI
      if (ast.op === 'LOAD') {
        node.args.push((a && typeof a === 'object' && a.var) ? a.var : a);
        continue;
      }
      if (a && typeof a === 'object' && a.op) {
        const sub = emit(a, deps);           // nested: dep on outer deps
        node.deps.push(sub.id);
        node.args.push({ ref: sub.id });
      } else if (a && typeof a === 'object' && a.var) {
        const ref = varMap[a.var];
        if (!ref) throw new Error('IR: unknown variable "' + a.var + '" (LOAD karo pehle)');
        node.deps.push(ref);
        node.args.push({ ref });
      } else {
        node.args.push(a);
      }
    }
    dedupDeps(node);
    if (ast.op === 'LOAD') {
      // LOAD ne variable declare kiya — varMap mein register
      const keyName = (ast.args[0] && typeof ast.args[0] === 'object' && ast.args[0].var)
        ? ast.args[0].var : ast.args[0];
      varMap[keyName] = node.id;
    }
    nodes.push(node);
    return node;
  }
  const roots = [];
  for (const st of stmts) roots.push(emit(st, []));
  return { nodes, rootId: roots[roots.length - 1].id };
}

function validateArity(ast) {
  const need = OPS[ast.op];
  if (ast.args.length !== need) throw new Error('IR: ' + ast.op + ' ko ' + need + ' args chahiye, mile ' + ast.args.length);
}

function dedupDeps(node) { node.deps = [...new Set(node.deps)]; }

/** public: source → validated IR */
function compile(src) {
  const ast = parse(src);
  const ir = buildIR(ast);
  validateIR(ir);
  return ir;
}

/** structural validation (fail-closed) */
function validateIR(ir) {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  for (const n of ir.nodes) {
    for (const d of n.deps) if (!byId.has(d)) throw new Error('IR: dep missing ' + d);
    // cycle check (DAG hona chahiye) — topo fail = cycle
  }
  topo(ir); // throws on cycle
}

/** topological order — engine bhi use karega */
function topo(ir) {
  const indeg = new Map();
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  for (const n of ir.nodes) indeg.set(n.id, 0);
  for (const n of ir.nodes) for (const d of n.deps) indeg.set(d.id, (indeg.get(d.id) || 0) + 1);
  const ready = [...indeg.entries()].filter(([, v]) => v === 0).map(([k]) => k);
  const order = [];
  const seen = new Set();
  while (ready.length) {
    const id = ready.shift(); // FIFO — deterministic, source-first
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const n of ir.nodes) {
      if (n.deps.includes(id)) {
        indeg.set(n.id, indeg.get(n.id) - 1);
        if (indeg.get(n.id) === 0) ready.push(n.id);
      }
    }
  }
  if (order.length !== ir.nodes.length) throw new Error('IR: cycle detected');
  return order.map((id) => byId.get(id));
}

module.exports = { parse, compile, topo, OPS, PARALLEL_OPS, ARITH };
