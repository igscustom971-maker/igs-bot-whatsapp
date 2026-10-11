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
async function tresorerie(annee, banqueOdoo = []) {
  let data = [];
  if (supabase) {
    const r = await supabase.from('gestion_qonto').select('date, montant, libelle, categorie').gte('date', `${annee - 1}-01-01`).lte('date', `${annee}-12-31`).limit(20000);
    if (!r.error) data = r.data || [];
  }
  // Priorité au relevé bancaire synchronisé dans Odoo (journal Banque) ; l'import CSV Qonto ne complète que les mois absents
  const moisOdoo = new Set(banqueOdoo.map(l => String(l.date).slice(0, 7)));
  data = [...banqueOdoo.map(l => ({ date: String(l.date).slice(0, 10), montant: l.amount, libelle: l.payment_ref || '', categorie: categorieDe(l.partner_id?.[1], l.payment_ref), source: 'odoo' })),
    ...data.filter(o => !moisOdoo.has(String(o.date).slice(0, 7))).map(o => ({ ...o, source: 'csv' }))];
  const parMois = {};
  for (const o of data) {
    if (INTERNE.test(`${o.categorie || ''} ${o.libelle || ''}`)) continue;
    const m = o.date.slice(0, 7);
    const x = parMois[m] || (parMois[m] = { entrees: 0, sorties: 0, categories: {}, source: o.source });
    if (o.montant > 0) x.entrees += o.montant; else { x.sorties += -o.montant; const c = o.categorie || 'Autres'; x.categories[c] = (x.categories[c] || 0) + -o.montant; }
  }
  for (const x of Object.values(parMois)) { x.entrees = r2(x.entrees); x.sorties = r2(x.sorties); x.net = r2(x.entrees - x.sorties); }
  return parMois;
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
  const treso = await tresorerie(annee, banque);
  const ligne = (a, i) => { const k = `${a}-${String(i + 1).padStart(2, '0')}`; const m = mois[k] || { ca: 0, achats: 0, factures: 0 }; return { mois: k, libelle: `${MOIS[i]} ${a}`, ca: r2(m.ca), achats: r2(m.achats), marge: r2(m.ca - m.achats), factures: m.factures, tresorerie: treso[k] || null }; };
  const annees = { [annee]: MOIS.map((_, i) => ligne(annee, i)), [annee - 1]: MOIS.map((_, i) => ligne(annee - 1, i)) };
  const auj = new Date(), moisCourant = auj.getFullYear() === annee ? auj.getMonth() : 11;
  const cumul = (a, jusqua) => annees[a].slice(0, jusqua + 1).reduce((s, m) => s + m.ca, 0);
  const top = new Map();
  for (const f of ventes) if (String(f.invoice_date).startsWith(String(annee)) && f.partner_id) { const k = f.partner_id[1]; top.set(k, (top.get(k) || 0) + (f.move_type === 'out_refund' ? -1 : 1) * (f.amount_untaxed || 0)); }
  const today = auj.toISOString().slice(0, 10);
  const impayes = ventes.filter(f => f.move_type === 'out_invoice' && ['not_paid', 'partial'].includes(f.payment_state) && f.invoice_date_due && f.invoice_date_due < today);
  const objectif = Number(await reglage('finances_objectif_mensuel', '0')) || 0;
  const data = {
    annee, mois_courant: moisCourant, objectif_mensuel: objectif,
    mois: annees[annee], mois_precedent_annee: annees[annee - 1],
    cumul: { annee: r2(cumul(annee, moisCourant)), annee_precedente: r2(cumul(annee - 1, moisCourant)), total_annee_precedente: r2(cumul(annee - 1, 11)) },
    top_clients: [...top].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nom, ht]) => ({ nom, ht: r2(ht) })),
    impayes: { n: impayes.length, ttc: r2(impayes.reduce((s, f) => s + (f.amount_residual || 0), 0)), liste: impayes.sort((a, b) => b.amount_residual - a.amount_residual).slice(0, 15).map(f => ({ numero: f.name, client: f.partner_id?.[1], echeance: f.invoice_date_due, reste: f.amount_residual })) },
    qonto_mois: Object.keys(treso).sort(), banque_odoo: banque.length > 0,
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
    ['Achats fournisseurs HT', eur(L.achats), 'factures fournisseurs saisies dans Odoo'],
    ['Marge brute HT', eur(L.marge), L.ca ? `${Math.round(L.marge / L.ca * 100)} % du CA` : ''],
    ['Factures émises', String(L.factures), L.factures ? `panier moyen ${eur(L.ca / L.factures)} HT` : ''],
    ['Cumul depuis janvier', eur(cumul), `${pct(cumul, cumulN1)} vs ${a - 1} à la même date`],
  ];
  if (s.objectif_mensuel) lignes.push(['Objectif du mois', eur(s.objectif_mensuel), `${Math.round(L.ca / s.objectif_mensuel * 100)} % atteint`]);
  if (t) lignes.push(['Trésorerie réelle (banque)', eur(t.net), `entrées ${eur(t.entrees)} · sorties ${eur(t.sorties)} (TTC, hors virements internes, ${t.source === 'odoo' ? 'journal Banque d\'Odoo' : 'relevé Qonto importé'})`]);
  const cats = t ? Object.entries(t.categories).sort((x, y) => y[1] - x[1]).slice(0, 8) : [];
  const html = `<div style="font:14px/1.5 Arial,sans-serif;color:#1E1E4B;max-width:640px">
<h2 style="margin:0 0 4px">Rapport ${MOIS[m - 1]} ${a} - IGS CUSTOM BAR</h2><p style="color:#68677D;margin:0 0 16px">Calculé depuis Odoo (factures validées, société IGS)${t ? ' et ton relevé Qonto' : ''}.</p>
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

module.exports = { synthese, importerQonto, rapportMensuel, setObjectif: v => setReglage('finances_objectif_mensuel', Math.max(0, Number(v) || 0)), _test: { lireQonto, parseCsv } };
