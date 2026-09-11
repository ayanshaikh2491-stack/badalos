/**
 * skills.js — Phase 5-style skill registry (engine ke saath chalta hai).
 * Strict interface (SKILL_API.md). Fail-closed dispatch.
 */

const REGISTRY = new Map();

function register(skill) {
  if (!skill || !skill.name || typeof skill.run !== 'function') throw new Error('skill: bad interface');
  REGISTRY.set(skill.name, skill);
  return skill;
}

function get(name) {
  if (!REGISTRY.has(name)) throw new Error('skill: not found "' + name + '" (fail-closed)');
  return REGISTRY.get(name);
}

/* ============ v0 SKILLS ============ */

/* math_skill — scalar arith + LOOP */
register({
  name: 'math_skill',
  version: 1,
  handles: (n) => ['ADD', 'SUB', 'MUL', 'DIV', 'COMPARE', 'LOOP'].includes(n.op),
  run: async (n, ctx) => {
    const v = (a) => (a && typeof a === 'object' && 'ref' in a ? ctx.memory.get(a.ref) : a);
    switch (n.op) {
      case 'ADD': return v(n.args[0]) + v(n.args[1]);
      case 'SUB': return v(n.args[0]) - v(n.args[1]);
      case 'MUL': return v(n.args[0]) * v(n.args[1]);
      case 'DIV': {
        const d = v(n.args[1]);
        if (d === 0) throw new Error('math: div by zero');
        return v(n.args[0]) / d;
      }
      case 'COMPARE': {
        const a = v(n.args[0]), b = v(n.args[1]);
        return a < b ? -1 : a > b ? 1 : 0;
      }
      case 'LOOP': {
        const count = v(n.args[0]);
        if (count > 100) throw new Error('math: LOOP > 100 unroll limit');
        let out = [];
        for (let i = 0; i < count; i++) out.push(v(n.args[1]));
        return out;
      }
      default: throw new Error('math: op not handled ' + n.op);
    }
  },
});

/* vector_skill — VECTOR_OP, SEARCH */
register({
  name: 'vector_skill',
  version: 1,
  handles: (n) => ['VECTOR_OP', 'SEARCH'].includes(n.op),
  run: async (n, ctx) => {
    const v = (a) => (a && typeof a === 'object' && 'ref' in a ? ctx.memory.get(a.ref) : a);
    if (n.op === 'SEARCH') {
      const data = v(n.args[0]); const val = v(n.args[1]);
      const idx = data.indexOf(val);
      return idx;
    }
    // VECTOR_OP(A, B, op)
    const A = v(n.args[0]), B = v(n.args[1]), op = n.args[2];
    if (!Array.isArray(A) || !Array.isArray(B) || A.length !== B.length) {
      throw new Error('vector: shape mismatch / not arrays');
    }
    switch (op) {
      case 'ADD': return A.map((x, i) => x + B[i]);
      case 'SUB': return A.map((x, i) => x - B[i]);
      case 'MUL': return A.map((x, i) => x * B[i]);
      case 'DIV': return A.map((x, i) => (B[i] === 0 ? (() => { throw new Error('vector: div 0'); })() : x / B[i]));
      default: throw new Error('vector: unknown op ' + op);
    }
  },
});

/* matrix_skill — MATRIX_OP (tiled parallel-capable MUL/ADD) */
register({
  name: 'matrix_skill',
  version: 1,
  handles: (n) => n.op === 'MATRIX_OP',
  run: async (n, ctx) => {
    const v = (a) => (a && typeof a === 'object' && 'ref' in a ? ctx.memory.get(a.ref) : a);
    const A = v(n.args[0]), B = v(n.args[1]), op = n.args[2];
    if (!Array.isArray(A) || !Array.isArray(B) || !Array.isArray(A[0]) || !Array.isArray(B[0])) {
      throw new Error('matrix: inputs 2D arrays hona chahiye');
    }
    const ra = A.length, ca = A[0].length, rb = B.length, cb = B[0].length;
    if (op === 'MUL') {
      if (ca !== rb) throw new Error('matrix: MUL shape mismatch (' + ca + ' != ' + rb + ')');
      const out = new Array(ra);
      for (let i = 0; i < ra; i++) {
        out[i] = new Array(cb).fill(0);
        for (let k = 0; k < ca; k++) {
          const aik = A[i][k];
          for (let j = 0; j < cb; j++) out[i][j] += aik * B[k][j]; // ikj loop = cache-friendly
        }
      }
      return out;
    }
    if (op === 'ADD') {
      if (ra !== rb || ca !== cb) throw new Error('matrix: ADD shape mismatch');
      return A.map((row, i) => row.map((x, j) => x + B[i][j]));
    }
    throw new Error('matrix: unknown op ' + op);
  },
});

