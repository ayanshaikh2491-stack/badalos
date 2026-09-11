/**
 * api.js — Phase: OS integration (spec §14).
 *
 * compute.submit(workload) → job_id
 *   .status / .pause / .resume / .cancel / .result
 *
 * workload: { dsl: "MAP(A, MUL, 2)\nREDUCE(r, SUM)", inputs: { A: [...] }, optimize: true }
 *
 * Safety: validation-fail → reference plan fallback (spec §5/16).
 * Model absent → deterministic v0 planner (spec §15).
 */

const { compile } = require('./dsl.js');
const { Engine } = require('./engine.js');
const { optimize, validateOptimized } = require('./optimizer.js');

const jobs = new Map();
let jobIdSeq = 1;

class ComputeAPI {
  constructor(opts = {}) {
    this.engine = new Engine({ concurrency: opts.concurrency || 4 });
    this.planner = opts.planner || deterministicPlanner; // 100M model slot (MODEL_SPEC.md)
    this.strictValidate = opts.strictValidate !== false; // default ON
  }

  /** workload → job (async fire) */
  submit(workload) {
    const id = 'job' + (jobIdSeq++);
    const job = {
      id, status: 'queued', submittedAt: Date.now(),
      state: 'running', // paused | cancelled
      controller: null, result: null, error: null, stats: null,
    };
    jobs.set(id, job);
    // fire async (na block karo submit ko)
    this._execute(job, workload).catch((e) => {
      job.error = String(e && e.message || e);
      job.status = 'failed';
    });
    return id;
  }

  async _execute(job, workload) {
    job.status = 'running';
    // 1) plan (deterministic v0 / model) → DSL string
    const dslSrc = this.planner.plan(workload).dsl;
    // 2) compile → validated IR
    let ir = compile(dslSrc);
    // 3) optimize (agar allowed) + VALIDATION FALLBACK
    if (workload.optimize !== false) {
      const { ir: optIr, changed } = optimize(ir);
      if (changed) {
        // reference run + optimized run — compare (spec §5)
        const ref = await this.engine.run(ir, workload.inputs || {});
        const opt = await this.engine.run(optIr, workload.inputs || {});
        const v = await validateOptimized(ref.result, opt.result);
        if (v.ok) {
          ir = optIr;
          job.stats = { optimized: true, refWallMs: ref.wallMs, optWallMs: opt.wallMs, ...opt.stats };
        } else {
          // FAIL-CLOSED: optimized galat → reference use karo
          job.result = ref.result;
          job.stats = { optimized: false, fallback: true, reason: 'validation mismatch' };
          job.status = 'done';
          return;
        }
      }
    }
    // 4) run final plan
    const controller = new AbortController();
    job.controller = controller;
    const out = await this.engine.run(ir, workload.inputs || {}, { signal: controller.signal });
    job.result = out.result;
    job.stats = { ...(job.stats || {}), ...out.stats, wallMs: out.wallMs, nodesDone: out.nodesDone, checkpoint: out.checkpoint };
    job.status = out ? 'done' : 'failed';
    job.state = 'done';
  }

  status(id) { const j = jobs.get(id); return j ? { id: j.id, status: j.status, error: j.error, stats: j.stats && { optimized: j.stats.optimized, wallMs: j.stats.wallMs } } : null; }
  result(id) { const j = jobs.get(id); if (!j) return null; return { id, status: j.status, result: j.result, error: j.error }; }

  pause(id) { const j = jobs.get(id); if (j && j.status === 'running') { j.state = 'paused'; if (j.controller) j.controller.abort(new Error('paused')); j.status = 'paused'; return true; } return false; }
  resume(id) {
    const j = jobs.get(id);
    if (!j || j.state !== 'paused') return false;
    j.state = 'running'; j.status = 'running';
    // checkpoint se warm resume — engine ko checkpoint pass karte hue dobara
    // (v0: re-run with checkpoint — pending nodes only)
    const w = j.savedWorkload;
    if (!w) return false;
    this._resumeFromCheckpoint(j, w).catch((e) => { j.error = String(e && e.message || e); j.status = 'failed'; });
    return true;
  }
  async _resumeFromCheckpoint(j, w) {
    const dslSrc = this.planner.plan(w).dsl;
    let ir = compile(dslSrc);
    const { ir: optIr } = optimize(ir);
    ir = optIr;
    const out = await this.engine.run(ir, w.inputs || {}, { checkpoint: j.stats && j.stats.checkpoint });
    j.result = out.result;
    j.stats = { ...(j.stats || {}), ...out.stats, resumed: true };
    j.status = 'done';
  }

  cancel(id) {
    const j = jobs.get(id);
    if (!j) return false;
    if (j.controller) j.controller.abort(new Error('cancelled'));
    j.status = 'cancelled';
    j.state = 'cancelled';
    return true;
  }
}

/* ============ Planner v0 — deterministic (MODEL_SPEC slot) ============ */

const deterministicPlanner = {
  name: 'deterministic-v0',
  version: 1,
  isModel: false,
  /** workload → canonical DSL */
  plan(workload) {
    if (workload && typeof workload.dsl === 'string') return { dsl: workload.dsl, confidence: 1.0 };
    if (workload && typeof workload.op === 'string') {
      // structured workload → DSL bana do
      const w = workload;
      const lines = [];
      lines.push('LOAD(' + (w.inputA || 'A') + ')');
      if (w.inputB) lines.push('LOAD(' + w.inputB + ')');
      lines.push(w.op + '(' + [w.inputA || 'A', w.inputB || 'B'].filter(Boolean).join(', ') + (w.mode ? ', ' + w.mode : '') + ')');
      return { dsl: lines.join('\n'), confidence: 1.0 };
    }
    throw new Error('planner: workload mein dsl ya op hona chahiye');
  },
};

module.exports = { ComputeAPI, deterministicPlanner, jobs };
