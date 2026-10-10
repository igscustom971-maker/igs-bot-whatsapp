// ============================================
// IGS GESTION - POINT D'ENTRÉE DU MODULE
// Branché dans server.js par UNE seule ligne : require('./gestion')(app);
// Toutes les routes sont sous /gestion. Rien n'est modifié dans le bot Leïla.
// ============================================

const cfg = require('./config');
const auth = require('./auth');
const commandes = require('./commandes');
const planches = require('./planches');
const stock = require('./stock');
const duplication = require('./duplication');
const caisse = require('./caisse');
const formulaire = require('./formulaire');
const admin = require('./admin');
const page = require('./page');

module.exports = function mountGestion(app) {
  // dashboard.igscustom.fr/ -> interface de gestion
  app.use((req, res, next) => {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    if (host === cfg.DASHBOARD_HOST && req.path === '/') return res.redirect('/gestion');
    next();
  });

  // Formulaire client public (igscustom.fr/formulaire) -> mail Microsoft 365
  formulaire.mount(app);

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

  // ---------- Admin : collaborateurs et listes ----------
  app.get('/gestion/admin', auth.requireUser, (req, res) => {
    if (req.user.role !== 'admin') return res.redirect('/gestion');
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'admin'));
  });
  const actA = fn => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); }
    catch (err) { console.error('Gestion admin :', err.message); res.status(400).json({ error: err.message }); }
  };
  app.get('/gestion/api/listes', auth.requireUser, actA(() => admin.getListes()));
  app.post('/gestion/api/admin/listes', auth.requireUser, auth.requireAdmin, actA(req => admin.setListes(req.body || {})));
  app.get('/gestion/api/collaborateurs', auth.requireUser, actA(req => admin.collaborateurs({ admin: req.user.role === 'admin', tous: req.query.tous === '1' && req.user.role === 'admin' }).then(c => ({ collaborateurs: c }))));
  app.post('/gestion/api/admin/collaborateurs', auth.requireUser, auth.requireAdmin, actA(req => admin.enregistrerCollaborateur(req.body || {})));
  app.post('/gestion/api/admin/test-mail', auth.requireUser, auth.requireAdmin, async (req, res) => {
    try { res.json(await formulaire.testMail(req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message, dernierEchecFormulaire: formulaire.dernierEchec() }); }
  });
  app.post('/gestion/api/admin/collaborateurs/:id/supprimer', auth.requireUser, auth.requireAdmin, actA(req => admin.supprimerCollaborateur(Number(req.params.id))));

  app.get('/gestion/caisse', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'caisse'));
  });
  // ---------- Espèces ----------
  const quiC = req => req.user.name || req.user.email;
  const actC = fn => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); }
    catch (err) { console.error('Gestion caisse :', err.message); res.status(400).json({ error: err.message }); }
  };
  app.get('/gestion/api/caisse', auth.requireUser, actC(req => caisse.etat(req.user.role)));
  app.post('/gestion/api/caisse/encaisser', auth.requireUser, actC(req => caisse.encaisser(req.body || {}, quiC(req))));
  app.post('/gestion/api/caisse/decaisser', auth.requireUser, actC(req => caisse.decaisser(req.body || {}, quiC(req))));
  app.post('/gestion/api/caisse/relever', auth.requireUser, auth.requireAdmin, actC(req => caisse.relever(req.body || {}, quiC(req))));
  app.post('/gestion/api/caisse/:id/supprimer', auth.requireUser, auth.requireAdmin, actC(req => caisse.supprimer(Number(req.params.id), quiC(req))));

  app.get('/gestion/stock', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'stock'));
  });
  // ---------- Stock ----------
  const quiS = req => req.user.name || req.user.email;
  const act = fn => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); }
    catch (err) { console.error('Gestion stock :', err.message); res.status(400).json({ error: err.message }); }
  };
  app.get('/gestion/api/stock', auth.requireUser, act(() => stock.etat()));
  app.post('/gestion/api/stock/:type(vierges|consommables)/mouvement', auth.requireUser, act(req => stock.mouvementExcel(req.params.type, req.body || {}, quiS(req), req.body?.motif)));
  app.post('/gestion/api/stock/:type(vierges|consommables)/ajouter', auth.requireUser, act(req => stock.ajouterExcel(req.params.type, req.body || {}, quiS(req))));
  app.post('/gestion/api/stock/clients/ajouter', auth.requireUser, act(req => stock.ajouterClient(req.body || {}, quiS(req))));
  app.post('/gestion/api/stock/clients/:id/mouvement', auth.requireUser, act(req => stock.mouvementClient(Number(req.params.id), req.body || {}, quiS(req), req.body?.motif)));
  app.post('/gestion/api/stock/clients/:id/supprimer', auth.requireUser, act(req => stock.supprimerClientLigne(Number(req.params.id), quiS(req))));
  app.post('/gestion/api/stock/importer-sandae', auth.requireUser, act(req => stock.importerSandae(quiS(req))));

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
  app.post('/gestion/api/planches/:cle/supprimer', auth.requireUser, action(req => planches.supprimer(req.params.cle, qui(req))));
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
      res.set('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(it.name)}`);
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

  app.get('/gestion/api/commandes-historique', auth.requireUser, async (req, res) => {
    try { res.json({ commandes: await duplication.historique(req.query.q) }); }
    catch (err) { res.status(502).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/dupliquer', auth.requireUser, async (req, res) => {
    try { res.json(await duplication.dupliquer(req.params.cle, req.body || {}, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion duplication :', err.message); res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/modifier', auth.requireUser, async (req, res) => {
    try { res.json({ commande: await commandes.modifier(req.params.cle, req.body || {}, req.user.name || req.user.email) }); }
    catch (err) { console.error('Gestion commande :', err.message); res.status(400).json({ error: err.message }); }
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
      res.json(await commandes.getDossierControle(req.params.devis));
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
      res.set('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(it.name)}`);
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
