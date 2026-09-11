/**
 * badalos-kernel.js — BadalOS ka core.
 *
 * Web-OS kernel jo browser mein chalta hai:
 *   - VirtualFileSystem (VFS): in-memory tree + localStorage persistence
 *     + Cloudflare KV sync (agar config ho to)
 *   - WindowManager: windows create/move/minimize/close z-order
 *   - ProcessManager: app spawn, ps, kill
 *   - Shell: cd/ls/cat/write/rm/mkdir/pwd/echo/clear/help
 *
 * Koi dependency nahi — vanilla JS, ek file kernel.
 * BadalOS = Linux-jaisa, lekin VPS nahi — compute browser mein, data cloud mein.
 */

/* ==================== VIRTUAL FILE SYSTEM ==================== */

class VFS {
  constructor() {
    this.tree = { '/': { type: 'dir', children: {} } };
    this.cwd = '/';
    this.storageKey = 'badalos.vfs.v1';
    this.kvEndpoint = null; // Cloudflare Worker URL (agar sync on ho)
    this.load();
  }

  _resolve(p) {
    if (!p) return this.cwd;
    let abs = p.startsWith('/') ? p : (this.cwd === '/' ? '' : this.cwd) + '/' + p;
    const parts = abs.split('/').filter(Boolean);
    const out = [];
    for (const part of parts) {
      if (part === '.') continue;
      else if (part === '..') out.pop();
      else out.push(part);
    }
    return '/' + out.join('/');
  }

  resolve(p) { return this._resolve(p); } // public alias (tests use it)

  _node(p) {
    const abs = this._resolve(p);
    if (abs === '/') return this.tree['/'];
    let node = this.tree['/'];
    for (const part of abs.split('/').filter(Boolean)) {
      if (node.type !== 'dir' || !node.children[part]) return null;
      node = node.children[part];
    }
    return node;
  }

  mkdir(p) {
    const abs = this._resolve(p);
    if (this._node(abs)) return { ok: false, err: 'already exists: ' + abs };
    const parts = abs.split('/').filter(Boolean);
    let node = this.tree['/'];
    for (const part of parts) {
      if (!node.children[part]) node.children[part] = { type: 'dir', children: {} };
      node = node.children[part];
    }
    this.persist();
    return { ok: true };
  }

  write(p, content) {
    const abs = this._resolve(p);
    const parts = autoSplit(abs);
    const name = parts.pop();
    let node = this.tree['/'];
    for (const part of parts) {
      if (!node.children[part]) node.children[part] = { type: 'dir', children: {} };
      if (node.children[part].type !== 'dir') return { ok: false, err: 'not a dir: /' + parts.join('/') };
      node = node.children[part];
    }
    if (!name) return { ok: false, err: 'invalid path' };
    const existed = node.children[name];
    node.children[name] = { type: 'file', content: String(content), mtime: Date.now() };
    this.persist();
    return { ok: true, created: !existed, path: abs };
  }

  read(p) {
    const n = this._node(p);
    if (!n) return { ok: false, err: 'no such file: ' + this._resolve(p) };
    if (n.type !== 'file') return { ok: false, err: 'is a directory: ' + this._resolve(p) };
    return { ok: true, content: n.content };
  }

