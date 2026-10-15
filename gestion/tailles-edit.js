// ============================================
// IGS GESTION - MODIFIER LE TABLEAU DES TAILLES D'UNE COMMANDE (Tailles.xlsx) DEPUIS LA FICHE
// Lignes modifiées, ajoutées ou retirées directement dans le fichier (même fichier SharePoint, version précédente
// gardée). Pour chaque ligne : ce qui serait pris dans le stock de vierges et ce qui serait commandé chez SEFI.
// Bon de commande SEFI :
//  - commande pas encore payée : rien à faire, le BDC sera rempli au paiement avec ce tableau (stock d'abord) ;
//  - commande dans le BDC en cours (pas encore envoyé) : ses lignes sont retirées puis remises d'après le nouveau
//    tableau (stock repris en priorité, pièces remises en stock si besoin) ;
//  - déjà envoyée chez SEFI : le BDC n'est pas touché (prévenu) : passer par « Ajouter des articles » ou par SEFI.
// ============================================
const g = require('./graph');
const commandes = require('./commandes');
const { supabase } = require('./db');

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const key = s => g.norm(s).replace(/[^a-z0-9]/g, '');
const cleStatut = s => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const AVANT_PAIEMENT = ['', 'ENDEVIS', 'ENATTENTE'];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function commande(cle) {
  const { rows } = await commandes.listCommandes();
  const c = rows.find(r => r.cle === cle);
  if (!c) throw new Error('Commande introuvable : actualise et réessaie');
  if (!c.n_devis) throw new Error('Cette commande n\'a pas de N° de devis');
  return c;
}

async function lireFichier(id) {
  const r = await g.content(id);
  const buf = Buffer.from(await r.arrayBuffer());
  const values = await require('./tailles-xlsx').lireTableau(buf, process.env.SP_TABLE_TAILLES || 'LignesCommande');
  const [header = [], ...rows] = values;
  const idx = {}; header.forEach((h, i) => { idx[key(h)] = i; });
  const col = (r, ...n) => { for (const x of n) if (idx[x] !== undefined) return r[idx[x]]; return ''; };
  const lignes = rows.map(r => ({
    type: txt(col(r, 'typedeproduit', 'type')), couleur: txt(col(r, 'couleur')), quantite: Number(col(r, 'qte', 'quantite')) || 0,
    taille: txt(col(r, 'taille')).toUpperCase(), coupe: txt(col(r, 'coupe')), visuel: txt(col(r, 'nomduvisueltexte', 'nomduvisuel', 'visuel')),
    remarques: txt(col(r, 'remarques', 'remarque')),
  })).filter(l => l.type || l.quantite);
  return { buf, lignes, capacite: rows.length };
}

const versSefi = l => ({ produit: l.type, couleur: l.couleur, taille: l.taille, coupe: l.coupe, qte: l.quantite });

async function situationBdc(c) {
  const st = cleStatut(c.statut);
  if (AVANT_PAIEMENT.includes(st)) return { etat: 'avant_paiement' };
  try {
    const d = await require('./sefi').devisDansBdc(c.n_devis);
    if (d.dans) return { etat: 'dans_bdc', lignes: d.lignes.length };
  } catch (err) { return { etat: 'inconnu', erreur: err.message }; }
  return { etat: ['PAYEE', 'VALIDEE'].includes(st) ? 'pas_dans_bdc' : 'deja_commande' };
}

async function lire(cle) {
  const c = await commande(cle);
  const f = await require('./ajout').fichierTailles(c.n_devis);
  if (!f) return { fichier: false, devis: c.n_devis };
  const { lignes, capacite } = await lireFichier(f.id);
  const [apercu, bdc] = await Promise.all([require('./sefi').apercu(lignes.map(versSefi)).catch(() => []), situationBdc(c)]);
  return { fichier: true, devis: c.n_devis, statut: c.statut, lignes, capacite, apercu, bdc };
}

function nettoyer(lignes) {
  return (Array.isArray(lignes) ? lignes : []).map(l => ({
    type: txt(l.type).slice(0, 60), couleur: txt(l.couleur).slice(0, 40), taille: txt(l.taille).toUpperCase().slice(0, 10),
    coupe: txt(l.coupe).slice(0, 20), quantite: Math.max(0, Math.round(Number(String(l.quantite).replace(',', '.')) || 0)),
    visuel: txt(l.visuel).slice(0, 80), remarques: txt(l.remarques).slice(0, 160),
  })).filter(l => l.type && l.quantite > 0);
}

