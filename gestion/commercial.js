// ============================================
// IGS GESTION - MODULE COMMERCIAL
// - Tableau de bord : devis en cours, à relancer, signés, reste à facturer (données Odoo)
// - Demandes de devis prises par Leïla (WhatsApp) : brouillon Odoo pré-fait, à vérifier puis envoyer
// - Relance à l'amiable d'un devis par mail (contact@), notée dans l'historique Odoo du devis
// - Facture du solde envoyée automatiquement quand une commande avec acompte passe en TERMINÉE / À EXPÉDIER
// Accès : profils admin et commercial.
// ============================================

const odoo = require('./odoo');
const g = require('./graph');
const { supabase } = require('./db');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const RELANCE_JOURS = Number(process.env.COMMERCIAL_RELANCE_JOURS || 5); // devis sans réponse depuis N jours = à relancer
const EN_COURS_JOURS = Number(process.env.COMMERCIAL_EN_COURS_JOURS || 45); // au-delà, un devis sans réponse n'est plus « en cours »
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Odoo : « 2026-10-09 14:00:00 » (UTC sans fuseau) ; Supabase : « …+00:00 » ou « …Z »
const jours = d => { if (!d) return null; const v = String(d).replace(' ', 'T'); const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(v) || v.length <= 10 ? v : v + 'Z'); return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400e3); };

async function journal(user, action, cle, details) {
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action, cle, details }).then(() => {}, () => {});
}

// Relances déjà faites : { numero: { n, derniere } }
async function relances(numeros) {
  if (!supabase || !numeros.length) return {};
  const out = {};
  for (let i = 0; i < numeros.length; i += 150) {
    const { data } = await supabase.from('gestion_actions').select('cle, cree_le').eq('action', 'devis_relance').in('cle', numeros.slice(i, i + 150));
    for (const r of data || []) {
      const o = out[r.cle] || (out[r.cle] = { n: 0, derniere: null });
      o.n++;
      if (!o.derniere || r.cree_le > o.derniere) o.derniere = r.cree_le;
    }
  }
  return out;
}

let cache = { le: 0, data: null };
async function tableauDeBord({ force = false } = {}) {
  if (!odoo.configured()) throw new Error('Odoo non configuré');
  if (!force && cache.data && Date.now() - cache.le < 60e3) return cache.data;
  const tous = await odoo.devisCommerciaux({ jours: 180 });
  const rel = await relances(tous.map(d => d.numero));
  // Statut de la commande dans le dashboard (atelier)
  let parDevis = new Map();
  try { parDevis = new Map(((await require('./commandes').listCommandes()).rows || []).filter(c => c.n_devis).map(c => [c.n_devis.toUpperCase(), c])); } catch {}
  const enrichi = tous.map(d => {
    const r = rel[d.numero] || { n: 0, derniere: null };
    const c = parDevis.get(d.numero.toUpperCase());
    const age = jours(d.date || d.cree_le);
    const depuisRelance = r.derniere ? jours(r.derniere) : null;
    return {
      ...d, age, relances: r.n, derniere_relance: r.derniere, atelier: c ? c.statut : null,
      a_relancer: ['draft', 'sent'].includes(d.etat) && d.etat === 'sent' && age >= RELANCE_JOURS && (depuisRelance === null || depuisRelance >= RELANCE_JOURS),
    };
  });
  const tousEnCours = enrichi.filter(d => ['draft', 'sent'].includes(d.etat));
  const enCours = tousEnCours.filter(d => (d.age ?? 0) <= EN_COURS_JOURS);
  const anciens = tousEnCours.length - enCours.length;
  const signes = enrichi.filter(d => d.etat === 'sale');
  const resteAFacturer = signes.filter(d => d.facturation === 'to invoice' || (d.reste_ttc != null && d.reste_ttc > 0.5));
  const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
  const signesMois = signes.filter(d => Date.parse(String(d.date).replace(' ', 'T') + 'Z') >= debutMois.getTime());
  const il90 = Date.now() - 90 * 86400e3;
  const crees90 = enrichi.filter(d => Date.parse(String(d.cree_le).replace(' ', 'T') + 'Z') >= il90 && d.etat !== 'draft');
  const somme = l => Math.round(l.reduce((s, d) => s + (d.montant_ht || 0), 0) * 100) / 100;
  const data = {
    le: new Date().toISOString(), relance_jours: RELANCE_JOURS, en_cours_jours: EN_COURS_JOURS, anciens_masques: anciens,
    kpi: {
      en_cours: { n: enCours.length, ht: somme(enCours) },
      a_relancer: enCours.filter(d => d.a_relancer).length,
      signes_mois: { n: signesMois.length, ht: somme(signesMois) },
      transformation_90j: crees90.length ? Math.round(crees90.filter(d => d.etat === 'sale').length / crees90.length * 100) : null,
      panier_moyen_ht: signes.length ? Math.round(somme(signes) / signes.length) : null,
      reste_a_facturer: { n: resteAFacturer.length, ttc: Math.round(resteAFacturer.reduce((s, d) => s + (d.reste_ttc || 0), 0) * 100) / 100 },
    },
    en_cours: enCours,
    signes: signes.slice(0, 80),
    reste_a_facturer: resteAFacturer,
    demandes: await demandes(),
  };
  cache = { le: Date.now(), data };
  return data;
}