  ls(p) {
    const n = this._node(p);
    if (!n) return { ok: false, err: 'no such dir: ' + this._resolve(p) };
    if (n.type === 'file') return { ok: true, entries: [{ name: basename(p), type: 'file' }] };
    const entries = Object.entries(n.children).map(([name, c]) => ({
      name, type: c.type, size: c.type === 'file' ? c.content.length : Object.keys(c.children).length,
    }));
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, entries };
  }

  rm(p) {
    const abs = this._resolve(p);
    if (abs === '/') return { ok: false, err: 'cannot rm /' };
    const parts = autoSplit(abs);
    const name = parts.pop();
    let node = this.tree['/'];
    for (const part of parts) node = node.children && node.children[part];
    if (!node || !node.children || !node.children[name]) return { ok: false, err: 'no such file: ' + abs };
    delete node.children[name];
    this.persist();
    return { ok: true };
  }

  /* --- persistence: localStorage + optional KV push --- */
  persist() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.tree)); } catch { /* quota */ }
    this.syncPush(); // fire-and-forget cloud sync
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        this.tree = JSON.parse(raw);
        if (!this.tree['/']) this.reset();
      } else {
        this.reset(); // pehli baar — default tree banao
      }
    } catch { this.reset(); }
  }

  reset() {
    this.tree = { '/': { type: 'dir', children: {} } };
    ['bin', 'etc', 'home', 'tmp', 'var'].forEach(d => {
      this.tree['/'].children[d] = { type: 'dir', children: {} };
    });
    this.write('/etc/motd', 'BadalOS 1.0 — badal (cloud) mein rehta hai, tera device sirf screen hai.\nType "help" for commands.\n');
    this.write('/etc/hostname', 'badal\n');
  }

  /* --- Cloudflare KV sync (fire-and-forget) --- */
  setSync(endpoint) { this.kvEndpoint = endpoint; }
  syncPush() {
    if (!this.kvEndpoint || typeof fetch !== 'function') return;
    try {
      fetch(this.kvEndpoint + '/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'save', tree: this.tree }),
      }).catch(() => {});
    } catch { /* offline — ignore */ }
  }
  /* KV se tree load (naye device pe login / recovery) — async */
  async syncPull() {
    if (!this.kvEndpoint || typeof fetch !== 'function') return { ok: false, err: 'no endpoint' };
    try {
      const r = await fetch(this.kvEndpoint + '/api/load');
      const data = await r.json();
      if (data.ok && data.tree && data.tree['/']) {
        this.tree = data.tree;
        this.persistLocal();
        return { ok: true };
      }
      return { ok: false, err: 'cloud empty' };
    } catch (e) {
      return { ok: false, err: String(e && e.message || e) };
    }
  }
  persistLocal() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.tree)); } catch { /* quota */ }
  }
}

function autoSplit(p) { return p.split('/').filter(Boolean); }
function basename(p) { const s = String(p).split('/').filter(Boolean); return s[s.length - 1] || '/'; }

/* ==================== PROCESS MANAGER ==================== */

class ProcessManager {
  constructor() {
    this.procs = new Map();
    this.nextPid = 1;
    this.onchange = null;
  }
  spawn(app) {
    const pid = this.nextPid++;
    this.procs.set(pid, { pid, app: app.name || 'unknown', started: Date.now(), kill: app.kill || null });
    if (this.onchange) this.onchange();
    return pid;
  }
  kill(pid) {
    const p = this.procs.get(pid);
    if (p && p.kill) { try { p.kill(); } catch {} }
    this.procs.delete(pid);
    if (this.onchange) this.onchange();
  }
  list() { return [...this.procs.values()].map(p => ({ ...p, kill: undefined })); }
}

/* ==================== WINDOW MANAGER ==================== */

class WindowManager {
  constructor(desktopEl, opts = {}) {
    this.desktop = desktopEl;
    this.winSeq = 1;
    this.z = 10;
    this.windows = new Map();
    this.onchange = null;
    this.defaultW = opts.w || 640; this.defaultH = opts.h || 420;
  }

