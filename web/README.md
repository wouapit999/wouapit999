# Wouapit-Androman — Web UI

The marketing site and device console for
[Wouapit-Androman](../Wouapit-Androman), the free Android toolkit. It presents
the product, the exact ADB commands each action runs, an in-browser **WebUSB**
device detector, and an honest lockout-recovery guide.

This is a **static site** (plain HTML/CSS/JS, no build step, no dependencies).

## What it does — and doesn't

- Detects a connected Android device over WebUSB (Chrome/Edge, HTTPS) and shows
  its identity, and gives you the copy-paste command for every action.
- The actual USB-mode switch and file transfers run through the desktop app's
  ADB connection, which performs the phone's authorization handshake.
- It does **not** bypass, crack, or remove screen locks. The "Locked out?"
  section only points to the official, ownership-verified recovery routes
  (Find Device erase, factory reset, Mi Unlock), all of which erase data.

## Run locally

```bash
cd web
python3 -m http.server 3000      # then open http://localhost:3000
```

## Deploy to Vercel

No configuration needed — it deploys as a static site. Pick whichever is easiest.

**Option A — one-click button** (clones the repo into your account and deploys `web/`):

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwouapit999%2Fwouapit999&root-directory=web&project-name=wouapit-androman&framework=null)

**Option B — import the existing repo** (no clone, keeps this repo as the source):
1. Go to <https://vercel.com/new> and pick **wouapit999/wouapit999** from your GitHub.
2. Set **Root Directory** to `web`.
3. Framework preset: **Other**. Click **Deploy**.

**Option C — CLI** (run on your own machine, where you're logged in):
```bash
npm i -g vercel
cd web
vercel login      # opens your browser to authenticate
vercel --prod     # deploys web/ to production
```

`vercel.json` enables clean URLs and sets a `Permissions-Policy: usb=(self)`
header so WebUSB works on the deployed origin.
