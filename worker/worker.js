/**
 * worker.js — BadalOS ka Cloud home (100% free tier).
 *
 * Do kaam:
 *   1. KV SYNC API: VFS tree save/load — BadalOS ka "cloud hard-disk".
 *      Laptop band kar do, data zinda.
 *   2. CRON DAEMON: scheduled jobs jo cloud pe chalte hain — device off ho tab bhi.
 *      (Shuruaat mein: health ping + notes/reminders file mein log entry)
 *
 * Deploy (free):
 *   npm i -g wrangler
 *   wrangler login
 *   wrangler kv:namespace create BADALOS
 *   # wrangler.toml (repo mein hai) mein id daalo
 *   wrangler deploy
 *   # cron: wrangler.toml mein [triggers] diya hai
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  /** HTTP — VFS sync API */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/api/save' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !body.tree) return json({ ok: false, err: 'bad body' }, 400);
      if (JSON.stringify(body.tree).length > 20 * 1024 * 1024) return json({ ok: false, err: 'tree >20MB' }, 413);
      await env.BADALOS.put('vfs', JSON.stringify(body.tree));
      return json({ ok: true, saved: new Date().toISOString() });
    }

    if (url.pathname === '/api/load' && request.method === 'GET') {
      const tree = await env.BADALOS.get('vfs');
      return json({ ok: true, tree: tree ? JSON.parse(tree) : null });
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, alive: new Date().toISOString() });
    }

    return json({ ok: false, err: 'not found', endpoints: ['/api/save', '/api/load', '/api/health'] }, 404);
  },

  /**
   * CRON DAEMON — scheduled jobs, device band hone ke baad bhi chalte hain.
   * wrangler.toml: cron every 30 min.
   * Job: heartbeat log + /var/log/heartbeat file mein entry daalta hai.
   */
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    const tree = await env.BADALOS.get('vfs');
    if (tree) {
      const parsed = JSON.parse(tree);
      // /var/log banao agar nahi
      parsed['/'] = parsed['/'] || { type: 'dir', children: {} };
      parsed['/'].children['var'] = parsed['/'].children['var'] || { type: 'dir', children: {} };
      const varDir = parsed['/'].children['var'];
      varDir.children['log'] = varDir.children['log'] || { type: 'dir', children: {} };
      const logDir = varDir.children['log'];
      // heartbeat file — last 50 entries
      const hb = logDir.children['heartbeat'] || { type: 'file', content: '', mtime: Date.now() };
      const lines = hb.content ? hb.content.split('\n').filter(Boolean) : [];
      lines.push('[cron ' + now + '] badal alive — device band ho tab bhi');
      hb.content = lines.slice(-50).join('\n') + '\n';
      hb.mtime = Date.now();
      logDir.children['heartbeat'] = hb;
      await env.BADALOS.put('vfs', JSON.stringify(parsed));
    } else {
      await env.BADALOS.put('cron-heartbeat', now);
    }
    console.log('[cron] heartbeat ' + now);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
