// ============================================
// IGS GESTION - AJOUT D'ARTICLES À UNE COMMANDE EN COURS
// Le client rajoute un ou plusieurs articles alors que sa commande est déjà payée, voire déjà commandée chez SEFI.
// Un seul bouton dans la fiche commande fait tout :
//  1. devis Odoo : nouvelle ligne au même prix que la ligne choisie (remise d'origine gardée), note dans le devis ;
//  2. Tailles.xlsx (tableau final de la commande) : lignes ajoutées, marquées « Ajout du jj/mm » ;
//  3. bon de commande SEFI : articles ajoutés (stock de vierges d'abord), partent au prochain envoi (9 h, 11 h, 17 h) ;
//  4. ligne de commande : « Informations complémentaires » relue dans Odoo + remarque « ➕ Ajout » pour l'atelier ;
//  5. paiement : commande déjà entièrement facturée -> facture de l'ajout envoyée tout de suite (lien de paiement) ;
//     commande avec acompte -> l'ajout sera dans la facture du solde.
// ============================================

const cfg = require('./config');
const g = require('./graph');
const odoo = require('./odoo');
const commandes = require('./commandes');
const { supabase } = require('./db');

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const key = s => g.norm(s).replace(/[^a-z0-9]/g, '');
const cleStatut = s => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const gp = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
const pad = n => String(n).padStart(2, '0');
const eur = n => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const prochainEnvoi = () => { const h = gp().getHours(); return h < 9 ? '9 h' : h < 11 ? '11 h' : h < 17 ? '17 h' : 'demain 9 h'; };

async function commande(cle) {
  const { rows } = await commandes.listCommandes();
  const c = rows.find(r => r.cle === cle);
  if (!c) throw new Error('Commande introuvable : actualise et réessaie');
  if (!c.n_devis) throw new Error('Cette commande n\'a pas de N° de devis');
  return c;
}

// Tailles.xlsx du dossier de la commande (sous-dossier « Tailles »)
async function fichierTailles(devis) {
  const dossier = await commandes.findCommandeFolder(devis);
  if (!dossier) return null;
  const items = await g.children(dossier.id);
  const sd = items.find(i => i.folder && key(i.name).startsWith('taille'));
  const dedans = sd ? (await g.children(sd.id)).filter(i => i.file && /\.xlsx$/i.test(i.name)) : [];
  return dedans.find(i => key(i.name).startsWith('taille')) || dedans[0] || items.find(i => i.file && /\.xlsx$/i.test(i.name) && key(i.name).startsWith('taille')) || null;
}

