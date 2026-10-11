// ============================================
// IGS GESTION - ODOO (JSON-RPC) : devis et factures Planches DTF
// Variables Render : ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY (+ ODOO_COMPANY_ID optionnel)
// ============================================

const { supabase } = require('./db');

const URL_ = (process.env.ODOO_URL || 'https://ghs-system.odoo.com').replace(/\/$/, '');
const DB = process.env.ODOO_DB;
const LOGIN = process.env.ODOO_LOGIN;
const KEY = process.env.ODOO_API_KEY;
const DEVIS_TEMPLATE_ID = Number(process.env.ODOO_DEVIS_TEMPLATE_ID || 35);

const PRODUITS = { METRE: 'IMPDTF1M', A4: 'IMPDTFA4', A3: 'IMPDTFA3', LIVRAISON_MQ: 'MQLIVRTB' };

const configured = () => !!(DB && LOGIN && KEY);

async function call(service, method, args) {
  const res = await fetch(`${URL_}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.data?.message || data.error.message;
    throw new Error(`Odoo : ${msg}`);
  }
  return data.result;
}

let uid = null;
async function getUid() {
  if (uid) return uid;
  if (!configured()) throw new Error('Odoo non configuré sur Render (ODOO_DB, ODOO_LOGIN, ODOO_API_KEY)');
  uid = await call('common', 'authenticate', [DB, LOGIN, KEY, {}]);
  if (!uid) throw new Error('Odoo : authentification refusée (vérifie ODOO_LOGIN / ODOO_API_KEY)');
  return uid;
}

let companyId = process.env.ODOO_COMPANY_ID ? Number(process.env.ODOO_COMPANY_ID) : null;
async function ctx() {
  if (!companyId) {
    const r = await rawKw('res.company', 'search_read', [[['name', 'ilike', 'IGS']]], { fields: ['id', 'name'], limit: 5 });
    if (r.length !== 1) throw new Error(`Société IGS ${r.length ? 'ambiguë (' + r.map(c => c.id + ' ' + c.name).join(', ') + ')' : 'introuvable'} : renseigne ODOO_COMPANY_ID sur Render`);
    companyId = r[0].id;
    console.log(`Gestion Odoo : société ${r[0].name} (id ${companyId})`);
  }
  return { lang: 'fr_FR', tz: 'America/Guadeloupe', allowed_company_ids: [companyId] };
}

async function rawKw(model, method, args, kwargs = {}) {
  return call('object', 'execute_kw', [DB, await getUid(), KEY, model, method, args, kwargs]);
}
async function kw(model, method, args, kwargs = {}) {
  return rawKw(model, method, args, { ...kwargs, context: { ...(await ctx()), ...(kwargs.context || {}) } });
}

// Filtres société : uniquement IGS (ou fiches partagées entre sociétés, company_id vide)
const igsOuPartage = async () => { await ctx(); return ['|', ['company_id', '=', false], ['company_id', '=', companyId]]; };
const igsSeulement = async () => { await ctx(); return [['company_id', '=', companyId]]; };

// ---------- Clients (avec correspondances : ZePUB = Manuel KOMLHA, etc.) ----------
const k = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const aliasMem = new Map(); // repli si Supabase n'est pas configuré
async function getAlias(nom) {
  if (!supabase) return aliasMem.get(k(nom)) || null;
  const { data } = await supabase.from('gestion_clients_alias').select('*').eq('alias', k(nom)).maybeSingle();
  return data || null;
}
async function setAlias(nom, partnerId, partnerName, user) {
  if (!supabase) { aliasMem.set(k(nom), { partner_id: partnerId, partner_name: partnerName }); return; }
  const { error } = await supabase.from('gestion_clients_alias').upsert({
    alias: k(nom), nom_excel: nom, partner_id: partnerId, partner_name: partnerName, cree_par: user, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Supabase : ${error.message}`);
}