/* parallel_skill — MAP/FILTER/SORT/REDUCE/SPLIT/MERGE (chunk waves) */
register({
  name: 'parallel_skill',
  version: 1,
  handles: (n) => ['MAP', 'FILTER', 'SORT', 'REDUCE', 'SPLIT', 'MERGE'].includes(n.op),
  run: async (n, ctx) => {
    const v = (a) => (a && typeof a === 'object' && 'ref' in a ? ctx.memory.get(a.ref) : a);
    switch (n.op) {
      case 'MAP': {
        const data = v(n.args[0]); const fn = n.args[1]; const val = v(n.args[2]);
        if (!Array.isArray(data)) throw new Error('map: data array nahi');
        return data.map((x) => applyFn(fn, x, val));
      }
      case 'FILTER': {
        const data = v(n.args[0]); const cmp = n.args[1]; const val = v(n.args[2]);
        return data.filter((x) => applyCmp(cmp, x, val));
      }
      case 'SORT': return [...v(n.args[0])].sort((a, b) => a - b);
      case 'REDUCE': {
        const data = v(n.args[0]); const mode = n.args[1];
        if (!Array.isArray(data)) throw new Error('reduce: data array nahi');
        // chunked reduce (pattern: parallel-friendly)
        const CH = 1024;
        let acc = mode === 'MIN' ? Infinity : mode === 'MAX' ? -Infinity : 0;
        for (let i = 0; i < data.length; i += CH) {
          const chunk = data.slice(i, i + CH);
          let sub = mode === 'MIN' ? Infinity : mode === 'MAX' ? -Infinity : 0;
          for (const x of chunk) {
            if (mode === 'SUM' || mode === 'AVG') sub += x;
            else if (mode === 'MIN') sub = Math.min(sub, x);
            else if (mode === 'MAX') sub = Math.max(sub, x);
          }
          if (mode === 'MIN') acc = Math.min(acc, sub);
          else if (mode === 'MAX') acc = Math.max(acc, sub);
          else acc += sub;
        }
        if (mode === 'AVG') acc = data.length ? acc / data.length : 0;
        return acc;
      }
      case 'SPLIT': {
        const data = v(n.args[0]); const parts = Math.max(1, v(n.args[1]) | 0);
        const size = Math.ceil(data.length / parts);
        const out = [];
        for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
        return out;
      }
      case 'MERGE': {
        const chunks = v(n.args[0]);
        return chunks.flat ? chunks.flat() : [].concat(...chunks);
      }
      default: throw new Error('parallel: ' + n.op);
    }
  },
});

/* memory_skill — LOAD/STORE/MOVE/COPY/CACHE/REUSE */
register({
  name: 'memory_skill',
  version: 1,
  handles: (n) => ['LOAD', 'STORE', 'MOVE', 'COPY', 'CACHE', 'REUSE'].includes(n.op),
  run: async (n, ctx) => {
    const v = (a) => (a && typeof a === 'object' && 'ref' in a ? ctx.memory.get(a.ref) : a);
    switch (n.op) {
      case 'LOAD': {
        const key = v(n.args[0]);
        if (!ctx.memory.has(key)) throw new Error('mem: LOAD "' + key + '" — data pehle submit karo (inputs)');
        return ctx.memory.get(key);
      }
      case 'COPY': return v(n.args[0]);
      case 'MOVE': return v(n.args[0]);
      case 'STORE': return v(n.args[0]);
      case 'CACHE': {
        // CACHE(key, value) — value ka result memo
        const key = v(n.args[0]);
        const hit = ctx.memo.get(key);
        if (hit !== undefined) { ctx.stats.cacheHits++; return hit; }
        return v(n.args[1]);
      }
      case 'REUSE': {
        const key = v(n.args[0]);
        if (ctx.memo.has(key)) { ctx.stats.cacheHits++; return ctx.memo.get(key); }
        throw new Error('mem: REUSE miss "' + key + '"');
      }
      default: throw new Error('mem: ' + n.op);
    }
  },
});

function applyFn(fn, x, val) {
  switch (fn) {
    case 'MUL': return x * val;
    case 'ADD': return x + val;
    case 'SUB': return x - val;
    case 'DIV': if (val === 0) throw new Error('map: div 0'); return x / val;
    default: throw new Error('map: unknown fn ' + fn);
  }
}
function applyCmp(cmp, x, val) {
  switch (cmp) {
    case 'LT': return x < val;
    case 'GT': return x > val;
    case 'EQ': return x === val;
    default: throw new Error('filter: unknown cmp ' + cmp);
  }
}

/** kaunsa skill is op ko handle karta hai */
function skillFor(node) {
  for (const s of REGISTRY.values()) if (s.handles(node)) return s;
  throw new Error('skill: koi skill handle nahi karta ' + node.op + ' (fail-closed)');
}

module.exports = { register, get, skillFor, REGISTRY };
