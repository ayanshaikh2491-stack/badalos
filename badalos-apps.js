/**
 * badalos-apps.js — BadalOS ke apps.
 * Har app ek function hai: (os) => { el, name, kill? }
 *   os = { vfs, wm, procs, openApp(name), toast(msg, ok) }
 */

/* ==================== TERMINAL ==================== */

function appTerminal(os) {
  const el = document.createElement('div');
  el.className = 'term';
  const out = document.createElement('div');
  out.className = 'term-out';
  const row = document.createElement('div');
  row.className = 'term-input-row';
  const promptEl = document.createElement('span');
  promptEl.className = 'term-prompt';
  const input = document.createElement('input');
  input.className = 'term-input';
  row.appendChild(promptEl);
  row.appendChild(input);
  el.appendChild(out);
  el.appendChild(row);

  const history = [];
  let hIndex = -1;

  const io = {
    print: (t) => {
      const line = document.createElement('div');
      line.textContent = t === '' ? ' ' : String(t);
      out.appendChild(line);
      out.scrollTop = out.scrollHeight;
    },
    clear: () => { out.innerHTML = ''; },
    psList: () => os.procs.list(),
  };

  const shell = new Shell(os.vfs, io);
  const refreshPrompt = () => {
    const cwd = os.vfs.cwd === '/' ? '/' : os.vfs.cwd.split('/').pop();
    promptEl.textContent = 'root@badal:' + os.vfs.cwd + '$ ';
  };

  io.print('BadalOS 1.0 — kernel loaded. Type "help".');
  if (os.vfs && os.vfs.read && os.vfs.read('/etc/motd').ok) io.print(os.vfs.read('/etc/motd').content.trim());
  refreshPrompt();

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const line = input.value;
      input.value = '';
      io.print('root@badal:' + os.vfs.cwd + '$ ' + line);
      if (line.trim()) { history.unshift(line); hIndex = -1; }
      await shell.run(line);
      refreshPrompt();
      input.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hIndex < history.length - 1) { hIndex++; input.value = history[hIndex]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hIndex > 0) { hIndex--; input.value = history[hIndex]; }
      else { hIndex = -1; input.value = ''; }
    }
  });

  el.addEventListener('mousedown', () => setTimeout(() => input.focus(), 0));
  return { el, name: 'terminal' };
}

/* ==================== FILES ==================== */