const PARTNER_FIELDS = ['id', 'name', 'email', 'zip', 'city', 'state_id', 'country_id', 'phone']; // (pas de 'mobile' : supprimé dans Odoo 19)

// ---------- Correspondance automatique nom Excel -> client Odoo ----------
// Score de ressemblance entre deux noms (0 à 1)
function similarite(a, b) {
  const ka = k(a), kb = k(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const court = ka.length < kb.length ? ka : kb, long = ka.length < kb.length ? kb : ka;
  let s = long.includes(court) ? 0.6 + 0.35 * (court.length / long.length) : 0;
  const ta = new Set(String(a).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(t => t.length >= 2));
  const tb = new Set(String(b).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(t => t.length >= 2));
  if (ta.size && tb.size) {
    const inter = [...ta].filter(t => tb.has(t)).length;
    s = Math.max(s, inter / Math.max(ta.size, tb.size) * 0.9);
  }
  return Math.round(s * 100) / 100;
}

// Suggestions Odoo classées par ressemblance (nom complet, puis mots du nom)
async function suggest(nom, limit = 8) {
  const dom = await igsOuPartage();
  const vus = new Map();
  const add = list => list.forEach(p => vus.set(p.id, p));
  add(await kw('res.partner', 'search_read', [[...dom, '|', ['name', 'ilike', nom], ['email', 'ilike', nom]]], { fields: PARTNER_FIELDS, limit: 15 }));
  const mots = String(nom).split(/[^A-Za-zÀ-ÿ0-9]+/).filter(m => m.length >= 3);
  if (vus.size < 5 && mots.length) {
    const ors = mots.map(m => ['name', 'ilike', m]);
    const domMots = ors.length > 1 ? [...Array(ors.length - 1).fill('|'), ...ors] : ors;
    add(await kw('res.partner', 'search_read', [[...dom, ...domMots]], { fields: PARTNER_FIELDS, limit: 15 }));
  }
  return [...vus.values()]
    .map(p => ({ id: p.id, name: p.name, email: p.email || null, phone: p.phone || null, ville: p.city || null, zip: p.zip || null, score: similarite(nom, p.name) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// { partner, source } si identifié (mémorisé, identique, ou correspondance sûre), sinon { candidats }
async function findPartner(nom) {
  const alias = await getAlias(nom);
  if (alias) {
    const p = await readPartner(alias.partner_id);
    if (p) return { partner: p, source: 'memorise' };
  }
  const cands = await suggest(nom);
  const [a, b] = cands;
  // Correspondance sûre : nom identique (unique), ou très ressemblant et nettement devant le suivant
  const sure = a && ((a.score === 1 && (!b || b.score < 1)) || (a.score >= 0.85 && (!b || b.score <= a.score - 0.25)));
  if (sure) {
    const p = await readPartner(a.id);
    await setAlias(nom, p.id, p.name, 'Correspondance automatique');
    return { partner: p, source: a.score === 1 ? 'identique' : 'auto' };
  }
  return { candidats: cands };
}

// Création d'une fiche client IGS (Guadeloupe ou Martinique selon le code postal)
async function createPartner({ name, email, phone, zip, city, street }) {
  name = String(name || '').trim();
  if (!name) throw new Error('Nom du client obligatoire');
  const z = String(zip || '').trim();
  const vals = { name, company_id: (await ctx(), companyId), customer_rank: 1 };
  if (email) vals.email = String(email).trim();
  if (phone) vals.phone = String(phone).trim();
  if (street) vals.street = String(street).trim();
  if (city) vals.city = String(city).trim();
  if (z) vals.zip = z;
  const code = z.startsWith('972') ? 'MQ' : z.startsWith('971') ? 'GP' : null;
  if (code) {
    const c = await kw('res.country', 'search_read', [[['code', '=', code]]], { fields: ['id'], limit: 1 });
    if (c.length) vals.country_id = c[0].id;
  }
  const id = await kw('res.partner', 'create', [vals]);
  return readPartner(id);
}

async function readPartner(id) {
  const [p] = await kw('res.partner', 'read', [[id]], { fields: PARTNER_FIELDS });
  return p || null;
}

// Écrit des champs simples sur une fiche client (ex. { phone })
async function ecrirePartner(id, valeurs) {
  const autorises = ['phone'];
  const v = Object.fromEntries(Object.entries(valeurs || {}).filter(([k]) => autorises.includes(k)));
  if (!Object.keys(v).length) throw new Error('Rien à écrire');
  await kw('res.partner', 'write', [[Number(id)], v]);
}

async function searchPartners(q) {
  if (!String(q || '').trim()) return [];
  return suggest(q, 12);
}

function isMartinique(p) {
  const txt = k(`${p.state_id?.[1] || ''} ${p.country_id?.[1] || ''}`);
  return txt.includes('martinique') || String(p.zip || '').startsWith('972');
}

// ---------- Produits et lignes ----------
const productCache = {};
async function product(code) {
  if (productCache[code]) return productCache[code];
  const r = await kw('product.product', 'search_read', [[...(await igsOuPartage()), ['default_code', '=', code]]], { fields: ['id', 'name'], limit: 1 });
  if (!r.length) throw new Error(`Produit ${code} introuvable dans Odoo`);
  return (productCache[code] = r[0]);
}

const remise = m => (m >= 20 ? 20 : m >= 10 ? 15 : 0);

// metres (nombre) ou format 'A3' / 'A4'
async function lignes({ metres, format }, partner) {
  const out = [];
  if (format) {
    out.push({ product_id: (await product(format === 'A3' ? PRODUITS.A3 : PRODUITS.A4)).id, qty: 1, discount: 0 });
  } else {
    if (!(metres > 0)) throw new Error('Métrage manquant');
    out.push({ product_id: (await product(PRODUITS.METRE)).id, qty: metres, discount: remise(metres) });
  }
  // Martinique : livraison facturée sous 4 m ou en A3/A4, offerte à partir de 4 m. Guadeloupe : jamais.
  if (isMartinique(partner) && (format || metres < 4)) {
    out.push({ product_id: (await product(PRODUITS.LIVRAISON_MQ)).id, qty: 1, discount: 0 });
  }
  return out;
}

// ---------- Envoi par mail (gabarit Odoo) ----------
async function sendWithTemplate(model, id, templateId, extraCtx = {}) {
  const wid = await kw('mail.compose.message', 'create', [{
    model, res_ids: [id], template_id: templateId, composition_mode: 'comment',
  }], { context: { active_model: model, active_id: id, active_ids: [id], default_model: model, default_res_ids: [id], default_template_id: templateId, ...extraCtx } });
  await kw('mail.compose.message', 'action_send_mail', [[wid]], { context: extraCtx });
}

let invoiceTemplateId = process.env.ODOO_FACTURE_TEMPLATE_ID ? Number(process.env.ODOO_FACTURE_TEMPLATE_ID) : null;
async function getInvoiceTemplateId() {
  if (invoiceTemplateId) return invoiceTemplateId;
  const r = await kw('ir.model.data', 'search_read', [[['module', '=', 'account'], ['name', '=', 'email_template_edi_invoice']]], { fields: ['res_id'], limit: 1 });
  if (!r.length) throw new Error('Gabarit mail facture introuvable (renseigne ODOO_FACTURE_TEMPLATE_ID)');
  return (invoiceTemplateId = r[0].res_id);
}

// ---------- Devis (planche ponctuelle) ----------
async function creerEtEnvoyerDevis({ partner, metres, format, titre, envoyer = true }) {
  const ls = await lignes({ metres, format }, partner);
  const vals = {
    partner_id: partner.id,
    company_id: companyId,
    order_line: ls.map(l => [0, 0, { product_id: l.product_id, product_uom_qty: l.qty, discount: l.discount }]),
  };
  if (titre) vals.x_studio_titre_devis = titre;
  let id;
  try {
    id = await kw('sale.order', 'create', [vals]);
  } catch (err) {
    if (titre && /x_studio_titre_devis/.test(err.message)) { delete vals.x_studio_titre_devis; id = await kw('sale.order', 'create', [vals]); }
    else throw err;
  }
  const [so] = await kw('sale.order', 'read', [[id]], { fields: ['name', 'amount_untaxed', 'amount_total'] });
  if (envoyer) await sendWithTemplate('sale.order', id, DEVIS_TEMPLATE_ID, { mark_so_as_sent: true });
  return { id, numero: so.name, montant_ht: so.amount_untaxed, montant_ttc: so.amount_total, envoye: envoyer, lien: lienOdoo('sale.order', id) };
}

// Anti-doublon : devis du même client créé il y a moins de 2 h
async function devisRecent(partnerId) {
  const since = new Date(Date.now() - 2 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  const r = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['partner_id', '=', partnerId], ['create_date', '>=', since]]], { fields: ['name'], limit: 1 });
  return r[0]?.name || null;
}

// Lien direct vers une fiche Odoo (devis, facture)
const lienOdoo = (model, id) => `${URL_}/web#id=${id}&model=${model}&view_type=form`;
async function lienDevis(numero) {
  const r = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['name', '=', numero]]], { fields: ['id'], limit: 1 });
  return r.length ? lienOdoo('sale.order', r[0].id) : null;
}

