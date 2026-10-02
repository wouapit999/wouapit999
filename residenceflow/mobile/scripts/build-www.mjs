// Generates the tiny local web directory: the offline fallback page shown when the device has
// no connection (Capacitor `server.errorPath`), in both languages, plus a start page.
import { mkdirSync, writeFileSync } from "node:fs";

const appUrl = (process.env.GESTPRO_APP_URL || "https://gestpro-app.vercel.app").replace(/\/+$/, "");
mkdirSync("www", { recursive: true });

const page = (body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>GestPro</title>
<style>
html,body{margin:0;height:100%;background:#0f172a;color:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 24px;box-sizing:border-box}
.logo{width:84px;height:84px;border-radius:22px;background:#10b981;display:grid;place-items:center;font-size:44px;margin-bottom:18px}
h1{font-size:28px;margin:0 0 6px;letter-spacing:.5px}
p{color:#cbd5e1;line-height:1.5;margin:6px 0;max-width:32ch}
button{margin-top:22px;background:#10b981;color:#052e16;border:0;border-radius:12px;padding:14px 28px;font-size:16px;font-weight:600}
small{color:#64748b;margin-top:28px;display:block}
</style></head><body><div class="wrap">${body}</div></body></html>`;

writeFileSync("www/offline.html", page(`
<div class="logo">🏢</div>
<h1>GestPro</h1>
<p><strong>Pas de connexion Internet.</strong><br>GestPro a besoin d'une connexion pour afficher vos immeubles, loyers et reçus.</p>
<p><strong>No Internet connection.</strong><br>GestPro needs a connection to show your buildings, rents and receipts.</p>
<button onclick="location.replace('${appUrl}')">Réessayer · Retry</button>
<small>${appUrl.replace(/^https?:\/\//, "")}</small>`));

writeFileSync("www/index.html", page(`
<div class="logo">🏢</div>
<h1>GestPro</h1>
<p>Chargement… · Loading…</p>
<script>location.replace('${appUrl}');</script>`));

console.log(`www/ generated for ${appUrl}`);
