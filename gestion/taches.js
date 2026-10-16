// ============================================
// IGS GESTION - TÂCHES AUTOMATIQUES (remplacent les flux Power Automate, un par un)
// Chaque tâche a son interrupteur dans Admin : on coupe le flux Power Automate, puis on active la tâche.
// État (activée, dernier passage, résultat) dans gestion_reglages.
// ============================================

const g = require('./graph');
const { supabase } = require('./db');
const planches = require('./planches');

const lireJSON = (v, d) => { try { const x = JSON.parse(v); return x ?? d; } catch { return d; } };
const heureGP = (d = Date.now()) => new Date(new Date(d).toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
const statutKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

async function reglage(cle, defaut = null) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (!supabase) throw new Error('Supabase non configuré');
  const { error } = await supabase.from('gestion_reglages').upsert({ cle, valeur, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// ---------- Planches : fichiers ----------
async function sousDossier(nom) {
  const { root, D } = await planches.dossierPlanches();
  const f = (await g.children(root.id, D)).find(i => i.folder && i.name.trim().toUpperCase() === nom);
  if (!f) throw new Error(`Dossier Technique/Planches/${nom} introuvable`);
  return { f, D, root };
}
// « Archivage planches imp » : chaque nuit du lundi au vendredi, les fichiers de PLANCHES A IMPRIMER déposés depuis plus
// de 24 h partent dans Archives. Rien le week-end : une planche envoyée le vendredi soir reste là jusqu'au lundi.
async function archiverPlanches() {
  const { f, D } = await sousDossier('PLANCHES A IMPRIMER');
  const { f: arch } = await sousDossier('ARCHIVES');
  const fichiers = (await g.children(f.id, D)).filter(i => i.file && Date.parse(i.lastModifiedDateTime) < Date.now() - 24 * 3600e3);
  let n = 0; const erreurs = [];
  for (const i of fichiers) { try { await g.moveItem(i.id, arch.id, D); n++; } catch (err) { erreurs.push(`${i.name} : ${err.message.slice(0, 80)}`); } }
  if (erreurs.length && !n) throw new Error(erreurs.join(' ; '));
  return `${n} fichier(s) archivé(s)${erreurs.length ? `, ${erreurs.length} non déplacé(s) : ${erreurs.join(' ; ')}` : ''}`;
}
// « Vider dossier planches » : fichiers posés directement dans Technique/Planches depuis plus de 48 h -> corbeille
async function viderRacinePlanches() {
  const { root, D } = await planches.dossierPlanches();
  const vieux = (await g.children(root.id, D)).filter(i => i.file && Date.parse(i.lastModifiedDateTime) < Date.now() - 48 * 3600e3);
  for (const i of vieux) await g.deleteItem(i.id, D);
  return `${vieux.length} fichier(s) supprimé(s)`;
}
// « vider archive planche » : une fois par mois, les fichiers archivés depuis plus de 30 jours partent à la corbeille
// SharePoint (récupérables 93 jours) ; les planches archivées récemment restent consultables.
async function viderArchivesPlanches() {
  const { f, D } = await sousDossier('ARCHIVES');
  const limite = Date.now() - 30 * 86400e3;
  const fichiers = (await g.children(f.id, D)).filter(i => i.file && Date.parse(i.lastModifiedDateTime || i.createdDateTime || 0) < limite);
  for (const i of fichiers) await g.deleteItem(i.id, D);
  return `${fichiers.length} fichier(s) supprimé(s)`;
}

// ---------- Planches : Odoo ----------
// « statut paiement planche » : devis confirmé dans Odoo -> Paiement PAYÉE
async function paiementPlanches() {
  const odoo = require('./odoo');
  const { rows } = await planches.listPlanches({ force: true });
  const aVoir = rows.filter(p => p.n_devis && statutKey(p.paiement) !== 'PAYEE');
  let n = 0;
  for (const p of aVoir) {
    try {
      if ((await odoo.etatDevis(p.n_devis)) === 'sale') { await planches.marquerPayee(p.cle); n++; }
    } catch (err) { console.error(`Gestion paiement planche ${p.n_devis} :`, err.message); }
  }
  return `${aVoir.length} devis vérifié(s), ${n} passé(s) en PAYÉE`;
}
// « Planches en attente » : planche EN ATTENTE (devis envoyé, pas encore validé) depuis plus de 72 h et toujours pas payée
// -> ligne supprimée et devis Odoo annulé (pas supprimé) ; si elle est payée entre-temps, elle passe À PRÉPARER toute seule
const ATTENTE_MAX_H = Number(process.env.PLANCHES_ATTENTE_MAX_H || 72);
async function expirerPlanchesEnAttente() {
  const { rows } = await planches.listPlanches({ force: true });
  const limite = Date.now() - ATTENTE_MAX_H * 3600e3;
  const depuis = p => Date.parse(p.statut_le || '') || Date.parse(String(p.date_commande || '').slice(0, 10) + 'T12:00:00Z') || Date.now();
  const vieilles = rows.filter(p => statutKey(p.statut) === 'ENATTENTE' && !p.hebdo && statutKey(p.paiement) !== 'PAYEE' && depuis(p) < limite);
  const faits = [];
  for (const p of vieilles) {
    try {
      // Dernière vérification dans Odoo : devis confirmé entre-temps -> payée, à préparer
      if (p.n_devis) {
        const etat = await require('./odoo').etatDevis(p.n_devis).catch(() => null);
        if (etat === 'sale') { await planches.marquerPayee(p.cle); faits.push(`${p.client} : payée, À PRÉPARER`); continue; }
        if (etat === 'draft' || etat === 'sent') await require('./odoo').annulerDevisOdoo({ numero: p.n_devis }, `planche en attente depuis plus de ${ATTENTE_MAX_H} h sans validation`, 'IGS Dashboard (automatique)').catch(err => console.error(`Planche ${p.cle} : devis non annulé :`, err.message));
      }
      await planches.supprimer(p.cle, 'IGS Dashboard (automatique)', { fichiers: [], devis: false });
      faits.push(`${p.client}${p.n_devis ? ` (${p.n_devis} annulé)` : ''} : supprimée`);
    } catch (err) { faits.push(`${p.client} : erreur ${err.message.slice(0, 80)}`); }
  }
  // Commandes textile EN ATTENTE : même règle (date de passage en attente notée au premier passage de la tâche)
  try {
    const commandes = require('./commandes');
    const { rows: cmds } = await commandes.listCommandes({ force: true });
    const vus = lireJSON(await reglage('commandes_en_attente_depuis', '{}'), {});
    const enAttente = cmds.filter(c => statutKey(c.statut) === 'ENATTENTE');
    const suivi = {};
    for (const c of enAttente) suivi[c.cle] = vus[c.cle] || Date.now();
    for (const c of enAttente.filter(c => suivi[c.cle] < limite)) {
      try {
        if (c.n_devis) {
          const etat = await require('./odoo').etatDevis(c.n_devis).catch(() => null);
          if (etat === 'sale') { await commandes.modifier(c.cle, { statut: 'PAYÉE' }, 'Odoo (commande payée)'); delete suivi[c.cle]; faits.push(`${c.n_devis} ${c.client} : payée → PAYÉE`); continue; }
          if (etat === 'draft' || etat === 'sent') await require('./odoo').annulerDevisOdoo({ numero: c.n_devis }, `commande en attente depuis plus de ${ATTENTE_MAX_H} h sans validation`, 'IGS Dashboard (automatique)').catch(err => console.error(`Commande ${c.cle} : devis non annulé :`, err.message));
        }
        await commandes.supprimer(c.cle, 'IGS Dashboard (automatique)', { dossier: false, devis: false });
        delete suivi[c.cle];
        faits.push(`${c.n_devis || c.cle} ${c.client}${c.n_devis ? ' (devis annulé)' : ''} : commande supprimée`);
      } catch (err) { faits.push(`${c.client} : erreur ${err.message.slice(0, 80)}`); }
    }
    await setReglage('commandes_en_attente_depuis', JSON.stringify(suivi));
  } catch (err) { faits.push(`commandes : ${err.message.slice(0, 80)}`); }
  return faits.length ? faits.join(' ; ') : 'rien d\'expiré (planches et commandes en attente)';
}

// « Devis planche auto » : planches en cours avec métrage, sans devis, pas payées, hors clients hebdo -> devis Odoo envoyé
// (A VÉRIFIER exclue : l'équipe doit regarder avant ; payée au comptoir (espèces, CB…) : pas de devis)
const ST_DEVIS = ['APREPARER', 'AIMPRIMER', 'ENATTENTE', 'ARECUPERER', 'AEXPEDIER'];
// Statuts ajoutés (à imprimer, prête…) : seulement les planches récentes (3 jours), pour ne jamais deviser d'anciennes planches
const recente = p => { const d = Date.parse(p.date_commande || ''); return !isNaN(d) && Date.now() - d < 3 * 86400e3; };
const aDeviser = p => ST_DEVIS.includes(statutKey(p.statut)) && !p.n_devis && !p.hebdo && p.client && (p.format || p.metres > 0)
  && (!String(p.paiement || '').trim() || /NON/i.test(p.paiement))
  && (['APREPARER', 'ENATTENTE'].includes(statutKey(p.statut)) || recente(p));
async function devisPlanches() {
  const { rows } = await planches.listPlanches({ force: true });
  const aFaire = rows.filter(aDeviser);
  const res = [];
  for (const p of aFaire) {
    try {
      const r = await planches.devis(p.cle, 'Devis automatique');
      if (r.ok) { res.push(`${p.client} : ${r.devis.numero}`); continue; }
      const remarque = r.doublon
        ? `DEVIS RECENT DEJA CREE (${r.doublon}) - A VERIFIER`
        : 'CLIENT OU PRODUIT INTROUVABLE DANS ODOO';
      await planches.modifier(p.cle, { statut: 'A VERIFIER', remarques: [remarque, p.remarques].filter(Boolean).join(' | ').slice(0, 500) }, 'Devis automatique');
      res.push(`${p.client} : à vérifier (${r.doublon ? 'doublon ' + r.doublon : 'client introuvable'})`);
    } catch (err) {
      console.error(`Gestion devis planche auto ${p.client} :`, err.message);
      try { await planches.modifier(p.cle, { statut: 'A VERIFIER', remarques: [`DEVIS AUTO IMPOSSIBLE : ${err.message}`.slice(0, 200), p.remarques].filter(Boolean).join(' | ').slice(0, 500) }, 'Devis automatique'); } catch {}
      res.push(`${p.client} : erreur (${err.message})`);
    }
  }
  return aFaire.length ? res.join(' ; ') : 'aucune planche à deviser';
}


// ---------- Commandes ----------
// « Commande payés Excel » : devis confirmés dans Odoo (48 h, hors planches) -> ligne PAYÉE (une seule fois par devis)
async function commandesPayees() {
  const odoo = require('./odoo');
  const commandes = require('./commandes');
  const liste = await odoo.commandesPayeesRecentes(48);
  const vus = new Set(lireJSON(await reglage('commandes_payees_vues', '[]'), []));
  const { rows } = await commandes.listCommandes({ force: true });
  const ajoutees = [];
  for (const o of liste) {
    if (vus.has(o.name)) continue;
    const ex = rows.find(r => String(r.n_devis || '').toUpperCase() === o.name.toUpperCase());
    if (ex) {
      // Ligne créée « EN DEVIS » par le formulaire avant le paiement : elle passe en PAYÉE dès la confirmation Odoo
      if (['ENDEVIS', 'ENATTENTE'].includes(statutKey(ex.statut))) {
        try {
          const note = /^⚠ Formulaire reçu mais devis/.test(ex.remarque || '') ? { remarque: '' } : {};
          await commandes.modifier(ex.cle, { statut: 'PAYÉE', ...note, ...(ex.infos || !o.infos ? {} : { infos: o.infos }) }, 'Odoo (commande payée)');
          ajoutees.push(`${o.name} ${o.client} (${ex.statut} → PAYÉE)`);
        } catch (err) { console.error(`Gestion commande payée ${o.name} :`, err.message); continue; }
        // (le BDC SEFI est rempli par commandes.modifier au passage EN DEVIS -> PAYÉE)
      }
      vus.add(o.name); continue;
    }
    try {
      await commandes.creerCommande({ n_devis: o.name, client: o.client, infos: o.infos, statut: 'PAYÉE' }, 'Odoo (commande payée)');
      vus.add(o.name); ajoutees.push(`${o.name} ${o.client}`);
    } catch (err) {
      if (/existe déjà/.test(err.message)) vus.add(o.name);
      else console.error(`Gestion commande payée ${o.name} :`, err.message);
    }
  }
  await setReglage('commandes_payees_vues', JSON.stringify([...vus].slice(-1000)));
  return ajoutees.length ? `${ajoutees.length} commande(s) ajoutée(s) : ${ajoutees.join(', ')}` : `${liste.length} devis confirmé(s) en 48 h, rien de nouveau`;
}
// « Nettoyage commande livrées » (minuit) : lignes LIVRÉE retirées de l'Excel (gardées dans l'historique du dashboard) ;
// planches ponctuelles LIVRÉE + PAYÉE retirées, planches hebdo LIVRÉE remises à zéro (statut vidé)
async function nettoyerLivrees() {
  if (require('./source').estBase()) {
    const nbC = await require('./commandes').retirerLivrees();
    const p = await planches.nettoyerBase();
    return `Planches : ${p.retirees} retirée(s), ${p.hebdo} hebdo remise(s) à zéro | Commandes : ${nbC} retirée(s) (gardées dans l'historique)`;
  }
  const xl = require('./excel');
  const cfg = require('./config');
  const n = v => String(v ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tp = await xl.readTable(cfg.TABLE_PLANCHES);
  const [cf, cpay, cst] = [xl.col(tp, 'Fréquence'), xl.col(tp, 'Paiement'), xl.col(tp, 'Statut')];
  const aSuppr = [];
  let hebdo = 0;
  for (const r of tp.rows) {
    const estHebdo = n(r.values[cf]).includes('HEBDOMADAIRE'), livree = n(r.values[cst]) === 'LIVREE';
    if (estHebdo && livree) { await xl.setCell(tp, r._row, cst, ''); hebdo++; }
    else if (!estHebdo && livree && n(r.values[cpay]) === 'PAYEE') aSuppr.push(r._row);
  }
  const nbP = await xl.supprimerLignes(tp, aSuppr);
  const tc = await xl.readTable(cfg.TABLE_COMMANDES);
  const cs = xl.col(tc, 'Statut');
  const nbC = await xl.supprimerLignes(tc, tc.rows.filter(r => n(r.values[cs]) === 'LIVREE').map(r => r._row));
  await Promise.all([require('./commandes').syncNow().catch(() => {}), planches.syncNow().catch(() => {})]);
  return `Planches : ${nbP} ligne(s) supprimée(s), ${hebdo} hebdo remise(s) à zéro | Commandes : ${nbC} ligne(s) supprimée(s)`;
}
// Tâches de nuit : dues une fois par jour calendaire de Guadeloupe
const jourGP = d => { const x = heureGP(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
const autreJour = (h, d) => !d || jourGP(new Date(d)) !== `${h.getFullYear()}-${h.getMonth()}-${h.getDate()}`;
// ---------- Registre ----------
// quand(h, dernier) : la tâche est-elle due ? h = heure de Guadeloupe, dernier = Date du dernier passage (ou null)
const TACHES = [
  { id: 'commandes_payees', nom: 'Commandes payées dans Odoo → ligne PAYÉE', flux: 'IGS - Commande payés Excel', rythme: 'toutes les 10 min', fn: commandesPayees,
    quand: (h, d) => !d || Date.now() - d > 9.5 * 60e3 },
  { id: 'rapport_mensuel', nom: 'Rapport du mois par mail (CA, achats, marge, trésorerie Qonto, impayés)', flux: '(nouveau, module Commercial)', rythme: 'le 1er de chaque mois à 8 h', fn: async () => { const r = await require('./finances').rapportMensuel(); return `rapport ${r.mois} envoyé (CA ${Math.round(r.ca)} € HT)`; },
    quand: (h, d) => h.getDate() === 1 && h.getHours() >= 8 && (!d || Date.now() - d > 20 * 86400e3) },
  { id: 'facture_solde', nom: 'Facture du solde envoyée au client quand une commande avec acompte passe en TERMINÉE ou À EXPÉDIER', flux: '(nouveau, module Commercial)', rythme: 'à chaque changement de statut', evenement: true,
    fn: async () => 'se déclenche tout seul au changement de statut', quand: () => false },
  { id: 'depot_formulaire', nom: 'Formulaire reçu → dossier SharePoint, ligne de commande et BDC SEFI', flux: 'IGS - Dépôt fichiers commande + IGS - Remplissage BDC SEFI', rythme: 'à chaque formulaire', evenement: true,
    fn: async () => 'se déclenche tout seul à chaque formulaire reçu', quand: () => false },
  { id: 'sefi_envoi', nom: 'Envoi du bon de commande à SEFI', flux: 'IGS - Envoi SEFI Auto + IGS - Envoi BDC SEFI', rythme: '9 h, 11 h et 17 h', fn: async () => { const r = await require('./sefi').envoyer('Envoi automatique'); return r.raison || `lot ${r.lot} envoyé (${r.devis.join(', ')})${r.bdcVide ? '' : ' — BDC NON vidé, à vérifier'}`; },
    quand: (h, d) => [9, 11, 17].includes(h.getHours()) && (!d || Date.now() - d > 70 * 60e3) },
  { id: 'nettoyage_livrees', nom: 'Nettoyage des commandes et planches LIVRÉE', flux: 'IGS - Nettoyage commande livrees', rythme: 'chaque nuit (minuit)', fn: nettoyerLivrees,
    quand: (h, d) => h.getHours() === 0 && autreJour(h, d) },
  { id: 'demandes_mail', nom: 'Demandes de devis reçues par mail (contact@) → Commercial > Demandes', flux: '(nouveau, Leïla)', rythme: 'toutes les 5 min', fn: () => require('./demandes-mail').relever(),
    quand: (h, d) => !d || Date.now() - d > 4.5 * 60e3 },
  { id: 'demandes_accuse', nom: 'Demande de devis reçue par mail → accusé de réception au client (10 min après, lundi-vendredi)', flux: '(nouveau, Leïla)', rythme: 'toutes les 5 min', fn: () => require('./demandes-mail').accuser(),
    quand: (h, d) => !d || Date.now() - d > 4.5 * 60e3 },
  { id: 'sefi_mails', nom: 'Mail reçu de SEFI → résumé à Ismaël sur WhatsApp (réponse et remarque après son accord)', flux: '(nouveau, Leïla)', rythme: 'toutes les 5 min', fn: () => require('./sefi-mails').relever(),
    quand: (h, d) => !d || Date.now() - d > 4.5 * 60e3 },
  { id: 'factures_payees', nom: 'Facture payée (virement, TPE… rapproché) mais jamais envoyée → envoyée au client, récap à Ismaël (à partir de l\'activation, pas d\'historique)', flux: '(nouveau)', rythme: 'toutes les 30 min (7 h - 20 h)', fn: () => require('./factures-payees').verifier(),
    quand: (h, d) => !d || Date.now() - d > 29 * 60e3 },
  { id: 'devis_whatsapp', nom: 'Devis envoyé → message WhatsApp de Leïla au client (si fenêtre de 24 h ouverte)', flux: '(nouveau, Leïla)', rythme: 'toutes les 10 min', fn: () => require('./commercial').devisEnvoyesWhatsapp(),
    quand: (h, d) => !d || Date.now() - d > 9.5 * 60e3 },
  { id: 'planches_en_attente', nom: `Planches et commandes EN ATTENTE (devis non validé) supprimées après ${ATTENTE_MAX_H} h, devis annulé ; payées entre-temps → À PRÉPARER / PAYÉE`, flux: '(nouveau)', rythme: 'toutes les heures', fn: expirerPlanchesEnAttente, defaut: 'on',
    quand: (h, d) => !d || Date.now() - d > 55 * 60e3 },
  { id: 'devis_planches', nom: 'Devis planche auto', flux: 'IGS - Devis planche auto', rythme: 'toutes les 30 min', fn: devisPlanches,
    quand: (h, d) => !d || Date.now() - d > 29 * 60e3 },
  { id: 'planches_mail', nom: 'Planches reçues par mail (dossier « Planches DTF »)', flux: 'IGS - Planche DTF MAIL', rythme: 'toutes les 2 min', fn: () => require('./planches-mail').relever(),
    quand: (h, d) => !d || Date.now() - d > 110e3 },
  { id: 'paiement_planches', nom: 'Paiement des planches (devis confirmé → PAYÉE)', flux: 'IGS - statut paiement planche', rythme: 'toutes les 15 min', fn: paiementPlanches,
    quand: (h, d) => !d || Date.now() - d > 14 * 60e3 },
  { id: 'archiver_planches', nom: 'Archivage des planches imprimées (fichiers de plus de 24 h)', flux: 'IGS - Archivage planches imp', rythme: 'chaque nuit du lundi au vendredi', fn: archiverPlanches,
    // nuits de lundi à vendredi = passages du mardi au samedi vers minuit ; rien dimanche ni lundi
    quand: (h, d) => [2, 3, 4, 5, 6].includes(h.getDay()) && h.getHours() <= 1 && autreJour(h, d) },
  { id: 'vider_racine_planches', nom: 'Nettoyage du dossier Planches (fichiers de plus de 48 h)', flux: 'IGS - Vider dossier planches', rythme: 'chaque nuit (minuit)', fn: viderRacinePlanches,
    quand: (h, d) => autreJour(h, d) },
  { id: 'vider_archives_planches', nom: 'Vidage mensuel des archives de planches', flux: 'IGS - vider archive planche', rythme: 'le 8 de chaque mois (10 h), fichiers archivés depuis plus de 30 jours', fn: viderArchivesPlanches,
    // Le 8 du mois (rattrapage les jours suivants si le serveur était arrêté) ; jamais dès l'activation de la tâche
    quand: (h, d) => h.getDate() >= 8 && h.getDate() <= 15 && h.getHours() >= 10 && (d ? (heureGP(d).getMonth() !== h.getMonth() && Date.now() - d > 20 * 86400e3) : h.getDate() === 8) },  { id: 'leila_apprentissage', nom: 'Apprentissage de Leïla (compare ses réponses à celles de l’équipe, en tire des leçons ; bilan le lundi)', flux: '(nouveau)', rythme: 'chaque soir (20 h)', fn: () => require('./apprentissage').tache(), defaut: 'on',
    quand: (h, d) => h.getHours() >= 20 && autreJour(h, d) },
];

const etatMemoire = new Map(); // id -> { le, ok, resultat }
const autoMemoire = new Map(); // id -> ms du dernier passage AUTOMATIQUE (un lancement manuel ne décale pas les tâches de nuit)
async function lancer(t, par = 'automatique') {
  if (etatMemoire.get(t.id)?.enCours) throw new Error('Déjà en cours');
  etatMemoire.set(t.id, { ...(etatMemoire.get(t.id) || {}), enCours: true });
  let ok = true, resultat;
  try { resultat = await t.fn(); }
  catch (err) { ok = false; resultat = err.message; console.error(`Gestion tâche ${t.id} :`, err.message); }
  const e = { le: new Date().toISOString(), ok, resultat: String(resultat || '').slice(0, 500), par };
  etatMemoire.set(t.id, e);
  await setReglage(`tache_${t.id}_dernier`, JSON.stringify(e)).catch(() => {});
  if (par === 'automatique') { autoMemoire.set(t.id, Date.parse(e.le)); await setReglage(`tache_${t.id}_auto`, e.le).catch(() => {}); }
  if (ok) console.log(`Gestion tâche ${t.id} : ${e.resultat}`);
  return e;
}

let tourEnCours = false;
async function tour() {
  if (tourEnCours || !supabase) return;
  tourEnCours = true;
  try {
    const h = heureGP();
    for (const t of TACHES) {
      if ((await reglage(`tache_${t.id}`, t.defaut || 'off')) !== 'on') continue;
      // Dernier passage automatique : le plus récent entre la mémoire et l'enregistrement (une écriture ratée ne relance pas)
      const dernier = lireJSON(await reglage(`tache_${t.id}_dernier`, 'null'), null);
      const auto = Date.parse(await reglage(`tache_${t.id}_auto`, '')) || (dernier && dernier.par === 'automatique' ? Date.parse(dernier.le) : 0);
      const d = Math.max(auto || 0, autoMemoire.get(t.id) || 0) || null;
      // « Vider dossier planches » : vers minuit seulement
      if (t.id === 'vider_racine_planches' && h.getHours() > 1) continue;
      if (t.evenement) continue;
      if (t.quand(h, d)) await lancer(t);
    }
  } catch (err) { console.error('Gestion tâches :', err.message); }
  finally { tourEnCours = false; }
}

async function etat() {
  const out = [];
  for (const t of TACHES) {
    out.push({ id: t.id, nom: t.nom, flux: t.flux, rythme: t.rythme, evenement: !!t.evenement,
      active: (await reglage(`tache_${t.id}`, t.defaut || 'off')) === 'on',
      dernier: etatMemoire.get(t.id)?.le ? etatMemoire.get(t.id) : lireJSON(await reglage(`tache_${t.id}_dernier`, 'null'), null) });
  }
  let sefi = null;
  try { sefi = await require('./sefi').etat(); } catch {}
  return { taches: out, sefi };
}
async function activer(id, actif) {
  if (!TACHES.find(t => t.id === id)) throw new Error('Tâche inconnue');
  await setReglage(`tache_${id}`, actif ? 'on' : 'off');
  return etat();
}
async function lancerMaintenant(id, user) {
  const t = TACHES.find(x => x.id === id);
  if (!t) throw new Error('Tâche inconnue');
  return lancer(t, user);
}

function start() {
  setTimeout(() => tour().catch(() => {}), 60e3);
  setInterval(() => tour().catch(() => {}), 60e3);
}

// Planche ajoutée à la main : devis tout de suite (si la tâche « Devis planche auto » est active), sans attendre 30 min
async function devisPlancheAjoutee(p) {
  if (!p || !aDeviser(p)) return null;
  if ((await reglage('tache_devis_planches', 'off')) !== 'on') return { statut: 'tache_off' };
  try {
    const r = await planches.devis(p.cle, 'Devis automatique');
    if (r.ok) return { statut: 'envoye', numero: r.devis.numero, envoye: r.devis.envoye };
    return { statut: r.doublon ? 'doublon' : 'client', doublon: r.doublon || null };
  } catch (err) { return { statut: 'erreur', erreur: err.message }; }
}
module.exports = { devisPlancheAjoutee, start, etat, activer, lancerMaintenant, _test: { TACHES, heureGP } };
