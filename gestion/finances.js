// ============================================
// IGS GESTION - CHIFFRE D'AFFAIRES ET RÉSULTATS (administrateur uniquement)
// - CA HT par mois (factures clients validées, avoirs déduits) pour l'année et l'année précédente
// - Achats HT (factures fournisseurs), marge brute = CA - achats
// - Impayés échus, meilleurs clients, objectif mensuel (réglable)
// - Relevé Qonto importé (CSV) : entrées / sorties réelles par mois et par catégorie (trésorerie)
// - Rapport du mois envoyé par mail le 1er de chaque mois (tâche « Rapport mensuel »)
// Société IGS uniquement (données Odoo filtrées sur IGS).
// ============================================

const odoo = require('./odoo');
const { supabase } = require('./db');

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const r2 = n => Math.round((n || 0) * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));

async function reglage(cle, defaut) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (!supabase) return;
  await supabase.from('gestion_reglages').upsert({ cle, valeur: String(valeur), updated_at: new Date().toISOString() });
}

// ---------- Relevé Qonto ----------
function parseCsv(texte) {
  const t = String(texte || '').replace(/^﻿/, '');
  const premiere = t.split(/\r?\n/)[0] || '';
  const sep = (premiere.match(/;/g) || []).length > (premiere.match(/,/g) || []).length ? ';' : ',';
  const lignes = []; let champ = '', ligne = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { champ += '"'; i++; } else q = false; } else champ += c; }
    else if (c === '"') q = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.filter(l => l.some(x => String(x).trim()));
}
const nombre = v => { const s = String(v ?? '').replace(/\s| |€/g, ''); if (!s) return null; const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')); return isNaN(n) ? null : n; };
function dateIso(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
function lireQonto(texte) {
  const lignes = parseCsv(texte);
  if (lignes.length < 2) throw new Error('Fichier vide ou illisible');
  const h = lignes[0].map(x => String(x).trim().toLowerCase());
  const col = (...res) => h.findIndex(x => res.some(re => re.test(x)));
  const iDate = col(/date.*op[ée]ration/, /operation date/, /date de la valeur/, /settlement date/, /^date/);
  const iMontant = col(/montant total.*ttc/, /total amount.*incl/, /^montant$/, /^amount$/, /montant/);
  const iDebit = col(/d[ée]bit/), iCredit = col(/cr[ée]dit/);
  const iLib = col(/contrepartie/, /counterparty/, /libell[ée]/, /label/, /description/, /b[ée]n[ée]ficiaire/);
  const iCat = col(/cat[ée]gorie/, /category/);
  const iStatut = col(/^statut/, /^status/);
  if (iDate < 0 || (iMontant < 0 && iDebit < 0 && iCredit < 0)) throw new Error('Colonnes date / montant introuvables : exporte le relevé Qonto au format CSV');
  const ops = [];
  for (const l of lignes.slice(1)) {
    if (iStatut >= 0 && /declin|refus|annul|cancel|reverted|rejet/i.test(l[iStatut] || '')) continue;
    const date = dateIso(l[iDate]);
    let montant = iMontant >= 0 ? nombre(l[iMontant]) : null;
    if (montant === null && (iDebit >= 0 || iCredit >= 0)) montant = (nombre(l[iCredit]) || 0) - Math.abs(nombre(l[iDebit]) || 0);
    if (!date || montant === null || montant === 0) continue;
    const libelle = String(iLib >= 0 ? l[iLib] : '').trim().slice(0, 160);
    const categorie = String(iCat >= 0 ? l[iCat] : '').trim().slice(0, 80) || null;
    ops.push({ date, montant: r2(montant), libelle, categorie, empreinte: `${date}|${r2(montant)}|${libelle.toLowerCase()}` });
  }
  if (!ops.length) throw new Error('Aucune opération reconnue dans le fichier');
  return ops;
}
async function importerQonto(texte, user) {
  if (!supabase) throw new Error('Base non configurée');
  const ops = lireQonto(texte);
  // Même date + même montant + même libellé = même opération (réimporter un relevé ne crée pas de doublon)
  const vus = new Map();
  for (const o of ops) { const n = (vus.get(o.empreinte) || 0) + 1; vus.set(o.empreinte, n); o.empreinte += `|${n}`; }
  let ajoutees = 0;
  for (let i = 0; i < ops.length; i += 300) {
    const { data, error } = await supabase.from('gestion_qonto').upsert(ops.slice(i, i + 300).map(o => ({ ...o, importe_par: user })), { onConflict: 'empreinte', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(/gestion_qonto/.test(error.message) ? 'Table Qonto absente : passe le SQL du module Finances dans Supabase' : error.message);
    ajoutees += (data || []).length;
  }
  const mois = [...new Set(ops.map(o => o.date.slice(0, 7)))].sort();
  return { lues: ops.length, ajoutees, mois };
}
const INTERNE = /virement interne|transfert interne|internal transfer|entre comptes|épargne|epargne/i;
// Catégorie d'une sortie bancaire sans catégorie (relevé Odoo) : le partenaire, sinon le début du libellé
const categorieDe = (partenaire, libelle) => partenaire || String(libelle || 'Autres').replace(/\b(CB|PRLV|VIR|SEPA|CARTE|PAIEMENT|PAYMENT|FACTURE)\b/gi, '').replace(/[0-9/*#:.-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ') || 'Autres';
// Mots du libellé à exclure du résultat réel : virements internes, apports (CCA), prêts… (modifiable dans les paramètres)
const EXCLURE_DEFAUT = ['virement interne', 'transfert interne', 'internal transfer', 'entre comptes', 'epargne', 'épargne', 'apport', 'compte courant', 'cca', 'emprunt', 'déblocage prêt', 'deblocage pret'];
async function tresorerie(annee, banqueOdoo = [], exclure = EXCLURE_DEFAUT) {
  let data = [];
  if (supabase) {
    const r = await supabase.from('gestion_qonto').select('date, montant, libelle, categorie').gte('date', `${annee - 1}-01-01`).lte('date', `${annee}-12-31`).limit(20000);
    if (!r.error) data = r.data || [];
  }
  // Priorité au relevé bancaire synchronisé dans Odoo (journal Banque) ; l'import CSV Qonto ne complète que les mois absents
  // Seulement le compte bancaire réel (Qonto, journal « Banque ») : les journaux Stripe/PayPal/SumUp sont des comptes
  // intermédiaires (fonds en attente, versements vers Qonto) qui feraient compter deux fois les mêmes encaissements.
  const INTERMEDIAIRE = /stripe|paypal|sum\s?up|payplug|lydia|attente|transit|suspens/i;
  const journaux = {};
  for (const l of banqueOdoo) { const n = l.journal_id?.[1] || 'Banque'; journaux[n] = journaux[n] || { nom: n, lignes: 0, ignore: INTERMEDIAIRE.test(n) }; journaux[n].lignes++; }
  // Mouvements internes Stripe (versement vers Qonto, fonds en attente / disponibles), quel que soit le journal où Odoo les range
  const INTERNE_STRIPE = /stripe payout|payout\s+po_|\bpo_[a-z0-9]|adding available funds|deducting pending funds|pending funds|available funds/i;
  banqueOdoo = banqueOdoo.filter(l => !INTERMEDIAIRE.test(l.journal_id?.[1] || '') && !INTERNE_STRIPE.test(l.payment_ref || ''));
  tresorerie.journaux = Object.values(journaux);
  const moisOdoo = new Set(banqueOdoo.map(l => String(l.date).slice(0, 7)));
  data = [...banqueOdoo.map(l => ({ date: String(l.date).slice(0, 10), montant: l.amount, libelle: l.payment_ref || '', categorie: categorieDe(l.partner_id?.[1], l.payment_ref), source: 'odoo' })),
    ...data.filter(o => !moisOdoo.has(String(o.date).slice(0, 7))).map(o => ({ ...o, source: 'csv' }))];
  const parMois = {};
  const mots = (exclure || []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  for (const o of data) {
    const m = o.date.slice(0, 7);
    const x = parMois[m] || (parMois[m] = { entrees: 0, sorties: 0, categories: {}, clients: {}, source: o.source, exclu: { entrees: 0, sorties: 0, lignes: [] } });
    const texte = `${o.categorie || ''} ${o.libelle || ''}`.toLowerCase();
    if (INTERNE.test(texte) || mots.some(w => texte.includes(w))) {
      if (o.montant > 0) x.exclu.entrees += o.montant; else x.exclu.sorties += -o.montant;
      if (x.exclu.lignes.length < 12) x.exclu.lignes.push({ date: o.date, montant: r2(o.montant), libelle: String(o.libelle || o.categorie || '').slice(0, 80) });
      continue;
    }
    if (o.montant > 0) { const c = o.categorie || 'Autres'; x.clients[c] = (x.clients[c] || 0) + o.montant; }
    if (o.montant > 0) x.entrees += o.montant; else { x.sorties += -o.montant; const c = o.categorie || 'Autres'; x.categories[c] = (x.categories[c] || 0) + -o.montant; }
  }
  for (const x of Object.values(parMois)) {
    x.entrees = r2(x.entrees); x.sorties = r2(x.sorties); x.net = r2(x.entrees - x.sorties);
    x.exclu.entrees = r2(x.exclu.entrees); x.exclu.sorties = r2(x.exclu.sorties);
    const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([nom, v]) => ({ nom, montant: r2(v) }));
    x.depenses = top(x.categories); x.encaissements = top(x.clients); delete x.categories; delete x.clients;
  }
  return parMois;
}

// ---------- Paramètres de gestion (objectifs, structure de coûts, CA de référence, fiches produits) ----------
// Valeurs données par Ismaël le 11/10/2026 ; modifiables dans l'onglet Chiffre d'affaires.
const PARAMS_DEFAUT = {
  taux_variables: 51.5,                                    // % du CA (ratio de juin 2026)
  // Charges fixes : un poste par ligne (loyer, électricité, abonnements…), actif à partir de « depuis » (et jusqu'à « jusqua » si renseigné)
  charges_fixes: [{ nom: 'Charges fixes (total)', depuis: '2026-09', montant: 1600 }],
  main_oeuvre: [{ depuis: '2026-08', montant: 1061, note: 'Maureen + Kelhyan' }, { depuis: '2026-10', montant: 1506, note: 'alternant + Maureen' }],
  cca: [{ depuis: '2026-01', montant: 600 }, { depuis: '2027-01', montant: 1000 }],
  phases: [
    { nom: 'Phase 1', jusqua: '2027-01', cible: 10000 },
    { nom: 'Phase 2', jusqua: '2028-01', cible: 15000, minimum: 14982, recommande: 16000, salaire_cout: 3160, salaire_net: 1700 },
  ],
  ca_source: 'saisie',
  banque_exclure: EXCLURE_DEFAUT, // 'saisie' : le CA saisi (référence) prime sur Odoo quand il est renseigné ; 'odoo' : toujours Odoo
};
const CA_SAISI_DEFAUT = { '2026-01': 3500, '2026-02': 4000, '2026-03': 3200, '2026-04': 3000, '2026-05': 6450, '2026-06': 6187, '2026-07': 5000, '2026-08': 5300, '2026-09': 3700 };
const PRODUITS_DEFAUT = [
  { nom: 'Tablier DTF (Wordans)', cout: 6.9, prix: 15, statut: 'confirmé' },
  { nom: 'Porte-clés Mineral', cout: 0.8, prix: 2, statut: 'confirmé' },
  { nom: 'Stylo Kanor (+ flocage DTF UV)', cout: 0.3, prix: 1.2, statut: 'confirmé' },
  { nom: 'Gourde', cout: 3.65, prix: 7.5, statut: 'confirmé' },
  { nom: 'Mug personnalisé', cout: null, prix: 13, statut: 'coût manquant' },
  { nom: 'Gobelet Eco Cup DTF UV', cout: null, prix: 2.3, statut: 'coût manquant' },
];
const lireJSON = (t, d) => { try { const v = JSON.parse(t); return v ?? d; } catch { return d; } };
async function parametres() {
  const [p, ca, pr] = await Promise.all([reglage('finances_params', null), reglage('finances_ca_saisi', null), reglage('finances_produits', null)]);
  return { params: { ...PARAMS_DEFAUT, ...lireJSON(p, {}) }, caSaisi: lireJSON(ca, CA_SAISI_DEFAUT), produits: lireJSON(pr, PRODUITS_DEFAUT) };
}
async function enregistrerParametres({ params, caSaisi, produits }) {
  if (params) {
    const t = Number(params.taux_variables);
    if (!(t >= 0 && t < 100)) throw new Error('Taux de charges variables invalide');
    await setReglage('finances_params', JSON.stringify(params));
  }
  if (caSaisi) {
    const propre = {};
    for (const [k, v] of Object.entries(caSaisi)) if (/^\d{4}-\d{2}$/.test(k) && v !== '' && v !== null && !isNaN(Number(v))) propre[k] = Number(v);
    await setReglage('finances_ca_saisi', JSON.stringify(propre));
  }
  if (produits) await setReglage('finances_produits', JSON.stringify(produits.filter(x => x && String(x.nom || '').trim()).map(x => ({ nom: String(x.nom).trim().slice(0, 80), cout: x.cout === '' || x.cout == null || isNaN(Number(x.cout)) ? null : Number(x.cout), prix: Number(x.prix) || 0, statut: String(x.statut || '').slice(0, 40) }))));
  cache.le = 0;
  return { ok: true };
}
// Valeur en vigueur un mois donné : dernière période commencée (0 avant la première)
const enVigueur = (liste, mois) => { const l = (liste || []).slice().sort((a, b) => a.depuis.localeCompare(b.depuis)); let v = 0; for (const x of l) if (x.depuis <= mois) v = x.montant; return Number(v) || 0; };
// Postes de charges fixes actifs ce mois-là (ils s'additionnent)
const postesDuMois = (liste, mois) => (liste || []).filter(x => (!x.depuis || x.depuis <= mois) && (!x.jusqua || x.jusqua >= mois)).map(x => ({ nom: x.nom || 'Charges fixes', montant: Number(x.montant) || 0 }));
const phaseDe = (phases, mois) => (phases || []).slice().sort((a, b) => a.jusqua.localeCompare(b.jusqua)).find(ph => mois <= ph.jusqua) || (phases || [])[phases.length - 1] || null;
function gestionDuMois(params, mois, ca) {
  const taux = (Number(params.taux_variables) || 0) / 100;
  const postes = postesDuMois(params.charges_fixes, mois);
  const fixes = postes.reduce((x, y) => x + y.montant, 0), mo = enVigueur(params.main_oeuvre, mois), cca = enVigueur(params.cca, mois);
  const couts = fixes + mo + cca;
  const ph = phaseDe(params.phases, mois);
  return {
    charges_fixes: r2(fixes), postes_fixes: postes, main_oeuvre: mo, cca, charges_variables: r2(ca * taux),
    seuil: taux < 1 ? Math.round(couts / (1 - taux)) : null,
    resultat: r2(ca * (1 - taux) - couts),
    phase: ph ? { nom: ph.nom, cible: ph.cible, minimum: ph.minimum || null, recommande: ph.recommande || null } : null,
    seuil_avec_salaire: ph && ph.salaire_cout && taux < 1 ? Math.round((couts + Number(ph.salaire_cout)) / (1 - taux)) : null,
  };
}

// ---------- Synthèse ----------
let cache = { cle: null, le: 0, data: null };
async function synthese(annee = new Date().getFullYear(), { force = false } = {}) {
  annee = Number(annee) || new Date().getFullYear();
  if (!force && cache.cle === annee && Date.now() - cache.le < 120e3) return cache.data;
  if (!odoo.configured()) throw new Error('Odoo non configuré');
  const { ventes, achats, banque = [] } = await odoo.financesMensuelles(annee);
  const mois = {};
  const cle = d => String(d).slice(0, 7);
  for (const f of ventes) { const m = mois[cle(f.invoice_date)] || (mois[cle(f.invoice_date)] = { ca: 0, achats: 0, factures: 0 }); m.ca += (f.move_type === 'out_refund' ? -1 : 1) * (f.amount_untaxed || 0); if (f.move_type === 'out_invoice') m.factures++; }
  for (const f of achats) { const m = mois[cle(f.invoice_date)] || (mois[cle(f.invoice_date)] = { ca: 0, achats: 0, factures: 0 }); m.achats += (f.move_type === 'in_refund' ? -1 : 1) * (f.amount_untaxed || 0); }
  const { params, caSaisi, produits } = await parametres();
  const treso = await tresorerie(annee, banque, params.banque_exclure);
  const ligne = (a, i) => {
    const k = `${a}-${String(i + 1).padStart(2, '0')}`; const m = mois[k] || { ca: 0, achats: 0, factures: 0 };
    const saisi = caSaisi[k] != null ? Number(caSaisi[k]) : null;
    const ca = params.ca_source === 'saisie' && saisi != null ? saisi : r2(m.ca);
    return { mois: k, libelle: `${MOIS[i]} ${a}`, ca, ca_odoo: r2(m.ca), ca_saisi: saisi, achats: r2(m.achats), marge: r2(ca - m.achats), factures: m.factures, tresorerie: treso[k] || null, gestion: gestionDuMois(params, k, ca) };
  };
  const annees = { [annee]: MOIS.map((_, i) => ligne(annee, i)), [annee - 1]: MOIS.map((_, i) => ligne(annee - 1, i)) };
  const auj = new Date(), moisCourant = auj.getFullYear() === annee ? auj.getMonth() : 11;
  const cumul = (a, jusqua) => annees[a].slice(0, jusqua + 1).reduce((s, m) => s + m.ca, 0);
  const top = new Map();
  for (const f of ventes) if (String(f.invoice_date).startsWith(String(annee)) && f.partner_id) { const k = f.partner_id[1]; top.set(k, (top.get(k) || 0) + (f.move_type === 'out_refund' ? -1 : 1) * (f.amount_untaxed || 0)); }
  const today = auj.toISOString().slice(0, 10);
  const impayes = ventes.filter(f => f.move_type === 'out_invoice' && ['not_paid', 'partial'].includes(f.payment_state) && f.invoice_date_due && f.invoice_date_due < today);
  const moisCle = `${annee}-${String(moisCourant + 1).padStart(2, '0')}`;
  const objectif = phaseDe(params.phases, moisCle)?.cible || Number(await reglage('finances_objectif_mensuel', '0')) || 0;
  const data = {
    annee, mois_courant: moisCourant, objectif_mensuel: objectif,
    mois: annees[annee], mois_precedent_annee: annees[annee - 1],
    cumul: { annee: r2(cumul(annee, moisCourant)), annee_precedente: r2(cumul(annee - 1, moisCourant)), total_annee_precedente: r2(cumul(annee - 1, 11)) },
    top_clients: [...top].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nom, ht]) => ({ nom, ht: r2(ht) })),
    impayes: { n: impayes.length, ttc: r2(impayes.reduce((s, f) => s + (f.amount_residual || 0), 0)), liste: impayes.sort((a, b) => b.amount_residual - a.amount_residual).slice(0, 15).map(f => ({ numero: f.name, client: f.partner_id?.[1], echeance: f.invoice_date_due, reste: f.amount_residual })) },
    qonto_mois: Object.keys(treso).sort(), banque_odoo: banque.length > 0, journaux_banque: tresorerie.journaux || [],
    params, ca_saisi: caSaisi,
    produits: produits.map(x => ({ ...x, marge: x.cout != null ? r2(x.prix - x.cout) : null, taux: x.cout != null && x.prix ? Math.round((x.prix - x.cout) / x.prix * 100) : null })),
  };
  cache = { cle: annee, le: Date.now(), data };
  return data;
}

// ---------- Rapport du mois (mail) ----------
async function rapportMensuel({ mois } = {}) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  const [a, m] = mois ? mois.split('-').map(Number) : [d.getFullYear(), d.getMonth() + 1];
  const s = await synthese(a, { force: true });
  const L = s.mois[m - 1], prec = m > 1 ? s.mois[m - 2] : (await synthese(a - 1, { force: true })).mois[11], n1 = s.mois_precedent_annee[m - 1];
  const cumul = s.mois.slice(0, m).reduce((x, y) => x + y.ca, 0), cumulN1 = s.mois_precedent_annee.slice(0, m).reduce((x, y) => x + y.ca, 0);
  const pct = (x, y) => (y ? `${x >= y ? '+' : ''}${Math.round((x - y) / Math.abs(y) * 100)} %` : '—');
  const t = L.tresorerie;
  const lignes = [
    ['Chiffre d\'affaires HT', eur(L.ca), `${pct(L.ca, prec.ca)} vs mois précédent · ${pct(L.ca, n1.ca)} vs ${MOIS[m - 1]} ${a - 1}`],
    ['Factures émises', String(L.factures), L.factures ? `panier moyen ${eur(L.ca / L.factures)} HT` : ''],
    ['Cumul depuis janvier', eur(cumul), `${pct(cumul, cumulN1)} vs ${a - 1} à la même date`],
  ];
  const G = L.gestion;
  if (t) lignes.splice(1, 0, ['Résultat réel du mois (banque)', eur(t.net), `encaissé ${eur(t.entrees)} − dépensé ${eur(t.sorties)} (TTC, hors virements internes, apports et prêts)`]);
  if (G.seuil) lignes.push(['Seuil de rentabilité', eur(G.seuil), L.ca >= G.seuil ? `atteint (+${eur(L.ca - G.seuil)})` : `manque ${eur(G.seuil - L.ca)}`]);
  if (!t) lignes.push(['Résultat estimé (modèle, faute de relevé bancaire)', eur(G.resultat), `CA − charges variables (${s.params.taux_variables} %) − fixes − main d'œuvre − CCA`]);
  if (G.phase) lignes.push([`Objectif ${G.phase.nom}`, eur(G.phase.cible), `${Math.round(L.ca / G.phase.cible * 100)} % atteint`]);

  const cats = t ? t.depenses.slice(0, 8).map(x => [x.nom, x.montant]) : [];
  const html = `<div style="font:14px/1.5 Arial,sans-serif;color:#1E1E4B;max-width:640px">
<h2 style="margin:0 0 4px">Rapport ${MOIS[m - 1]} ${a} - IGS CUSTOM BAR</h2><p style="color:#68677D;margin:0 0 16px">CA : factures validées Odoo (société IGS). Résultat : ta banque (Qonto), entrées − sorties.</p>
<table style="border-collapse:collapse;width:100%">${lignes.map(([l, v, c]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #eee"><b>${esc(l)}</b><div style="color:#68677D;font-size:12px">${esc(c)}</div></td><td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;font-size:16px"><b>${esc(v)}</b></td></tr>`).join('')}</table>
${cats.length ? `<h3 style="margin:20px 0 6px">Principales dépenses (banque)</h3><ul>${cats.map(([c, v]) => `<li>${esc(c)} : ${eur(v)}</li>`).join('')}</ul>` : `<p style="background:#FFF7E6;padding:10px 12px;border-radius:8px">💡 Aucune opération bancaire trouvée pour ${MOIS[m - 1]} dans le journal Banque d'Odoo. Vérifie la synchronisation Qonto dans Odoo, ou importe le relevé dans le dashboard (Commercial → Chiffre d'affaires → Importer un relevé Qonto).</p>`}
${s.top_clients.length ? `<h3 style="margin:20px 0 6px">Meilleurs clients ${a}</h3><ol>${s.top_clients.slice(0, 5).map(c => `<li>${esc(c.nom)} : ${eur(c.ht)} HT</li>`).join('')}</ol>` : ''}
${s.impayes.n ? `<h3 style="margin:20px 0 6px">Impayés échus</h3><p>${s.impayes.n} facture(s) pour ${eur(s.impayes.ttc)} TTC : ${s.impayes.liste.slice(0, 5).map(f => `${esc(f.client)} (${eur(f.reste)})`).join(', ')}</p>` : ''}
</div>`;
  const cfg = require('./config');
  const dest = (process.env.RECAP_EMAIL || cfg.ADMIN_EMAILS[0] || '').split(',').map(x => x.trim()).filter(Boolean);
  await require('./graph').sendMail((process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase(), { to: dest, subject: `Rapport ${MOIS[m - 1]} ${a} : CA ${eur(L.ca)} HT`, html });
  return { ok: true, mois: `${a}-${String(m).padStart(2, '0')}`, ca: L.ca, dest };
}

module.exports = { synthese, parametres, enregistrerParametres, importerQonto, rapportMensuel, setObjectif: v => setReglage('finances_objectif_mensuel', Math.max(0, Number(v) || 0)), _test: { lireQonto, parseCsv } };