// ---------- Demandes de devis (Leïla) ----------
async function demandes() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('gestion_demandes').select('*').in('statut', ['nouvelle', 'brouillon', 'erreur']).order('cree_le', { ascending: false }).limit(100);
  if (error) return [];
  return data || [];
}

// Nouvelle demande (Leïla) : enregistrée, puis brouillon Odoo pré-fait (client retrouvé/créé, produit, quantité)
async function nouvelleDemande(d, par = 'Leïla (WhatsApp)') {
  if (!supabase) return null;
  const row = {
    source: d.source || 'whatsapp', telephone: d.telephone || null, nom: (d.nom || '').slice(0, 120) || null, email: (d.email || '').slice(0, 160) || null,
    produit: (d.produit || '').slice(0, 120) || null, quantite: Number(d.quantite) > 0 ? Number(d.quantite) : null, zone: (d.zone || '').slice(0, 80) || null,
    details: (d.details || '').slice(0, 600) || null, statut: 'nouvelle',
  };
  // Même client, même produit dans les 6 h : on complète la demande existante plutôt que d'en créer une 2e
  if (row.telephone) {
    const { data: ex } = await supabase.from('gestion_demandes').select('*').eq('telephone', row.telephone).in('statut', ['nouvelle', 'brouillon']).gte('cree_le', new Date(Date.now() - 6 * 3600e3).toISOString()).order('cree_le', { ascending: false }).limit(1);
    if (ex && ex[0] && (!row.produit || !ex[0].produit || ex[0].produit.toLowerCase() === row.produit.toLowerCase())) {
      console.log(`Commercial : demande déjà enregistrée pour ${row.telephone} (${ex[0].devis_numero || 'sans brouillon'})`);
      return ex[0];
    }
  }
  const { data: ins, error } = await supabase.from('gestion_demandes').insert(row).select().single();
  if (error) { console.error('Commercial demande :', error.message); return null; }
  await preparerBrouillon(ins.id, par).catch(() => {});
  cache.le = 0;
  return ins;
}

async function preparerBrouillon(id, par, nom) {
  const { data: d } = await supabase.from('gestion_demandes').select('*').eq('id', id).maybeSingle();
  if (!d) throw new Error('Demande introuvable');
  if (nom && String(nom).trim() && String(nom).trim() !== d.nom) { d.nom = String(nom).trim().slice(0, 120); await supabase.from('gestion_demandes').update({ nom: d.nom }).eq('id', id); }
  if (d.devis_id) return d;
  try {
    if (!odoo.configured()) throw new Error('Odoo non configuré');
    const so = await odoo.brouillonDemande(d);
    await supabase.from('gestion_demandes').update({ statut: 'brouillon', devis_id: so.id, devis_numero: so.numero, erreur: null }).eq('id', id);
    await journal(par, 'demande_brouillon', so.numero, { demande: id, client: so.client, client_cree: so.client_cree, produit: so.produit });
    console.log(`Commercial : brouillon ${so.numero} préparé pour ${so.client}${so.produit ? ' (' + so.produit + ')' : ' (produit à choisir)'}`);
    return { ...d, statut: 'brouillon', devis_id: so.id, devis_numero: so.numero };
  } catch (err) {
    await supabase.from('gestion_demandes').update({ statut: 'erreur', erreur: err.message.slice(0, 300) }).eq('id', id);
    cache.le = 0;
    throw err;
  }
}

