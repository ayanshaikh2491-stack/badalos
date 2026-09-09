# ☁️ BadalOS

**Linux-jaisa lightweight OS jo browser mein chalta hai — VPS nahi chahiye, hosting free hai.**

> *badal* (बादल) = cloud. OS cloud pe rehta hai, tera device sirf screen hai.

```
Laptop ON:   ██████████░░  BadalOS desktop + apps
Laptop OFF:  ░░░░░░░░░░░░  BadalOS data + cron cloud mein ZINDA
```

## Ye kya hai

Ek web-OS: desktop, taskbar, terminal, file manager, editor, sysmon, settings — sab **browser ke andar** chalta hai (koi VPS/CPU/GPU rent nahi).

| Cheez | Kahan | Cost |
|---|---|---|
| **Kernel + apps** | Tere browser mein (compute free) | ₹0 |
| **Hosting** (OS files) | Cloudflare Pages | ₹0 |
| **Hard-disk** (VFS sync) | Cloudflare KV | ₹0 |
| **Cron daemon** (background jobs) | Cloudflare Worker + Cron | ₹0 |

**Total: ₹0/month.** Laptop band karo — data cloud mein zinda, cron jobs chalte rahenge. Kisi bhi device se login karo — wahi OS khulega.

## Features

- **Terminal** — `ls/cd/cat/write/mkdir/rm/echo/ps/help` (history arrow keys ke saath)
- **Files** — dual-click navigation, new file/dir, delete, editor se open
- **Editor** — VFS files open/save/save-as
- **SysMon** — live processes, storage usage, cloud status
- **Settings** — Cloudflare sync endpoint config, cloud se restore, VFS reset
- **Boot screen** — dmesg-jaisa boot log (nostalgia included 😄)
- **Window manager** — draggable windows, minimize, z-order, taskbar sync

## Quick start (local)

```bash
git clone https://github.com/ayanshaikh2491-stack/badalos.git
cd badalos
node serve.js          # http://localhost:4173
```

Zero dependencies — Node stdlib only.

## Deploy — free (10 minute)

### 1. OS files → Cloudflare Pages

```bash
# Cloudflare dashboard -> Workers & Pages -> Create -> Pages
# Direct upload: index.html, style.css, boot.js, badalos-apps.js, kernel/, favicon.svg
```

Ya wrangler se:

```bash
npm i -g wrangler
wrangler pages deploy . --project-name=badalos
```

### 2. Cloud hard-disk + cron → Worker

```bash
cd worker
npm i -g wrangler
wrangler login
wrangler kv namespace create BADALOS     # id copy karo
# wrangler.toml mein id daalo (REPLACE_WITH_YOUR_KV_ID)
wrangler deploy
```

### 3. OS ko cloud se jodo

BadalOS → Settings → endpoint daalo:
```
https://badalos-cloud.<your-name>.workers.dev
```

**Ho gaya.** Ab har file-write cloud mein push hoti hai. Laptop band karo, phone se kholo — same files. Cron har 30 min `/var/log/heartbeat` mein likhta hai — device off ho tab bhi.

## Architecture

```
┌─ Browser (tera device — FREE compute) ─┐
│  boot.js → WindowManager → Apps         │
│  badalos-kernel.js: VFS + Shell + PM    │
│         ↕ localStorage (fast cache)     │
│         ↕ fetch (sync push/pull)        │
└──────────────┬──────────────────────────┘
               ↓
┌─ Cloudflare (FREE tier) ────────────────┐
│  Pages: OS static files                 │
│  Worker: /api/save /api/load (KV sync)  │
│  Cron: heartbeat daemon (30 min)        │
└─────────────────────────────────────────┘
```

## Tests — 44/44

```bash
node test-badalos.js
```

Covers: VFS (resolve/write/read/ls/mkdir/rm/deep paths), localStorage persistence, default tree, shell commands (12), process manager (spawn/kill/onChange), esc().

Browser-verified: boot, terminal `ls`, Files app, Editor save→VFS→localStorage, window close→taskbar sync, computed styles (CSS applied), zero console errors.

## Roadmap

- [ ] Terminal: pipes/redirection
- [ ] More apps: clock, calculator, browser (iframe sandbox)
- [ ] Multi-user: auth + per-user KV
- [ ] Agent app: loop-energy/codegraph integration
- [ ] Offline PWA (installable)

## License

MIT
