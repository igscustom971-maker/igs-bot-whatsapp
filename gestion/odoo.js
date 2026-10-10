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
    const r = await rawKw('res.company', 'search_read', [[['name', 'ilike', 'IGS']]], { fields: ['id', 'name'], limit: 1 });
    if (!r.length) throw new Error('Société IGS introuvable dans Odoo (renseigne ODOO_COMPANY_ID)');
    companyId = r[0].id;
  }
  return { lang: 'fr_FR', tz: 'America/Guadeloupe', allowed_company_ids: [companyId] };
}

async function rawKw(model, method, args, kwargs = {}) {
  return call('object', 'execute_kw', [DB, await getUid(), KEY, model, method, args, kwargs]);
}
async function kw(model, method, args, kwargs = {}) {
  return rawKw(model, method, args, { ...kwargs, context: { ...(await ctx()), ...(kwargs.context || {}) } });
}

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

const PARTNER_FIELDS = ['id', 'name', 'email', 'zip', 'state_id', 'country_id', 'phone', 'mobile'];

// Retourne { partner } ou { candidats } si le client n'est pas identifié avec certitude
async function findPartner(nom) {
  const alias = await getAlias(nom);
  if (alias) {
    const [p] = await kw('res.partner', 'read', [[alias.partner_id]], { fields: PARTNER_FIELDS });
    if (p) return { partner: p };
  }
  const exact = await kw('res.partner', 'search_read', [[['name', '=ilike', nom]]], { fields: PARTNER_FIELDS, limit: 5 });
  if (exact.length === 1) return { partner: exact[0] };
  const proches = exact.length ? exact
    : await kw('res.partner', 'search_read', [[['name', 'ilike', nom]]], { fields: PARTNER_FIELDS, limit: 10 });
  return { candidats: proches.map(p => ({ id: p.id, name: p.name, email: p.email })) };
}

async function readPartner(id) {
  const [p] = await kw('res.partner', 'read', [[id]], { fields: PARTNER_FIELDS });
  return p || null;
}

async function searchPartners(q) {
  const r = await kw('res.partner', 'search_read', [['|', ['name', 'ilike', q], ['email', 'ilike', q]]], { fields: ['id', 'name', 'email'], limit: 15 });
  return r.map(p => ({ id: p.id, name: p.name, email: p.email }));
}

function isMartinique(p) {
  const txt = k(`${p.state_id?.[1] || ''} ${p.country_id?.[1] || ''}`);
  return txt.includes('martinique') || String(p.zip || '').startsWith('972');
}

// ---------- Produits et lignes ----------
const productCache = {};
async function product(code) {
  if (productCache[code]) return productCache[code];
  const r = await kw('product.product', 'search_read', [[['default_code', '=', code]]], { fields: ['id', 'name'], limit: 1 });
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
  const r = await kw('sale.order', 'search_read', [[['partner_id', '=', partnerId], ['create_date', '>=', since]]], { fields: ['name'], limit: 1 });
  return r[0]?.name || null;
}

// Lien direct vers une fiche Odoo (devis, facture)
const lienOdoo = (model, id) => `${URL_}/web#id=${id}&model=${model}&view_type=form`;
async function lienDevis(numero) {
  const r = await kw('sale.order', 'search_read', [[['name', '=', numero]]], { fields: ['id'], limit: 1 });
  return r.length ? lienOdoo('sale.order', r[0].id) : null;
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
  configured, findPartner, readPartner, searchPartners, setAlias, isMartinique, remise,
  creerEtEnvoyerDevis, creerEtEnvoyerFacture, devisRecent, lienDevis,
};
