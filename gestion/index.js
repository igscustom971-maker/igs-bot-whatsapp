// ============================================
// IGS GESTION - POINT D'ENTRÉE DU MODULE
// Branché dans server.js par UNE seule ligne : require('./gestion')(app);
// Toutes les routes sont sous /gestion. Rien n'est modifié dans le bot Leïla.
// ============================================

const cfg = require('./config');
const auth = require('./auth');
const commandes = require('./commandes');
const planches = require('./planches');
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
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'accueil'));
  });
  app.get('/gestion/commandes', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'commandes'));
  });
  app.get('/gestion/planches', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'planches'));
  });

  app.get('/gestion/api/planches', auth.requireUser, async (req, res) => {
    const data = await planches.listPlanches({ force: req.query.actualiser === '1' });
    res.json({ planches: data.rows, syncedAt: data.syncedAt, erreur: data.error });
  });

  // ---------- Actions Planches (phase 1) ----------
  const qui = req => req.user.name || req.user.email;
  const action = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (err) { console.error('Gestion action :', err.message); res.status(400).json({ error: err.message }); }
  };
  app.post('/gestion/api/planches/ajouter', auth.requireUser, action(req => planches.ajouter(req.body || {}, qui(req))));
  app.get('/gestion/api/planches/:cle/client', auth.requireUser, action(req => planches.clientPlanche(req.params.cle)));
  app.post('/gestion/api/planches/:cle/client', auth.requireUser, action(req => planches.choisirClient(req.params.cle, req.body?.partnerId, qui(req))));
  app.post('/gestion/api/odoo/clients', auth.requireUser, action(async req => ({ client: await require('./odoo').createPartner(req.body || {}) })));
  app.post('/gestion/api/planches/:cle/modifier', auth.requireUser, action(req => planches.modifier(req.params.cle, req.body || {}, qui(req)).then(planche => ({ planche }))));
  app.post('/gestion/api/planches/:cle/devis', auth.requireUser, action(req => planches.devis(req.params.cle, qui(req), req.body || {})));
  app.post('/gestion/api/planches/:cle/facturer', auth.requireUser, auth.requireAdmin, action(req => planches.facturer(req.params.cle, qui(req), req.body || {})));
  // Ouvre un devis Odoo à partir de son numéro (ex. /gestion/odoo/devis/DE2601064)
  app.get('/gestion/odoo/devis/:numero', auth.requireUser, async (req, res) => {
    try {
      const lien = await require('./odoo').lienDevis(req.params.numero);
      if (!lien) return res.status(404).send(`Devis ${req.params.numero} introuvable dans Odoo`);
      res.redirect(lien);
    } catch (err) { res.status(502).send(err.message); }
  });
  app.get('/gestion/api/odoo/clients', auth.requireUser, action(req => require('./odoo').searchPartners(String(req.query.q || '').slice(0, 60)).then(clients => ({ clients }))));
  app.get('/gestion/api/planches/facturation-auto', auth.requireUser, action(() => planches.etatFacturationAuto()));
  app.post('/gestion/api/planches/facturation-auto', auth.requireUser, auth.requireAdmin, action(async req => {
    await planches.setReglage('facturation_hebdo_auto', req.body?.active ? 'on' : 'off');
    return planches.etatFacturationAuto();
  }));

  app.get('/gestion/api/planches/:cle/fichiers', auth.requireUser, async (req, res) => {
    try {
      res.json(await planches.getFichiers(req.params.cle));
    } catch (err) {
      console.error('Gestion fichiers planche :', err.message);
      res.status(502).json({ erreur: err.message });
    }
  });

  app.get('/gestion/api/planches/fichier/:id', auth.requireUser, async (req, res) => {
    try {
      const it = await planches.fichierAutorise(req.params.id);
      if (!it) return res.status(403).send('Fichier non autorisé');
      const r = await require('./graph').content(it.id, planches.drive());
      res.set('Content-Type', it.file.mimeType || r.headers.get('content-type') || 'application/octet-stream');
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(it.name)}`);
      res.set('Cache-Control', 'private, max-age=300');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.error('Gestion fichier planche :', err.message);
      res.status(502).send('Fichier indisponible');
    }
  });

  app.get('/gestion/api/me', auth.requireUser, (req, res) => {
    res.json({ email: req.user.email, name: req.user.name, role: req.user.role });
  });

  app.get('/gestion/api/commandes', auth.requireUser, async (req, res) => {
    const data = await commandes.listCommandes({ force: req.query.actualiser === '1' });
    res.json({ commandes: data.rows, syncedAt: data.syncedAt, erreur: data.error });
  });

  // Modification manuelle de la date de livraison (admin et équipe). { date: "AAAA-MM-JJ" } ou { date: null } = revenir à la date Excel
  app.post('/gestion/api/commandes/:cle/livraison', auth.requireUser, async (req, res) => {
    try {
      const date = req.body?.date || null;
      res.json({ commande: await commandes.setLivraison(req.params.cle, date, req.user.name || req.user.email) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
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
  planches.startSync();
  console.log('Module Gestion IGS monté sur /gestion');
};