// Copie d'un devis existant (nouvelle commande à partir d'une ancienne) : brouillon, non envoyé
async function copierDevis(numero) {
  const r = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['name', '=', numero]]], { fields: ['id'], limit: 1 });
  if (!r.length) throw new Error(`Devis ${numero} introuvable dans Odoo (société IGS)`);
  const id = await kw('sale.order', 'copy', [r[0].id]);
  const [so] = await kw('sale.order', 'read', [[id]], { fields: ['name', 'amount_untaxed'] });
  return { id, numero: so.name, montant_ht: so.amount_untaxed, lien: lienOdoo('sale.order', id) };
}

// ---------- Client d'un devis (pour préremplir le formulaire, compléter le téléphone) ----------
async function clientDuDevis(numero) {
  const r = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['name', '=', numero]]], { fields: ['id', 'partner_id'], limit: 1 });
  if (!r.length || !r[0].partner_id) return null;
  const [p] = await kw('res.partner', 'read', [[r[0].partner_id[0]]], { fields: ['id', 'name', 'email', 'phone'] });
  return p || null;
}

// "590690112233" -> "+590 690 11 22 33" ; "33612345678" -> "+33 6 12 34 56 78"
function formatTel(intl) {
  const d = String(intl || '').replace(/\D/g, '');
  const m = d.match(/^(590|596|594|262|33)(\d+)$/);
  if (!m) return d ? `+${d}` : '';
  const [, cc, reste] = m;
  const tete = reste.length === 9 ? reste.slice(0, cc === '33' ? 1 : 3) : '';
  const suite = (tete ? reste.slice(tete.length) : reste).match(/.{1,2}/g) || [];
  return `+${cc} ${tete ? tete + ' ' : ''}${suite.join(' ')}`.trim();
}

