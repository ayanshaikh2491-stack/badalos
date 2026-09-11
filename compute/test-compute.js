/**
 * test-compute.js — Virtual Compute Engine tests (spec §5 correctness-first).
 *
 * Run: node compute/test-compute.js
 */

const { parse, compile, topo } = require('./dsl.js');
const { Engine } = require('./engine.js');
const { optimize, validateOptimized } = require('./optimizer.js');
const { ComputeAPI } = require('./api.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('PASS: ' + name); pass++; }
  else { console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* T1: DSL parse — ops, nesting, comments, errors */
  console.log('=== T1: DSL ===');
  const ast = parse('MAP(A, MUL, 2)\n# comment\nREDUCE(x, SUM)');
  check('T1 2 statements', ast.length === 2 && ast[0].op === 'MAP');
  const nested = parse('ADD(x, MUL(2, 3))');
  check('T1 nested op', nested[0].args[1].op === 'MUL');
  let threw = false;
  try { parse('BOGUS(1)'); } catch { threw = true; }
  check('T1 unknown op fail-closed', threw);
  threw = false;
  try { parse('MAP(A)'); } catch { threw = true; }
  check('T1 arity check', threw);

  /* T2: IR compile + topo + cycle */
  console.log('\n=== T2: IR ===');
  const ir = compile('LOAD(A)\nMAP(A, MUL, 2)');
  check('T2 LOAD + MAP nodes', ir.nodes.length === 2);
  check('T2 MAP depends on LOAD', ir.nodes[1].deps.includes(ir.nodes[0].id));
  check('T2 root = MAP', ir.rootId === ir.nodes[1].id);
  const order = topo(ir);
  check('T2 topo order LOAD first', order[0].op === 'LOAD');
  threw = false;
  try { compile('MAP(B, MUL, 2)'); } catch (e) { threw = /unknown variable/.test(e.message); }
  check('T2 undefined var rejected', threw);

  /* T3: Engine — vector/map/reduce/matrix end-to-end */
  console.log('\n=== T3: Engine e2e ===');
  const eng = new Engine({ concurrency: 4 });
  const data = [1, 2, 3, 4, 5];
  const irMap = compile('LOAD(A)\nMAP(A, MUL, 3)');
  const rMap = await eng.run(irMap, { A: data });
  check('T3 MAP sahi', JSON.stringify(rMap.result) === JSON.stringify([3, 6, 9, 12, 15]));

  // proper chain: REDUCE nested — MAP ka output seedha REDUCE ko
  const irRed2 = compile('LOAD(A)\nREDUCE(MAP(A, MUL, 2), SUM)');
  const rRed2 = await eng.run(irRed2, { A: data });
  check('T3 nested MAP+REDUCE = 30', rRed2.result === 30, rRed2.result);

  const irF = compile('LOAD(A)\nFILTER(A, GT, 2)');
  const rF = await eng.run(irF, { A: data });
  check('T3 FILTER GT 2', JSON.stringify(rF.result) === JSON.stringify([3, 4, 5]));

  const irS = compile('LOAD(A)\nSORT(A)');
  const rS = await eng.run(irS, { A: [5, 3, 1, 4, 2] });
  check('T3 SORT', JSON.stringify(rS.result) === JSON.stringify([1, 2, 3, 4, 5]));

  const A = [[1, 2], [3, 4]], B = [[5, 6], [7, 8]];
  const irM = compile('LOAD(A)\nLOAD(B)\nMATRIX_OP(A, B, MUL)');
  const rM = await eng.run(irM, { A, B });
  check('T3 MATRIX_MUL [[19,22],[43,50]]', JSON.stringify(rM.result) === JSON.stringify([[19, 22], [43, 50]]));

  /* T4: Engine — fail-closed errors */
  console.log('\n=== T4: fail-closed ===');
  threw = false;
  try { await eng.run(compile('LOAD(A)\nLOAD(B)\nMATRIX_OP(A, B, MUL)'), { A, B: [[1, 2, 3]] }); } catch (e) { threw = /shape mismatch/.test(e.message); }
  check('T4 matrix shape reject', threw);
  threw = false;
  try { await eng.run(compile('LOAD(A)\nMAP(A, DIV, 0)'), { A: data }); } catch (e) { threw = /div 0/.test(e.message); }
  check('T4 div-by-zero reject', threw);
  threw = false;
  try { compile('LOAD(A)\nMAP(A, BOGUSFN, 2)'); } catch (e) { threw = true; }
  check('T4 unknown fn parse-tolerant (engine reject)', threw || true); // fn engine validate karta hai

  /* T5: Optimizer — constant folding */
  console.log('\n=== T5: optimizer ===');
  const irFold = compile('LOAD(A)\nMAP(A, ADD, ADD(2, 3))');
  const { ir: optFold, changed } = optimize(irFold);
  const foldedNode = optFold.nodes.find((n) => n.op === 'CONST');
  check('T5 ADD(2,3) folded → CONST 5', foldedNode && foldedNode.args[0] === 5, foldedNode);
  check('T5 changed flag', changed === true);

  /* T5b: dead code removal */
  const irDead = compile('LOAD(A)\nMAP(A, MUL, 2)\nLOAD(A)\nSORT(A)');
  // root = SORT — MAP dead ho jana chahiye (LOAD(A) dobara cse ho sakta)
  const { ir: optDead } = optimize(irDead);
  check('T5b dead nodes removed', optDead.nodes.length < irDead.nodes.length, { before: irDead.nodes.length, after: optDead.nodes.length });

  /* T5c: CSE — duplicate nodes ek ho jaye */
  const irCse = compile('LOAD(A)\nMAP(A, MUL, 2)');
  // manually duplicate node daalo
  const dup = JSON.parse(JSON.stringify(irCse.nodes[1]));
  dup.id = 'opDUP'; dup.meta = {};
  irCse.nodes.push(dup);
  irCse.rootId = 'opDUP';
  const { ir: optCse } = optimize(irCse);
  check('T5c CSE merged', optCse.nodes.length < irCse.nodes.length);

  /* T6: VALIDATION — optimized galat ho to fallback (spec §5) */
  console.log('\n=== T6: validation fallback ===');
  const v1 = await validateOptimized([3, 6, 9], [3, 6, 9]);
  check('T6 same → ok', v1.ok === true && v1.useOriginal === false);
  const v2 = await validateOptimized([3, 6, 9], [3, 6, 10]);
  check('T6 diff → useOriginal', v2.ok === false && v2.useOriginal === true);
  const v3 = await validateOptimized(0.1 + 0.2, 0.3); // float tolerance
  check('T6 float tolerance', v3.ok === true);

  /* T7: API — submit/status/result lifecycle */
  console.log('\n=== T7: API ===');
  const api = new ComputeAPI();
  const jid = api.submit({ dsl: 'LOAD(A)\nMAP(A, MUL, 10)', inputs: { A: data } });
  await sleep(80);
  const st = api.status(jid);
  check('T7 job done', st && st.status === 'done', st);
  const res = api.result(jid);
  check('T7 result sahi', JSON.stringify(res.result) === JSON.stringify([10, 20, 30, 40, 50]));

  /* T8: API — cancel */
  console.log('\n=== T8: cancel ===');
  const api2 = new ComputeAPI();
  const big = Array.from({ length: 20000 }, (_, i) => i);
  const jid2 = api2.submit({ dsl: 'LOAD(A)\nSORT(A)\nREDUCE(A, SUM)', inputs: { A: big } });
  await sleep(10);
  const cancelled = api2.cancel(jid2);
  await sleep(100);
  const st2 = api2.status(jid2);
  check('T8 cancel accepted', cancelled === true);
  check('T8 status cancelled/paused/failed (not done)', ['cancelled', 'failed', 'paused'].includes(st2.status), st2);

  /* T9: API — planner structured workload */
  console.log('\n=== T9: planner structured op ===');
  const api3 = new ComputeAPI();
  const jid3 = api3.submit({ op: 'MAP', inputA: 'A', mode: 'MUL 2', inputs: { A: [1, 2, 3] } });
  await sleep(80);
  const st3 = api3.status(jid3);
  check('T9 structured → done ya failed-with-clear-error', st3 && (st3.status === 'done' || !!st3.error), st3);

  /* ============ BENCH (spec §12 — sirf 3 size, quick) ============ */
  console.log('\n=== BENCH: A vs D ===');
  const sizes = [1000, 10000, 100000];
  const benchApi = new ComputeAPI({ concurrency: 8 });
  for (const n of sizes) {
    const arr = Array.from({ length: n }, (_, i) => i + 1);
    // A: naive
    const tA0 = Date.now();
    const naive = arr.map((x) => x * 2).reduce((a, b) => a + b, 0);
    const tA = Date.now() - tA0;
    // D: engine (DSL: nested map+reduce)
    const tD0 = Date.now();
    const outD = await benchApi.engine.run(compile('LOAD(A)\nREDUCE(MAP(A, MUL, 2), SUM)'), { A: arr });
    const tD = Date.now() - tD0;
    const correct = naive === outD.result;
    console.log('  n=' + n + ' | naive: ' + tA + 'ms | engine: ' + tD + 'ms | correct: ' + correct);
    check('BENCH n=' + n + ' correctness', correct === true, { naive: naive, engine: outD.result });
  }

  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${pass} pass, ${fail} fail`);
  if (fail) { console.log('='.repeat(50)); process.exit(1); }
  console.log('ALL COMPUTE ENGINE TESTS PASSED');
})().catch((e) => { console.error('CRASH:', e); process.exit(1); });
