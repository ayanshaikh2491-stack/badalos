/**
 * boot.js — BadalOS system boot.
 * Boot screen -> kernel init -> desktop ready.
 * Vanilla JS, koi dependency nahi.
 */

(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- boot sequence ---------- */
  const BOOT_STEPS = [
    'badal-kernel: loading VFS ................ ok',
    'badal-kernel: localStorage mount ......... ok',
    'badal-kernel: process table ............... ok',
    'badal-kernel: window manager ............. ok',
    'badal-cloud:  checking sync endpoint ...... {CLOUD}',
    'badal-os:     starting desktop ............ ok',
  ];

  async function boot() {
    const log = $('boot-log');
    const fill = $('boot-fill');
    let pct = 0;

    const put = (line) => {
      log.textContent += line + '\n';
      log.scrollTop = log.scrollHeight;
    };

    // 1) Kernel init
    const vfs = new VFS();
    if (localStorage.getItem('badalos.kv')) vfs.setSync(localStorage.getItem('badalos.kv'));

    const procs = new ProcessManager();
    procs.onchange = () => renderTaskbar();
    const wm = new WindowManager($('win-area'));
    wm.onchange = () => renderTaskbar();

    const os = { vfs, procs, wm, openApp, toast, cloudStatus: 'local' };

    // 2) Boot log
    for (let i = 0; i < BOOT_STEPS.length; i++) {
      let line = BOOT_STEPS[i];
      if (line.includes('{CLOUD}')) {
        line = vfs.kvEndpoint
          ? 'badal-cloud:  checking sync endpoint ...... online (' + vfs.kvEndpoint + ')'
          : 'badal-cloud:  checking sync endpoint ...... local-only (Settings mein configure)';
        os.cloudStatus = vfs.kvEndpoint ? 'cloud' : 'local';
      }
      put(line);
      pct = Math.round(((i + 1) / BOOT_STEPS.length) * 100);
      fill.style.width = pct + '%';
      await sleep(220);
    }

    await sleep(400);
    $('boot').classList.add('hidden');
    $('desktop').classList.remove('hidden');

    // 3) Desktop wire-up
    wireDesktop(os);
    openApp('terminal');
    console.log('[BadalOS] boot complete —', procs.list().length, 'procs');
  }

  /* ---------- app opening ---------- */
  function openApp(name) {
    const meta = BADAL_APPS[name];
    if (!meta) return;
    let app;
    try {
      app = meta.factory(OS_CTX);
    } catch (e) {
      OS_CTX.toast('app crash: ' + name + ' — ' + e.message, false);
      return;
    }
    const title = (app.title || meta.title);
    const win = OS_CTX.wm.create(title, app.el, app.opts || {});
    const pid = OS_CTX.procs.spawn({ name, kill: app.kill || null });
    WIN_MAP.set(pid, win.id);
    app.el.dataset.pid = pid;
  }

  const WIN_MAP = new Map(); // pid -> win id
  let OS_CTX = null;

  /* ---------- taskbar ---------- */
  function renderTaskbar() {
    const tb = $('tb-apps');
    if (!tb || !OS_CTX) return;
    tb.innerHTML = '';
    for (const p of OS_CTX.procs.list()) {
      const btn = document.createElement('button');
      btn.className = 'tb-app' + (isTopWin(WIN_MAP.get(p.pid)) ? ' active' : '');
      btn.textContent = p.app;
      btn.title = 'PID ' + p.pid;
      btn.onclick = () => OS_CTX.wm.focusTop(WIN_MAP.get(p.pid));
      tb.appendChild(btn);
    }
  }

  function isTopWin(id) {
    if (!id) return false;
    const win = OS_CTX.wm.windows.get(id);
    return win && !win.minimized && String(win.el.style.zIndex) === String(OS_CTX.wm.z);
  }

  /* ---------- toast ---------- */
  function toast(msg, ok = true) {
    const t = document.createElement('div');
    t.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
    t.textContent = (ok ? '✓ ' : '✗ ') + msg;
    $('desktop').appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  /* ---------- desktop events ---------- */
  function wireDesktop(os) {
    OS_CTX = os;

    // icons + start-menu items
    document.querySelectorAll('[data-app]').forEach((node) => {
      node.addEventListener('click', () => openApp(node.dataset.app));
    });

    // start menu toggle
    const sm = $('start-menu');
    $('start-btn').onclick = (e) => { e.stopPropagation(); sm.classList.toggle('hidden'); };
    sm.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => sm.classList.add('hidden'));
    $('sm-reboot').onclick = () => location.reload();

    // clock
    const clock = () => {
      const d = new Date();
      $('tb-clock').textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    };
    clock();
    setInterval(clock, 1000);

    // cloud button
    $('cloud-btn').onclick = () => {
      if (os.vfs.kvEndpoint) {
        os.toast('cloud sync ON: ' + os.vfs.kvEndpoint, true);
      } else {
        os.toast('local only — Settings mein Cloudflare endpoint daalo', false);
      }
    };

    // shutdown
    $('shutdown').onclick = () => {
      if (confirm('Shutdown BadalOS? (data auto-saved hai)')) {
        document.body.innerHTML = '<div style="position:fixed;inset:0;background:#0d1117;color:#8b949e;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:14px;flex-direction:column;gap:12px;">' +
          '<div style="font-size:40px;">☁️</div><div>BadalOS halted. Data cloud/local mein saved hai.</div>' +
          '<div style="font-size:11px;color:#58a6ff;cursor:pointer;border:1px solid #30363d;padding:6px 16px;border-radius:6px;" onclick="location.reload()">↻ Power On</div></div>';
      }
    };

    // window close se process kill bhi
    const origClose = WindowManager.prototype.close;
    WindowManager.prototype.close = function (id) {
      // pid dhoondo is window ka
      for (const [pid, wid] of WIN_MAP.entries()) {
        if (wid === id) {
          const p = OS_CTX.procs.procs.get(pid);
          if (p && p.kill) { try { p.kill(); } catch {} }
          OS_CTX.procs.procs.delete(pid);
          WIN_MAP.delete(pid);
          renderTaskbar();
        }
      }
      origClose.call(this, id);
    };
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