function appFiles(os) {
  const el = document.createElement('div');
  el.className = 'fm';
  const toolbar = document.createElement('div');
  toolbar.className = 'fm-toolbar';
  const pathEl = document.createElement('div');
  pathEl.className = 'fm-path';
  const list = document.createElement('div');
  list.className = 'fm-list';

  const mkBtn = (label, onClick) => {
    const b = document.createElement('button');
    b.className = 'fm-btn';
    b.textContent = label;
    b.onclick = onClick;
    toolbar.appendChild(b);
    return b;
  };

  let cwd = os.vfs.cwd;
  const refresh = () => {
    pathEl.textContent = cwd;
    list.innerHTML = '';
    const r = os.vfs.ls(cwd);
    if (!r.ok) { cwd = '/'; return refresh(); }
    if (!r.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'fm-empty';
      empty.textContent = '(empty directory)';
      list.appendChild(empty);
    }
    if (cwd !== '/') {
      const up = document.createElement('div');
      up.className = 'fm-row';
      up.innerHTML = '<span class="fm-name dir">..</span><span class="fm-type">dir</span>';
      up.onclick = () => { cwd = os.vfs.resolve(cwd + '/..'); refresh(); };
      list.appendChild(up);
    }
    for (const entry of r.entries) {
      const row = document.createElement('div');
      row.className = 'fm-row';
      const name = document.createElement('span');
      name.className = 'fm-name' + (entry.type === 'dir' ? ' dir' : '');
      name.textContent = entry.name;
      const type = document.createElement('span');
      type.className = 'fm-type';
      type.textContent = entry.type;
      const size = document.createElement('span');
      size.className = 'fm-size';
      size.textContent = entry.type === 'file' ? fmtSize(entry.size) : '';
      row.appendChild(name); row.appendChild(type); row.appendChild(size);
      row.ondblclick = () => {
        if (entry.type === 'dir') { cwd = os.vfs.resolve(cwd + '/' + entry.name); refresh(); }
        else openEditor(os, os.vfs.resolve(cwd + '/' + entry.name));
      };
      row.onclick = () => {
        document.querySelectorAll('.fm-row.selected').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
      };
      list.appendChild(row);
    }
  };

  mkBtn('←', () => { cwd = os.vfs.resolve(cwd + '/..'); refresh(); });
  mkBtn('Home', () => { cwd = '/'; refresh(); });
  mkBtn('New Dir', () => {
    const name = prompt('Directory name:');
    if (name) { os.vfs.mkdir(os.vfs.resolve(cwd + '/' + name)); refresh(); }
  });
  mkBtn('New File', () => {
    const name = prompt('File name:');
    if (name) { os.vfs.write(os.vfs.resolve(cwd + '/' + name), ''); refresh(); }
  });
  mkBtn('Delete', () => {
    const sel = list.querySelector('.fm-row.selected .fm-name');
    if (!sel) return os.toast('pehle kuch select karo (single click)', false);
    const name = sel.textContent;
    if (confirm('Delete "' + name + '"?')) { os.vfs.rm(os.vfs.resolve(cwd + '/' + name)); refresh(); }
  });
  mkBtn('Open', () => {
    const sel = list.querySelector('.fm-row.selected .fm-name');
    if (!sel) return os.toast('pehle kuch select karo', false);
    const target = os.vfs.resolve(cwd + '/' + sel.textContent);
    const node = os.vfs._node(target);
    if (!node) return;
    if (node.type === 'dir') { cwd = target; refresh(); }
    else openEditor(os, target);
  });

  toolbar.appendChild(pathEl);
  el.appendChild(toolbar);
  el.appendChild(list);
  refresh();
  return { el, name: 'files' };
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/* ==================== EDITOR ==================== */

function appEditor(os) { return openEditor(os, '/tmp/untitled.txt'); }

function openEditor(os, initialPath) {
  const el = document.createElement('div');
  el.className = 'ed';
  const toolbar = document.createElement('div');
  toolbar.className = 'ed-toolbar';
  const pathInput = document.createElement('input');
  pathInput.type = 'text';
  pathInput.value = initialPath;
  const textarea = document.createElement('textarea');
  textarea.spellcheck = false;

  const mkBtn = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'fm-btn';
    b.textContent = label;
    b.onclick = fn;
    toolbar.appendChild(b);
  };

  const load = () => {
    const r = os.vfs.read(pathInput.value);
    if (r.ok) textarea.value = r.content;
    else textarea.value = '';
  };
  mkBtn('Open', () => load());
  mkBtn('Save', () => {
    const r = os.vfs.write(pathInput.value, textarea.value);
    os.toast(r.ok ? 'saved: ' + pathInput.value : 'save fail: ' + r.err, r.ok);
  });
  mkBtn('Save As', () => {
    const p = prompt('Save to path:', pathInput.value);
    if (p) { pathInput.value = os.vfs.resolve(p); os.vfs.write(pathInput.value, textarea.value); os.toast('saved: ' + pathInput.value, true); }
  });

  toolbar.appendChild(pathInput);
  el.appendChild(toolbar);
  el.appendChild(textarea);
  load();
  return { el, name: 'editor', title: 'Editor — ' + (initialPath || 'untitled') };
}

/* ==================== SYSMON ==================== */

function appSysmon(os) {
  const el = document.createElement('div');
  el.className = 'sysmon';
  const timer = setInterval(render, 1000);
  function render() {
    const procs = os.procs.list();
    const vfs = os.vfs;
    let fileCount = 0, byteCount = 0;
    (function count(node) {
      for (const c of Object.values(node.children || {})) {
        if (c.type === 'file') { fileCount++; byteCount += c.content ? c.content.length : 0; }
        else count(c);
      }
    })(vfs.tree['/']);
    const storageUsed = (() => { try { return (localStorage.getItem('badalos.vfs.v1') || '').length; } catch { return 0; } })();
    el.innerHTML =
      '<h3>System</h3>' +
      'Kernel: BadalOS 1.0 (web) &nbsp;|&nbsp; Boot: <span class="ok">OK</span><br>' +
      'Platform: ' + esc(navigator.platform || 'web') + ' &nbsp;|&nbsp; Cores: ' + (navigator.hardwareConcurrency || '?') + '<br>' +
      'Uptime: ' + Math.floor(performance.now() / 1000) + 's<br>' +
      '<h3>Processes</h3>' +
      (procs.length ? procs.map(p => '[' + p.pid + '] ' + esc(p.app)).join('<br>') : '(none)') +
      '<h3>Storage (VFS)</h3>' +
      'Files: ' + fileCount + ' &nbsp;|&nbsp; Bytes: ' + byteCount + '<br>' +
      'localStorage: ' + fmtSize(storageUsed) + ' / ' + fmtSize(estimateQuota()) + ' (approx)<br>' +
      '<h3>Cloud Sync</h3>' +
      (vfs.kvEndpoint
        ? '<span class="ok">● Online</span> — ' + esc(vfs.kvEndpoint) + ' (auto-push on write)'
        : '<span class="warn">○ Local only</span> — Settings mein Cloudflare endpoint daalo, phir laptop band karke bhi data zinda') +
      '<h3>Performance</h3>' +
      '<div class="bar"><div class="bar-fill" style="width:' + Math.min(100, storageUsed / 50000 * 100) + '%"></div></div> storage pressure';
  }
  render();
  return { el, name: 'sysmon', kill: () => clearInterval(timer) };
}

