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
const heures = require('./heures');
const page = require('./page');

module.exports = function mountGestion(app) {
  // dashboard.igscustom.fr/ -> interface de gestion
  app.use((req, res, next) => {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    if (host === cfg.DASHBOARD_HOST && req.path === '/') return res.redirect('/gestion');
    next();
  });

  // Fenêtre WhatsApp de 24 h : on note l'heure de CHAQUE message reçu sur le numéro de Leïla
  // (y compris les jours où le bot est en pause, où les messages ne vont pas dans l'historique).
  // Lecture seule du webhook : la requête continue vers le bot sans aucune modification.
  app.use('/webhook', (req, res, next) => {
    try {
      if (req.method === 'POST') {
        const nums = new Set(), textes = [];
        for (const e of req.body?.entry || []) for (const ch of e.changes || []) for (const m of ch.value?.messages || []) {
          if (!m.from) continue;
          nums.add(String(m.from));
          const t = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.reaction?.emoji || m.image?.caption || m.document?.caption;
          if (t) textes.push({ from: String(m.from), texte: t, le: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString() });
        }
        if (nums.size) require('./bat-envoi').noterMessagesEntrants([...nums]).catch(() => {});
        // Réponse d'un client à l'envoi de son BAT (validation automatique si favorable)
        if (textes.length) require('./bat-reponses').messagesWhatsApp(textes).catch(err => console.error('Gestion BAT réponses :', err.message));
      }
    } catch {}
    next();
  });

  // Formulaire client public (igscustom.fr/formulaire) -> mail Microsoft 365
  formulaire.mount(app);
  // Lien signé vers le BAT (récupéré par WhatsApp)
  require('./bat-envoi').mount(app);

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
  // Comptes individuels (connexion à distance)
  app.post('/gestion/api/admin/collaborateurs/:id/acces', auth.requireUser, auth.requireAdmin, actA(req => require('./comptes').definirAcces(Number(req.params.id), req.body || {})));
  app.post('/gestion/api/admin/collaborateurs/:id/acces/retirer', auth.requireUser, auth.requireAdmin, actA(req => require('./comptes').retirerAcces(Number(req.params.id))));
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

  // ---------- Heures des collaborateurs ----------
  app.get('/gestion/heures', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'heures'));
  });
  const quiH = req => req.user.name || req.user.email;
  const actH = fn => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); }
    catch (err) { console.error('Gestion heures :', err.message); res.status(400).json({ error: err.message }); }
  };
  // Compte individuel : toujours verrouillé sur son propre nom
  app.post('/gestion/api/heures', auth.requireUser, actH(req => heures.saisir({ ...(req.body || {}), ...(req.user.collab ? { collaborateur: req.user.collab } : {}) }, quiH(req), req.user.role)));
  app.post('/gestion/api/heures/:id(\\d+)/supprimer', auth.requireUser, actH(req => heures.supprimer(Number(req.params.id), quiH(req), req.user.role, req.user.collab || null)));
  app.get('/gestion/api/heures/mes', auth.requireUser, actH(req => heures.mesHeures(String(req.user.collab || req.query.collaborateur || ''), String(req.query.lundi || ''))));
  app.get('/gestion/api/heures/semaine', auth.requireUser, auth.requireAdmin, actH(req => heures.semaine(String(req.query.lundi || ''))));
  app.post('/gestion/api/heures/:id(\\d+)/modifier', auth.requireUser, auth.requireAdmin, actH(req => heures.modifier(Number(req.params.id), req.body || {}, quiH(req))));
  app.post('/gestion/api/heures/payer', auth.requireUser, auth.requireAdmin, actH(req => heures.payer(String(req.body?.collaborateur || ''), String(req.body?.lundi || ''), quiH(req))));
  app.post('/gestion/api/heures/paiements/:id(\\d+)/annuler', auth.requireUser, auth.requireAdmin, actH(req => heures.annulerPaiement(Number(req.params.id), quiH(req))));
  app.post('/gestion/api/heures/recap', auth.requireUser, auth.requireAdmin, actH(req => heures.envoyerRecap(String(req.body?.lundi || ''), quiH(req))));
  app.post('/gestion/api/heures/recap-auto', auth.requireUser, auth.requireAdmin, actH(async req => { await heures.setReglage('heures_recap_auto', req.body?.active ? 'on' : 'off'); return { ok: true }; }));
  app.post('/gestion/api/heures/importer', auth.requireUser, auth.requireAdmin, actH(req => heures.importerExcel(quiH(req))));

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
  app.post('/gestion/api/planches/:cle/supprimer', auth.requireUser, action(req => planches.supprimer(req.params.cle, qui(req), { fichiers: req.body?.fichiers })));
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

  app.post('/gestion/api/commandes/:cle/supprimer', auth.requireUser, async (req, res) => {
    try { res.json(await commandes.supprimer(req.params.cle, req.user.name || req.user.email, { dossier: !!req.body?.dossier })); }
    catch (err) { console.error('Gestion suppression commande :', err.message); res.status(400).json({ error: err.message }); }
  });

  // Bordereau d'expédition : dépôt (PDF/PNG/JPG, 15 Mo max) et suppression
  const uploadBordereau = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single('fichier');
  app.post('/gestion/api/commandes/:cle/bordereau', auth.requireUser, (req, res, next) => uploadBordereau(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (15 Mo max)' : err.message });
    next();
  }), async (req, res) => {
    try { res.json(await commandes.ajouterBordereau(req.params.cle, req.file, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion bordereau :', err.message); res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/bordereau/:id/supprimer', auth.requireUser, async (req, res) => {
    try { res.json(await commandes.supprimerBordereau(req.params.cle, req.params.id, req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // BAT : marqué envoyé au client (ou annulé) ; relecture des dossiers à la demande
  app.post('/gestion/api/commandes/:cle/bat-envoye', auth.requireUser, async (req, res) => {
    try { res.json({ commande: await commandes.setBatEnvoye(req.params.cle, !!req.body?.envoye, req.user.name || req.user.email) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/bat-envoyer', auth.requireUser, async (req, res) => {
    try { res.json(await require('./bat-envoi').envoyer(req.params.cle, { mail: req.body?.mail !== false, whatsapp: req.body?.whatsapp !== false }, req.user.name || req.user.email, auth.baseUrl(req))); }
    catch (err) { console.error('Gestion envoi BAT :', err.message); res.status(400).json({ error: err.message }); }
  });
  // Lien vers le formulaire client prérempli (devis, client, e-mail, téléphone ; complétés depuis Odoo si besoin)
  app.get('/gestion/api/commandes/:cle/lien-formulaire', auth.requireUser, async (req, res) => {
    try {
      const { rows } = await commandes.listCommandes();
      const c = rows.find(r => r.cle === req.params.cle);
      if (!c) throw new Error('Commande introuvable');
      let email = c.email || '', tel = c.telephone ? String(c.telephone).replace(/^(590|596|594)(\d{9})$/, '0$2') : '';
      if ((!email || !tel) && c.n_devis) {
        try { const p = await require('./odoo').clientDuDevis(c.n_devis); if (p) { email = email || p.email || ''; tel = tel || p.phone || ''; } }
        catch (err) { console.error('Gestion lien formulaire (Odoo) :', err.message); }
      }
      const q = new URLSearchParams({ devis: c.n_devis || '', client: c.client || '', email, tel });
      res.json({ url: `${process.env.FORM_PAGE_URL || 'https://igscustom.fr/formulaire/'}?${q}` });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/bat-valide', auth.requireUser, async (req, res) => {
    try { res.json({ commande: await commandes.validerBat(req.params.cle, req.user.name || req.user.email) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  // Nouvelle commande saisie à la main ; client d'un devis Odoo pour préremplir
  app.post('/gestion/api/commandes/nouvelle', auth.requireUser, async (req, res) => {
    try { res.json(await commandes.creerCommande(req.body || {}, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion nouvelle commande :', err.message); res.status(400).json({ error: err.message }); }
  });
  app.get('/gestion/api/odoo/devis/:numero/client', auth.requireUser, async (req, res) => {
    try {
      const p = await require('./odoo').clientDuDevis(String(req.params.numero).toUpperCase().trim());
      res.json({ client: p ? { nom: p.name, email: p.email || '', telephone: p.phone || '' } : null });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/bat/actualiser', auth.requireUser, async (req, res) => {
    try { await commandes.scannerBat(); res.json({ ok: true }); } catch (err) { res.status(502).json({ error: err.message }); }
  });

  // "À payer en espèces" : { actif: true|false, montant?: "45,50" }
  app.post('/gestion/api/commandes/:cle/especes', auth.requireUser, async (req, res) => {
    try { res.json({ commande: await commandes.setEspeces(req.params.cle, { actif: !!req.body?.actif, montant: req.body?.montant }, req.user.name || req.user.email) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
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

  // ---------- Messages automatiques aux clients (remplacent Power Automate) ----------
  const notif = require('./notifications');
  const actN = fn => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); }
    catch (err) { console.error('Gestion notifications :', err.message); res.status(400).json({ error: err.message }); }
  };
  app.get('/gestion/api/notifications', auth.requireUser, auth.requireAdmin, actN(() => notif.etat()));
  app.post('/gestion/api/notifications/activer', auth.requireUser, auth.requireAdmin, actN(req => notif.activer({ actif: !!req.body?.actif, ignorerAttente: !!req.body?.ignorerAttente }, req.user.name || req.user.email)));
  app.post('/gestion/api/notifications/lien-avis', auth.requireUser, auth.requireAdmin, actN(req => notif.definirLienAvis(req.body?.lien)));

  // ---------- Journal d'une commande + question interne à Leïla ----------
  const leila = require('./leila');
  app.get('/gestion/api/commandes/:cle/journal', auth.requireUser, actN(req => leila.journalCommande(req.params.cle)));
  app.post('/gestion/api/commandes/:cle/question', auth.requireUser, actN(req => leila.question(req.params.cle, req.body?.question, req.user.name || req.user.email)));

  // Générateur de BAT
  require('./bat-generateur').mount(app);

  commandes.startSync();
  planches.startSync();
  heures.startRecap();
  require('./telephones').start();
  require('./bat-reponses').start();
  notif.start();
  console.log('Module Gestion IGS monté sur /gestion');
};
