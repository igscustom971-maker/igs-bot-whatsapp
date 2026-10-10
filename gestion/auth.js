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
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
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

function getUser(req) {
  return verify(parseCookies(req)[COOKIE]);
}

// Middleware : page HTML -> redirige vers la connexion ; API -> 401
// Compte individuel (identifiant + mot de passe) : vérifié en base (actif, mot de passe inchangé), changement obligatoire si provisoire
function requireUser(req, res, next) {
  const user = getUser(req);
  const refuser = () => {
    if (req.path.startsWith('/gestion/api/')) return res.status(401).json({ error: 'Non connecté' });
    return res.redirect('/gestion/auth/login');
  };
  if (!user) return refuser();
  if (!String(user.email || '').startsWith('local:')) { req.user = user; return next(); }
  comptes().sessionValide(user).then(v => {
    if (!v) { setCookie(res, COOKIE, '', 0); return refuser(); }
    if (v.provisoire) {
      if (req.path.startsWith('/gestion/api/')) return res.status(403).json({ error: 'Change ton mot de passe provisoire avant de continuer' });
      return res.redirect('/gestion/auth/mot-de-passe');
    }
    req.user = { ...user, name: v.affichage, collab: v.affichage };
    next();
  }).catch(err => { console.error('Gestion auth : contrôle de session', err.message); refuser(); });
}
const comptes = () => require('./comptes');
const ouvrirSession = (res, s) => setCookie(res, COOKIE, sign({ ...s, exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
const ipDe = req => (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();

// ---------- Pages de connexion (Microsoft 365 au bureau, identifiant perso à distance) ----------
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function pageAuth(titre, corps, script = '') {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escH(titre)} · IGS DASHBOARD</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1e1b4b;background:linear-gradient(135deg,#fde2f0,#ede9fe)}
.box{width:100%;max-width:400px;background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 10px 40px rgba(30,27,75,.12)}
h1{margin:0 0 4px;font-size:22px;letter-spacing:.3px}.sub{color:#6b7280;font-size:14px;margin:0 0 20px}
.ms{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;background:#fff;color:#1e1b4b;font:inherit;font-weight:600;text-decoration:none}
.ms:hover{background:#f9fafb}.sep{display:flex;align-items:center;gap:10px;color:#9ca3af;font-size:12px;margin:20px 0}.sep:before,.sep:after{content:"";flex:1;height:1px;background:#e5e7eb}
label{display:block;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.3px;margin:12px 0 4px}
input{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font:inherit;font-size:16px}
button.go{width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#e91e8c;color:#fff;font:inherit;font-weight:700;font-size:16px;cursor:pointer}
button.go:disabled{opacity:.6}.lien{display:block;text-align:center;margin-top:14px;color:#6b7280;font-size:14px}
.msg{display:none;margin-top:14px;padding:10px 12px;border-radius:10px;font-size:14px}.msg.err{display:block;background:#fee2e2;color:#991b1b}.msg.ok{display:block;background:#dcfce7;color:#166534}
.info{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:6px}
</style></head><body><main class="box">${corps}</main>
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
  app.get('/gestion/auth/login', (req, res) => {
    if (getUser(req)) return res.redirect('/gestion');
    res.set('Cache-Control', 'no-store').send(pageAuth('Connexion', `<h1>IGS DASHBOARD</h1><p class="sub">Connexion à l'espace de gestion</p>
<a class="ms" href="/gestion/auth/microsoft"><svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect width="10" height="10" fill="#f25022"/><rect x="11" width="10" height="10" fill="#7fba00"/><rect y="11" width="10" height="10" fill="#00a4ef"/><rect x="11" y="11" width="10" height="10" fill="#ffb900"/></svg>Se connecter avec Microsoft 365</a>
<div class="sep">ou avec ton identifiant</div>
<form id="f"><label for="i">Identifiant</label><input id="i" autocomplete="username" autocapitalize="none" placeholder="ton prénom (ex. maureen)" required>
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
    if (!c) return res.status(400).send(pageAuth('Lien expiré', `<h1>Lien expiré</h1><p class="sub">Ce lien n'est plus valable (1 heure, une seule utilisation).</p><a class="ms" href="/gestion/auth/oubli">Refaire une demande</a>`));
    res.set('Cache-Control', 'no-store').send(pageAuth('Nouveau mot de passe', `<h1>Nouveau mot de passe</h1><p class="sub">${escH(c.affichage)} · identifiant <b>${escH(c.identifiant)}</b></p>
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
      if (error) return res.status(400).send(`Connexion refusée : ${error_description || error}`);
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
        return res.status(403).send(`Le compte ${email} n'a pas accès à l'interface de gestion IGS.`);
      }
      setCookie(res, COOKIE, sign({ email, name: claims.name || email, role, exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
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

module.exports = { mount, requireUser, requireAdmin, getUser };
