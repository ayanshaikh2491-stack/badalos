/**
 * parat-panel.js — BadalOS app: PARAT ka live control room.
 *
 * OS desktop se layer-system ka asli proof:
 *   - "Run 1000" button → 1000 requests, LIVE counter
 *   - Layers ka scorecard: cache/dedup/batch/queue ne kitna bacha
 *   - Parat library vendor/parat.browser.js se aata hai
 */

function appParatPanel(os) {
  const el = document.createElement('div');
  el.className = 'parat-panel';

  const state = { running: false, lastRun: null };

  el.innerHTML =
    '<div class="pp-head">' +
    '  <div class="pp-title">🧅 Parat Panel <span class="pp-sub">work-minimizing layers</span></div>' +
    '  <div class="pp-actions">' +
    '    <input type="number" id="pp-count" value="1000" min="10" max="5000" title="kitne requests">' +
    '    <input type="number" id="pp-unique" value="10" min="1" max="100" title="kitne alag inputs">' +
    '    <button id="pp-run" class="pp-btn">⚡ Run</button>' +
    '    <button id="pp-reset" class="pp-btn pp-ghost">↻ Reset</button>' +
    '  </div>' +
    '</div>' +
    '<div class="pp-stats" id="pp-stats">' +
    '  <div class="pp-stat"><div class="pp-num" id="pp-req">0</div><div class="pp-lab">requests</div></div>' +
    '  <div class="pp-stat"><div class="pp-num" id="pp-compute">0</div><div class="pp-lab">asli compute</div></div>' +
    '  <div class="pp-stat"><div class="pp-num" id="pp-saved">0%</div><div class="pp-lab">kaam bacha</div></div>' +
    '  <div class="pp-stat"><div class="pp-num" id="pp-cache">0</div><div class="pp-lab">cache hits</div></div>' +
    '</div>' +
    '<div class="pp-layers" id="pp-layers">' +
    '  <div class="pp-layer" id="pp-l1"><span class="pp-ln">L1 🗄️ Cache</span><span class="pp-lv" id="pp-l1v">—</span><div class="pp-bar"><div class="pp-fill" id="pp-l1b"></div></div></div>' +
    '  <div class="pp-layer" id="pp-l2"><span class="pp-ln">L2 👯 Dedup</span><span class="pp-lv" id="pp-l2v">—</span><div class="pp-bar"><div class="pp-fill" id="pp-l2b"></div></div></div>' +
    '  <div class="pp-layer" id="pp-l3"><span class="pp-ln">L3 📦 Batch</span><span class="pp-lv" id="pp-l3v">—</span><div class="pp-bar"><div class="pp-fill" id="pp-l3b"></div></div></div>' +
    '  <div class="pp-layer" id="pp-l4"><span class="pp-ln">L4 ⏳ Queue</span><span class="pp-lv" id="pp-l4v">—</span><div class="pp-bar"><div class="pp-fill" id="pp-l4b"></div></div></div>' +
    '  <div class="pp-layer pp-l5" id="pp-l5"><span class="pp-ln">L5 ⚙️ Compute</span><span class="pp-lv" id="pp-l5v">—</span><div class="pp-bar"><div class="pp-fill pp-hot" id="pp-l5b"></div></div></div>' +
    '</div>' +
    '<div class="pp-msg" id="pp-msg">Button dabao — 1000 requests bhejenge, layers kha jayenge, sirf minimum compute neeche jayega. 🎯</div>';

  setTimeout(() => {
    const $ = (id) => el.querySelector('#' + id);
    const Lib = window.Parat;
    if (!Lib) { $('pp-msg').textContent = '⚠️ Parat bundle load nahi hua (vendor/parat.browser.js missing)'; return; }

    const p = new Lib.Parat();
    let computeCount = 0;
    let busy = false;

    p.task('panel-demo', async (input) => {
      computeCount++;
      await new Promise((r) => setTimeout(r, 2));
      return { value: input.n * 2 };
    }, { cacheTtl: 30000, concurrency: 5 });

    function render(st) {
      $('pp-req').textContent = st.requests;
      $('pp-compute').textContent = st.computed;
      $('pp-saved').textContent = st.savedPct + '%';
      $('pp-cache').textContent = st.cacheHits;
      const total = st.requests || 1;
      const pct = (n) => Math.min(100, Math.round((n / total) * 100));
      $('pp-l1v').textContent = st.cacheHits + ' kha liye';
      $('pp-l1b').style.width = pct(st.cacheHits) + '%';
      const dedupSaved = Math.max(0, st.requests - st.computed - st.cacheHits);
      $('pp-l2v').textContent = dedupSaved + ' shared';
      $('pp-l2b').style.width = pct(dedupSaved) + '%';
      $('pp-l3v').textContent = 'batch off';
      $('pp-l3b').style.width = '0%';
      $('pp-l4v').textContent = st.queued + ' lined up';
      $('pp-l4b').style.width = pct(Math.min(st.queued, total)) + '%';
      $('pp-l5v').textContent = st.computed + ' asli';
      $('pp-l5b').style.width = pct(st.computed) + '%';
    }

    $('pp-run').onclick = async () => {
      if (busy) return;
      busy = true;
      $('pp-run').textContent = '… running';
      const count = Math.max(10, Math.min(5000, parseInt($('pp-count').value, 10) || 1000));
      const unique = Math.max(1, Math.min(100, parseInt($('pp-unique').value, 10) || 10));
      computeCount = 0;
      p.reset();
      $('pp-msg').textContent = count + ' requests bhej rahe hain (' + unique + ' alag inputs)...';
      const reqs = [];
      for (let i = 0; i < count; i++) reqs.push(p.run('panel-demo', { n: i % unique }));
      await Promise.all(reqs);
      const st = p.stats();
      st.computed = computeCount; // panel apna asli counter dikhata hai
      render(st);
      $('pp-msg').textContent = '✅ ' + count + ' requests → ' + computeCount + ' compute (' + Math.round(((count - computeCount) / count) * 100) + '% kaam bacha). Server so raha hai 😴';
      $('pp-run').textContent = '⚡ Run';
      busy = false;
    };

    $('pp-reset').onclick = () => {
      p.reset();
      computeCount = 0;
      render({ requests: 0, computed: 0, cacheHits: 0, savedPct: 0, queued: 0 });
      $('pp-msg').textContent = 'Reset ho gaya. Phir se chalao! 🧅';
    };
  }, 0);

  return { el, name: 'parat', title: 'Parat Panel' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { appParatPanel };
}