async function envoyerDemande(id, user) {
  const { data: d } = await supabase.from('gestion_demandes').select('*').eq('id', id).maybeSingle();
  if (!d || !d.devis_id) throw new Error('Pas de brouillon Odoo pour cette demande');
  const so = await odoo.envoyerDevisOdoo(d.devis_id);
  await supabase.from('gestion_demandes').update({ statut: 'envoye', traite_par: user, traite_le: new Date().toISOString() }).eq('id', id);
  await journal(user, 'demande_devis_envoye', so.name, { demande: id });
  cache.le = 0;
  return { ok: true, numero: so.name };
}
async function abandonnerDemande(id, user) {
  await supabase.from('gestion_demandes').update({ statut: 'abandonnee', traite_par: user, traite_le: new Date().toISOString() }).eq('id', id);
  cache.le = 0;
  return { ok: true };
}

// ---------- Relance à l'amiable ----------
async function relancer(numero, user, message) {
  const so = await odoo.devisParNumero(numero);
  if (!so) throw new Error('Devis introuvable');
  if (!['draft', 'sent'].includes(so.state)) throw new Error('Ce devis n\'est plus en attente');
  const p = await odoo.readPartner(so.partner_id[0]);
  if (!p?.email) throw new Error(`Pas d'e-mail sur la fiche Odoo de ${so.partner_id[1]}`);
  const lien = await odoo.lienPortailDevis(so.id);
  const prenom = String(p.name || '').split(/\s+/)[0];
  const texte = String(message || '').trim() || `Bonjour${prenom ? ' ' + prenom : ''},\n\nJe me permets de revenir vers vous concernant votre devis ${so.name}. Avez-vous pu en prendre connaissance ?\n\nSi vous avez la moindre question ou une modification à apporter (quantités, visuel, tailles…), n'hésitez pas à me répondre directement, je m'en occupe.\n\nBelle journée,\nL'équipe IGS CUSTOM BAR`;
  const html = `<div style="font:14px/1.6 Arial,sans-serif;color:#1E1E4B">${esc(texte).replace(/\n/g, '<br>')}${lien ? `<p style="margin:22px 0"><a href="${esc(lien)}" style="background:#FF1E8E;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Voir mon devis ${esc(so.name)}</a></p>` : ''}</div>`;
  await g.sendMail(MAILBOX, { to: p.email, subject: `Votre devis ${so.name} - IGS CUSTOM BAR`, html });
  await odoo.noteDevis(so.id, `Relance à l'amiable envoyée par mail à ${esc(p.email)} depuis le dashboard (${esc(user)}).`);
  await journal(user, 'devis_relance', so.name, { email: p.email, client: p.name });
  cache.le = 0;
  console.log(`Commercial : relance du devis ${so.name} envoyée à ${p.email} par ${user}`);
  return { ok: true, email: p.email };
}