// Ajoute le téléphone sur la fiche Odoo du client du devis, uniquement si elle n'en a pas
async function completerTelephone(numero, telIntl) {
  const p = await clientDuDevis(numero);
  if (!p) return { statut: 'devis_introuvable' };
  if (p.phone && String(p.phone).trim()) return { statut: 'deja_renseigne', partner: p.name };
  const phone = formatTel(telIntl);
  if (!phone) return { statut: 'pas_de_numero' };
  await kw('res.partner', 'write', [[p.id], { phone }]);
  return { statut: 'ajoute', partner: p.name, partnerId: p.id, phone };
}

// ---------- Facture hebdo ----------
async function creerEtEnvoyerFacture({ partner, metres, format, titre }) {
  const ls = await lignes({ metres, format }, partner);
  const id = await kw('account.move', 'create', [{
    move_type: 'out_invoice',
    partner_id: partner.id,
    company_id: companyId,
    ref: titre,
    invoice_line_ids: [
      [0, 0, { display_type: 'line_section', name: titre }],
      ...ls.map(l => [0, 0, { product_id: l.product_id, quantity: l.qty, discount: l.discount }]),
    ],
  }]);
  await kw('account.move', 'action_post', [[id]]);
  const [inv] = await kw('account.move', 'read', [[id]], { fields: ['name', 'amount_untaxed', 'amount_total'] });
  await sendWithTemplate('account.move', id, await getInvoiceTemplateId());
  return { id, numero: inv.name, montant_ht: inv.amount_untaxed, montant_ttc: inv.amount_total, lien: lienOdoo('account.move', id) };
}

