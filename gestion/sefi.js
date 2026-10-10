// ============================================
// IGS GESTION - BON DE COMMANDE SEFI (remplace « Remplissage BDC SEFI », « Envoi BDC SEFI » et « Envoi SEFI Auto »)
// Le bon de commande reste le classeur Excel « IGS - Bon de commande V2.xlsx » (Fournisseurs/SEFI/Commandes) :
//  - remplir(devis) : à la réception du formulaire (Tailles.xlsx), lignes ajoutées au BDC (Feuil1, DETAIL_COMMANDE,
//    DEVIS_EN_COURS), en prenant d'abord dans le stock de t-shirts vierges (décompté dans l'Excel des commandes) ;
//  - envoyer() : 9 h, 11 h, 17 h et à la demande (bouton) : récap, copie figée -> PDF -> mail SEFI + récap à contact@,
//    BDC vidé si rien n'a bougé pendant l'envoi, commandes passées EN COMMANDE.
// Logique reprise des scripts Office 1_PreparerEnvoi, 2_FigerBDC, 3_ConfirmerEnvoi, 4_PasserEnCommande,
// 5_RemplirBonDeCommande, 6_SynchroStock et 7_DecrementerStock.
// ============================================

const g = require('./graph');
const { supabase } = require('./db');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const BDC_PATH = process.env.SEFI_BDC_PATH || 'Fournisseurs/SEFI/Commandes/IGS - Bon de commande V2.xlsx';
const SEFI_EMAIL = process.env.SEFI_EMAIL || 'sefi2@orange.fr';
const RECAP_EMAIL = process.env.SEFI_RECAP_EMAIL || MAILBOX;
const F = 'Feuil1';
const TAILLES = ['TU', '2A', '4A', '6A', '8A', '10A', '12A', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const GRANDES = ['3XL', '4XL', '5XL'];
const ENFANTS = ['2A', '4A', '6A', '8A', '10A', '12A'];
const TVA = 0.085;

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const num = v => { const n = parseFloat(txt(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const maj = v => txt(v).toUpperCase();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eur = n => n.toFixed(2) + ' EUR';
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };
const gp = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
const pad = n => String(n).padStart(2, '0');
const colLettre = i => String.fromCharCode(65 + i); // 0 -> A … 16 -> Q

// ---------- Tables reprises du script 5_RemplirBonDeCommande ----------
const NORM_TAILLE = { '2XL': 'XXL', '2xl': 'XXL', xxl: 'XXL', '3xl': '3XL', '4xl': '4XL', '5xl': '5XL', tu: 'TU', xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL' };
const NORM_COULEUR = {
  'Noir Profond': 'Noir', 'Noir profond': 'Noir', 'NOIR PROFOND': 'Noir', 'Bleu Atoll': 'Bleu atoll', 'BLEU ATOLL': 'Bleu atoll',
  'Jaune citron': 'Jaune Citron', 'JAUNE CITRON': 'Jaune Citron', 'Bleu Royal': 'Royal', 'Bleu royal': 'Royal', 'BLEU ROYAL': 'Royal',
  'Kaki Fonce': 'Kaki', 'KAKI FONCE': 'Kaki', 'Violet fonce': 'Violet Fonce', 'VIOLET FONCE': 'Violet Fonce', 'Gris fonce': 'Gris Fonce',
  'GRIS FONCE': 'Gris Fonce', 'Gris clair': 'Gris Pur', 'GRIS CLAIR': 'Gris Pur', 'French marine': 'French Marine', 'FRENCH MARINE': 'French Marine',
  'Rose bonbon': 'Rose Bonbon', 'ROSE BONBON': 'Rose Bonbon', 'Vert bouteille': 'Vert Bouteille', 'VERT BOUTEILLE': 'Vert Bouteille',
  'Vert pomme': 'Vert Pomme', 'VERT POMME': 'Vert Pomme', 'Vert prairie': 'Vert Prairie', 'VERT PRAIRIE': 'Vert Prairie',
  'Kaki foncé': 'Kaki', 'Gris foncé': 'Gris Fonce', 'Violet foncé': 'Violet Fonce', 'Jaune gold': 'Jaune Gold', 'JAUNE GOLD': 'Jaune Gold', 'jaune gold': 'Jaune Gold',
};
const REFS = {
  'T-ShirtUnisexe': 'IMPERIAL', 'T-ShirtFemme': 'IMPERIAL WOMEN', 'T-Shirt Col VUnisexe': 'VICTORY', 'T-Shirt Col VFemme': 'MOON',
  'T-Shirt PolyesterUnisexe': 'SPORTY', 'T-Shirt PolyesterFemme': 'SPORTY WOMEN', 'T-Shirt Longue MancheUnisexe': 'MONARCH',
  'T-Shirt Longue MancheFemme': 'MAJESTIC', 'T-Shirt EnfantUnisexe': 'REGENT KIDS', 'T-Shirt EnfantFemme': 'REGENT KIDS',
  'DébardeurUnisexe': 'JUSTIN', 'DébardeurFemme': 'JUSTIN WOMEN', 'PoloUnisexe': 'SPRING', 'PoloFemme': 'PEOPLE',
  'Tote BagUnisexe': 'IBIZA', 'Tote BagFemme': 'IBIZA', 'CasquetteUnisexe': 'LONG BEACH', 'CasquetteFemme': 'LONG BEACH',
  'AutreUnisexe': 'AUTRE', 'AutreFemme': 'AUTRE',
};
const CODES = {
  Blanc: '102', Noir: '309', Fuchsia: '140', 'Jaune Citron': '302', 'Bleu atoll': '225', Orange: '400', 'Vert Prairie': '272',
  'French Marine': '319', Rouge: '145', Bordeaux: '146', 'Rose Bonbon': '127', 'Rose Orchidee': '136', Royal: '241', 'Vert Pomme': '280',
  Jaune: '301', 'Jaune Gold': '301', Aqua: '321', 'Gris Chine': '342', Marine: '318', Hibiscus: '168', Bleu: '205', Outremer: '238',
  Denim: '244', 'Bleu Glacier': '245', 'Bleu Petrole': '249', 'Vert Bouteille': '264', Kaki: '268', Army: '269', Emeraude: '270',
  'Gris Souris': '381', 'Gris Fonce': '384', Terre: '397', Chocolat: '398', Terracotta: '407', 'Violet Fonce': '712', 'Gris Pur': '342',
  Ciel: '220', Sable: '115',
};
const TARIFS = {
  IMPERIAL: 4.95, 'IMPERIAL WOMEN': 4.95, MONARCH: 4.95, MAJESTIC: 4.95, JUSTIN: 4.95, 'JUSTIN WOMEN': 4.95, SPRING: 10.99, PEOPLE: 10.99,
  PERFECT: 10.99, 'PERFECT WOMEN': 10.99, IBIZA: 1.87, 'LONG BEACH': 2.97, SPORTY: 0, 'SPORTY WOMEN': 0, VICTORY: 4.95, MOON: 4.95,
  'REGENT KIDS': 3.08, 'IMPERIAL KIDS': 4.39, PORTLAND: 14.85, PITCHER: 10.78,
};
const TARIFS_3XL = {
  IMPERIAL: 6.05, 'IMPERIAL WOMEN': 6.05, MONARCH: 6.05, MAJESTIC: 6.05, JUSTIN: 6.05, 'JUSTIN WOMEN': 6.05, SPRING: 16.99, PEOPLE: 16.99,
  PERFECT: 16.99, 'PERFECT WOMEN': 16.99, IBIZA: 1.87, 'LONG BEACH': 0, SPORTY: 0, 'SPORTY WOMEN': 0, VICTORY: 6.05, MOON: 6.05,
  'REGENT KIDS': 3.08, 'IMPERIAL KIDS': 4.39, PORTLAND: 14.85, PITCHER: 10.78,
};

let bdcId = null;
async function bdc() {
  if (bdcId) return bdcId;
  const it = await g.itemByPath(BDC_PATH);
  return (bdcId = it.id);
}
const lignesFeuille = async (id, sheet) => ((await g.usedRange(id, sheet))?.values || []);

// Une seule opération à la fois sur le BDC (remplissage / envoi)
let file = Promise.resolve();
const enFile = fn => { const p = file.then(fn, fn); file = p.catch(() => {}); return p; };

// ---------- Remplissage (réception du formulaire) ----------
// lignes : [{ produit, couleur, taille, coupe, qte }] lues dans Tailles.xlsx (tableau LignesCommande)
async function remplir(nDevis, nomClient, lignes) {
  return enFile(async () => {
    nDevis = nDevis || 'INCONNU'; nomClient = nomClient || 'CLIENT INCONNU';
    const id = await bdc();
    // Anti-doublon : devis déjà dans DEVIS_EN_COURS
    const devisEnCours = await lignesFeuille(id, 'DEVIS_EN_COURS');
    if (nDevis !== 'INCONNU' && devisEnCours.slice(1).some(r => txt(r[0]) === nDevis)) return { ok: true, deja: true, mouvements: [] };

    // Stock de t-shirts vierges (module stock : Excel ou base du dashboard)
    const stockMod = require('./stock');
    let stock = null;
    try { stock = await stockMod.vierges(); } catch (err) { console.error('SEFI : stock illisible (tout part chez SEFI)', err.message); }
    const restant = new Map(); // ligne de stock -> quantité restante
    const ligneStock = (refBase, couleur, taille) => {
      if (!stock) return null;
      let exact = null, inclus = null;
      for (const r of stock) {
        if (maj(r.couleur) !== maj(couleur) || maj(r.taille).replace(/^2XL$/, 'XXL') !== maj(taille)) continue;
        const s = maj(r.reference);
        if (s === maj(refBase)) { exact = r; break; }
        if (!inclus && s && s.includes(maj(refBase))) inclus = r;
      }
      return exact || inclus;
    };

    const zone = (await g.readRange(id, F, 'A17:Q48')).values; // 32 lignes, une sur deux utilisée
    const modifs = new Map(); // "A17" -> valeur
    const detail = [], mouvements = [];
    for (const l of lignes) {
      const produit = txt(l.produit);
      let couleur = txt(l.couleur);
      const coupe = txt(l.coupe) || 'Unisexe';
      const qte = num(l.qte);
      if (!produit || !couleur || qte <= 0) continue;
      const pl = produit.toLowerCase();
      if (pl === 't-shirt fourni' || pl.startsWith('autre :') || pl.startsWith('autre:')) continue;
      if (NORM_COULEUR[couleur]) couleur = NORM_COULEUR[couleur];
      let taille = txt(l.taille);
      if (!taille && (produit === 'Casquette' || produit === 'Tote Bag')) taille = 'TU';
      if (!taille) continue;
      if (NORM_TAILLE[taille]) taille = NORM_TAILLE[taille];
      const iTaille = TAILLES.indexOf(maj(taille));
      if (iTaille < 0) continue;
      const refBase = ENFANTS.includes(maj(taille)) && produit === 'T-Shirt' ? 'REGENT KIDS' : (REFS[produit + coupe] || produit.toUpperCase());
      const refComplete = `${refBase} ${couleur.toUpperCase()} ${CODES[couleur] || '???'}`;
      const prix = (GRANDES.includes(maj(taille)) ? TARIFS_3XL[refBase] : TARIFS[refBase]) || 0;

      // Stock d'abord
      const ls = ligneStock(refBase, couleur, taille);
      const dispo = ls ? (restant.has(ls) ? restant.get(ls) : num(ls.quantite)) : 0;
      const pris = Math.min(dispo, qte);
      const sefi = qte - pris;
      if (pris > 0) { restant.set(ls, dispo - pris); mouvements.push({ reference: refBase, couleur, taille, qte_prise: pris, _ligne: ls }); }

      if (sefi > 0) {
        let i = -1;
        for (let k = 0; k < 32; k += 2) if (txt(zone[k][0]) === refComplete) { i = k; break; }
        if (i < 0) for (let k = 0; k < 32; k += 2) if (!txt(zone[k][0])) { i = k; zone[k][0] = refComplete; modifs.set(`A${17 + k}`, refComplete); break; }
        if (i >= 0) {
          const v = num(zone[i][iTaille + 1]) + sefi;
          zone[i][iTaille + 1] = v;
          modifs.set(`${colLettre(iTaille + 1)}${17 + i}`, v);
        } else console.error(`SEFI : BDC plein, ${refComplete} ${taille} x${sefi} non ajouté (devis ${nDevis})`);
      }
      detail.push([nDevis, nomClient, refComplete, couleur, taille, qte, pris, sefi, prix, sefi * prix]);
    }

    for (const [adr, v] of modifs) await g.patchRange(id, F, adr, [[v]]);
    if (detail.length) {
      const d = await lignesFeuille(id, 'DETAIL_COMMANDE');
      let n = 2; while (n < d.length && txt(d[n][0])) n++; // première ligne libre à partir de la 3e (comme le script)
      await g.patchRange(id, 'DETAIL_COMMANDE', `A${n + 1}:J${n + detail.length}`, detail);
    }
    if (nDevis !== 'INCONNU') {
      let n = 1; while (n < devisEnCours.length && txt(devisEnCours[n][0])) n++;
      const now = gp();
      await g.patchRange(id, 'DEVIS_EN_COURS', `A${n + 1}:D${n + 1}`, [[nDevis, nomClient, `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`, 'EN ATTENTE']]);
    }
    // Stock décompté (7_DecrementerStock)
    for (const ls of new Set(mouvements.map(m => m._ligne))) {
      try { await stockMod.mouvementExcel('vierges', { row: ls.row, sig: ls.sig, set: Math.max(0, restant.get(ls)) }, 'BDC SEFI', `Commande ${nDevis} (${nomClient})`); }
      catch (err) { console.error(`SEFI : stock ${ls.reference} ${ls.couleur} ${ls.taille} non décompté`, err.message); }
    }
    console.log(`SEFI : BDC rempli pour ${nDevis} (${detail.length} ligne(s), ${mouvements.length} prise(s) en stock)`);
    return { ok: true, lignes: detail.length, mouvements: mouvements.map(({ _ligne, ...m }) => m) };
  });
}

// Lecture du Tailles.xlsx d'une commande (tableau LignesCommande) puis remplissage ; alerte si vide
async function remplirDepuisTailles(nDevis, nomClient, taillesItemId) {
  const r = await g.tableRange(taillesItemId, process.env.SP_TABLE_TAILLES || 'LignesCommande');
  const [entete = [], ...vals] = r.values || [];
  const i = n => entete.findIndex(h => txt(h).toLowerCase() === n.toLowerCase());
  const [ip, ic, it, icp, iq] = [i('Type de produit'), i('Couleur'), i('Taille'), i('Coupe'), i('Qté')];
  const lignes = vals.filter(v => v.some(x => txt(x))).map(v => ({ produit: v[ip], couleur: v[ic], taille: v[it], coupe: icp >= 0 ? v[icp] : '', qte: v[iq] }));
  if (!lignes.length) {
    await g.sendMail(MAILBOX, { to: MAILBOX, subject: 'Attention : tableau de commande vide', html: `<p>Le tableau est vide pour le devis ${esc(nDevis)}</p>` });
    return { ok: false, raison: 'tableau de tailles vide' };
  }
  return remplir(nDevis, nomClient, lignes);
}

// ---------- Envoi ----------
async function lireLot(id) {
  const zone = (await g.readRange(id, F, 'A17:Q48')).values;
  const bdcQ = {}, lignesSig = [];
  for (let i = 0; i < 32; i += 2) {
    const ref = txt(zone[i][0]);
    if (!ref) continue;
    const qtes = [];
    for (let c = 0; c < 16; c++) {
      const q = Math.round(num(zone[i][c + 1]));
      qtes.push(q);
      if (q > 0) { const k = `${maj(ref)}|${TAILLES[c]}`; if (bdcQ[k]) bdcQ[k].qte += q; else bdcQ[k] = { ref, taille: TAILLES[c], qte: q }; }
    }
    lignesSig.push(`${ref}:${qtes.join(',')}`);
  }
  const detail = (await lignesFeuille(id, 'DETAIL_COMMANDE')).slice(1).filter(r => txt(r[0]))
    .map(r => ({ devis: txt(r[0]), client: txt(r[1]), ref: txt(r[2]), taille: txt(r[4]), stock: Math.round(num(r[6])), sefi: Math.round(num(r[7])), prix: num(r[8]), total: num(r[9]) }));
  const devis = [], clients = {};
  (await lignesFeuille(id, 'DEVIS_EN_COURS')).slice(1).filter(r => txt(r[0])).forEach(r => { const d = txt(r[0]); if (!devis.includes(d)) devis.push(d); clients[d] = txt(r[1]); });
  detail.forEach(l => { if (!devis.includes(l.devis)) devis.push(l.devis); if (!clients[l.devis]) clients[l.devis] = l.client; });
  const signature = hash(lignesSig.join(';') + '#' + devis.join(',') + '#' + detail.length);
  return { vide: !lignesSig.length, bdcQ, detail, devis, clients, signature };
}

// Récap HTML (1_PreparerEnvoi)
async function recap(id, L, lot, dateHeure) {
  let tarifs = [];
  try {
    tarifs = (await lignesFeuille(id, 'TARIFS')).slice(1).filter(r => txt(r[0]))
      .map(r => ({ base: maj(r[0]), normal: num(r[1]), grande: num(r[2]) })).sort((a, b) => b.base.length - a.base.length);
  } catch {}
  const prixTarif = (ref, grande) => { const r = maj(ref); for (const t of tarifs) if (r === t.base || r.startsWith(t.base + ' ')) return grande ? t.grande : t.normal; return 0; };
  const prevu = {};
  L.detail.forEach(l => { if (l.sefi <= 0) return; const k = `${maj(l.ref)}|${maj(l.taille)}`; if (prevu[k]) prevu[k].qte += l.sefi; else prevu[k] = { ref: l.ref, taille: l.taille, qte: l.sefi }; });
  const manuels = [], manquants = [];
  Object.keys(L.bdcQ).forEach(k => { const d = L.bdcQ[k].qte - (prevu[k] ? prevu[k].qte : 0); if (d > 0) manuels.push({ ...L.bdcQ[k], qte: d }); });
  Object.keys(prevu).forEach(k => { const d = prevu[k].qte - (L.bdcQ[k] ? L.bdcQ[k].qte : 0); if (d > 0) manquants.push({ ...prevu[k], qte: d }); });
  const TH = '<th style="padding:4px 8px;">', TD = '<td style="padding:4px 8px;">';
  const tableau = (couleur, entetes, lignes) => `<table border="1" style="border-collapse:collapse;width:100%;"><tr style="background:${couleur};color:white;">${entetes.map(e => TH + e + '</th>').join('')}</tr>${lignes.join('')}</table>`;
  let totalSefi = 0, totalStock = 0, totalHT = 0;
  let html = `<html><body style="font-family:Arial;font-size:13px;"><h2 style="color:#1E1E4B;">RECAP COMMANDES SEFI</h2><p>Date : <b>${esc(dateHeure)}</b> &nbsp;|&nbsp; Lot : <b>${esc(lot)}</b></p>`;
  L.devis.forEach(d => {
    const ls = [], lst = []; let nS = 0, nSt = 0;
    L.detail.filter(l => l.devis === d).forEach(l => {
      nS += l.sefi; nSt += l.stock; totalHT += l.total;
      if (l.sefi > 0) ls.push(`<tr>${TD}${esc(l.ref)}</td>${TD}${esc(l.taille)}</td>${TD}${l.sefi}</td>${TD}${l.prix > 0 ? eur(l.prix) : '?'}</td>${TD}${l.total > 0 ? eur(l.total) : '?'}</td></tr>`);
      if (l.stock > 0) lst.push(`<tr>${TD}${esc(l.ref)}</td>${TD}${esc(l.taille)}</td>${TD}${l.stock}</td></tr>`);
    });
    totalSefi += nS; totalStock += nSt;
    html += `<hr><h3 style="color:#1E1E4B;">Devis : ${esc(d)} - ${esc(L.clients[d] || '')}</h3>`;
    if (ls.length) html += `<p><b>COMMANDE SEFI (${nS} unites) :</b></p>` + tableau('#1E1E4B', ['Reference', 'Taille', 'Qte', 'Prix HT', 'Total HT'], ls);
    if (lst.length) html += `<p><b>PRIS EN STOCK (${nSt} unites) :</b></p>` + tableau('#3A7C22', ['Reference', 'Taille', 'Qte'], lst);
  });
  if (manuels.length) {
    let nM = 0;
    const lm = manuels.map(m => { const prix = prixTarif(m.ref, GRANDES.includes(m.taille)); nM += m.qte; totalHT += prix * m.qte; return `<tr>${TD}${esc(m.ref)}</td>${TD}${esc(m.taille)}</td>${TD}${m.qte}</td>${TD}${prix > 0 ? eur(prix) : 'A definir'}</td>${TD}${prix > 0 ? eur(prix * m.qte) : 'A definir'}</td></tr>`; });
    totalSefi += nM;
    html += `<hr><h3 style="color:#E65C00;">AJOUT MANUEL (${nM} unites)</h3><p style="color:#E65C00;"><b>Articles ajoutés à la main dans le bon de commande</b></p>` + tableau('#E65C00', ['Reference', 'Taille', 'Qte', 'Prix HT', 'Total HT'], lm);
  }
  if (manquants.length) {
    html += '<hr><h3 style="color:#B00020;">ECART : quantités absentes du bon de commande</h3><p style="color:#B00020;"><b>Prévues dans le détail des devis mais manquantes sur le BDC envoyé</b></p>'
      + tableau('#B00020', ['Reference', 'Taille', 'Qte manquante'], manquants.map(m => `<tr>${TD}${esc(m.ref)}</td>${TD}${esc(m.taille)}</td>${TD}${m.qte}</td></tr>`));
  }
  html += `<hr><table cellpadding="8" style="background:#1E1E4B;color:white;"><tr><td>Total unites SEFI :</td><td><b>${totalSefi}</b></td></tr><tr><td>Total unites Stock :</td><td><b>${totalStock}</b></td></tr><tr><td>Total HT :</td><td><b>${eur(totalHT)}</b></td></tr><tr><td>TVA 8.5% :</td><td><b>${eur(totalHT * TVA)}</b></td></tr><tr><td>TOTAL TTC :</td><td><b>${eur(totalHT * (1 + TVA))}</b></td></tr></table><p style="color:gray;font-size:11px;">Email genere automatiquement - IGS Custom Bar</p></body></html>`;
  return html;
}

async function reglage(cle, defaut = null) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (supabase) await supabase.from('gestion_reglages').upsert({ cle, valeur, updated_at: new Date().toISOString() });
}

async function envoyer(par = 'Envoi automatique') {
  return enFile(async () => {
    // Verrou : « MANUEL » (BDC modifié pendant un envoi) bloque tout envoi jusqu'à déblocage dans Admin
    const verrou = await reglage('sefi_verrou', '');
    if (verrou) return { ok: false, verrou: true, raison: `Envoi bloqué : ${verrou}. Vérifie le BDC puis débloque dans Admin.` };
    const id = await bdc();
    const L = await lireLot(id);
    if (L.vide) return { ok: true, vide: true, raison: 'BDC vide, rien à envoyer' };
    const now = gp();
    const lot = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const dateHeure = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const recapHtml = await recap(id, L, lot, dateHeure);

    // Copie figée (2_FigerBDC) : seule la feuille du BDC, date en O1 -> PDF
    const original = await g.item(id);
    const copieId = await g.copyItem(id, original.parentReference.id, `Commande_${lot}.xlsx`, { attendre: true });
    for (const ws of await g.worksheets(copieId)) if (ws.name !== F) await g.deleteWorksheet(copieId, ws.name);
    await g.patchRange(copieId, F, 'O1', [[dateHeure.slice(0, 10)]]);
    const pdf = await g.pdf(copieId);
    try {
      const sefiDossier = await g.itemByPath(BDC_PATH.split('/').slice(0, -2).join('/') || 'Fournisseurs/SEFI');
      await g.uploadFile(sefiDossier.id, `Commande_${lot}.pdf`, pdf, 'application/pdf');
    } catch (err) { console.error('SEFI : PDF non archivé', err.message); }

    await g.sendMail(MAILBOX, {
      to: SEFI_EMAIL, subject: `[IGS CUSTOM BAR] - Bon de commande ${dateHeure.slice(0, 10)}`,
      html: '<p>Bonjour,<br><br>Veuillez trouver ci-joint la commande du jour.<br><br>Bien Cordialement,</p><p><br>IGS CUSTOM BAR</p>',
      attachments: [{ name: `Commande_${lot}.pdf`, contentType: 'application/pdf', buffer: pdf }],
    });
    await g.sendMail(MAILBOX, { to: RECAP_EMAIL, subject: `Récap commande SEFI du ${dateHeure.slice(0, 10)}`, html: recapHtml }).catch(err => console.error('SEFI : récap non envoyé', err.message));

    // 3_ConfirmerEnvoi : on vide le BDC seulement si rien n'a changé pendant l'envoi
    const apres = await lireLot(id);
    let vide = false;
    if (apres.signature === L.signature) {
      await g.clearRange(id, F, 'A17:Q48');
      await g.clearRange(id, F, 'S1:S10');
      for (const nom of ['DETAIL_COMMANDE', 'DEVIS_EN_COURS']) {
        const u = await g.usedRange(id, nom);
        if (u && u.values.length > 1) {
          const debut = (u.rowIndex || 0) + 2, fin = (u.rowIndex || 0) + u.values.length;
          const derniere = colLettre(Math.min(25, (u.columnIndex || 0) + u.values[0].length - 1));
          await g.clearRange(id, nom, `A${debut}:${derniere}${fin}`);
        }
      }
      vide = true;
    } else {
      await setReglage('sefi_verrou', `MANUEL - BDC modifié pendant l'envoi du lot ${lot}`);
      await g.sendMail(MAILBOX, { to: MAILBOX, subject: 'Commande envoyée à SEFI mais BDC non vidé : vérifie avant le prochain envoi', html: '<p>Commande envoyée à SEFI mais BDC non vidé : vérifie avant le prochain envoi (puis débloque l\'envoi dans Admin).</p>' }).catch(() => {});
    }

    // 4_PasserEnCommande : EN COMMANDE, sans jamais faire reculer un statut
    const commandes = require('./commandes');
    const ORDRE = ['ENDEVIS', 'PAYEE', 'VALIDEE', 'ENCOMMANDE', 'ENPRODUCTION', 'ENFLOCAGE', 'TERMINEE', 'AEXPEDIER', 'EXPEDIEE', 'LIVREE'];
    const k = s => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
    const { rows } = await commandes.listCommandes({ force: true });
    const passes = [];
    for (const d of L.devis) {
      const c = rows.find(r => maj(r.n_devis) === maj(d));
      if (!c || ORDRE.indexOf(k(c.statut)) >= ORDRE.indexOf('ENCOMMANDE')) continue;
      try { await commandes.modifier(c.cle, { statut: 'EN COMMANDE' }, par); passes.push(d); }
      catch (err) { console.error(`SEFI : ${d} non passé EN COMMANDE`, err.message); }
    }
    const res = { ok: true, lot, devis: L.devis, enCommande: passes, bdcVide: vide };
    await setReglage('sefi_dernier_envoi', JSON.stringify({ le: new Date().toISOString(), par, ...res }));
    if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: par, action: 'bdc_sefi_envoye', cle: lot, details: res });
    console.log(`SEFI : lot ${lot} envoyé (${L.devis.join(', ')})${vide ? '' : ' — BDC NON vidé (modifié pendant l\'envoi)'}`);
    return res;
  });
}

async function debloquer() { await setReglage('sefi_verrou', ''); return { ok: true }; }
async function etat() {
  return { verrou: await reglage('sefi_verrou', ''), dernier: JSON.parse((await reglage('sefi_dernier_envoi', 'null')) || 'null') };
}

module.exports = { remplir, remplirDepuisTailles, envoyer, debloquer, etat, _test: { lireLot, recap, hash } };