// ---------- Facture du solde ----------
const LIB_SOLDE = { introuvable: 'devis introuvable dans Odoo', pas_confirme: 'devis pas encore confirmé', pas_d_acompte: 'pas d\'acompte facturé', brouillon_existant: 'une facture brouillon existe déjà dans Odoo', deja_facture: 'déjà entièrement facturé', rien_a_facturer: 'rien à facturer', pas_d_email: 'pas d\'e-mail sur la fiche client Odoo', en_cours: 'facture déjà en cours de création' };
const soldeEnCours = new Set(); // verrou par devis : bouton manuel et passage automatique ne facturent jamais deux fois
async function facturerSolde(numero, user, { auto = false } = {}) {
  const cleV = String(numero || '').trim().toUpperCase();
  if (soldeEnCours.has(cleV)) return { statut: 'en_cours', libelle: LIB_SOLDE.en_cours };
  soldeEnCours.add(cleV);
  let r;
  try { r = await odoo.facturerSolde(numero, { exigerAcompte: auto }); }
  finally { soldeEnCours.delete(cleV); }
  if (r.statut === 'envoyee') {
    await journal(user, 'facture_solde_envoyee', numero, { facture: r.numero, ttc: r.montant_ttc, auto });
    console.log(`Commercial : facture du solde ${r.numero} (${r.montant_ttc} € TTC) envoyée pour ${numero}${auto ? ' (automatique)' : ''}`);
    cache.le = 0;
  }
  return { ...r, libelle: LIB_SOLDE[r.statut] || null };
}

// Appelé quand une commande change de statut (atelier) : TERMINÉE / À EXPÉDIER -> facture du solde si acompte
async function surStatutCommande(c, nouveauStatut, par) {
  try {
    const st = String(nouveauStatut || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!['TERMINEE', 'AEXPEDIER'].includes(st) || !c?.n_devis || !odoo.configured()) return;
    if ((await require('./notifications').reglage('tache_facture_solde', 'off')) !== 'on') return;
    const r = await facturerSolde(c.n_devis, `${par} (automatique)`, { auto: true });
    if (r.statut !== 'envoyee' && !['pas_d_acompte', 'deja_facture', 'pas_confirme', 'en_cours'].includes(r.statut)) {
      // Cas à regarder à la main : prévenir par mail
      await g.sendMail(MAILBOX, { to: MAILBOX, subject: `Facture du solde non envoyée - ${c.n_devis} - ${c.client || ''}`, html: `<p>La commande ${esc(c.n_devis)} (${esc(c.client || '')}) est passée en ${esc(nouveauStatut)}, mais la facture du solde n'a pas pu partir : <b>${esc(r.libelle || r.statut)}</b>.</p><p>À vérifier dans Odoo.</p>` }).catch(() => {});
    }
  } catch (err) {
    console.error(`Commercial : facture du solde ${c?.n_devis} :`, err.message);
    g.sendMail(MAILBOX, { to: MAILBOX, subject: `Facture du solde en erreur - ${c?.n_devis}`, html: `<p>Erreur lors de la facture du solde de ${esc(c?.n_devis)} : ${esc(err.message)}</p>` }).catch(() => {});
  }
}


// ---------- Clients à réactiver ----------
let cacheReac = { le: 0, data: null };
async function clientsAReactiver({ force = false } = {}) {
  if (!force && cacheReac.data && Date.now() - cacheReac.le < 10 * 60e3) return cacheReac.data;
  const liste = await odoo.clientsAReactiver();
  const rel = {};
  if (supabase && liste.length) {
    const { data } = await supabase.from('gestion_actions').select('cle, cree_le').eq('action', 'client_reactivation').in('cle', liste.map(c => `partner-${c.id}`));
    for (const r of data || []) if (!rel[r.cle] || r.cree_le > rel[r.cle]) rel[r.cle] = r.cree_le;
  }
  const data = liste.map(c => ({ ...c, relance_le: rel[`partner-${c.id}`] || null }));
  cacheReac = { le: Date.now(), data };
  return data;
}
async function relancerClient(partnerId, user, message) {
  const p = await odoo.readPartner(Number(partnerId));
  if (!p?.email) throw new Error('Pas d\'e-mail sur la fiche Odoo de ce client');
  const prenom = String(p.name || '').split(/\s+/)[0];
  const texte = String(message || '').trim() || `Bonjour${prenom ? ' ' + prenom : ''},\n\nÇa fait un moment ! J'espère que tout va bien de votre côté.\n\nSi vous avez un projet en vue (t-shirts, polos, sweats, tote bags, planches DTF…) pour un événement, votre équipe ou la saison qui arrive, je vous prépare un devis avec plaisir. Il suffit de répondre à ce mail.\n\nÀ très vite,\nL'équipe IGS CUSTOM BAR`;
  await g.sendMail(MAILBOX, { to: p.email, subject: 'Des nouvelles de IGS CUSTOM BAR', html: `<div style="font:14px/1.6 Arial,sans-serif;color:#1E1E4B">${esc(texte).replace(/\n/g, '<br>')}</div>` });
  await journal(user, 'client_reactivation', `partner-${p.id}`, { client: p.name, email: p.email });
  cacheReac.le = 0;
  return { ok: true, email: p.email };
}

