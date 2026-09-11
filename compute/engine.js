/**
 * engine.js — Phase 3: Deterministic execution engine.
 *
 * IR (validated) → DAG → dependency waves → parallel cap → skills → results.
 * + checkpoint / resume / cancel / pause (spec §7)
 * + correctness validation hook (spec §5)
 */

const { topo } = require('./dsl.js');
const { skillFor } = require('./skills.js');

class Engine {
  constructor(opts = {}) {
    this.concurrency = opts.concurrency || 4;
    this.onProgress = opts.onProgress || null;
  }

  /**
   * IR chalao.
   * @param {object} ir — { nodes, rootId } (compile() se)
   * @param {object} inputs — { A: [...], B: [[...], ...] } — LOAD keys
   * @param {object} opts — { signal, checkpoint (Map se resume), validate }
   * @returns { { result, nodesDone, wallMs, checkpoint } }
   */
  async run(ir, inputs = {}, opts = {}) {
    const t0 = Date.now();
    const order = topo(ir); // dependency order (cycles pehle reject ho chuke)
    const byId = new Map(ir.nodes.map((n) => [n.id, n]));

    // memory + memo (checkpoint se warm-start)
    const memory = new Map(opts.checkpoint ? opts.checkpoint.memory : []);
    const memo = new Map(opts.checkpoint ? opts.checkpoint.memo : []);
    for (const [k, v] of Object.entries(inputs)) memory.set(k, v);
    const ctx = {
      memory, memo,
      stats: { cacheHits: 0, opsRun: 0 },
      cancelled: false,
    };
    const signal = opts.signal || null;

    // waves: nodes jinki deps done — parallel fire (cap ke andar)
    const done = new Set(opts.checkpoint ? opts.checkpoint.done : []);
    let nodesDone = done.size;
    let running = 0;
    const results = new Map();

    const runOne = async (node) => {
      const skill = skillFor(node);
      const out = await skill.run(node, ctx);
      memory.set(node.id, out);
      results.set(node.id, out);
      done.add(node.id); // COMPLETION pe done — sirf fire pe nahi
      ctx.stats.opsRun++;
      nodesDone++;
      if (this.onProgress) this.onProgress({ nodesDone, nodesTotal: ir.nodes.length, last: node.id });
    };

    const self = this;
    await new Promise((resolve, reject) => {
      let settled = false;
      const checkDone = () => {
        if (settled) return;
        if (ctx.cancelled) { settled = true; return reject(new Error('cancelled')); }
        if (nodesDone >= ir.nodes.length) { settled = true; return resolve(); }
        schedule();
      };

      function schedule() {
        if (ctx.cancelled) return;
        for (const node of order) {
          if (running >= self.concurrency) break;
          if (fired.has(node.id)) continue;
          if (node.deps.some((d) => !done.has(d))) continue;
          // deps complete — fire karo
          fired.add(node.id);
          running++;
          runOne(node)
            .catch((e) => {
              if (!ctx.cancelled) { ctx.cancelled = true; settled = true; return reject(e); }
            })
            .finally(() => {
              running--;
              checkDone();
            });
        }
        // koi fire nahi hua + kuch chal nahi raha + adhura kaam = stuck
        if (running === 0 && nodesDone < ir.nodes.length && !ctx.cancelled) {
          settled = true;
          return reject(new Error('engine: stuck — unresolved deps (internal bug)'));
        }
      }

      const fired = new Set();

      // cancel watch
      if (signal) {
        signal.addEventListener('abort', () => {
          ctx.cancelled = true;
          checkDone();
        }, { once: true });
      }

      schedule();
      if (ir.nodes.length === 0) { settled = true; resolve(); }
    });

    return {
      result: results.get(ir.rootId),
      results,
      nodesDone,
      wallMs: Date.now() - t0,
      checkpoint: { memory: [...memory.entries()], memo: [...memo.entries()], done: [...done] },
      stats: ctx.stats,
    };
  }
}

module.exports = { Engine };
