// ============================================
// IGS GESTION - MESSAGES AUTOMATIQUES AUX CLIENTS (remplace les mails Power Automate)
// Toutes les 3 minutes :
//  - Commande « prête » au passage en TERMINÉE
//  - Commande « expédiée » dès que le N° de suivi est saisi
//  - « Avis » le lendemain à 10 h du passage en LIVRÉE (si le lien Google est renseigné dans Admin)
//  - Planche « prête » (A RECUPERER) et « expédiée » (EXPÉDIÉE + N° de suivi)
// Mail générique depuis contact@ + WhatsApp personnalisé (tutoiement si le client tutoie) si la fenêtre de 24 h
// est ouverte.
// Indépendant de l'Excel : ce qui a déjà été envoyé est lu dans gestion_notifications (journal des messages,
// conservé 24 mois), jamais dans les colonnes « Mail Envoyé ». À l'activation, ce qui est déjà en attente peut être
// marqué « ignoré » (clients déjà prévenus par Power Automate).
// ============================================

const g = require('./graph');
const { supabase } = require('./db');
const commandes = require('./commandes');
const planches = require('./planches');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const HORAIRES = 'du lundi au vendredi de 14h30 à 17h30';
const ADRESSE = '62 rue Louis Vatable, Pointe-à-Pitre';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const heureGuadeloupe = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
const suiviLien = n => `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(n)}`;
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

