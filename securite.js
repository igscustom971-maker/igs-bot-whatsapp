// ============================================
// IGS - SÉCURITÉ HTTP (webhook WhatsApp, en-têtes, CSRF du dashboard, erreurs)
// ============================================

const crypto = require('crypto');

// Comparaison à temps constant (jetons, secrets)
const egalSur = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- Webhook WhatsApp ----------
// Avec DUALHOOK_WEBHOOK_SECRET (variable Render), le webhook n'accepte que l'adresse secrète
// https://…/webhook/<secret> (à renseigner dans Dualhook) : personne d'autre ne peut envoyer de faux messages
// (faux client, faux Ismaël). L'ancienne adresse /webhook est alors refusée en POST.
function webhook(req, res, next) {
  if (!/^\/webhook(\/|$)/.test(req.path)) return next();
  const secret = process.env.DUALHOOK_WEBHOOK_SECRET || '';
  const m = req.path.match(/^\/webhook\/([^/]+)\/?$/);
  if (m) {
    if (!secret || !egalSur(m[1], secret)) return res.sendStatus(404);
    const q = req.url.indexOf('?');
    req.url = '/webhook' + (q >= 0 ? req.url.slice(q) : '');
    req.webhookAuthentifie = true;
  } else if (secret && req.method === 'POST') {
    return res.sendStatus(404);
  }
  if (req.method === 'POST' && Number(req.headers['content-length'] || 0) > 1024 * 1024) return res.sendStatus(413);
  next();
}
if (!process.env.DUALHOOK_WEBHOOK_SECRET) console.warn('⚠️ DUALHOOK_WEBHOOK_SECRET non défini : le webhook WhatsApp accepte des messages de n\'importe qui.');

// ---------- En-têtes de sécurité ----------
function enTetes(req, res, next) {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  if (req.path.startsWith('/gestion')) res.set({ 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'" });
  if ((req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

// ---------- CSRF (monté sur /gestion) ----------
// Une action du dashboard (POST…) doit venir du dashboard lui-même : une page piégée ailleurs (même sur igscustom.fr)
// ne peut pas agir avec la session d'un membre de l'équipe. Liens publics signés (/gestion/public/…) exclus.
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/public/')) return next();
  const origine = req.get('origin');
  const site = req.get('sec-fetch-site');
  if (!origine && !site) return next(); // pas un navigateur : pas de session à détourner
  if (site === 'same-origin') return next();
  if (origine && origine !== 'null') {
    let h = '';
    try { h = new URL(origine).host.toLowerCase(); } catch {}
    const ici = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    const autorises = (process.env.GESTION_HOSTS || 'igs-bot-whatsapp.onrender.com,dashboard.igscustom.fr').toLowerCase().split(',').map(x => x.trim());
    if (h && (h === ici || autorises.includes(h))) return next();
  }
  console.warn(`CSRF : requête ${req.method} ${req.originalUrl.split('?')[0]} refusée (origine ${origine || site})`);
  return res.status(403).json({ error: 'Origine refusée' });
}

// ---------- Dernier filet : jamais de pile d'appels renvoyée ----------
function erreurs(err, req, res, next) {
  if (res.headersSent) return next(err);
  const st = err.status || err.statusCode;
  console.error(`Erreur ${req.method} ${req.path} :`, err.message);
  res.status(st && st < 500 ? st : 500).json({ error: st === 413 ? 'Requête trop volumineuse' : st && st < 500 ? 'Requête invalide' : 'Erreur serveur' });
}

module.exports = { egalSur, webhook, enTetes, csrf, erreurs };