// Écrit les lignes dans les premières lignes VIDES du tableau LignesCommande (le modèle a des lignes vides d'avance),
// puis ajoute des lignes au tableau s'il n'y en a plus assez
async function ajouterTailles(fileId, lignes) {
  const range = await g.tableRange(fileId, cfg.TABLE_TAILLES);
  const [header, ...rows] = range.values;
  const idx = {}; header.forEach((h, i) => { idx[key(h)] = i; });
  const ordre = [['typedeproduit', 'type'], ['couleur', 'couleur'], ['qte', 'quantite'], ['taille', 'taille'], ['coupe', 'coupe'], ['nomduvisueltexte', 'visuel'], ['remarques', 'remarques']];
  const cols = ordre.map(([h]) => idx[h] ?? (h === 'nomduvisueltexte' ? idx.nomduvisuel : undefined));
  if ([0, 1, 2, 3].some(j => cols[j] === undefined)) throw new Error(`Tailles.xlsx : colonnes inattendues (${header.join(' | ')})`);
  const m = String(range.address).match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)/);
  const [, sheet, c0, r0] = m;
  const colL = n => { let s = ''; n++; while (n) { const q = (n - 1) % 26; s = String.fromCharCode(65 + q) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colI = l => l.split('').reduce((t, ch) => t * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const vides = rows.map((r, i) => (!txt(r[cols[0]]) && !Number(r[cols[2]]) ? i : -1)).filter(i => i >= 0);
  let k = 0;
  for (const l of lignes) {
    const i = vides[k++];
    if (i !== undefined) {
      for (let j = 0; j < ordre.length; j++) {
        if (cols[j] === undefined) continue;
        const v = l[ordre[j][1]] ?? '';
        await g.patchRange(fileId, sheet, `${colL(colI(c0) + cols[j])}${Number(r0) + 1 + i}`, [[v]]);
      }
    } else {
      const out = Array(header.length).fill('');
      ordre.forEach(([, f], j) => { if (cols[j] !== undefined) out[cols[j]] = l[f] ?? ''; });
      // la colonne N° (formule) éventuelle reste vide : Excel la recalcule
      await g.addTableRow(fileId, cfg.TABLE_TAILLES, out);
    }
  }
}

function nettoyer(lignes) {
  return (Array.isArray(lignes) ? lignes : []).map(l => ({
    type: txt(l.type).slice(0, 60), couleur: txt(l.couleur).slice(0, 40), taille: txt(l.taille).toUpperCase().slice(0, 10),
    coupe: txt(l.coupe).slice(0, 20) || 'Unisexe', quantite: Math.max(0, Math.round(Number(l.quantite) || 0)), visuel: txt(l.visuel).slice(0, 80), remarques: txt(l.remarques).slice(0, 160),
  })).filter(l => l.quantite > 0 && l.type);
}
const resume = lignes => lignes.map(l => `${l.quantite} x ${[l.type, l.couleur, l.taille].filter(Boolean).join(' ')}`).join(', ');

// Ce qu'il faut pour afficher le formulaire d'ajout
async function preparer(cle) {
  const c = await commande(cle);
  const so = odoo.configured() ? await odoo.lignesDevis(c.n_devis).catch(err => ({ erreur: err.message })) : { erreur: 'Odoo non configuré' };
  const st = cleStatut(c.statut);
  return {
    devis: c.n_devis, client: c.client, statut: c.statut,
    odoo: so || { erreur: `devis ${c.n_devis} introuvable dans Odoo` },
    sefi: ['', 'ENDEVIS'].includes(st) ? 'apres_paiement' : 'prochain_envoi', prochain_envoi: prochainEnvoi(),
  };
}

const enCours = new Set();
async function ajouter(cle, data, user) {
  if (enCours.has(cle)) throw new Error('Ajout déjà en cours pour cette commande');
  enCours.add(cle);
  try { return await faire(cle, data, user); } finally { enCours.delete(cle); }
}

async function faire(cle, data, user) {
  const c = await commande(cle);
  const lignes = nettoyer(data.lignes);
  if (!lignes.length) throw new Error('Ajoute au moins un article (quantité > 0)');
  const st = cleStatut(c.statut);
  if (st === 'LIVREE') throw new Error('Commande déjà livrée : fais plutôt une nouvelle commande (Dupliquer)');
  const total = lignes.reduce((t, l) => t + l.quantite, 0);
  const now = gp();
  const mention = `ajout du ${pad(now.getDate())}/${pad(now.getMonth() + 1)}`;
  lignes.forEach(l => { l.remarques = [l.remarques, mention.replace(/^a/, 'A')].filter(Boolean).join(' - '); });
  const etapes = [];
  let odooR = null, facture = null;

  // 1. Devis Odoo (le reste n'est fait que si le devis est à jour, sauf si on choisit de passer Odoo)
  if (data.ligneOdoo) {
    odooR = await odoo.ajouterLigneDevis(c.n_devis, { ligneId: data.ligneOdoo, qte: total, mention });
    await odoo.noteDevis(odooR.so_id, `➕ Ajout de ${total} article(s) par ${user} depuis IGS Dashboard : ${resume(lignes)}`);
    etapes.push(`✅ Devis ${c.n_devis} : ligne ajoutée (${total} pièce(s), ${eur(odooR.montant_ajout_ttc)} TTC) – nouveau total ${eur(odooR.total_ttc)} TTC`);
  } else etapes.push('⚠️ Devis Odoo non modifié (aucune ligne choisie) : à faire à la main');

  // 2. Tableau final (Tailles.xlsx)
  let tailles = null;
  try {
    tailles = await fichierTailles(c.n_devis);
    // Pas encore de tableau (commande refaite sans Tailles.xlsx…) : créé depuis le modèle si le dossier existe
    if (!tailles) {
      const dossier = await commandes.findCommandeFolder(c.n_devis).catch(() => null);
      if (dossier) { await require('./duplication').taillesDepuisModele(dossier.id); tailles = await fichierTailles(c.n_devis); }
    }
    if (tailles) { await ajouterTailles(tailles.id, lignes); etapes.push('✅ Tableau de la commande (Tailles.xlsx) complété'); }
    else etapes.push('⚠️ Pas de Tailles.xlsx dans le dossier (formulaire pas encore reçu ?) : le client ou l\'équipe ajoutera les articles dans le formulaire');
  } catch (err) { etapes.push(`❌ Tailles.xlsx non complété : ${err.message}`); tailles = null; }

  // 3. Bon de commande SEFI : seulement une commande payée (EN DEVIS : le BDC sera rempli au paiement avec le Tailles.xlsx complet)
  if (['', 'ENDEVIS'].includes(st)) etapes.push('ℹ️ Commande pas encore payée : les articles seront commandés chez SEFI au paiement, avec le reste');
  else if (!(await require('./depot').actif().catch(() => false))) etapes.push('⚠️ Tâche « Formulaire reçu → BDC SEFI » désactivée : ajoute les articles au bon de commande SEFI à la main');
  else if (st === 'PAYEE' && !tailles) etapes.push('ℹ️ Le BDC SEFI sera rempli à la réception du formulaire');
  else {
    try {
      const b = await require('./sefi').remplir(c.n_devis, c.client, lignes.map(l => ({ produit: l.type, couleur: l.couleur, taille: l.taille, coupe: l.coupe, qte: l.quantite })), { ajout: true });
      etapes.push(b.lignes ? `✅ Bon de commande SEFI : ${b.sefi} pièce(s) à commander${b.stock ? `, ${b.stock} prise(s) dans le stock` : ''}${b.sefi ? ` – part au prochain envoi (${prochainEnvoi()})` : ''}` : '⚠️ Rien ajouté au BDC SEFI (article non commandable chez SEFI : t-shirt fourni, « Autre »…)');
    } catch (err) { etapes.push(`❌ BDC SEFI non complété : ${err.message} – ajoute-les à la main`); }
  }

  // 4. Ligne de commande : contenu relu dans Odoo + remarque visible par l'atelier
  const champs = { remarque: [txt(c.remarque), `➕ ${mention.replace(/^a/, 'A')} : ${resume(lignes)}`].filter(Boolean).join(' | ').slice(-500) };
  if (odooR?.infos) champs.infos = odooR.infos;
  await commandes.modifier(cle, champs, user);
  etapes.push('✅ Commande mise à jour (contenu et remarque)');

  // 5. Paiement de l'ajout
  if (odooR && odooR.etat === 'sale') {
    if (odooR.facturation_avant === 'invoiced' && data.facturer !== false) {
      facture = await require('./commercial').facturerSolde(c.n_devis, user).catch(err => ({ statut: 'erreur', libelle: err.message }));
      etapes.push(facture.statut === 'envoyee' ? `✅ Facture de l'ajout ${facture.numero} (${eur(facture.montant_ttc)} TTC) envoyée au client avec le lien de paiement` : `⚠️ Facture de l'ajout non envoyée : ${facture.libelle || facture.statut} – voir Commercial > À facturer`);
    } else if (odooR.facturation_avant === 'invoiced') etapes.push('ℹ️ Facture de l\'ajout non envoyée (choix) : à faire depuis Commercial > À facturer');
    else etapes.push('ℹ️ Commande avec acompte : l\'ajout sera dans la facture du solde');
  } else if (odooR) etapes.push('ℹ️ Devis pas encore confirmé : le client paiera le devis mis à jour');

  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'commande_ajout', cle: c.n_devis, details: { client: c.client, lignes, total, odoo: odooR && { ajout_ttc: odooR.montant_ajout_ttc, total_ttc: odooR.total_ttc }, facture: facture?.numero || null } }).then(() => {}, () => {});
  console.log(`Gestion : ajout de ${total} article(s) à ${c.n_devis} par ${user}`);
  return { devis: c.n_devis, total, etapes, lien: odooR?.lien || null };
}

module.exports = { preparer, ajouter, _test: { ajouterTailles, nettoyer, prochainEnvoi } };