// État d'un devis (draft, sent, sale, cancel) par son numéro ; null si introuvable
async function etatDevis(numero) {
  const r = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['name', '=', numero]]], { fields: ['state'], limit: 1 });
  return r[0]?.state || null;
}

// Fiche client par e-mail (mail de planche) ; null si aucune
// Client Odoo par numéro de téléphone (format international sans +, ex. 590690112233). Odoo enregistre
// « +590 690 11 22 33 » ou « 0690112233 » : recherche large sur la fin du numéro, puis comparaison exacte.
async function partnerParTelephone(telIntl) {
  const d = String(telIntl || '').replace(/\D/g, '');
  if (d.length < 9) return null;
  const a = d.slice(-4, -2), b = d.slice(-2);
  const r = await kw('res.partner', 'search_read', [['|', ['phone', 'ilike', `%${a} ${b}`], ['phone', 'ilike', `%${a}${b}`]]], { fields: ['id', 'name', 'email', 'phone'], limit: 80 });
  const norm = require('./commandes').normalizePhone;
  return r.find(p => norm(p.phone || '') === d) || null;
}

async function partnerParEmail(email) {
  const e = String(email || '').trim();
  if (!e || !e.includes('@')) return null;
  const r = await kw('res.partner', 'search_read', [[['email', '=ilike', e]]], { fields: ['id', 'name', 'email', 'phone'], limit: 1 });
  return r[0] || null;
}

// Commandes confirmées (payées) des 48 dernières heures, hors planches DTF : [{ name, client, infos }]
async function commandesPayeesRecentes(heures = 48) {
  const depuis = new Date(Date.now() - heures * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  const planches = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['order_line.product_id.default_code', 'in', [PRODUITS.METRE, PRODUITS.A3, PRODUITS.A4]]]], { fields: ['id'] });
  const exclus = planches.map(p => p.id);
  const so = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['state', '=', 'sale'], ['date_order', '>=', depuis], ['id', 'not in', exclus]]], { fields: ['name', 'partner_id', 'order_line'] });
  const out = [];
  for (const o of so) {
    const lignes = o.order_line.length ? await kw('sale.order.line', 'search_read', [[['id', 'in', o.order_line]]], { fields: ['product_uom_qty', 'name', 'display_type'] }) : [];
    const infos = lignes.filter(l => !l.display_type).map(l => `${l.product_uom_qty} x ${String(l.name || '').split('\n')[0]}`).join('\r\n');
    out.push({ name: o.name, client: o.partner_id ? o.partner_id[1] : '', infos });
  }
  return out;
}

