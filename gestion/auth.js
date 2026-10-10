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
function requireUser(req, res, next) {
  const user = getUser(req);
  if (user) { req.user = user; return next(); }
  if (req.path.startsWith('/gestion/api/')) return res.status(401).json({ error: 'Non connecté' });
  return res.redirect('/gestion/auth/login');
}
function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Réservé à l\'administrateur' });
}

function mount(app) {
  app.get('/gestion/auth/login', (req, res) => {
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
    setCookie(res, COOKIE, '', 0);
    res.redirect(`https://login.microsoftonline.com/${cfg.TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(baseUrl(req) + '/gestion')}`);
  });
}

module.exports = { mount, requireUser, requireAdmin, getUser };