// ---------- Fiche client complète ----------
async function rechercherClients(q) {
  if (String(q || '').trim().length < 2) return [];
  return (await odoo.searchPartners(q)).map(p => ({ id: p.id, nom: p.name, email: p.email, telephone: p.phone, ville: p.ville }));
}
async function ficheClient(partnerId) {
  const f = await odoo.ficheClientOdoo(partnerId);
  const norm = require('./commandes').normalizePhone;
  const tel = norm(f.client.telephone || '');
  // Commandes de l'atelier liées à ses devis
  try {
    const nums = new Set(f.devis.map(d => d.numero.toUpperCase()));
    const rows = (await require('./commandes').listCommandes()).rows || [];
    f.atelier = rows.filter(c => c.n_devis && nums.has(c.n_devis.toUpperCase())).map(c => ({ devis: c.n_devis, statut: c.statut, livraison: c.date_livraison || null }));
  } catch { f.atelier = []; }
  // Planches (même nom de client)
  try {
    const k = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pl = (await require('./planches').listPlanches()).rows || [];
    f.planches = pl.filter(p => k(p.client) === k(f.client.nom)).slice(0, 20).map(p => ({ date: p.date_commande, statut: p.statut, metres: p.format || p.metres, hebdo: !!p.hebdo, paiement: p.paiement }));
  } catch { f.planches = []; }
  // Conversation WhatsApp (Leïla + équipe) et note client
  f.conversation = []; f.note = null;
  if (supabase && tel) {
    const [{ data: conv }, { data: note }] = await Promise.all([
      supabase.from('conversations').select('role, content, created_at').eq('phone_number', tel).order('created_at', { ascending: false }).limit(40),
      supabase.from('client_notes').select('note').eq('phone_number', tel).maybeSingle(),
    ]);
    f.conversation = (conv || []).reverse().map(m => ({ role: m.role, texte: m.content, le: m.created_at }));
    f.note = note?.note || null;
  }
  return f;
}

// ---------- Origine des demandes (90 jours) ----------
async function origines() {
  const tous = await odoo.devisCommerciaux({ jours: 90, planches: true });
  const viaLeila = new Set();
  if (supabase) {
    const { data } = await supabase.from('gestion_demandes').select('devis_numero').not('devis_numero', 'is', null).gte('cree_le', new Date(Date.now() - 95 * 86400e3).toISOString());
    for (const d of data || []) viaLeila.add(d.devis_numero);
  }
  const textile = new Set((await odoo.devisCommerciaux({ jours: 90 })).map(d => d.numero));
  const groupes = {};
  for (const d of tous) {
    if (d.etat === 'cancel' && !d.montant_ht) continue;
    const src = viaLeila.has(d.numero) ? 'Leïla (WhatsApp)' : textile.has(d.numero) ? 'Textile (boutique, mail, site…)' : 'Planches DTF';
    const gr = groupes[src] || (groupes[src] = { source: src, devis: 0, signes: 0, ca_signe_ht: 0 });
    gr.devis++;
    if (d.etat === 'sale') { gr.signes++; gr.ca_signe_ht += d.montant_ht || 0; }
  }
  return Object.values(groupes).map(x => ({ ...x, ca_signe_ht: Math.round(x.ca_signe_ht), taux: x.devis ? Math.round(x.signes / x.devis * 100) : null })).sort((a, b) => b.devis - a.devis);
}

module.exports = { clientsAReactiver, relancerClient, rechercherClients, ficheClient, origines, tableauDeBord, demandes, nouvelleDemande, preparerBrouillon, envoyerDemande, abandonnerDemande, relancer, facturerSolde, surStatutCommande, RELANCE_JOURS };
