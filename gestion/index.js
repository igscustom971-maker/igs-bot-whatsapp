// ============================================
// IGS GESTION - POINT D'ENTRÉE DU MODULE
// Branché dans server.js par UNE seule ligne : require('./gestion')(app);
// Toutes les routes sont sous /gestion. Rien n'est modifié dans le bot Leïla.
// ============================================

const cfg = require('./config');
const auth = require('./auth');
const commandes = require('./commandes');
const page = require('./page');

module.exports = function mountGestion(app) {
  // dashboard.igscustom.fr/ -> interface de gestion
  app.use((req, res, next) => {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    if (host === cfg.DASHBOARD_HOST && req.path === '/') return res.redirect('/gestion');
    next();
  });

  auth.mount(app);

  app.get('/gestion', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user));
  });

  app.get('/gestion/api/me', auth.requireUser, (req, res) => {
    res.json({ email: req.user.email, name: req.user.name, role: req.user.role });
  });

  app.get('/gestion/api/commandes', auth.requireUser, async (req, res) => {
    const force = req.query.actualiser === '1';
    const data = force ? await commandes.syncNow() : await commandes.listCommandes();
    res.json({ commandes: data.rows, syncedAt: data.syncedAt, erreur: data.error });
  });

  app.get('/gestion/api/commandes/:devis/dossier', auth.requireUser, async (req, res) => {
    try {
      res.json(await commandes.getDossier(req.params.devis));
    } catch (err) {
      console.error('Gestion dossier :', err.message);
      res.status(502).json({ erreur: err.message });
    }
  });

  // Proxy de fichier (BAT PDF, visuels) : affichage dans le navigateur sans exposer SharePoint
  app.get('/gestion/api/fichier/:id', auth.requireUser, async (req, res) => {
    try {
      const it = await commandes.fichierAutorise(req.params.id);
      if (!it) return res.status(403).send('Fichier non autorisé');
      const r = await require('./graph').content(it.id);
      res.set('Content-Type', it.file.mimeType || r.headers.get('content-type') || 'application/octet-stream');
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(it.name)}`);
      res.set('Cache-Control', 'private, max-age=300');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.error('Gestion fichier :', err.message);
      res.status(502).send('Fichier indisponible');
    }
  });

  commandes.startSync();
  console.log('Module Gestion IGS monté sur /gestion');
};
