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
    .map(p => ({ id: p.id, name: p.name, email: p.email || null, ville: p.city || null, zip: p.zip || null, score: similarite(nom, p.name) }))
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

module.exports = {
  configured, findPartner, readPartner, searchPartners, createPartner, getAlias, setAlias, isMartinique, remise,
  creerEtEnvoyerDevis, creerEtEnvoyerFacture, devisRecent, lienDevis, copierDevis, clientDuDevis, completerTelephone, formatTel,
};
