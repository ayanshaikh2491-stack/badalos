/**
 * test-badalos.js — BadalOS kernel tests (Node mein — DOM-free logic).
 * Run: node test-badalos.js
 */

const { VFS, Shell, ProcessManager, esc } = require('./kernel/badalos-kernel.js');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('PASS: ' + name); pass++; }
  else { console.log('FAIL: ' + name + (detail ? ' — ' + detail : '')); fail++; }
};

// localStorage mock (kernel persistence ke liye)
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

/* ============ VFS ============ */
console.log('=== V1: basic write/read ===');
const vfs = new VFS();
check('V1 resolve abs', vfs.resolve('/home') === '/home');
check('V1 resolve rel from root', vfs.resolve('home') === '/home');
vfs.cwd = '/home';
check('V1 resolve rel from /home', vfs.resolve('x') === '/home/x');
check('V1 resolve dotdot', vfs.resolve('..') === '/');
check('V1 resolve dotdot chain', vfs.resolve('../../home') === '/home');
const w1 = vfs.write('/home/readme.txt', 'BadalOS zinda hai');
check('V1 write ok', w1.ok);
check('V1 read back', vfs.read('/home/readme.txt').content === 'BadalOS zinda hai');
check('V1 read missing', !vfs.read('/nope.txt').ok);
check('V1 read dir as file fails', !vfs.read('/home').ok);

console.log('\n=== V2: mkdir/ls/rm ===');
check('V2 mkdir', vfs.mkdir('/home/projects').ok);
check('V2 mkdir dup fails', !vfs.mkdir('/home/projects').ok);
vfs.write('/home/projects/a.txt', 'aaa');
vfs.write('/home/projects/b.md', 'bbb');
const ls1 = vfs.ls('/home/projects');
check('V2 ls 2 entries', ls1.ok && ls1.entries.length === 2, JSON.stringify(ls1));
check('V2 ls sorted', ls1.entries[0].name === 'a.txt');
check('V2 ls file sizes', ls1.entries[0].size === 3);
vfs.rm('/home/projects/a.txt');
check('V2 rm removes', vfs.ls('/home/projects').entries.length === 1);
check('V2 rm missing fails', !vfs.rm('/home/zzz').ok);
check('V2 rm root fails', !vfs.rm('/').ok);

console.log('\n=== V3: write creates parent dirs ===');
const w3 = vfs.write('/deep/nested/path/file.txt', 'deep');
check('V3 deep write ok', w3.ok && w3.path === '/deep/nested/path/file.txt');
check('V3 deep read', vfs.read('/deep/nested/path/file.txt').content === 'deep');
const lsD = vfs.ls('/deep/nested');
check('V3 parent auto-created', lsD.ok && lsD.entries.some(e => e.name === 'path'));

console.log('\n=== V4: persistence ===');
const vfs2 = new VFS();
check('V4 reload from localStorage', vfs2.read('/home/readme.txt').content === 'BadalOS zinda hai');
check('V4 dirs survive', vfs2.ls('/home/projects').entries.length === 1);

console.log('\n=== V5: default tree (reset) ===');
const vfs3 = new VFS();
store['badalos.vfs.v1'] = null; // corrupt force
const vfs4 = new VFS();
check('V5 motd exists', vfs4.read('/etc/motd').ok);
check('V5 hostname', vfs4.read('/etc/hostname').content.trim() === 'badal');

/* ============ SHELL ============ */
console.log('\n=== S1: shell commands ===');
const lines = [];
const io = {
  print: (t) => lines.push(String(t)),
  clear: () => { lines.length = 0; },
  psList: () => [{ pid: 1, app: 'terminal', started: Date.now() }],
};
const shell = new Shell(vfs4, io);
vfs4.write('/home/todo.md', 'cloud data zinda');

const run = async (cmd) => { await shell.run(cmd); };
(async () => {
  await run('help');
  check('S1 help lists commands', lines.join('\n').includes('mkdir'));
  await run('echo hello badal');
  check('S1 echo', lines[lines.length - 1] === 'hello badal');
  await run('pwd');
  check('S1 pwd', lines[lines.length - 1] === '/');
  await run('cd /home');
  await run('pwd');
  check('S1 cd+pwd', lines[lines.length - 1] === '/home');
  await run('cat todo.md');
  check('S1 cat', lines[lines.length - 1] === 'cloud data zinda');
  await run('cat nope');
  check('S1 cat missing errs', lines[lines.length - 1].includes('no such file'));
  await run('ls');
  const lsOut = lines[lines.length - 1];
  check('S1 ls shows todo', lsOut.includes('todo.md'));
  await run('cd /');
  await run('write /home/note.txt naya note');
  check('S1 write', vfs4.read('/home/note.txt').content === 'naya note');
  await run('mkdir /home/newdir');
  check('S1 mkdir', vfs4.ls('/home/newdir').ok);
  await run('rm /home/note.txt');
  check('S1 rm', !vfs4.read('/home/note.txt').ok);
  await run('bogus');
  check('S1 unknown cmd', lines[lines.length - 1].includes('command not found'));
  await run('whoami');
  check('S1 whoami', lines[lines.length - 1].includes('root@badal'));
  await run('ps');
  check('S1 ps lists', lines.join('\n').match(/\b1\s+terminal/));
  await run('clear');
  check('S1 clear', lines.length === 0);

  /* ============ PROCESS MANAGER ============ */
  console.log('\n=== P1: processes ===');
  const pm = new ProcessManager();
  let changed = 0;
  pm.onchange = () => changed++;
  const pid = pm.spawn({ name: 'sysmon' });
  const pid2 = pm.spawn({ name: 'files' });
  check('P1 pids sequential', pid === 1 && pid2 === 2);
  check('P1 list', pm.list().length === 2);
  let killed = false;
  pm.spawn({ name: 'dying', kill: () => { killed = true; } });
  pm.kill(3);
  check('P1 kill runs killer', killed);
  check('P1 kill removes', pm.list().length === 2);
  check('P1 onchange fired', changed >= 4);

  /* ============ MISC ============ */
  console.log('\n=== M1: esc ===');
  check('M1 esc html', esc('<script>"x"</script>') === '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');

  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${pass} pass, ${fail} fail`);
  console.log('='.repeat(50));
  if (fail) process.exit(1);
  console.log('ALL BADALOS TESTS PASSED');
})();