async function apercu(lignes) {
  return require('./sefi').apercu(nettoyer(lignes).map(versSefi));
}

const enCours = new Set();
async function enregistrer(cle, data, user) {
  if (enCours.has(cle)) throw new Error('Enregistrement déjà en cours pour cette commande');
  enCours.add(cle);
  try {
    const c = await commande(cle);
    const lignes = nettoyer(data.lignes);
    if (!lignes.length) throw new Error('Le tableau doit garder au moins une ligne (produit + quantité)');
    const f = await require('./ajout').fichierTailles(c.n_devis);
    if (!f) throw new Error('Pas de Tailles.xlsx dans le dossier de la commande');
    const { buf, lignes: avant, capacite } = await lireFichier(f.id);
    if (lignes.length > capacite) throw new Error(`Trop de lignes (${lignes.length}) : le tableau en contient ${capacite} au maximum. Regroupe des lignes.`);
    const nouveau = await require('./tailles-xlsx').ecrireLignes(buf, lignes, process.env.SP_TABLE_TAILLES || 'LignesCommande');
    await g.remplacerContenu(f.id, nouveau, XLSX);
    commandes.oublierDossier(c.n_devis);
    const etapes = [`✅ Tableau enregistré (${lignes.reduce((t, l) => t + l.quantite, 0)} pièce(s))`];

    // Bon de commande SEFI
    const bdc = await situationBdc(c);
    let resultatBdc = null;
    if (bdc.etat === 'dans_bdc' && data.bdc !== false) {
      const sefi = require('./sefi');
      const r1 = await sefi.retirerDevis(c.n_devis, user);
      try {
        resultatBdc = await sefi.remplir(c.n_devis, c.client, lignes.map(versSefi));
        etapes.push(`✅ Bon de commande SEFI mis à jour : ${resultatBdc.sefi || 0} pièce(s) à commander, ${resultatBdc.stock || 0} prise(s) dans le stock${r1.remis_en_stock ? ` (${r1.remis_en_stock} remise(s) en stock d'abord)` : ''}`);
      } catch (err) {
        etapes.push(`❌ Commande retirée du BDC SEFI mais pas remise : ${err.message}. Ajoute-la à la main dans l'onglet BDC SEFI.`);
      }
    } else if (bdc.etat === 'dans_bdc') etapes.push('ℹ️ Bon de commande SEFI non modifié (choix) : vérifie-le dans l\'onglet BDC SEFI');
    else if (bdc.etat === 'avant_paiement') etapes.push('ℹ️ Commande pas encore payée : le BDC SEFI sera rempli au paiement avec ce tableau (stock pris en priorité)');
    else if (bdc.etat === 'deja_commande') etapes.push('⚠️ Commande déjà envoyée chez SEFI : le BDC n\'est pas modifié. Pour des pièces en plus, utilise « Ajouter des articles » ; pour des pièces en moins, préviens SEFI.');
    else if (bdc.etat === 'pas_dans_bdc') etapes.push('ℹ️ La commande n\'est pas dans le BDC SEFI en cours (formulaire pas encore traité ou déjà envoyée) : vérifie l\'onglet BDC SEFI si besoin');
    else etapes.push(`⚠️ BDC SEFI non vérifié : ${bdc.erreur || '?'}`);

    if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'tailles_modifiees', cle, details: { devis: c.n_devis, avant: avant.map(l => `${l.quantite} ${l.type} ${l.couleur} ${l.taille}`), apres: lignes.map(l => `${l.quantite} ${l.type} ${l.couleur} ${l.taille}`), bdc: bdc.etat } }).then(() => {}, () => {});
    console.log(`Gestion : tableau des tailles de ${c.n_devis} modifié par ${user} (${bdc.etat})`);
    return { ok: true, etapes, bdc: resultatBdc };
  } finally { enCours.delete(cle); }
}

module.exports = { lire, apercu, enregistrer, _test: { nettoyer } };
