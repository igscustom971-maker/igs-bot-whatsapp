// ============================================
// IGS GESTION - CONNEXION MICROSOFT 365 (OpenID Connect, flux "authorization code")
// Session = cookie signé HMAC (aucune dépendance externe).
// Le MFA est appliqué par le tenant Microsoft 365.
// ============================================

const crypto = require('crypto');
const cfg = require('./config');

const COOKIE = 'igs_gestion';
const STATE_COOKIE = 'igs_gestion_state';
const SESSION_HOURS = 12;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', cfg.SESSION_SECRET).update(body).digest());
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !cfg.SESSION_SECRET) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = b64url(crypto.createHmac('sha256', cfg.SESSION_SECRET).update(body).digest());
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch {} }
  });
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  res.append('Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/gestion; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

// Domaine utilisé (onrender.com ou dashboard.igscustom.fr), limité à la liste autorisée
function baseUrl(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const safeHost = cfg.ALLOWED_HOSTS.includes(host) ? host : cfg.ALLOWED_HOSTS[0];
  return `https://${safeHost}`;
}
const redirectUri = req => `${baseUrl(req)}/gestion/auth/callback`;

function roleFor(email) {
  const e = (email || '').toLowerCase();
  if (cfg.ADMIN_EMAILS.includes(e)) return 'admin';
  if (cfg.TEAM_EMAILS.includes(e)) return 'equipe';
  return null;
}

// Une session a toujours un rôle et jamais de type : un lien signé (ex. BAT) ne peut pas servir de session
function getUser(req) {
  const u = verify(parseCookies(req)[COOKIE]);
  if (!(u && !u.t && (u.role === 'admin' || u.role === 'equipe'))) return null;
  // Anciennes sessions sans profils : admin -> tout, équipe -> technique
  if (!Array.isArray(u.profils) || !u.profils.length) u.profils = u.role === 'admin' ? ['admin'] : ['technique'];
  return u;
}
// L'utilisateur a-t-il ce profil ? (admin = tous les profils)
const aProfil = (u, p) => !!u && (u.role === 'admin' || (u.profils || []).includes('admin') || (u.profils || []).includes(p));
function requireProfil(p) {
  return (req, res, next) => {
    if (aProfil(req.user, p)) return next();
    if ((req.originalUrl || req.path).startsWith('/gestion/api/')) return res.status(403).json({ error: 'Accès réservé (profil ' + p + ')' });
    return res.redirect('/gestion');
  };
}

// Middleware : page HTML -> redirige vers la connexion ; API -> 401
// Compte individuel (identifiant + mot de passe) : vérifié en base (actif, mot de passe inchangé), changement obligatoire si provisoire
function requireUser(req, res, next) {
  const user = getUser(req);
  const refuser = () => {
    if ((req.originalUrl || req.path).startsWith('/gestion/api/')) return res.status(401).json({ error: 'Non connecté' });
    return res.redirect('/gestion/auth/login');
  };
  if (!user) return refuser();
  if (!String(user.email || '').startsWith('local:')) { req.user = user; return next(); }
  comptes().sessionValide(user).then(v => {
    if (!v) { setCookie(res, COOKIE, '', 0); return refuser(); }
    if (v.provisoire) {
      if ((req.originalUrl || req.path).startsWith('/gestion/api/')) return res.status(403).json({ error: 'Change ton mot de passe provisoire avant de continuer' });
      return res.redirect('/gestion/auth/mot-de-passe');
    }
    req.user = { ...user, name: v.affichage, collab: v.affichage, profils: v.profils, role: v.profils.includes('admin') ? 'admin' : 'equipe' };
    next();
  }).catch(err => {
    // Panne passagère : la session n'est pas effacée, on demande juste de réessayer
    console.error('Gestion auth : contrôle de session', err.message);
    if ((req.originalUrl || req.path).startsWith('/gestion/api/')) return res.status(503).json({ error: 'Base momentanément indisponible, réessaie dans un instant' });
    res.status(503).send('Base momentanément indisponible, réessaie dans un instant.');
  });
}
const comptes = () => require('./comptes');
const ouvrirSession = (res, s) => setCookie(res, COOKIE, sign({ ...s, exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
// Adresse du visiteur : la DERNIÈRE de X-Forwarded-For (ajoutée par le proxy Render) ; la première peut être inventée
const ipDe = req => { const x = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean); return x[x.length - 1] || req.ip || ''; };

// ---------- Pages de connexion (Microsoft 365 au bureau, identifiant perso à distance) ----------
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function pageAuth(titre, corps, script = '') {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(titre)} · IGS DASHBOARD</title><meta name="robots" content="noindex">
<link rel="icon" href="/gestion/favicon.ico" sizes="any"><link rel="icon" href="/gestion/icon-192.png" type="image/png">
<link rel="manifest" href="/gestion/manifest.webmanifest"><meta name="theme-color" content="#1E1E4B">
<link rel="apple-touch-icon" href="/gestion/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="IGS"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script>if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/gestion/sw.js', { scope: '/gestion/' }).catch(() => {}));</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;font-family:'Poppins',system-ui,-apple-system,'Segoe UI',sans-serif;color:#1E1E4B;background:#F7F0E4}
.side{flex:1 1 55%;position:relative;overflow:hidden;background:#1E1E4B;color:#fff;padding:56px 64px;display:flex;flex-direction:column;justify-content:center;gap:34px}
.side::before{content:"";position:absolute;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#FF1E8E 0,#B0156B 45%,transparent 70%);opacity:.5;right:-230px;bottom:-250px}
.side::after{content:"";position:absolute;width:300px;height:300px;border-radius:50%;border:2px solid rgba(255,255,255,.08);right:120px;top:-90px}

.side>*{position:relative;z-index:1}
.marque{display:flex;align-items:center;gap:14px}
.marque{flex-direction:column;align-items:flex-start;gap:10px}.marque .lg{width:150px;height:130px;display:flex;align-items:center;justify-content:center;color:#FF1E8E;font-weight:800;filter:drop-shadow(0 14px 30px rgba(30,30,75,.25))}
.marque .lg img{width:100%;height:100%;object-fit:contain;display:block}
.marque b{font-family:'Bebas Neue',sans-serif;font-weight:400;font-size:34px;letter-spacing:.04em;display:block;line-height:1;color:#fff}.marque small{color:#FF8A3D;font-size:13px;font-weight:700;letter-spacing:.12em}
.accroche{max-width:540px}
.accroche h2{margin:0;font-family:'Bebas Neue',sans-serif;font-weight:400;font-size:60px;line-height:.92;letter-spacing:.01em}
.accroche h2 em{font-style:normal;color:#FF1E8E}
.accroche h2{color:#fff}.accroche p{margin:14px 0 0;color:#C9C8E3;font-size:15px;line-height:1.6}
.puces{display:flex;flex-wrap:wrap;gap:8px;margin-top:26px}
.puces{margin-top:18px}.puces span{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600;color:#fff}
.cote{flex:1 1 45%;display:flex;align-items:center;justify-content:center;padding:40px 24px;background:#fff}
.box{width:100%;max-width:420px}
.box .lg-m{display:none}
h1{margin:0 0 6px;font-family:'Bebas Neue',sans-serif;font-weight:400;font-size:46px;letter-spacing:.02em;line-height:1}.sub{color:#7A7899;font-size:15px;margin:0 0 28px}
.ms{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:52px;padding:12px;border:1px solid #E3E1EE;border-radius:14px;background:#fff;color:#1E1E4B;font:inherit;font-weight:700;font-size:15px;text-decoration:none;box-shadow:0 1px 2px rgba(30,30,75,.04);transition:.15s}
.ms:hover{border-color:#C9C6DC;box-shadow:0 6px 18px rgba(30,30,75,.08)}
.sep{display:flex;align-items:center;gap:12px;color:#A3A1BC;font-size:12.5px;font-weight:600;margin:24px 0 8px}.sep:before,.sep:after{content:"";flex:1;height:1px;background:#E6E4EF}
label{display:block;font-size:13px;font-weight:700;color:#5B5A7E;margin:16px 0 6px}
input{width:100%;min-height:50px;padding:12px 14px;border:1px solid #E3E1EE;border-radius:14px;font:inherit;font-size:16px;background:#fff;color:#1E1E4B;transition:.15s}
input:focus{outline:none;border-color:#FF1E8E;box-shadow:0 0 0 4px rgba(255,30,142,.12)}
button.go{width:100%;margin-top:24px;min-height:52px;padding:13px;border:0;border-radius:14px;background:#FF1E8E;color:#fff;font:inherit;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 10px 24px rgba(255,30,142,.28);transition:.15s}
button.go:hover{background:#E8137D}button.go:disabled{opacity:.6}
.lien{display:block;text-align:center;margin-top:18px;color:#7A7899;font-size:14px;font-weight:600;text-decoration:none}.lien:hover{color:#FF1E8E}
.msg{display:none;margin-top:16px;padding:12px 14px;border-radius:12px;font-size:14px;font-weight:600}.msg.err{display:block;background:#FFE4E6;color:#9F1239}.msg.ok{display:block;background:#DCFCE7;color:#166534}
.info{background:#FEF3C7;color:#92400E;padding:12px 14px;border-radius:12px;font-size:14px;margin-bottom:8px}
@media (max-width:900px){
  body{flex-direction:column;background:#fff}
  /* Téléphone : bandeau compact */
  .side{flex:none;padding:22px 20px 26px;min-height:auto;gap:16px}
  .side::before{width:340px;height:340px;right:-150px;bottom:-190px}.side::after{display:none}
  .marque{flex-direction:row;align-items:center}
  .marque .lg{width:74px;height:64px;filter:none}
  .marque b{color:#fff;font-size:30px}.marque small{color:#FF8A3D}
  .accroche{padding:0;background:none;box-shadow:none}.cote{background:#fff}
  .accroche h2{font-size:34px;color:#fff}.accroche p,.puces{display:none}
  .cote{padding:28px 20px 40px;align-items:flex-start}
}
</style></head><body>
<aside class="side" aria-hidden="false">
  <div class="marque"><div class="lg"><img src="/gestion/logo-igs.png" alt="IGS CUSTOM BAR" onerror="this.replaceWith(document.createTextNode('IGS'))"></div><div><b>IGS DASHBOARD</b><small>IGS CUSTOM BAR</small></div></div>
  <div class="accroche"><h2>Tout l'atelier,<br><em>au même endroit.</em></h2><p>Commandes, BAT, planches DTF, stock, espèces et heures : tout se suit ici, et les messages aux clients partent tout seuls.</p>
  <div class="puces"><span>Commandes</span><span>BAT</span><span>Planches DTF</span><span>Stock</span><span>Heures</span></div></div>
</aside>
<div class="cote"><main class="box">${corps}</main></div>
<script>
const $ = id => document.getElementById(id);
function msg(t, k){ const m = $('msg'); m.className = 'msg ' + k; m.textContent = t; }
async function envoyer(url, body){
  const b = document.querySelector('button.go'); b.disabled = true;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
    return j;
  } catch(e){ msg(e.message, 'err'); return null; } finally { b.disabled = false; }
}
${script}
</script></body></html>`;
}
function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Réservé à l\'administrateur' });
}

function mount(app) {
  // Logo IGS (public : page de connexion, icône d'onglet)
  app.get('/gestion/fond-igs.jpg', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(require('path').join(__dirname, 'static', 'fond-igs.jpg')));
  // ---------- Application installable (PWA) : manifeste, icônes, service worker (publics) ----------
  const statique = (nom, type, age = 604800) => (req, res) => res.set({ 'Cache-Control': `public, max-age=${age}`, ...(type ? { 'Content-Type': type } : {}) }).sendFile(require('path').join(__dirname, 'static', nom));
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) app.get(`/gestion/${f}`, statique(f));
  app.get('/gestion/favicon.ico', statique('favicon.ico', 'image/x-icon'));
  // Lecture des exports WhatsApp (.txt, .zip, .vcf) dans le navigateur, onglet Leïla
  app.get('/gestion/import-whatsapp.js', statique('import-whatsapp.js', 'text/javascript; charset=utf-8', 3600));
  app.get('/gestion/produits.js', statique('produits.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/apprentissage.js', statique('apprentissage.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/sefi-bdc.js', statique('sefi-bdc.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/depot.js', statique('depot.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/absence.js', statique('absence.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/rouleau.js', statique('rouleau.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/todo.js', statique('todo.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/tailles-edit.js', statique('tailles-edit.js', 'text/javascript; charset=utf-8', 300));
  app.get('/gestion/objectifs.js', statique('objectifs.js', 'text/javascript; charset=utf-8', 300));
  // pdf.js (navigateur) : conversion des logos PDF en image
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) app.get(`/gestion/pdfjs/${f}`, (req, res) => res.set({ 'Cache-Control': 'public, max-age=604800', 'Content-Type': 'text/javascript; charset=utf-8' }).sendFile(require.resolve(`pdfjs-dist/build/${f}`)));
  app.get('/gestion/manifest.webmanifest', (req, res) => res.set({ 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' }).send(JSON.stringify({
    id: '/gestion/', name: 'IGS Dashboard', short_name: 'IGS', description: 'Commandes, BAT, planches DTF, stock et commercial d\'IGS Custom Bar',
    start_url: '/gestion/', scope: '/gestion/', display: 'standalone', orientation: 'any', lang: 'fr',
    background_color: '#1E1E4B', theme_color: '#1E1E4B',
    icons: [
      { src: '/gestion/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/gestion/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/gestion/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Commandes', url: '/gestion/commandes', icons: [{ src: '/gestion/icon-192.png', sizes: '192x192' }] },
      { name: 'BAT', url: '/gestion/bat', icons: [{ src: '/gestion/icon-192.png', sizes: '192x192' }] },
      { name: 'Planches DTF', url: '/gestion/planches', icons: [{ src: '/gestion/icon-192.png', sizes: '192x192' }] },
    ],
  })));
  // Service worker minimal : tout passe par le réseau (données toujours fraîches) ; hors connexion, une page d'attente
  app.get('/gestion/sw.js', (req, res) => res.set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/gestion/' }).send(`
const HORS_LIGNE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IGS Dashboard</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1E1E4B;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><img src="/gestion/icon-192.png" width="120" height="120" alt=""><h2>Pas de connexion</h2><p>IGS Dashboard a besoin d\\'internet. Vérifie ta connexion puis réessaie.</p><button onclick="location.reload()" style="padding:12px 20px;border:0;border-radius:10px;background:#FF1E8E;color:#fff;font-weight:700">Réessayer</button></div></body></html>';
self.addEventListener('install', e => { e.waitUntil(caches.open('igs-v1').then(c => c.add('/gestion/icon-192.png')).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(HORS_LIGNE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
`));
  app.get('/gestion/logo-igs.png', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(require('path').join(__dirname, 'static', 'logo-igs.png')));
  app.get('/gestion/auth/login', (req, res) => {
    if (getUser(req)) return res.redirect('/gestion');
    res.set('Cache-Control', 'no-store').send(pageAuth('Connexion', `<h1>Bon retour 👋</h1><p class="sub">Connecte-toi à ton espace IGS DASHBOARD.</p>
<a class="ms" href="/gestion/auth/microsoft"><svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect width="10" height="10" fill="#f25022"/><rect x="11" width="10" height="10" fill="#7fba00"/><rect y="11" width="10" height="10" fill="#00a4ef"/><rect x="11" y="11" width="10" height="10" fill="#ffb900"/></svg>Se connecter avec Microsoft 365</a>
<div class="sep">ou avec ton identifiant</div>
<form id="f"><label for="i">Identifiant</label><input id="i" autocomplete="username" autocapitalize="none" required>
<label for="p">Mot de passe</label><input id="p" type="password" autocomplete="current-password" required>
<button class="go" type="submit">Se connecter</button></form>
<a class="lien" href="/gestion/auth/oubli">Mot de passe oublié ?</a><div class="msg" id="msg"></div>`,
    `$('f').onsubmit = async e => { e.preventDefault(); const j = await envoyer('/gestion/auth/local', { identifiant: $('i').value, mot_de_passe: $('p').value }); if (j) location.href = j.redirect; };`));
  });

  app.post('/gestion/auth/local', async (req, res) => {
    try {
      if (!cfg.SESSION_SECRET) throw new Error('Connexion non configurée');
      const s = await comptes().connecter(req.body?.identifiant, String(req.body?.mot_de_passe || ''), ipDe(req));
      ouvrirSession(res, s);
      res.json({ redirect: s.provisoire ? '/gestion/auth/mot-de-passe' : '/gestion' });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // Changement du mot de passe (obligatoire après un mot de passe provisoire)
  app.get('/gestion/auth/mot-de-passe', (req, res) => {
    const u = getUser(req);
    if (!u || !String(u.email).startsWith('local:')) return res.redirect('/gestion/auth/login');
    res.set('Cache-Control', 'no-store').send(pageAuth('Mot de passe', `<h1>Mot de passe</h1><p class="sub">${escH(u.name)} · identifiant <b>${escH(u.email.slice(6))}</b></p>
${u.provisoire ? '<div class="info">Ton mot de passe est provisoire : choisis ton propre mot de passe pour continuer.</div>' : ''}
<form id="f"><label for="a">Mot de passe actuel</label><input id="a" type="password" autocomplete="current-password" required>
<label for="n">Nouveau mot de passe (8 caractères minimum)</label><input id="n" type="password" autocomplete="new-password" minlength="8" required>
<label for="c">Confirme le nouveau mot de passe</label><input id="c" type="password" autocomplete="new-password" minlength="8" required>
<button class="go" type="submit">Enregistrer</button></form><a class="lien" href="${u.provisoire ? '/gestion/auth/logout' : '/gestion'}">${u.provisoire ? 'Se déconnecter' : 'Retour au dashboard'}</a><div class="msg" id="msg"></div>`,
    `$('f').onsubmit = async e => { e.preventDefault(); const j = await envoyer('/gestion/auth/mot-de-passe', { actuel: $('a').value, nouveau: $('n').value, confirmation: $('c').value }); if (j) { msg('Mot de passe enregistré', 'ok'); setTimeout(() => location.href = '/gestion', 600); } };`));
  });
  app.post('/gestion/auth/mot-de-passe', async (req, res) => {
    try {
      const u = getUser(req);
      if (!u || !String(u.email).startsWith('local:')) return res.status(401).json({ error: 'Non connecté' });
      const s = await comptes().changerMdp(u.cid, String(req.body?.actuel || ''), String(req.body?.nouveau || ''), String(req.body?.confirmation || ''));
      ouvrirSession(res, s);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // Mot de passe oublié -> lien sur l'e-mail perso
  app.get('/gestion/auth/oubli', (req, res) => {
    res.set('Cache-Control', 'no-store').send(pageAuth('Mot de passe oublié', `<h1>Mot de passe oublié</h1><p class="sub">Indique ton identifiant ou ton e-mail perso : tu recevras un lien pour choisir un nouveau mot de passe.</p>
<form id="f"><label for="s">Identifiant ou e-mail perso</label><input id="s" autocapitalize="none" required>
<button class="go" type="submit">Recevoir le lien</button></form><a class="lien" href="/gestion/auth/login">Retour à la connexion</a><div class="msg" id="msg"></div>`,
    `$('f').onsubmit = async e => { e.preventDefault(); const j = await envoyer('/gestion/auth/oubli', { saisie: $('s').value }); if (j) msg('Si ce compte existe et a un e-mail perso, un lien vient d’y être envoyé (valable 1 heure). Pense à regarder les spams.', 'ok'); };`));
  });
  app.post('/gestion/auth/oubli', async (req, res) => {
    try { await comptes().demanderReset(String(req.body?.saisie || ''), baseUrl(req), ipDe(req)); }
    catch (err) { console.error('Gestion auth : réinitialisation', err.message); }
    res.json({ ok: true }); // réponse identique dans tous les cas
  });
  app.get('/gestion/auth/reset', async (req, res) => {
    const t = String(req.query.t || '');
    const c = await comptes().compteDuToken(t).catch(() => null);
    if (!c) return res.status(400).send(pageAuth('Lien expiré', `<h1>Lien expiré</h1><p class="sub">Ce lien n'est plus valable (il ne sert qu'une fois, et expire après 1 heure, ou 72 heures pour une invitation).</p><a class="ms" href="/gestion/auth/oubli">Refaire une demande</a>`));
    const premier = !c.mdp_hash;
    res.set('Cache-Control', 'no-store').send(pageAuth(premier ? 'Choisis ton mot de passe' : 'Nouveau mot de passe', `<h1>${premier ? 'Bienvenue 👋 Choisis ton mot de passe' : 'Nouveau mot de passe'}</h1><p class="sub">${escH(c.affichage)} · identifiant <b>${escH(c.identifiant)}</b></p>
<form id="f"><label for="n">Nouveau mot de passe (8 caractères minimum)</label><input id="n" type="password" autocomplete="new-password" minlength="8" required>
<label for="c">Confirme le mot de passe</label><input id="c" type="password" autocomplete="new-password" minlength="8" required>
<button class="go" type="submit">Enregistrer et me connecter</button></form><div class="msg" id="msg"></div>`,
    `$('f').onsubmit = async e => { e.preventDefault(); const j = await envoyer('/gestion/auth/reset', { t: ${JSON.stringify(t)}, nouveau: $('n').value, confirmation: $('c').value }); if (j) location.href = '/gestion'; };`));
  });
  app.post('/gestion/auth/reset', async (req, res) => {
    try {
      const s = await comptes().reinitialiser(String(req.body?.t || ''), String(req.body?.nouveau || ''), String(req.body?.confirmation || ''));
      ouvrirSession(res, s);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.get('/gestion/auth/microsoft', (req, res) => {
    if (!cfg.CLIENT_ID || !cfg.TENANT_ID || !cfg.SESSION_SECRET) {
      return res.status(500).send('Connexion non configurée : MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET et SESSION_SECRET sont requis sur Render.');
    }
    const state = b64url(crypto.randomBytes(24));
    setCookie(res, STATE_COOKIE, state, 600);
    const params = new URLSearchParams({
      client_id: cfg.CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri(req),
      response_mode: 'query',
      scope: 'openid profile email',
      state,
      prompt: 'select_account',
    });
    res.redirect(`https://login.microsoftonline.com/${cfg.TENANT_ID}/oauth2/v2.0/authorize?${params}`);
  });

  app.get('/gestion/auth/callback', async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;
      if (error) return res.status(400).type("text/plain").send(`Connexion refusée : ${String(error_description || error).slice(0, 300)}`);
      const expected = parseCookies(req)[STATE_COOKIE];
      if (!state || !expected || state !== expected) return res.status(400).send('Session de connexion expirée, réessaie.');
      setCookie(res, STATE_COOKIE, '', 0);

      const tokenRes = await fetch(`https://login.microsoftonline.com/${cfg.TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.CLIENT_ID,
          client_secret: cfg.CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(req),
          scope: 'openid profile email',
        }),
      });
      const tok = await tokenRes.json();
      if (!tokenRes.ok || !tok.id_token) {
        console.error('Gestion auth : échange du code refusé', tok.error, tok.error_description);
        return res.status(400).send('Connexion impossible (échange du code refusé). Vérifie l\'URI de redirection dans Azure.');
      }
      // id_token reçu directement de Microsoft en HTTPS (pas via le navigateur) : on lit ses informations
      const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      if (claims.tid !== cfg.TENANT_ID || claims.aud !== cfg.CLIENT_ID) return res.status(403).send('Compte hors tenant.');
      const email = (claims.preferred_username || claims.email || claims.upn || '').toLowerCase();
      const role = roleFor(email);
      if (!role) {
        console.warn('Gestion auth : compte non autorisé', email);
        return res.status(403).type('text/plain').send(`Le compte ${email} n'a pas accès à l'interface de gestion IGS.`);
      }
      setCookie(res, COOKIE, sign({ email, name: claims.name || email, role, profils: role === 'admin' ? ['admin'] : ['technique'], exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
      console.log(`Gestion : connexion ${email} (${role})`);
      res.redirect('/gestion');
    } catch (err) {
      console.error('Gestion auth : erreur callback', err);
      res.status(500).send('Erreur de connexion.');
    }
  });

  app.get('/gestion/auth/logout', (req, res) => {
    const u = getUser(req);
    setCookie(res, COOKIE, '', 0);
    if (u && String(u.email || '').startsWith('local:')) return res.redirect('/gestion/auth/login');
    res.redirect(`https://login.microsoftonline.com/${cfg.TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(baseUrl(req) + '/gestion')}`);
  });
}

module.exports = { mount, requireUser, requireAdmin, requireProfil, aProfil, getUser, baseUrl, sign, verify };