// Suppression d'un devis (commande / planche supprimée dans le dashboard) : annulé puis supprimé dans Odoo.
// Jamais si une facture existe déjà (comptabilité) : le devis est alors laissé tel quel.
async function supprimerDevis(numero) {
  const n = String(numero || '').trim().toUpperCase();
  if (!/^[A-Z]{1,5}\d{3,}(-R\d+)?$/.test(n)) return { supprime: false, raison: 'pas un N° de devis' };
  const r = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['name', '=', n]]], { fields: ['id', 'state', 'invoice_ids'], limit: 1 });
  if (!r.length) return { supprime: false, raison: 'devis introuvable dans Odoo' };
  const so = r[0];
  if ((so.invoice_ids || []).length) {
    const inv = await kw('account.move', 'search_read', [[['id', 'in', so.invoice_ids], ['state', '!=', 'cancel']]], { fields: ['name'] });
    if (inv.length) return { supprime: false, raison: `déjà facturé (${inv.map(i => i.name).join(', ')}) : devis laissé dans Odoo` };
  }
  if (so.state !== 'cancel' && so.state !== 'draft') await kw('sale.order', 'action_cancel', [[so.id]], { context: { disable_cancel_warning: true } });
  await kw('sale.order', 'unlink', [[so.id]]);
  return { supprime: true };
}


// ================= MODULE COMMERCIAL =================
const PLANCHE_CODES = () => [PRODUITS.METRE, PRODUITS.A3, PRODUITS.A4];
const m2o = v => (Array.isArray(v) ? { id: v[0], nom: v[1] } : null);