  create(title, contentEl, opts = {}) {
    const id = 'win-' + this.winSeq++;
    const w = Math.min(opts.w || this.defaultW, Math.max(320, this.desktop.clientWidth - 40));
    const h = Math.min(opts.h || this.defaultH, Math.max(240, this.desktop.clientHeight - 80));
    const x = 40 + ((this.winSeq * 25) % Math.max(60, this.desktop.clientWidth - w - 80));
    const y = 24 + ((this.winSeq * 18) % Math.max(40, this.desktop.clientHeight - h - 120));

    const el = document.createElement('div');
    el.className = 'badal-window';
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.innerHTML =
      '<div class="badal-titlebar">' +
      '  <span class="badal-title">' + esc(title) + '</span>' +
      '  <span class="badal-winbtns">' +
      '    <button class="bw-min" title="Minimize">–</button>' +
      '    <button class="bw-close" title="Close">×</button>' +
      '  </span>' +
      '</div>' +
      '<div class="badal-body"></div>';
    const body = el.querySelector('.badal-body');
    if (contentEl) body.appendChild(contentEl);

    this.desktop.appendChild(el);
    this.windows.set(id, { id, el, minimized: false, title });

    // Focus + drag
    const focus = () => { this.z++; el.style.zIndex = this.z; };
    el.addEventListener('mousedown', focus);
    this.makeDraggable(el, focus);
    el.querySelector('.bw-close').onclick = (e) => { e.stopPropagation(); this.close(id); };
    el.querySelector('.bw-min').onclick = (e) => { e.stopPropagation(); this.minimize(id); };
    focus();
    this.emitChange();
    return { id, el, body };
  }

  makeDraggable(el, focus) {
    const bar = el.querySelector('.badal-titlebar');
    let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
    bar.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      drag = true; focus();
      sx = e.clientX; sy = e.clientY; ox = parseInt(el.style.left); oy = parseInt(el.style.top);
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      el.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      el.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => { drag = false; });
  }

  minimize(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.minimized = !win.minimized;
    win.el.classList.toggle('minimized', win.minimized);
    this.emitChange();
  }

  close(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.el.remove();
    this.windows.delete(id);
    this.emitChange();
  }

  focusTop(id) {
    const win = this.windows.get(id);
    if (win) { this.z++; win.el.style.zIndex = this.z; win.minimized = false; win.el.classList.remove('minimized'); }
  }

  emitChange() { if (this.onchange) this.onchange(); }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtKB(n) {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'K';
  return (n / 1024 / 1024).toFixed(1) + 'M';
}

/* ==================== SHELL ==================== */

class Shell {
  constructor(vfs, io) {
    this.vfs = vfs;
    this.io = io; // { print(text), input() -> Promise<string>, clear() }
  }

