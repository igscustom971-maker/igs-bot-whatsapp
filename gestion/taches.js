// ============================================
// IGS GESTION - TÂCHES AUTOMATIQUES (remplacent les flux Power Automate, un par un)
// Chaque tâche a son interrupteur dans Admin : on coupe le flux Power Automate, puis on active la tâche.
// État (activée, dernier passage, résultat) dans gestion_reglages.
// ============================================

const g = require('./graph');
const { supabase } = require('./db');
const planches = require('./planches');

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
// « Archivage planches imp » : tous les fichiers de PLANCHES A IMPRIMER -> Archives (toutes les 48 h)
async function archiverPlanches() {
  const { f, D } = await sousDossier('PLANCHES A IMPRIMER');
  const { f: arch } = await sousDossier('ARCHIVES');
  const fichiers = (await g.children(f.id, D)).filter(i => i.file);
  for (const i of fichiers) await g.moveItem(i.id, arch.id, D);
  return `${fichiers.length} fichier(s) archivé(s)`;
}
// « Vider dossier planches » : fichiers posés directement dans Technique/Planches depuis plus de 48 h -> corbeille
async function viderRacinePlanches() {
  const { root, D } = await planches.dossierPlanches();
  const vieux = (await g.children(root.id, D)).filter(i => i.file && Date.parse(i.lastModifiedDateTime) < Date.now() - 48 * 3600e3);
  for (const i of vieux) await g.deleteItem(i.id, D);
  return `${vieux.length} fichier(s) supprimé(s)`;
}
// « vider archive planche » : Archives vidé une fois par mois (corbeille SharePoint, récupérable 93 jours)
async function viderArchivesPlanches() {
  const { f, D } = await sousDossier('ARCHIVES');
  const fichiers = (await g.children(f.id, D)).filter(i => i.file);
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
// « Devis planche auto » : planches A PREPARER avec métrage, sans devis, hors clients hebdo -> devis Odoo envoyé
async function devisPlanches() {
  const { rows } = await planches.listPlanches({ force: true });
  const aFaire = rows.filter(p => statutKey(p.statut) === 'APREPARER' && !p.n_devis && !p.hebdo && p.client && (p.format || p.metres > 0));
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
  const vus = new Set(JSON.parse((await reglage('commandes_payees_vues', '[]')) || '[]'));
  const { rows } = await commandes.listCommandes({ force: true });
  const ajoutees = [];
  for (const o of liste) {
    if (vus.has(o.name)) continue;
    if (rows.some(r => String(r.n_devis || '').toUpperCase() === o.name.toUpperCase())) { vus.add(o.name); continue; }
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
// ---------- Registre ----------
// quand(h, dernier) : la tâche est-elle due ? h = heure de Guadeloupe, dernier = Date du dernier passage (ou null)
const TACHES = [
  { id: 'commandes_payees', nom: 'Commandes payées dans Odoo → ligne PAYÉE', flux: 'IGS - Commande payés Excel', rythme: 'toutes les 10 min', fn: commandesPayees,
    quand: (h, d) => !d || Date.now() - d > 9.5 * 60e3 },
  { id: 'depot_formulaire', nom: 'Formulaire reçu → dossier SharePoint, ligne de commande et BDC SEFI', flux: 'IGS - Dépôt fichiers commande + IGS - Remplissage BDC SEFI', rythme: 'à chaque formulaire', evenement: true,
    fn: async () => 'se déclenche tout seul à chaque formulaire reçu', quand: () => false },
  { id: 'sefi_envoi', nom: 'Envoi du bon de commande à SEFI', flux: 'IGS - Envoi SEFI Auto + IGS - Envoi BDC SEFI', rythme: '9 h, 11 h et 17 h', fn: async () => { const r = await require('./sefi').envoyer('Envoi automatique'); return r.raison || `lot ${r.lot} envoyé (${r.devis.join(', ')})${r.bdcVide ? '' : ' — BDC NON vidé, à vérifier'}`; },
    quand: (h, d) => [9, 11, 17].includes(h.getHours()) && (!d || Date.now() - d > 70 * 60e3) },
  { id: 'nettoyage_livrees', nom: 'Nettoyage des commandes et planches LIVRÉE', flux: 'IGS - Nettoyage commande livrees', rythme: 'chaque nuit (minuit)', fn: nettoyerLivrees,
    quand: (h, d) => h.getHours() === 0 && (!d || Date.now() - d > 20 * 3600e3) },
  { id: 'devis_planches', nom: 'Devis planche auto', flux: 'IGS - Devis planche auto', rythme: 'toutes les 30 min', fn: devisPlanches,
    quand: (h, d) => !d || Date.now() - d > 29 * 60e3 },
  { id: 'planches_mail', nom: 'Planches reçues par mail (dossier « Planches DTF »)', flux: 'IGS - Planche DTF MAIL', rythme: 'toutes les 2 min', fn: () => require('./planches-mail').relever(),
    quand: (h, d) => !d || Date.now() - d > 110e3 },
  { id: 'paiement_planches', nom: 'Paiement des planches (devis confirmé → PAYÉE)', flux: 'IGS - statut paiement planche', rythme: 'toutes les 15 min', fn: paiementPlanches,
    quand: (h, d) => !d || Date.now() - d > 14 * 60e3 },
  { id: 'archiver_planches', nom: 'Archivage des planches imprimées', flux: 'IGS - Archivage planches imp', rythme: 'toutes les 48 h (10 h)', fn: archiverPlanches,
    quand: (h, d) => h.getHours() >= 10 && (!d || Date.now() - d > 47 * 3600e3) },
  { id: 'vider_racine_planches', nom: 'Nettoyage du dossier Planches (fichiers de plus de 48 h)', flux: 'IGS - Vider dossier planches', rythme: 'chaque nuit (minuit)', fn: viderRacinePlanches,
    quand: (h, d) => !d || Date.now() - d > 23 * 3600e3 },
  { id: 'vider_archives_planches', nom: 'Vidage mensuel des archives de planches', flux: 'IGS - vider archive planche', rythme: 'le 8 de chaque mois (10 h)', fn: viderArchivesPlanches,
    quand: (h, d) => h.getDate() >= 8 && h.getHours() >= 10 && (!d || heureGP(d).getMonth() !== h.getMonth() || Date.now() - d > 32 * 86400e3) },
];

const etatMemoire = new Map(); // id -> { le, ok, resultat }
async function lancer(t, par = 'automatique') {
  if (etatMemoire.get(t.id)?.enCours) throw new Error('Déjà en cours');
  etatMemoire.set(t.id, { ...(etatMemoire.get(t.id) || {}), enCours: true });
  let ok = true, resultat;
  try { resultat = await t.fn(); }
  catch (err) { ok = false; resultat = err.message; console.error(`Gestion tâche ${t.id} :`, err.message); }
  const e = { le: new Date().toISOString(), ok, resultat: String(resultat || '').slice(0, 500), par };
  etatMemoire.set(t.id, e);
  await setReglage(`tache_${t.id}_dernier`, JSON.stringify(e)).catch(() => {});
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
      if ((await reglage(`tache_${t.id}`, 'off')) !== 'on') continue;
      const dernier = JSON.parse((await reglage(`tache_${t.id}_dernier`, 'null')) || 'null');
      const d = dernier ? Date.parse(dernier.le) : null;
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
      active: (await reglage(`tache_${t.id}`, 'off')) === 'on',
      dernier: etatMemoire.get(t.id)?.le ? etatMemoire.get(t.id) : JSON.parse((await reglage(`tache_${t.id}_dernier`, 'null')) || 'null') });
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

module.exports = { start, etat, activer, lancerMaintenant, _test: { TACHES, heureGP } };
