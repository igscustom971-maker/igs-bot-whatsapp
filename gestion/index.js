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

  // Profils : technique = atelier (commandes, BAT, planches, stock, espèces, Leïla) ; commercial = module Commercial ; admin = tout
  const tech = auth.requireProfil('technique');
  // Toute écriture sur une commande ou un BAT : le dossier SharePoint mis en cache est relu à la prochaine ouverture
  app.use((req, res, next) => { if (req.method === 'POST' && /^\/gestion\/api\/(commandes|bat)\b/.test(req.path)) { commandes.oublierDossier(); cacheFichiers.clear(); } next(); });
  // API de l'atelier : profil technique obligatoire (un compte seulement commercial n'y a pas accès)
  const API_TECH = new Set(['bat', 'caisse', 'commandes', 'commandes-historique', 'fichier', 'planches', 'sefi', 'stock', 'leila']);
  app.use('/gestion/api', (req, res, next) => {
    const seg = req.path.split('/')[1] || '';
    if (!API_TECH.has(seg)) return next();
    // Espèces : aussi les commerciaux (ils encaissent et récupèrent les espèces)
    if (seg === 'caisse') return auth.requireUser(req, res, () => (auth.aProfil(req.user, 'technique') || auth.aProfil(req.user, 'commercial') ? next() : res.status(403).json({ error: 'Accès réservé' })));
    auth.requireUser(req, res, () => tech(req, res, next));
  });
  app.get('/gestion', auth.requireUser, (req, res) => {
    if (!auth.aProfil(req.user, 'technique')) return res.redirect(auth.aProfil(req.user, 'commercial') ? '/gestion/commercial' : '/gestion/heures');
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'accueil'));
  });
  // ---------- Module Commercial ----------
  const commercial = require('./commercial');
  const com = auth.requireProfil('commercial');
  const quiCom = req => req.user.name || req.user.email;
  const actCom = fn => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); }
    catch (err) { console.error('Commercial :', err.message); res.status(400).json({ error: err.message }); }
  };
  app.get('/gestion/commercial', auth.requireUser, com, (req, res) => res.set('Cache-Control', 'no-store').send(page.render(req.user, 'commercial')));
  app.get('/gestion/api/commercial', auth.requireUser, com, actCom(req => commercial.tableauDeBord({ force: req.query.force === '1' })));
  app.post('/gestion/api/commercial/relance/:numero', auth.requireUser, com, actCom(req => commercial.relancer(String(req.params.numero), quiCom(req), req.body?.message)));
  app.post('/gestion/api/commercial/impayes/relance', auth.requireUser, com, actCom(req => commercial.relancerClientImpayes(req.body?.ids, quiCom(req), { niveau: req.body?.niveau, message: req.body?.message })));
  app.post('/gestion/api/commercial/solde/:numero', auth.requireUser, com, actCom(req => commercial.facturerSolde(String(req.params.numero), quiCom(req))));
  app.post('/gestion/api/commercial/demandes/:id/brouillon', auth.requireUser, com, actCom(req => commercial.preparerBrouillon(Number(req.params.id), quiCom(req), req.body?.nom)));
  app.post('/gestion/api/commercial/demandes/:id/envoyer', auth.requireUser, com, actCom(req => commercial.envoyerDemande(Number(req.params.id), quiCom(req))));
  app.get('/gestion/api/commercial/demandes-compte', auth.requireUser, com, async (req, res) => {
    try { res.json(await commercial.compteDemandes()); } catch (err) { res.json({ n: 0 }); }
  });
  app.post('/gestion/api/commercial/demandes/:id/annuler', auth.requireUser, com, actCom(req => commercial.annulerDemande(Number(req.params.id), quiCom(req), req.body?.motif)));
  app.post('/gestion/api/commercial/devis/:num/annuler', auth.requireUser, com, actCom(req => commercial.annulerDevis(String(req.params.num), quiCom(req), req.body?.motif)));
  app.post('/gestion/api/commercial/depuis-conversation', auth.requireUser, com, actCom(req => commercial.depuisConversation(String(req.body?.telephone || ''), quiCom(req), { nom: req.body?.nom })));
  app.post('/gestion/api/commercial/demandes/:id/deja-envoye', auth.requireUser, com, actCom(req => commercial.dejaEnvoyee(Number(req.params.id), quiCom(req))));
  app.post('/gestion/api/commercial/demandes/:id/abandonner', auth.requireUser, com, actCom(req => commercial.abandonnerDemande(Number(req.params.id), quiCom(req))));
  app.get('/gestion/api/commercial/reactiver', auth.requireUser, com, actCom(req => commercial.clientsAReactiver({ force: req.query.force === '1' }).then(c => ({ clients: c }))));
  app.post('/gestion/api/commercial/reactiver/:id', auth.requireUser, com, actCom(req => commercial.relancerClient(Number(req.params.id), quiCom(req), req.body?.message)));
  app.get('/gestion/api/commercial/clients', auth.requireUser, com, actCom(req => commercial.rechercherClients(req.query.q).then(c => ({ clients: c }))));
  app.get('/gestion/api/commercial/client/:id', auth.requireUser, com, actCom(req => commercial.ficheClient(Number(req.params.id))));
  app.get('/gestion/api/commercial/origines', auth.requireUser, com, actCom(() => commercial.origines().then(o => ({ origines: o }))));
  // Chiffre d'affaires et résultats : administrateur uniquement
  const finances = require('./finances');
  // Objectifs de vente par article (admin)
  app.get('/gestion/api/finances/objectifs', auth.requireUser, auth.requireAdmin, actCom(req => require('./objectifs').bilan(String(req.query.mois || ''))));
  app.post('/gestion/api/finances/objectifs', auth.requireUser, auth.requireAdmin, actCom(req => require('./objectifs').enregistrer(req.body || {})));
  app.get('/gestion/api/finances', auth.requireUser, auth.requireAdmin, actCom(req => finances.synthese(Number(req.query.annee) || undefined, { force: req.query.force === '1' })));
  app.post('/gestion/api/finances/parametres', auth.requireUser, auth.requireAdmin, actCom(req => finances.enregistrerParametres(req.body || {})));
  app.post('/gestion/api/finances/objectif', auth.requireUser, auth.requireAdmin, actCom(req => finances.setObjectif(req.body?.montant).then(() => ({ ok: true }))));
  app.post('/gestion/api/finances/qonto', auth.requireUser, auth.requireAdmin, actCom(req => finances.importerQonto(req.body?.texte, quiCom(req))));
  app.post('/gestion/api/finances/rapport', auth.requireUser, auth.requireAdmin, actCom(req => finances.rapportMensuel({ mois: req.body?.mois })));
  app.post('/gestion/api/commercial/demandes', auth.requireUser, com, actCom(req => commercial.nouvelleDemande({ ...(req.body || {}), source: 'manuel' }, quiCom(req))));
  app.get('/gestion/commandes', auth.requireUser, tech, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'commandes'));
  });
  app.get('/gestion/planches', auth.requireUser, tech, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'planches'));
  });
  app.get('/gestion/bat', auth.requireUser, tech, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'bat'));
  });
  app.get('/gestion/leila', auth.requireUser, tech, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'leila'));
  });
  // ---------- Leïla (assistante WhatsApp) : pilotage depuis le dashboard ----------
  // Relais vers les commandes /admin/* du bot (jeton ADMIN_TOKEN ajouté côté serveur, jamais envoyé au navigateur).
  // Équipe : activer / désactiver / automatique / statut. Admin : tout.
  const LEILA_GET = ['activer', 'desactiver', 'auto', 'statut', 'fermer', 'lever-fermeture', 'test-horaires-on', 'test-horaires-off', 'contexte-voir', 'note-client-voir', 'backlog', 'test-recap', 'messages-programmes', 'planning-voir', 'catalogue-voir'];
  const LEILA_POST = ['contexte', 'contexte-ajouter', 'note-client', 'message-programme', 'message-programme-annuler', 'importer-historique', 'simuler', 'planning', 'catalogue'];
  const LEILA_EQUIPE = ['activer', 'desactiver', 'auto', 'statut'];
  // Message d'absence de Leïla (remplace celui de WhatsApp Business) : texte et activation
  const ABS = { texte: "Bonjour 👋 Merci pour votre message ! L'atelier IGS Custom Bar est fermé pour le moment (ouvert du lundi au vendredi). Nous vous répondons dès la réouverture. Pour gagner du temps, vous pouvez déjà nous préciser votre demande (produit, quantité, visuel, date souhaitée) 😊", texte_conges: "Bonjour 👋 Merci pour votre message ! L'atelier IGS Custom Bar est en congés jusqu'au {date} inclus. Nous vous répondons dès notre retour 😊" };
  app.get('/gestion/api/leila-absence', auth.requireUser, auth.requireAdmin, async (req, res) => {
    try { const v = JSON.parse((await require('../supabase').getSetting('leila_absence')) || '{}'); res.json({ active: v.active !== false, texte: v.texte || ABS.texte, texte_conges: v.texte_conges || ABS.texte_conges, modele: process.env.WHATSAPP_MODELE_REPRISE || null }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/leila-absence', auth.requireUser, auth.requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const v = { active: b.active !== false, texte: String(b.texte || '').trim().slice(0, 900) || ABS.texte, texte_conges: String(b.texte_conges || '').trim().slice(0, 900) || ABS.texte_conges };
      await require('../supabase').setSetting('leila_absence', JSON.stringify(v));
      res.json({ ok: true, ...v });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/leila/:action', auth.requireUser, async (req, res) => {
    const action = String(req.params.action);
    if (![...LEILA_GET, ...LEILA_POST].includes(action)) return res.status(404).json({ error: 'Action inconnue' });
    if (req.user.role !== 'admin' && !LEILA_EQUIPE.includes(action)) return res.status(403).json({ error: 'Réservé à l\'administrateur' });
    const jeton = process.env.ADMIN_TOKEN;
    if (!jeton) return res.status(500).json({ error: 'ADMIN_TOKEN non configuré sur Render' });
    const base = `http://127.0.0.1:${process.env.PORT || 3000}/admin/${action}`;
    const corps = req.body || {};
    try {
      let r;
      if (LEILA_GET.includes(action)) {
        const q = new URLSearchParams({ token: jeton });
        for (const k of ['date', 'numero']) if (corps[k]) q.set(k, String(corps[k]));
        r = await fetch(`${base}?${q}`);
      } else {
        r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...corps, token: jeton }) });
      }
      const texte = await r.text();
      if (['activer', 'desactiver', 'auto'].includes(action)) console.log(`Leïla : ${action} par ${req.user.name || req.user.email}`);
      res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, texte } : { error: texte.slice(0, 300) });
    } catch (err) { res.status(502).json({ error: err.message }); }
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
  // Numéros clients dans Odoo à partir des BAT et des commandes (analyse puis application, jamais d'écrasement)
  const telBat = require('./telephones-bat');
  app.get('/gestion/api/admin/telephones', auth.requireUser, auth.requireAdmin, actA(() => telBat.rapport()));
  app.post('/gestion/api/admin/telephones/analyser', auth.requireUser, auth.requireAdmin, actA(req => telBat.analyser(req.user.name || req.user.email)));
  app.get('/gestion/api/admin/telephones/whatsapp', auth.requireUser, auth.requireAdmin, actA(() => telBat.whatsappNonRattaches()));
  app.post('/gestion/api/admin/telephones/whatsapp', auth.requireUser, auth.requireAdmin, actA(req => telBat.rattacherWhatsapp(req.body?.numero, req.body?.partnerId, !!req.body?.remplacer, req.user.name || req.user.email)));
  app.post('/gestion/api/admin/telephones/whatsapp/ignorer', auth.requireUser, auth.requireAdmin, actA(req => telBat.ignorerWhatsapp(req.body?.numero, req.user.name || req.user.email)));
  app.get('/gestion/api/admin/clients-odoo', auth.requireUser, auth.requireAdmin, actA(async req => ({ clients: String(req.query.q || '').trim().length < 2 ? [] : (await require('./odoo').searchPartners(req.query.q)).map(p => ({ id: p.id, nom: p.name, telephone: p.phone, ville: p.ville })) })));
  app.post('/gestion/api/admin/telephones/appliquer', auth.requireUser, auth.requireAdmin, actA(req => telBat.appliquer(req.body?.choix, req.user.name || req.user.email)));
  // Source des données (base du dashboard depuis la bascule ; l'ancien retour vers l'Excel a été retiré)
  const source = require('./source');
  app.get('/gestion/api/admin/source', auth.requireUser, auth.requireAdmin, (req, res) => res.json(source.etat()));
  // Diagnostic (admin) : en-têtes et formules des tableaux de l'Excel, pour les reprendre dans le dashboard
  app.get('/gestion/api/admin/formules', auth.requireUser, auth.requireAdmin, async (req, res) => {
    const g = require('./graph'), cfg = require('./config');
    const out = {};
    try {
      const id = (await g.itemByPath(cfg.EXCEL_PATH)).id;
      for (const t of [cfg.TABLE_COMMANDES, cfg.TABLE_PLANCHES, process.env.SP_TABLE_STOCK || 'TableauStock', process.env.SP_TABLE_CONSO || 'Tableau2', process.env.SP_TABLE_SANDAE || 'Tableau6']) {
        try {
          const r = await g.tableRange(id, t);
          const [entete, ...lignes] = r.formulas || [];
          const formules = {};
          (entete || []).forEach((h, i) => { const f = lignes.map(l => l[i]).find(v => typeof v === 'string' && v.startsWith('=')); if (f) formules[h] = f; });
          out[t] = { adresse: r.address, colonnes: entete, formules, lignes: lignes.length };
        } catch (err) { out[t] = { erreur: err.message }; }
      }
      res.json(out);
    } catch (err) { res.status(502).json({ error: err.message }); }
  });
  app.post('/gestion/api/admin/test-mail', auth.requireUser, auth.requireAdmin, async (req, res) => {
    try { res.json(await formulaire.testMail(req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message, dernierEchecFormulaire: formulaire.dernierEchec() }); }
  });
  // Comptes individuels (connexion à distance)
  app.post('/gestion/api/admin/collaborateurs/:id/acces', auth.requireUser, auth.requireAdmin, actA(req => require('./comptes').definirAcces(Number(req.params.id), req.body || {})));
  app.post('/gestion/api/admin/collaborateurs/:id/inviter', auth.requireUser, auth.requireAdmin, actA(req => require('./comptes').inviter(Number(req.params.id), auth.baseUrl(req))));
  app.post('/gestion/api/admin/collaborateurs/inviter-tous', auth.requireUser, auth.requireAdmin, actA(req => require('./comptes').inviterTous(auth.baseUrl(req))));
  app.post('/gestion/api/admin/collaborateurs/:id/acces/retirer', auth.requireUser, auth.requireAdmin, actA(req => require('./comptes').retirerAcces(Number(req.params.id))));
  app.post('/gestion/api/admin/collaborateurs/:id/supprimer', auth.requireUser, auth.requireAdmin, actA(req => admin.supprimerCollaborateur(Number(req.params.id))));

  const techOuCom = (req, res, next) => (auth.aProfil(req.user, 'technique') || auth.aProfil(req.user, 'commercial') ? next() : res.redirect('/gestion'));
  app.get('/gestion/caisse', auth.requireUser, techOuCom, (req, res) => {
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
  // Récupérer les espèces : Ismaël et les commerciaux
  const adminOuCom = (req, res, next) => (req.user.role === 'admin' || auth.aProfil(req.user, 'commercial') ? next() : res.status(403).json({ error: 'Réservé à Ismaël et aux commerciaux' }));
  app.post('/gestion/api/caisse/relever', auth.requireUser, adminOuCom, actC(req => caisse.relever(req.body || {}, quiC(req))));
  app.post('/gestion/api/caisse/:id/supprimer', auth.requireUser, auth.requireAdmin, actC(req => caisse.supprimer(Number(req.params.id), quiC(req))));

  // ---------- Factures fournisseurs (photo ou PDF -> Odoo) : profils technique, commercial et admin ----------
  const atelierOuCom = (req, res, next) => (auth.aProfil(req.user, 'technique') || auth.aProfil(req.user, 'commercial')) ? next() : res.status(403).json({ error: 'Accès réservé à l\'équipe' });
  app.get('/gestion/factures', auth.requireUser, (req, res) => {
    if (!auth.aProfil(req.user, 'technique') && !auth.aProfil(req.user, 'commercial')) return res.redirect('/gestion');
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'factures'));
  });
  const uploadFacture = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 8 } }).array('fichiers', 8);
  app.post('/gestion/api/factures-fournisseurs', auth.requireUser, atelierOuCom, (req, res, next) => uploadFacture(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (20 Mo maximum)' : err.code === 'LIMIT_FILE_COUNT' ? '8 photos maximum par facture' : err.message });
    next();
  }), async (req, res) => {
    try { res.json(await require('./factures-fournisseurs').envoyer({ fichiers: req.files, description: req.body?.description }, req.user.name || req.user.email)); }
    catch (err) { console.error('Factures fournisseurs :', err.message); res.status(400).json({ error: err.message }); }
  });
  // Règlement au comptoir (TPE et/ou espèces) d'une commande ou d'une planche : facture Odoo + note pour le rapprochement
  app.post('/gestion/api/reglement-comptoir', auth.requireUser, atelierOuCom, async (req, res) => {
    try { res.json(await require('./reglement-comptoir').enregistrer(req.body || {}, req.user.name || req.user.email)); }
    catch (err) { console.error('Règlement comptoir :', err.message); res.status(400).json({ error: err.message }); }
  });
  app.get('/gestion/api/factures-fournisseurs', auth.requireUser, atelierOuCom, async (req, res) => {
    try { res.json({ envois: await require('./factures-fournisseurs').recents(req.user.name || req.user.email, req.user.role === 'admin') }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ---------- Heures des collaborateurs ----------
  app.get('/gestion/heures', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'heures'));
  });
  const quiH = req => req.user.name || req.user.email;
  const actH = fn => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); }
    catch (err) { console.error('Gestion heures :', err.message); res.status(400).json({ error: err.message }); }
  };
  // Compte individuel : toujours verrouillé sur son propre nom. Le compte partagé de l'atelier (Microsoft 365) ne peut
  // ni saisir, ni voir, ni supprimer les heures ou factures de quelqu'un : il faut se connecter avec son compte personnel.
  const nominatif = (req, res, next) => (req.user.collab || req.user.role === 'admin') ? next() : res.status(403).json({ error: 'Pour voir ou modifier tes heures, connecte-toi avec ton compte personnel (prénom + mot de passe)' });
  // Saisie : ouverte au poste partagé de l'atelier (compte Microsoft contact@) : on choisit son nom, on met ses heures, on valide
  app.post('/gestion/api/heures', auth.requireUser, actH(req => heures.saisir({ ...(req.body || {}), ...(req.user.collab ? { collaborateur: req.user.collab } : {}) }, quiH(req), req.user.role)));
  // Facture de prestation de la semaine (collaborateurs indépendants : profil technique, et l'admin)
  app.post('/gestion/api/heures/facture', auth.requireUser, nominatif, (req, res, next) => (auth.aProfil(req.user, 'technique') ? next() : res.status(403).json({ error: 'Réservé aux techniciens' })),
    (req, res, next) => uploadFacture(req, res, err => err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (20 Mo maximum)' : err.code === 'LIMIT_FILE_COUNT' ? '8 photos maximum par facture' : err.message }) : next()), actH(req => heures.deposerFacture({ collaborateur: req.user.collab || req.body?.collaborateur, lundi: req.body?.lundi, fichiers: req.files }, quiH(req))));
  app.post('/gestion/api/heures/:id(\\d+)/supprimer', auth.requireUser, nominatif, actH(req => heures.supprimer(Number(req.params.id), quiH(req), req.user.role, req.user.collab || null)));
  app.get('/gestion/api/heures/mes', auth.requireUser, nominatif, actH(req => heures.mesHeures(String(req.user.collab || req.query.collaborateur || ''), String(req.query.lundi || ''))));
  app.get('/gestion/api/heures/semaine', auth.requireUser, auth.requireAdmin, actH(req => heures.semaine(String(req.query.lundi || ''))));
  app.post('/gestion/api/heures/:id(\\d+)/modifier', auth.requireUser, auth.requireAdmin, actH(req => heures.modifier(Number(req.params.id), req.body || {}, quiH(req))));
  app.post('/gestion/api/heures/payer', auth.requireUser, auth.requireAdmin, actH(req => heures.payer(String(req.body?.collaborateur || ''), String(req.body?.lundi || ''), quiH(req), { especes: !!req.body?.especes })));
  app.post('/gestion/api/heures/paiements/:id(\\d+)/annuler', auth.requireUser, auth.requireAdmin, actH(req => heures.annulerPaiement(Number(req.params.id), quiH(req))));
  app.post('/gestion/api/heures/recap', auth.requireUser, auth.requireAdmin, actH(req => heures.envoyerRecap(String(req.body?.lundi || ''), quiH(req))));
  app.post('/gestion/api/heures/recap-auto', auth.requireUser, auth.requireAdmin, actH(async req => { await heures.setReglage('heures_recap_auto', req.body?.active ? 'on' : 'off'); return { ok: true }; }));
  app.post('/gestion/api/heures/importer', auth.requireUser, auth.requireAdmin, actH(req => heures.importerExcel(quiH(req))));

  // ---------- Produits (catalogue Odoo, prix TTC) : lecture pour tous, prix modifiables par admin et commercial ----------
  app.get('/gestion/produits', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').send(page.render(req.user, 'produits'));
  });
  app.get('/gestion/api/produits', auth.requireUser, async (req, res) => {
    try { res.json({ ...(await require('./produits').liste({ force: !!req.query.force })), peut_modifier: auth.aProfil(req.user, 'commercial') }); }
    catch (err) { console.error('Gestion produits :', err.message); res.status(502).json({ error: err.message }); }
  });
  app.post('/gestion/api/produits/:id(\\d+)/prix', auth.requireUser, auth.requireProfil('commercial'), async (req, res) => {
    try { res.json(await require('./produits').changerPrix(Number(req.params.id), req.body?.prix_ttc, req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  // ---------- Apprentissage de Leïla (admin) ----------
  const actAp = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (err) { console.error('Gestion apprentissage :', err.message); res.status(400).json({ error: err.message }); }
  };
  const appr = () => require('./apprentissage');
  const quiAp = req => req.user.name || req.user.email;
  app.get('/gestion/api/apprentissage', auth.requireUser, auth.requireAdmin, actAp(() => appr().etat()));
  app.post('/gestion/api/apprentissage/mode', auth.requireUser, auth.requireAdmin, actAp(req => appr().setMode(req.body?.mode)));
  app.post('/gestion/api/apprentissage/lecons/:action(valider|refuser|modifier|supprimer)', auth.requireUser, auth.requireAdmin, actAp(req => appr().changer(req.body?.ids, req.params.action, req.body?.texte, quiAp(req))));
  app.post('/gestion/api/apprentissage/apprendre', auth.requireUser, auth.requireAdmin, actAp(req => appr().apprendre(req.body || {}, quiAp(req))));
  app.post('/gestion/api/apprentissage/analyser', auth.requireUser, auth.requireAdmin, actAp(() => appr().analyser().then(r => ({ resultat: r }))));
  app.post('/gestion/api/apprentissage/bilan', auth.requireUser, auth.requireAdmin, actAp(req => appr().bilan({ envoyer: !!req.body?.envoyer }).then(t => ({ texte: t }))));
  app.get('/gestion/stock', auth.requireUser, tech, (req, res) => {
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
  app.post('/gestion/api/planches/:cle/supprimer', auth.requireUser, action(req => planches.supprimer(req.params.cle, qui(req), { fichiers: req.body?.fichiers, devis: !!req.body?.devis })));
  app.post('/gestion/api/planches/ajouter', auth.requireUser, async (req, res) => {
    // Doublon possible sur un compteur hebdo : 409 pour que le dashboard demande confirmation
    try {
      const r = await planches.ajouter(req.body || {}, qui(req));
      // Planche ponctuelle ajoutée à la main : devis Odoo envoyé tout de suite (comme la tâche « Devis planche auto »)
      if (r && r.planche && !r.compteur) r.devis = await require('./taches').devisPlancheAjoutee(r.planche).catch(err => ({ statut: 'erreur', erreur: err.message }));
      res.json(r);
    }
    catch (err) { if (err.doublon) return res.status(409).json({ error: err.message, doublon: true }); console.error('Gestion action :', err.message); res.status(400).json({ error: err.message }); }
  });
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
      if (!lien) return res.status(404).type('text/plain').send(`Devis ${String(req.params.numero).slice(0, 30)} introuvable dans Odoo`);
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
      await require('./graph').streamer(r, res); // planches de plusieurs dizaines de Mo : jamais en mémoire
    } catch (err) {
      console.error('Gestion fichier planche :', err.message);
      if (!res.headersSent) res.status(502).send('Fichier indisponible'); else res.end();
    }
  });

  app.get('/gestion/api/me', auth.requireUser, (req, res) => {
    res.json({ email: req.user.email, name: req.user.name, role: req.user.role });
  });

  // Bouton « Actualiser » : va d'abord chercher dans Odoo les commandes confirmées/payées pas encore dans le tableau
  // (même travail que la tâche « Commandes payées dans Odoo », 1 fois toutes les 30 s au plus, 20 s d'attente max)
  let dernierImportOdoo = 0;
  app.get('/gestion/api/commandes', auth.requireUser, async (req, res) => {
    if (req.query.actualiser === '1' && Date.now() - dernierImportOdoo > 30e3) {
      dernierImportOdoo = Date.now();
      const imp = require('./taches').lancerMaintenant('commandes_payees', `${req.user.name || req.user.email} (Actualiser)`).catch(err => console.error('Actualiser : import Odoo', err.message));
      await Promise.race([imp, new Promise(r => setTimeout(r, 20e3))]);
    }
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
  // Ajout d'articles à une commande en cours (devis Odoo + Tailles.xlsx + BDC SEFI)
  app.get('/gestion/api/commandes/:cle/ajout', auth.requireUser, async (req, res) => {
    try { res.json(await require('./ajout').preparer(req.params.cle)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/ajout', auth.requireUser, async (req, res) => {
    try { res.json(await require('./ajout').ajouter(req.params.cle, req.body || {}, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion ajout :', err.message); res.status(400).json({ error: err.message }); }
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
    try { res.json(await commandes.supprimer(req.params.cle, req.user.name || req.user.email, { dossier: !!req.body?.dossier, devis: !!req.body?.devis })); }
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
  // Visuel d'une planche importé depuis le dashboard (« Client - P1.png » dans PLANCHES A IMPRIMER)
  // Sur disque (pas en mémoire) : 5 planches de 80 Mo saturaient la RAM du serveur
  const uploadVisuelPlanche = require('multer')({ storage: require('multer').diskStorage({ destination: require('os').tmpdir() }), limits: { fileSize: 80 * 1024 * 1024, files: 5 } }).array('fichiers', 5);
  app.post('/gestion/api/planches/:cle/visuel', auth.requireUser, (req, res, next) => uploadVisuelPlanche(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (80 Mo max)' : err.code === 'LIMIT_FILE_COUNT' ? '5 fichiers maximum à la fois' : err.message });
    next();
  }), async (req, res) => {
    try { res.json(await planches.importerVisuels(req.params.cle, req.files, req.body?.note, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion visuel planche :', err.message); res.status(400).json({ error: err.message }); }
    finally { for (const f of req.files || []) if (f.path) require('fs').promises.unlink(f.path).catch(() => {}); }
  });
  // Planches : même chose (dossier Technique/Planches/BORDEREAUX), à tout moment
  app.post('/gestion/api/planches/:cle/remise', auth.requireUser, async (req, res) => {
    try { res.json({ planche: await planches.setRemise(req.params.cle, req.body?.remise ?? null, qui(req)) }); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.get('/gestion/api/planches-historique', auth.requireUser, async (req, res) => {
    try { res.json({ planches: await planches.historique({ limite: 10 }) }); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.get('/gestion/api/planches/:cle/suivi', auth.requireUser, async (req, res) => {
    try { res.json(await planches.suiviHebdo(req.params.cle)); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.get('/gestion/api/planches/:cle/bordereaux', auth.requireUser, async (req, res) => {
    try { res.json({ bordereaux: await planches.bordereaux(req.params.cle) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/planches/:cle/bordereau', auth.requireUser, (req, res, next) => uploadBordereau(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (15 Mo max)' : err.message });
    next();
  }), async (req, res) => {
    try { res.json(await planches.ajouterBordereau(req.params.cle, req.file, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion bordereau planche :', err.message); res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/planches/:cle/prioritaire', auth.requireUser, async (req, res) => {
    try { res.json(await planches.setPrioritaire(req.params.cle, !!req.body?.actif, req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/planches/:cle/fichier/:id/supprimer', auth.requireUser, async (req, res) => {
    try { res.json(await planches.supprimerFichier(req.params.cle, req.params.id, req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/planches/:cle/bordereau/:id/supprimer', auth.requireUser, async (req, res) => {
    try { res.json(await planches.supprimerBordereau(req.params.cle, req.params.id, req.user.name || req.user.email)); }
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
  // Adresse d'expédition (Odoo) d'un devis : fiche des commandes À EXPÉDIER / EXPÉDIÉE
  app.get('/gestion/api/odoo/devis/:numero/adresse', auth.requireUser, async (req, res) => {
    try { res.json({ adresse: await require('./odoo').adresseLivraison(String(req.params.numero).toUpperCase().trim()) }); }
    catch (err) { res.status(502).json({ error: err.message }); }
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
  // Montant à payer des commandes (Odoo) : total TTC, déjà payé, reste
  app.get('/gestion/api/commandes/soldes', auth.requireUser, async (req, res) => {
    try { res.json(await require('./odoo').soldesDevis(String(req.query.devis || '').split(','))); }
    catch (err) { res.status(502).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/sans-paiement', auth.requireUser, async (req, res) => {
    try { res.json(await commandes.setSansPaiement(req.params.cle, !!req.body?.actif, req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/dossier', auth.requireUser, async (req, res) => {
    try { res.json(await commandes.creerDossier(req.params.cle, req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/prioritaire', auth.requireUser, async (req, res) => {
    try { res.json(await commandes.setPrioritaire(req.params.cle, !!req.body?.actif, req.user.name || req.user.email)); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
  // Tableau des tailles (Tailles.xlsx) modifiable depuis la fiche : stock de vierges pris en priorité, BDC SEFI resynchronisé
  app.get('/gestion/api/commandes/:cle/tailles', auth.requireUser, async (req, res) => {
    try { res.json(await require('./tailles-edit').lire(req.params.cle)); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/tailles/apercu', auth.requireUser, async (req, res) => {
    try { res.json({ apercu: await require('./tailles-edit').apercu(req.body?.lignes) }); } catch (err) { res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/tailles', auth.requireUser, async (req, res) => {
    try { res.json(await require('./tailles-edit').enregistrer(req.params.cle, req.body || {}, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion tailles :', err.message); res.status(400).json({ error: err.message }); }
  });
  app.post('/gestion/api/commandes/:cle/especes', auth.requireUser, async (req, res) => {
    try { res.json({ commande: await commandes.setEspeces(req.params.cle, { actif: !!req.body?.actif, montant: req.body?.montant }, req.user.name || req.user.email) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.get('/gestion/api/commandes/:devis/dossier', auth.requireUser, async (req, res) => {
    try {
      res.json(await commandes.getDossierControle(req.params.devis, { force: req.query.force === '1' }));
    } catch (err) {
      console.error('Gestion dossier :', err.message);
      res.status(502).json({ erreur: err.message });
    }
  });

  const cacheFichiers = new Map(); // id -> { le, it, buf, type }
  // Surveillance mémoire (Render redémarre le service au-delà de sa limite) : relevé dans les logs, caches vidés si ça monte
  const SEUIL_MO = Number(process.env.MEMOIRE_ALERTE_MO || 400);
  setInterval(() => {
    const m = process.memoryUsage(), mo = n => Math.round(n / 1048576);
    const fichiersMo = mo([...cacheFichiers.values()].reduce((t, v) => t + v.buf.length, 0));
    if (mo(m.rss) >= SEUIL_MO) {
      cacheFichiers.clear(); commandes.oublierDossier();
      console.warn(`Mémoire haute : ${mo(m.rss)} Mo (tas ${mo(m.heapUsed)} Mo, buffers ${mo(m.arrayBuffers)} Mo) : caches vidés`);
    } else console.log(`Mémoire : ${mo(m.rss)} Mo (tas ${mo(m.heapUsed)} Mo, buffers ${mo(m.arrayBuffers)} Mo, cache fichiers ${fichiersMo} Mo)`);
  }, 10 * 60e3).unref?.();
  // Proxy de fichier (BAT PDF, visuels) : affichage dans le navigateur sans exposer SharePoint
  app.get('/gestion/api/fichier/:id', auth.requireUser, async (req, res) => {
    try {
      // Fichiers gardés 10 min en mémoire (visuels rouverts par la fiche puis le générateur de BAT)
      for (const [k, v] of cacheFichiers) if (Date.now() - v.le >= 10 * 60e3) cacheFichiers.delete(k); // périmés libérés
      const c = cacheFichiers.get(req.params.id);
      let it, buf, type;
      if (c) ({ it, buf, type } = c);
      else {
        it = await commandes.fichierAutorise(req.params.id);
        if (!it) return res.status(403).send('Fichier non autorisé');
        const r = await require('./graph').content(it.id);
        type = it.file.mimeType || r.headers.get('content-type') || 'application/octet-stream';
        // Gros fichier ou pas une image (BAT PDF, archive…) : envoyé au fil de l'eau, jamais gardé en mémoire
        if (!/^image\//i.test(type) || !(it.size <= 5e6)) {
          res.set('Content-Type', type);
          res.set('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(it.name)}`);
          res.set('Cache-Control', 'private, max-age=600');
          return await require('./graph').streamer(r, res);
        }
        buf = Buffer.from(await r.arrayBuffer());
        cacheFichiers.set(req.params.id, { le: Date.now(), it, buf, type });
        let total = 0; for (const v of cacheFichiers.values()) total += v.buf.length;
        while (total > 30e6 && cacheFichiers.size) { const k = cacheFichiers.keys().next().value; total -= cacheFichiers.get(k).buf.length; cacheFichiers.delete(k); }
      }
      res.set('Content-Type', type);
      res.set('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(it.name)}`);
      res.set('Cache-Control', 'private, max-age=600');
      res.send(buf);
    } catch (err) {
      console.error('Gestion fichier :', err.message);
      if (!res.headersSent) res.status(502).send('Fichier indisponible'); else res.end();
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

  // ---------- Tâches automatiques (remplacent les flux Power Automate un par un) ----------
  const taches = require('./taches');
  app.get('/gestion/api/taches', auth.requireUser, auth.requireAdmin, actN(() => taches.etat()));
  app.post('/gestion/api/taches/:id/activer', auth.requireUser, auth.requireAdmin, actN(req => taches.activer(req.params.id, !!req.body?.actif)));
  app.post('/gestion/api/taches/:id/lancer', auth.requireUser, auth.requireAdmin, actN(req => taches.lancerMaintenant(req.params.id, req.user.name || req.user.email)));

  // ---------- Bon de commande SEFI : envoi manuel (dashboard ou bouton du fichier Excel), déblocage ----------
  const sefi = require('./sefi');
  let sefiDernierBouton = 0;
  const lancerSefi = par => {
    if (Date.now() - sefiDernierBouton < 120e3) return { ok: false, message: 'Un envoi vient d\'être lancé, attends 2 minutes.' };
    sefiDernierBouton = Date.now();
    sefi.envoyer(par).then(r => console.log('SEFI (manuel) :', r.raison || `lot ${r.lot} envoyé`)).catch(err => {
      console.error('SEFI (manuel) : échec', err.message);
      require('./graph').sendMail((process.env.FORM_MAILBOX || 'contact@igscustom.fr'), { to: (process.env.FORM_MAILBOX || 'contact@igscustom.fr'), subject: '⚠️ Envoi du BDC SEFI impossible', html: `<p>${String(err.message).replace(/</g, '&lt;')}</p>` }).catch(() => {});
    });
    return { ok: true, message: 'Envoi lancé : le récap arrive par mail dans 1 à 2 minutes (rien n\'est envoyé si le BDC est vide).' };
  };
  app.post('/gestion/api/sefi/envoyer', auth.requireUser, actN(req => lancerSefi(req.user.name || req.user.email)));
  app.post('/gestion/api/sefi/debloquer', auth.requireUser, auth.requireAdmin, actN(() => sefi.debloquer()));
  // Onglet « BDC SEFI » : contenu en temps réel, conversion, ajout manuel, ajustement (toute l'équipe)
  const quiS2 = req => req.user.name || req.user.email;
  const actS = fn => async (req, res) => { try { res.json(await fn(req)); } catch (err) { console.error('BDC SEFI :', err.message); res.status(/Graph|SharePoint|fetch/i.test(err.message) ? 502 : 400).json({ error: err.message }); } };
  // ---------- Rouleau de film DTF (100 m) : décompte par les planches imprimées, alerte à 20 m ----------
  const rouleau = require('./rouleau');
  app.get('/gestion/api/rouleau', auth.requireUser, tech, actS(() => rouleau.etat()));
  app.post('/gestion/api/rouleau/nouveau', auth.requireUser, tech, actS(req => rouleau.nouveauRouleau(req.body || {}, quiS2(req))));
  app.post('/gestion/api/rouleau/corriger', auth.requireUser, tech, actS(req => rouleau.corriger(req.body || {}, quiS2(req))));
  app.post('/gestion/api/rouleau/seuils', auth.requireUser, auth.requireAdmin, actS(req => rouleau.reglerSeuils(req.body || {})));
  // ---------- Mes tâches (Ismaël, admin) : aussi alimentées par Leïla sur WhatsApp ----------
  const todo = require('./todo');
  app.get('/gestion/taches', auth.requireUser, auth.requireAdmin, (req, res) => res.set('Cache-Control', 'no-store').send(page.render(req.user, 'todo')));
  app.get('/gestion/api/todo', auth.requireUser, auth.requireAdmin, actS(() => todo.liste().then(taches => ({ taches }))));
  app.post('/gestion/api/todo', auth.requireUser, auth.requireAdmin, actS(req => todo.ajouter(req.body || {}, quiS2(req))));
  app.post('/gestion/api/todo/:id', auth.requireUser, auth.requireAdmin, actS(req => todo.modifier(req.params.id, req.body || {}, quiS2(req))));
  app.post('/gestion/api/todo/:id/supprimer', auth.requireUser, auth.requireAdmin, actS(req => todo.supprimer(req.params.id)));
  app.get('/gestion/sefi', auth.requireUser, tech, (req, res) => res.set('Cache-Control', 'no-store').send(page.render(req.user, 'sefi')));
  app.get('/gestion/api/sefi/bdc', auth.requireUser, actS(req => sefi.contenuBdc({ force: req.query.force === '1' }).then(c => ({ ...c, admin: req.user.role === 'admin' }))));
  app.get('/gestion/api/sefi/convertir', auth.requireUser, actS(async req => { const c = sefi.convertir(req.query.texte, req.query.taille); if (req.user.role !== 'admin') delete c.prix; return c; }));
  app.post('/gestion/api/sefi/ajouter', auth.requireUser, actS(req => sefi.ajouterManuel(req.body || {}, quiS2(req))));
  app.post('/gestion/api/sefi/quantite', auth.requireUser, actS(req => sefi.fixerQuantite(req.body || {}, quiS2(req))));
  app.post('/gestion/api/sefi/supprimer-ligne', auth.requireUser, actS(req => sefi.supprimerLigne(req.body || {}, quiS2(req))));
  // Bouton du fichier Excel (script Office) : jeton dédié SEFI_BOUTON_JETON, ne permet QUE de lancer l'envoi
  app.options('/gestion/public/sefi/envoyer', (req, res) => { res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }).sendStatus(204); });
  app.post('/gestion/public/sefi/envoyer', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const attendu = process.env.SEFI_BOUTON_JETON;
    const recu = String(req.body?.jeton || '');
    const crypto = require('crypto');
    const bR = Buffer.from(recu), bA = Buffer.from(attendu || '');
    if (!attendu || bR.length !== bA.length || !crypto.timingSafeEqual(bR, bA)) return res.status(403).json({ ok: false, message: 'Jeton invalide' });
    res.json(lancerSefi('Bouton Excel'));
  });

  // ---------- Journal d'une commande + question interne à Leïla ----------
  const leila = require('./leila');
  app.get('/gestion/api/commandes/:cle/journal', auth.requireUser, actN(req => leila.journalCommande(req.params.cle)));
  app.post('/gestion/api/commandes/:cle/question', auth.requireUser, actN(req => leila.question(req.params.cle, req.body?.question, req.user.name || req.user.email)));

  // Générateur de BAT
  require('./bat-generateur').mount(app);

  require('./source').charger().catch(() => {});
  commandes.startSync();
  planches.startSync();
  heures.startRecap();
  require('./telephones').start();
  require('./bat-reponses').start();
  notif.start();
  require('./colissimo').start();
  taches.start();
  console.log('Module Gestion IGS monté sur /gestion');
};