  async run(line) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return;
    switch (cmd) {
      case 'help': return this.printHelp();
      case 'clear': return this.io.clear();
      case 'pwd': return this.io.print(this.vfs.cwd);
      case 'echo': return this.io.print(args.join(' '));
      case 'cd': {
        const target = args[0] || '/';
        const abs = this.vfs._resolve(target);
        const node = this.vfs._node(abs);
        if (!node) return this.io.print('cd: no such directory: ' + target);
        if (node.type !== 'dir') return this.io.print('cd: not a directory: ' + target);
        this.vfs.cwd = abs;
        return;
      }
      case 'ls': {
        const r = this.vfs.ls(args[0] || '.');
        if (!r.ok) return this.io.print('ls: ' + r.err);
        if (!r.entries.length) return;
        const namePad = Math.max(...r.entries.map(e => e.name.length)) + 2;
        this.io.print(r.entries.map(e => {
          const tag = e.type === 'dir' ? '/' : '';
          return e.name.padEnd(namePad) + tag + (e.type === 'file' ? '  ' + e.size + 'B' : '');
        }).join('\n'));
        return;
      }
      case 'cat': {
        if (!args[0]) return this.io.print('cat: missing operand');
        const r = this.vfs.read(args[0]);
        return this.io.print(r.ok ? r.content : 'cat: ' + r.err);
      }
      case 'write': {
        if (args.length < 2) return this.io.print('usage: write <file> <text...>');
        const r = this.vfs.write(args[0], args.slice(1).join(' '));
        return this.io.print(r.ok ? '' : 'write: ' + r.err);
      }
      case 'mkdir': return this.printOp(this.vfs.mkdir(args[0]), 'mkdir');
      case 'rm': return this.printOp(this.vfs.rm(args[0]), 'rm');
      case 'cp': {
        if (args.length < 2) return this.io.print('usage: cp <src> <dst>');
        const r = this.vfs.read(args[0]);
        if (!r.ok) return this.io.print('cp: ' + r.err);
        const w = this.vfs.write(args[1], r.content);
        return this.io.print(w.ok ? '' : 'cp: ' + w.err);
      }
      case 'mv': {
        if (args.length < 2) return this.io.print('usage: mv <src> <dst>');
        const r = this.vfs.read(args[0]);
        if (!r.ok) return this.io.print('mv: ' + r.err);
        const w = this.vfs.write(args[1], r.content);
        if (!w.ok) return this.io.print('mv: ' + w.err);
        this.vfs.rm(args[0]);
        return;
      }
      case 'touch': {
        if (!args[0]) return this.io.print('usage: touch <file>');
        const r = this.vfs.read(args[0]);
        return this.vfs.write(args[0], r.ok ? r.content : '');
      }
      case 'tree': {
        const root = args[0] || '.';
        const node = this.vfs._node(this.vfs._resolve(root));
        if (!node) return this.io.print('tree: no such directory: ' + root);
        this.io.print(this.vfs._resolve(root));
        this.printTree(node, '', this.io);
        return;
      }
      case 'find': {
        const q = (args[0] || '').toLowerCase();
        if (!q) return this.io.print('usage: find <name>');
        const hits = this.walk('.').filter((p) => p.toLowerCase().includes(q));
        return this.io.print(hits.length ? hits.join('\n') : '(kuch nahi mila)');
      }
      case 'grep': {
        // grep <text> [path]
        if (!args[0]) return this.io.print('usage: grep <text> [path]');
        const root = args[1] || '.';
        let count = 0;
        for (const p of this.walk(root)) {
          const r = this.vfs.read(p);
          if (!r.ok) continue;
          const lines = r.content.split('\n');
          lines.forEach((l, i) => {
            if (l.toLowerCase().includes(args[0].toLowerCase())) {
              count++;
              this.io.print(p + ':' + (i + 1) + ': ' + l.trim().slice(0, 80));
            }
          });
        }
        if (!count) this.io.print('(kuch nahi mila)');
        return;
      }
      case 'wc': {
        if (!args[0]) return this.io.print('usage: wc <file>');
        const r = this.vfs.read(args[0]);
        if (!r.ok) return this.io.print('wc: ' + r.err);
        const lines = r.content.split('\n').length;
        const words = r.content.split(/\s+/).filter(Boolean).length;
        return this.io.print(lines + ' lines  ' + words + ' words  ' + r.content.length + ' bytes');
      }
      case 'head': return this.printSlice(args, 0);
      case 'tail': return this.printSlice(args, -1);
      case 'df': {
        const raw = (typeof localStorage !== 'undefined' && localStorage.getItem) ? (localStorage.getItem('badalos.vfs.v1') || '') : '';
        const quota = 5 * 1024 * 1024;
        return this.io.print(
          'Filesystem   Used     Free     Use%  Mount\n' +
          'badal-vfs    ' + fmtKB(raw.length) + '  ' + fmtKB(quota - raw.length) + '  ' +
          Math.round((raw.length / quota) * 100) + '%    /'
        );
      }
      case 'top': {
        if (!this.io.psList) return this.io.print('top: no process info');
        this.io.print('PID  APP            UPTIME');
        for (const p of this.io.psList()) {
          const up = Math.floor((Date.now() - p.started) / 1000);
          this.io.print(String(p.pid).padEnd(5) + p.app.padEnd(15) + up + 's');
        }
        return;
      }
      case 'neofetch': return this.io.print(
        '      ☁️       root@badal\n' +
        '     ☁☁️       -------\n' +
        '    ☁☁☁️       OS: BadalOS 1.0 cloud\n' +
        '   ☁☁☁☁️      Kernel: badal-kernel 1.0\n' +
        '              Shell: badal-sh 1.0\n' +
        '              WM: BadalWM\n' +
        '              Host: ' + (typeof navigator !== 'undefined' ? (navigator.platform || 'web') : 'web') + '\n' +
        '              Uptime: ' + Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) / 1000) + 's\n' +
        '              Cloud: ' + (this.vfs.kvEndpoint ? 'ONLINE ☁' : 'local-only')
      );
      case 'whoami': return this.io.print('root@badal (cloud-admin)');
      case 'uname': return this.io.print('BadalOS 1.0 cloud ' + (navigator ? navigator.platform || 'web' : 'web'));
      case 'date': return this.io.print(new Date().toString());
      case 'ps': {
        if (!this.io.psList) return;
        this.io.print('PID  APP       STARTED');
        for (const p of this.io.psList()) {
          this.io.print(String(p.pid).padEnd(5) + p.app.padEnd(10) + new Date(p.started).toLocaleTimeString());
        }
        return;
      }
      default:
        return this.io.print(cmd + ': command not found (try "help")');
    }
  }

  printOp(r, name) {
    if (!r.ok) this.io.print(name + ': ' + r.err);
  }

  /** recursive tree print helper (tree command) */
  printTree(node, prefix, io) {
    const kids = node.type === 'dir' ? Object.entries(node.children) : [];
    kids.forEach(([name, child], i) => {
      const last = i === kids.length - 1;
      io.print(prefix + (last ? '└── ' : '├── ') + name + (child.type === 'dir' ? '/' : ''));
      if (child.type === 'dir') this.printTree(child, prefix + (last ? '    ' : '│   '), io);
    });
  }

  /** walk — cwd se saare file paths (find/grep ke liye) */
  walk(from) {
    const out = [];
    const rootAbs = this.vfs._resolve(from || '.');
    const node = this.vfs._node(rootAbs);
    if (!node) return out;
    const rec = (n, prefix) => {
      if (n.type !== 'dir') return;
      for (const [name, child] of Object.entries(n.children)) {
        const p = prefix + name;
        if (child.type === 'dir') rec(child, p + '/');
        else out.push(p);
      }
    };
    rec(node, rootAbs === '/' ? '' : rootAbs.replace(/^\//, '') + '/');
    return out;
  }

  /** head/tail helper — pehli/akhri N lines */
  printSlice(args, dir) {
    if (!args[0]) return this.io.print('usage: head/tail <file> [lines]');
    const r = this.vfs.read(args[0]);
    if (!r.ok) return this.io.print('head: ' + r.err);
    const n = parseInt(args[1], 10) || 10;
    const lines = r.content.split('\n');
    const slice = dir === 0 ? lines.slice(0, n) : lines.slice(-n);
    return this.io.print(slice.join('\n'));
  }

  printHelp() {
    this.io.print(
      'BadalOS shell commands:\n' +
      '  help            ye list\n' +
      '  clear           screen saaf\n' +
      '  pwd             current dir\n' +
      '  cd <dir>        directory change\n' +
      '  ls [dir]        list files\n' +
      '  cat <file>      file padho\n' +
      '  write <f> <txt> file likho\n' +
      '  mkdir <dir>     directory banao\n' +
      '  rm <file>       hatao\n' +
      '  echo <txt>      print\n' +
      '  cp/mv <a> <b>  copy/move file\n' +
      '  touch <file>    khali file banao\n' +
      '  tree [dir]      directory ka tree\n' +
      '  find <name>     file dhoondo\n' +
      '  grep <txt> [p]  text dhoondo files mein\n' +
      '  wc <file>       lines/words/bytes\n' +
      '  head/tail <f> [n] pehli/akhri n lines\n' +
      '  df              storage usage\n' +
      '  top             process list + uptime\n' +
      '  neofetch        OS info ☁\n' +
      '  whoami / uname / date\n' +
      '  ps              running processes'
    );
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VFS, Shell, ProcessManager, WindowManager, esc, fmtKB };
}