// ---------- Ton du message : tutoiement si le client est connu et tutoie (ou note « tutoiement ») ----------
async function profilClient(tel, nomCommande) {
  const out = { tu: false, prenom: '', connu: false };
  if (supabase && tel) {
    const [{ data: hist }, { data: cl }, { data: note }] = await Promise.all([
      supabase.from('conversations').select('content').eq('phone_number', tel).eq('role', 'user').order('created_at', { ascending: false }).limit(25),
      supabase.from('clients').select('name').eq('phone_number', tel).maybeSingle(),
      supabase.from('client_notes').select('note').eq('phone_number', tel).maybeSingle(),
    ]);
    const textes = (hist || []).map(h => h.content || '').join(' \n ');
    out.connu = (hist || []).length >= 2;
    const n = String(note?.note || '');
    out.tu = /tutoi/i.test(n) && !/vouvoi/i.test(n) ? true
      : out.connu && /\b(tu|t'|ton|ta|tes|toi|stp|salut|coucou|wesh|cc|slt)\b/i.test(textes) && !/\b(vous|votre|vos)\b/i.test(textes.slice(0, 400));
    if (cl?.name) out.prenom = String(cl.name).trim().split(/\s+/)[0];
  }
  if (!out.prenom && nomCommande && !/\b(sas|sarl|eurl|sasu|asso|association|club|mairie|ecole|école|ets|sci|team|factory|bar|restaurant|ste|société)\b/i.test(nomCommande)) {
    const mots = String(nomCommande).trim().split(/\s+/);
    if (mots.length <= 3 && /^[A-Za-zÀ-ÿ-]+$/.test(mots[0])) out.prenom = mots[0].charAt(0).toUpperCase() + mots[0].slice(1).toLowerCase();
  }
  return out;
}

// ---------- Textes ----------
function textes(type, ctx, ton) {
  const p = ton.prenom ? ' ' + ton.prenom : '';
  const ref = ctx.devis ? ` ${ctx.devis}` : '';
  const especes = ctx.especes ? (ton.tu ? `\nPense à prévoir ${ctx.especes} en espèces 😉` : `\nMerci de prévoir ${ctx.especes} en espèces.`) : '';
  const W = {
    prete: ton.tu
      ? `Salut${p} ! Ta commande est prête 🙌 Tu peux passer la récupérer ${HORAIRES} (${ADRESSE}). À tout bientôt !${especes}`
      : `Bonjour${p} 👋 Bonne nouvelle : votre commande${ref} est prête ! Vous pouvez venir la récupérer ${HORAIRES}, au ${ADRESSE}. À très bientôt !${especes}`,
    expedition: ton.tu
      ? `Salut${p} ! Ta commande vient de partir 📦 Numéro de suivi : ${ctx.suivi}\nTu peux la suivre ici : ${suiviLien(ctx.suivi)}`
      : `Bonjour${p} 👋 Votre commande${ref} a été expédiée 📦 Numéro de suivi : ${ctx.suivi}\nSuivi : ${suiviLien(ctx.suivi)}`,
    avis: ton.tu
      ? `Merci encore pour ta confiance${p} 🙏 Si tu es content(e) du résultat, un petit avis Google nous aiderait vraiment : ${ctx.lienAvis}`
      : `Bonjour${p}, merci encore pour votre confiance 🙏 Si vous êtes satisfait(e) de votre commande, un petit avis Google nous aiderait beaucoup : ${ctx.lienAvis}`,
    planche_prete: ton.tu
      ? `Salut${p} ! Ta planche DTF est prête 🙌 Tu peux passer la récupérer ${HORAIRES} (${ADRESSE}).${especes}`
      : `Bonjour${p} 👋 Votre planche DTF est prête ! Vous pouvez venir la récupérer ${HORAIRES}, au ${ADRESSE}.${especes}`,
    planche_expedition: ton.tu
      ? `Salut${p} ! Ta planche DTF est partie 📦 Numéro de suivi : ${ctx.suivi}\nSuivi : ${suiviLien(ctx.suivi)}`
      : `Bonjour${p} 👋 Votre planche DTF a été expédiée 📦 Numéro de suivi : ${ctx.suivi}\nSuivi : ${suiviLien(ctx.suivi)}`,
  };
  const sujetRef = ctx.devis ? ` ${ctx.devis}` : '';
  const S = {
    prete: `Votre commande${sujetRef} est prête - IGS CUSTOM BAR`,
    expedition: `Votre commande${sujetRef} a été expédiée - IGS CUSTOM BAR`,
    avis: 'Votre avis compte pour nous - IGS CUSTOM BAR',
    planche_prete: 'Votre planche DTF est prête - IGS CUSTOM BAR',
    planche_expedition: 'Votre planche DTF a été expédiée - IGS CUSTOM BAR',
  };
  const bonjour = `<p>Bonjour${ton.prenom ? ' ' + esc(ton.prenom) : ''},</p>`;
  const sig = '<p>Belle journée,<br>L\'équipe IGS CUSTOM BAR<br><span style="color:#6b7280;font-size:12px">' + ADRESSE + ' · 0690 69 18 63 · igscustom.fr</span></p>';
  const especesMail = ctx.especes ? `<p>Merci de prévoir <b>${esc(ctx.especes)}</b> en espèces lors du retrait.</p>` : '';
  const M = {
    prete: `${bonjour}<p>Bonne nouvelle : votre commande${esc(sujetRef)} est <b>prête</b> !</p><p>Vous pouvez venir la récupérer ${HORAIRES}, au ${ADRESSE}.</p>${especesMail}${sig}`,
    expedition: `${bonjour}<p>Votre commande${esc(sujetRef)} a été <b>expédiée</b>.</p><p>Numéro de suivi : <b>${esc(ctx.suivi)}</b><br><a href="${suiviLien(ctx.suivi)}">Suivre mon colis sur La Poste</a></p>${sig}`,
    avis: `${bonjour}<p>Merci encore pour votre confiance !</p><p>Si vous êtes satisfait(e) de votre commande, un petit avis Google nous aiderait beaucoup :</p><p><a href="${esc(ctx.lienAvis)}" style="display:inline-block;padding:12px 18px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">⭐ Laisser un avis</a></p>${sig}`,
    planche_prete: `${bonjour}<p>Votre <b>planche DTF</b> est prête !</p><p>Vous pouvez venir la récupérer ${HORAIRES}, au ${ADRESSE}.</p>${especesMail}${sig}`,
    planche_expedition: `${bonjour}<p>Votre <b>planche DTF</b> a été expédiée.</p><p>Numéro de suivi : <b>${esc(ctx.suivi)}</b><br><a href="${suiviLien(ctx.suivi)}">Suivre mon colis sur La Poste</a></p>${sig}`,
  };
  return { whatsapp: W[type], sujet: S[type], mail: M[type] };
}

// ---------- Envoi ----------
async function envoyerTexteWhatsApp(tel, texte) {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID, key = process.env.DUALHOOK_API_KEY;
  if (!id || !key) throw new Error('WhatsApp non configuré');
  const res = await fetch(`https://api.dualhook.com/v25.0/${id}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: tel, type: 'text', text: { body: texte } }),
  });
  if (!res.ok) throw new Error(`WhatsApp refusé (${res.status}) : ${(await res.text()).slice(0, 150)}`);
  if (supabase) await supabase.from('conversations').insert({ phone_number: tel, role: 'assistant', content: texte });
}

async function journal(o) {
  if (!supabase) return;
  const { error } = await supabase.from('gestion_notifications').insert(o);
  if (error) console.error('Gestion notifications (journal) :', error.message);
}

// Envoie un message (mail + WhatsApp si possible) ; renvoie { ok, canaux, raison }
async function envoyer(item, par = 'Automatique') {
  const { dernierMessageClient } = require('./bat-envoi')._test;
  const ton = await profilClient(item.tel, item.nom);
  const t = textes(item.type, item, ton);
  const canaux = [], erreurs = [];
  if (item.tel) {
    const dernier = await dernierMessageClient(item.tel);
    if (dernier && Date.now() - dernier.getTime() < 23.5 * 3600e3) {
      try { await envoyerTexteWhatsApp(item.tel, t.whatsapp); canaux.push('WhatsApp'); } catch (err) { erreurs.push(err.message); }
    }
  }
  if (item.email) {
    try { await g.sendMail(MAILBOX, { to: item.email, subject: t.sujet, html: t.mail }); canaux.push('mail'); } catch (err) { erreurs.push(err.message); }
  }
  const ok = canaux.length > 0;
  const raison = ok ? null : (erreurs.join(' ; ') || (!item.email ? 'pas d\'e-mail' + (item.tel ? ' et pas de message WhatsApp du client depuis plus de 24 h' : ' ni de téléphone') : 'échec'));
  await journal({ cle: item.cle, type: item.type, canal: canaux.join(' + ') || null, statut: ok ? 'envoye' : (!item.email && !item.tel ? 'sans_contact' : 'echec'), destinataire: [item.email, item.tel].filter(Boolean).join(' / '), sujet: t.sujet, message: t.whatsapp, erreur: raison, par });
  console.log(`Gestion notification ${item.type} ${item.cle} : ${ok ? canaux.join(' + ') : 'échec (' + raison + ')'}`);
  return { ok, canaux, raison };
}

// ---------- Ce qui est à envoyer maintenant ----------
async function dejaTraites() {
  if (!supabase) return { faits: new Set(), echecsRecents: new Set() };
  const depuis = new Date(Date.now() - 6 * 3600e3).toISOString();
  const { data } = await supabase.from('gestion_notifications').select('cle, type, statut, cree_le').gte('cree_le', new Date(Date.now() - 400 * 86400e3).toISOString()).limit(20000);
  const faits = new Set(), echecsRecents = new Set();
  for (const n of data || []) {
    if (n.statut === 'envoye' || n.statut === 'ignore' || n.statut === 'sans_contact') faits.add(`${n.cle}|${n.type}`);
    else if (n.statut === 'echec' && n.cree_le > depuis) echecsRecents.add(`${n.cle}|${n.type}`);
  }
  return { faits, echecsRecents };
}

async function contactPlanche(client) {
  try {
    const r = await require('./odoo').findPartner(client);
    if (r.partner) return { email: r.partner.email || null, tel: commandes.normalizePhone(r.partner.phone || '') };
  } catch {}
  return { email: null, tel: null };
}

async function aEnvoyer() {
  const { faits, echecsRecents } = await dejaTraites();
  const libre = (cle, type) => !faits.has(`${cle}|${type}`) && !echecsRecents.has(`${cle}|${type}`);
  const out = [];
  const { rows } = await commandes.listCommandes();
  for (const c of rows) {
    const st = statutKey(c.statut);
    const base = { cle: c.cle, devis: c.n_devis, nom: c.client, email: c.email, tel: c.telephone, especes: c.a_payer_especes ? (c.montant_especes != null && !isNaN(Number(c.montant_especes)) ? Number(c.montant_especes).toFixed(2).replace('.', ',') + ' €' : 'le montant') : null };
    if (st === 'TERMINEE' && libre(c.cle, 'prete')) out.push({ ...base, type: 'prete' });
    if (c.numero_suivi && libre(c.cle, 'expedition')) out.push({ ...base, type: 'expedition', suivi: c.numero_suivi });
  }
  // Avis : le lendemain à 10 h du passage en LIVRÉE (date relevée par le dashboard, après l'activation)
  const lienAvis = await reglage('notif_avis_lien', '');
  const active = await reglage('notif_active_le', null);
  if (supabase && lienAvis && active) {
    const { data } = await supabase.from('gestion_commandes').select('cle, n_devis, client, email, telephone, livree_vu_le').not('livree_vu_le', 'is', null).gte('livree_vu_le', active).limit(500);
    const maintenant = heureGuadeloupe();
    for (const c of data || []) {
      const vu = new Date(new Date(c.livree_vu_le).toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
      const du = new Date(vu.getFullYear(), vu.getMonth(), vu.getDate() + 1, 10, 0, 0);
      if (maintenant >= du && libre(c.cle, 'avis')) out.push({ cle: c.cle, devis: c.n_devis, nom: c.client, email: c.email, tel: c.telephone, type: 'avis', lienAvis });
    }
  }
  // Planches
  const pl = await planches.listPlanches();
  for (const p of pl.rows || []) {
    const st = statutKey(p.statut);
    const veutPrete = st === 'ARECUPERER' && libre(p.cle, 'planche_prete');
    const veutExp = st === 'EXPEDIEE' && p.numero_suivi && libre(p.cle, 'planche_expedition');
    if (!veutPrete && !veutExp) continue;
    const ct = await contactPlanche(p.client);
    const base = { cle: p.cle, devis: p.n_devis, nom: p.client, email: ct.email, tel: ct.tel, planche: true, especes: null };
    if (veutPrete) out.push({ ...base, type: 'planche_prete' });
    if (veutExp) out.push({ ...base, type: 'planche_expedition', suivi: p.numero_suivi });
  }
  return out;
}

// Dates de passage en LIVRÉE relevées (pour l'avis du lendemain)
async function releverLivrees() {
  if (!supabase) return;
  const { rows } = await commandes.listCommandes();
  const livrees = rows.filter(c => statutKey(c.statut) === 'LIVREE').map(c => c.cle);
  if (!livrees.length) return;
  await supabase.from('gestion_commandes').update({ livree_vu_le: new Date().toISOString() }).in('cle', livrees).is('livree_vu_le', null);
}

let enCours = false;
async function cycle() {
  if (enCours) return;
  enCours = true;
  try {
    await releverLivrees();
    if ((await reglage('notif_actives', 'off')) !== 'on') return;
    for (const item of await aEnvoyer()) {
      await envoyer(item);
    }
  } catch (err) {
    console.error('Gestion notifications :', err.message);
  } finally { enCours = false; }
}

// ---------- Admin : état, activation (envoyer ou ignorer ce qui est en attente), lien avis ----------
async function etat() {
  const items = await aEnvoyer().catch(err => { throw new Error(err.message); });
  return {
    actives: (await reglage('notif_actives', 'off')) === 'on',
    lienAvis: await reglage('notif_avis_lien', ''),
    activeLe: await reglage('notif_active_le', null),
    enAttente: items.map(i => ({ cle: i.cle, type: i.type, nom: i.nom, devis: i.devis, email: i.email, tel: i.tel })),
  };
}
async function activer({ actif, ignorerAttente }, user) {
  if (actif && ignorerAttente) {
    for (const item of await aEnvoyer()) {
      await journal({ cle: item.cle, type: item.type, canal: null, statut: 'ignore', destinataire: null, sujet: null, message: null, erreur: 'Ignoré à l\'activation (déjà traité avant le dashboard)', par: user });
    }
  }
  if (actif && !(await reglage('notif_active_le', null))) await setReglage('notif_active_le', new Date().toISOString());
  await setReglage('notif_actives', actif ? 'on' : 'off');
  if (actif) setTimeout(() => cycle().catch(() => {}), 1000);
  return etat();
}
async function definirLienAvis(lien) {
  const l = String(lien || '').trim();
  if (l && !/^https:\/\//.test(l)) throw new Error('Le lien doit commencer par https://');
  await setReglage('notif_avis_lien', l);
  return { ok: true };
}

// Purge du journal au-delà de 24 mois
async function purger() {
  if (!supabase) return;
  await supabase.from('gestion_notifications').delete().lt('cree_le', new Date(Date.now() - 730 * 86400e3).toISOString());
}

function start() {
  setTimeout(() => cycle().catch(() => {}), 45e3);
  setInterval(() => cycle().catch(() => {}), 3 * 60e3);
  setInterval(() => purger().catch(() => {}), 24 * 3600e3);
}

module.exports = { start, cycle, etat, activer, definirLienAvis, envoyer, envoyerTexteWhatsApp, profilClient, _test: { textes, aEnvoyer } };