function estimateQuota() { return 5 * 1024 * 1024; /* localStorage typical ~5MB */ }

/* ==================== SETTINGS ==================== */

function appSettings(os) {
  const el = document.createElement('div');
  el.className = 'settings';
  el.innerHTML =
    '<label>Cloudflare Worker endpoint (KV sync)</label>' +
    '<input type="text" id="st-kv" placeholder="https://your-worker.your-name.workers.dev">' +
    '<div class="hint">Ye endpoint BadalOS ka "cloud hard-disk" hai. Data har write pe cloud push hota hai. ' +
    'Laptop band kar do — data cloud mein zinda rehta hai, kisi bhi device se login karo.<br><br>' +
    'Setup: README.md mein deploy guide hai (100% free — Cloudflare free tier).</div>' +
    '<button id="st-save">Save Settings</button>' +
    '<button id="st-restore" style="margin-left:8px;">☁ Restore from Cloud</button>' +
    '<div class="hint" id="st-status"></div>' +
    '<h3 class="sysmon-h" style="color:var(--muted);font-size:12px;margin:16px 0 6px;">Danger Zone</h3>' +
    '<button id="st-reset" style="border-color:rgba(248,81,73,.4);color:var(--red);background:rgba(248,81,73,.1);">Reset VFS (sab delete)</button>';

  setTimeout(() => {
    const kvInput = el.querySelector('#st-kv');
    const statusEl = el.querySelector('#st-status');
    kvInput.value = localStorage.getItem('badalos.kv') || '';
    el.querySelector('#st-save').onclick = () => {
      const v = kvInput.value.trim();
      localStorage.setItem('badalos.kv', v);
      if (v) {
        os.vfs.setSync(v);
        statusEl.innerHTML = '<span class="status-ok">Saved. Cloud sync ON — ' + esc(v) + '</span>';
      } else {
        os.vfs.setSync(null);
        statusEl.innerHTML = '<span class="status-err">Saved. Cloud sync OFF (local only)</span>';
      }
    };
    el.querySelector('#st-restore').onclick = async () => {
      statusEl.textContent = 'cloud se laa raha hoon...';
      const r = await os.vfs.syncPull();
      if (r.ok) { statusEl.innerHTML = '<span class="status-ok">Restored ✓ — cloud se data aa gaya (2s mein reload hoga)</span>'; setTimeout(() => location.reload(), 2000); }
      else statusEl.innerHTML = '<span class="status-err">Restore fail: ' + esc(r.err) + '</span>';
    };
    el.querySelector('#st-reset').onclick = () => {
      if (confirm('Sab files delete? Ye undo nahi hota.')) {
        localStorage.removeItem('badalos.vfs.v1');
        location.reload();
      }
    };
  }, 0);
  return { el, name: 'settings' };
}

/* ==================== APP REGISTRY ==================== */

const BADAL_APPS = {
  terminal: { title: 'Terminal', factory: appTerminal },
  files: { title: 'Files', factory: appFiles },
  editor: { title: 'Editor', factory: appEditor },
  sysmon: { title: 'System Monitor', factory: appSysmon },
  settings: { title: 'Settings', factory: appSettings },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BADAL_APPS, appTerminal, appFiles, appEditor, appSysmon, appSettings, openEditor, fmtSize };
}