// Devis et commandes IGS des N derniers jours (hors planches DTF sauf demande) pour le tableau de bord commercial
async function devisCommerciaux({ jours = 120, planches = false } = {}) {
  const depuis = new Date(Date.now() - jours * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
  const dom = [...(await igsSeulement()), ['create_date', '>=', depuis]];
  let exclus = [];
  if (!planches) {
    const pl = await kw('sale.order', 'search_read', [[...dom, ['order_line.product_id.default_code', 'in', PLANCHE_CODES()]]], { fields: ['id'] });
    exclus = pl.map(p => p.id);
  }
  const champs = ['name', 'partner_id', 'state', 'amount_untaxed', 'amount_total', 'date_order', 'create_date', 'validity_date', 'invoice_status', 'invoice_ids', 'amount_to_invoice', 'user_id'];
  let r;
  try { r = await kw('sale.order', 'search_read', [[...dom, ['id', 'not in', exclus]]], { fields: champs, order: 'create_date desc', limit: 600 }); }
  catch (err) { if (!/amount_to_invoice/.test(err.message)) throw err; r = await kw('sale.order', 'search_read', [[...dom, ['id', 'not in', exclus]]], { fields: champs.filter(c => c !== 'amount_to_invoice'), order: 'create_date desc', limit: 600 }); }
  // Factures liées (acompte déjà facturé ?)
  const invIds = [...new Set(r.flatMap(o => o.invoice_ids || []))];
  const factures = new Map();
  for (let i = 0; i < invIds.length; i += 200) {
    const f = await kw('account.move', 'read', [invIds.slice(i, i + 200)], { fields: ['id', 'name', 'state', 'move_type', 'amount_untaxed', 'amount_total', 'payment_state'] });
    for (const x of f) factures.set(x.id, x);
  }
  return r.map(o => {
    const inv = (o.invoice_ids || []).map(id => factures.get(id)).filter(f => f && f.state !== 'cancel');
    const factureHT = inv.reduce((s, f) => s + (f.move_type === 'out_refund' ? -1 : 1) * (f.amount_untaxed || 0), 0);
    return {
      id: o.id, numero: o.name, client: m2o(o.partner_id), etat: o.state, montant_ht: o.amount_untaxed, montant_ttc: o.amount_total,
      cree_le: o.create_date, date: o.date_order, validite: o.validity_date || null, facturation: o.invoice_status,
      reste_ttc: o.amount_to_invoice != null ? o.amount_to_invoice : null,
      deja_facture_ht: Math.round(factureHT * 100) / 100, factures: inv.map(f => ({ numero: f.name, etat: f.state, paiement: f.payment_state, ttc: f.amount_total })),
      lien: lienOdoo('sale.order', o.id),
    };
  });
}

// Lien client (portail) vers le devis : le client le consulte et le signe en ligne
async function lienPortailDevis(id) {
  try {
    const u = await kw('sale.order', 'get_portal_url', [[id]]);
    if (typeof u === 'string' && u) return u.startsWith('http') ? u : `${URL_}${u}`;
  } catch {}
  return null;
}
// Note dans l'historique (chatter) d'un devis
async function noteDevis(id, texte) {
  try { await kw('sale.order', 'message_post', [[id]], { body: texte, message_type: 'comment', subtype_xmlid: 'mail.mt_note' }); } catch (err) { console.error('Odoo note devis :', err.message); }
}
async function devisParNumero(numero) {
  const r = await kw('sale.order', 'search_read', [[...(await igsSeulement()), ['name', '=', numero]]], { fields: ['id', 'name', 'state', 'partner_id', 'amount_untaxed', 'amount_total', 'invoice_ids', 'invoice_status'], limit: 1 });
  return r[0] || null;
}
async function envoyerDevisOdoo(id) {
  await sendWithTemplate('sale.order', id, DEVIS_TEMPLATE_ID, { mark_so_as_sent: true });
  const [so] = await kw('sale.order', 'read', [[id]], { fields: ['name', 'state'] });
  return so;
}

// Facture du SOLDE d'une commande dont l'acompte est déjà facturé : facture « reste à facturer » d'Odoo
// (acompte déduit), validée puis envoyée au client par mail. exigerAcompte : seulement si une facture existe déjà.
async function facturerSolde(numero, { exigerAcompte = true } = {}) {
  const so = await devisParNumero(numero);
  if (!so) return { statut: 'introuvable' };
  if (so.state !== 'sale') return { statut: 'pas_confirme', etat: so.state };
  const avant = new Set(so.invoice_ids || []);
  const existantes = avant.size ? await kw('account.move', 'read', [[...avant]], { fields: ['state', 'move_type'] }) : [];
  const actives = existantes.filter(f => f.state !== 'cancel' && f.move_type === 'out_invoice');
  if (exigerAcompte && !actives.length) return { statut: 'pas_d_acompte' };
  if (actives.some(f => f.state === 'draft')) return { statut: 'brouillon_existant' };
  if (so.invoice_status === 'invoiced') return { statut: 'deja_facture' };
  const ctx = { active_model: 'sale.order', active_ids: [so.id], active_id: so.id };
  const wid = await kw('sale.advance.payment.inv', 'create', [{ advance_payment_method: 'delivered' }], { context: ctx });
  try { await kw('sale.advance.payment.inv', 'create_invoices', [[wid]], { context: ctx }); }
  catch (err) { if (/aucune ligne|no invoiceable|nothing to invoice|rien à facturer/i.test(err.message)) return { statut: 'rien_a_facturer' }; throw err; }
  const [apres] = await kw('sale.order', 'read', [[so.id]], { fields: ['invoice_ids'] });
  const nouvelles = (apres.invoice_ids || []).filter(id => !avant.has(id));
  if (!nouvelles.length) return { statut: 'rien_a_facturer' };
  const id = nouvelles[0];
  await kw('account.move', 'action_post', [[id]]);
  const [inv] = await kw('account.move', 'read', [[id]], { fields: ['name', 'amount_untaxed', 'amount_total'] });
  await sendWithTemplate('account.move', id, await getInvoiceTemplateId());
  return { statut: 'envoyee', numero: inv.name, montant_ht: inv.amount_untaxed, montant_ttc: inv.amount_total, client: so.partner_id?.[1], lien: lienOdoo('account.move', id) };
}

// Produit Odoo le plus proche d'une demande (« t-shirt », « polo »… ; variante avant/arrière selon la zone)
const MOTS_PRODUITS = [[/t.?shirt|tee.?shirt|\btee\b/i, 't-shirt'], [/polo/i, 'polo'], [/sweat|hoodie|capuche/i, 'sweat'], [/d[ée]bardeur/i, 'débardeur'], [/casquette/i, 'casquette'], [/tote/i, 'tote'], [/gobelet|timbale|eco.?cup/i, 'gobelet'], [/mug|tasse/i, 'mug'], [/maillot/i, 'maillot']];
async function produitPourDemande(produit, zone) {
  const terme = (MOTS_PRODUITS.find(([re]) => re.test(produit || '')) || [null, String(produit || '').split(/\s+/)[0]])[1];
  if (!terme) return null;
  const r = await kw('product.product', 'search_read', [[...(await igsOuPartage()), ['sale_ok', '=', true], ['name', 'ilike', terme]]], { fields: ['id', 'name', 'default_code', 'list_price'], limit: 20 });
  if (!r.length) return null;
  const deuxFaces = /arri[eè]re|dos|verso|derri[eè]re|av\s*\/?\s*ar|deux/i.test(zone || '');
  const estAvAr = p => /av\s*\/?\s*ar|avant.{0,3}arri|recto.?verso/i.test(`${p.name} ${p.default_code || ''}`);
  const perso = r.filter(p => /personnalis/i.test(p.name));
  const base = perso.length ? perso : r;
  return base.find(p => estAvAr(p) === deuxFaces) || base[0];
}

// Brouillon de devis pour une demande (client retrouvé ou créé, produit + quantité, note avec la demande)
async function brouillonDemande(d) {
  let partner = null;
  if (d.telephone) partner = await partnerParTelephone(d.telephone).catch(() => null);
  if (!partner && d.email) partner = await partnerParEmail(d.email).catch(() => null);
  if (!partner && d.nom) { const f = await findPartner(d.nom).catch(() => ({})); partner = f.partner || null; }
  let cree = false;
  if (!partner) {
    if (!d.nom) throw new Error('nom du client manquant pour créer la fiche Odoo');
    const id = await createPartner({ name: d.nom, email: d.email || undefined, phone: d.telephone ? formatTel(d.telephone) : undefined });
    partner = { id: typeof id === 'object' ? id.id : id, name: d.nom };
    cree = true;
  }
  const prod = await produitPourDemande(d.produit, d.zone).catch(() => null);
  const note = `Demande ${d.source === 'whatsapp' ? 'WhatsApp (Leïla)' : 'commerciale'} : ${[d.quantite ? d.quantite + ' x' : '', d.produit, d.zone ? '· zone ' + d.zone : '', d.details ? '· ' + d.details : ''].filter(Boolean).join(' ')}`.slice(0, 500);
  const lines = [];
  if (prod) lines.push([0, 0, { product_id: prod.id, product_uom_qty: Number(d.quantite) > 0 ? Number(d.quantite) : 1 }]);
  lines.push([0, 0, { display_type: 'line_note', name: note + (prod ? '' : ' (produit à choisir)') }]);
  const id = await kw('sale.order', 'create', [{ partner_id: partner.id, company_id: companyId, order_line: lines }]);
  const [so] = await kw('sale.order', 'read', [[id]], { fields: ['name', 'amount_untaxed', 'amount_total'] });
  return { id, numero: so.name, montant_ht: so.amount_untaxed, client: partner.name, client_cree: cree, produit: prod ? prod.name : null, lien: lienOdoo('sale.order', id) };
}

module.exports = {
  supprimerDevis, commandesPayeesRecentes, partnerParEmail, etatDevis, configured, findPartner, readPartner, searchPartners, createPartner, getAlias, setAlias, isMartinique, remise,
  creerEtEnvoyerDevis, creerEtEnvoyerFacture, devisRecent, lienDevis, copierDevis, clientDuDevis, completerTelephone, formatTel, partnerParTelephone, ecrirePartner, devisCommerciaux, lienPortailDevis, noteDevis, devisParNumero, envoyerDevisOdoo, facturerSolde, produitPourDemande, brouillonDemande,
};
