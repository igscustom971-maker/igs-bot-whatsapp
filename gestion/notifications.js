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
// Lien avis Google d'IGS (celui du flux Power Automate), modifiable dans Admin
const LIEN_AVIS_DEFAUT = 'https://g.page/r/CWIVVFwaHQYBEBM/review';
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
      ? `Salut${p} ! Ta commande est prête 🙌 Tu peux passer la récupérer ${HORAIRES}. À tout bientôt !${especes}`
      : `Bonjour${p} 👋 Bonne nouvelle : votre commande${ref} est prête ! Vous pouvez venir la récupérer ${HORAIRES}. À très bientôt !${especes}`,
    expedition: ton.tu
      ? `Salut${p} ! Ta commande vient de partir 📦 Numéro de suivi : ${ctx.suivi}\nTu peux la suivre ici : ${suiviLien(ctx.suivi)}`
      : `Bonjour${p} 👋 Votre commande${ref} a été expédiée 📦 Numéro de suivi : ${ctx.suivi}\nSuivi : ${suiviLien(ctx.suivi)}`,
    avis: ton.tu
      ? `Merci encore pour ta confiance${p} 🙏 Si tu es content(e) du résultat, un petit avis Google nous aiderait vraiment : ${ctx.lienAvis}`
      : `Bonjour${p}, merci encore pour votre confiance 🙏 Si vous êtes satisfait(e) de votre commande, un petit avis Google nous aiderait beaucoup : ${ctx.lienAvis}`,
    planche_prete: ton.tu
      ? `Salut${p} ! Ta planche DTF est prête 🙌 Tu peux passer la récupérer ${HORAIRES}.${especes}`
      : `Bonjour${p} 👋 Votre planche DTF est prête ! Vous pouvez venir la récupérer ${HORAIRES}.${especes}`,
    planche_expedition: ton.tu
      ? `Salut${p} ! Ta planche DTF est partie 📦 Numéro de suivi : ${ctx.suivi}\nSuivi : ${suiviLien(ctx.suivi)}`
      : `Bonjour${p} 👋 Votre planche DTF a été expédiée 📦 Numéro de suivi : ${ctx.suivi}\nSuivi : ${suiviLien(ctx.suivi)}`,
    livree_colis: ton.tu
      ? `Salut${p} ! Ton colis${ctx.suivi ? ' (' + ctx.suivi + ')' : ''} a bien été livré 📦 On espère que ta commande te plaît !${ctx.lienAvis ? `\nSi tu es content(e), un petit avis Google nous aiderait vraiment 🙏 ${ctx.lienAvis}` : ''}`
      : `Bonjour${p} 👋 Votre colis${ctx.suivi ? ' (n° ' + ctx.suivi + ')' : ''} a bien été livré 📦 Nous espérons que votre commande vous plaît !${ctx.lienAvis ? `\nSi vous êtes satisfait(e), un petit avis Google nous aiderait beaucoup 🙏 ${ctx.lienAvis}` : ''}`,
    planche_livree: ton.tu
      ? `Salut${p} ! Ta planche DTF${ctx.suivi ? ' (' + ctx.suivi + ')' : ''} a bien été livrée 📦${ctx.lienAvis ? `\nSi tu es content(e), un petit avis Google nous aiderait vraiment 🙏 ${ctx.lienAvis}` : ''}`
      : `Bonjour${p} 👋 Votre planche DTF${ctx.suivi ? ' (n° ' + ctx.suivi + ')' : ''} a bien été livrée 📦${ctx.lienAvis ? `\nSi vous êtes satisfait(e), un petit avis Google nous aiderait beaucoup 🙏 ${ctx.lienAvis}` : ''}`,
  };
  const sujetRef = ctx.devis ? ` ${ctx.devis}` : '';
  const S = {
    prete: `Votre commande${sujetRef} est prête - IGS CUSTOM BAR`,
    expedition: `Votre commande${sujetRef} a été expédiée - IGS CUSTOM BAR`,
    avis: 'Votre avis compte pour nous - IGS CUSTOM BAR',
    planche_prete: 'Votre planche DTF est prête - IGS CUSTOM BAR',
    planche_expedition: 'Votre planche DTF a été expédiée - IGS CUSTOM BAR',
    livree_colis: 'Votre commande IGS CUSTOM BAR est livrée 📦',
    planche_livree: 'Votre planche DTF IGS CUSTOM BAR est livrée 📦',
  };
  const qui = ton.prenom || (ctx.nom ? String(ctx.nom).trim() : '');
  const bonjour = `<p>Bonjour${qui ? ' ' + esc(qui) : ''},</p>`;
  const sig = ''; // signature ajoutée automatiquement par CodeTwo
  const especesMail = ctx.especes ? `<p>Merci de prévoir <b>${esc(ctx.especes)}</b> en espèces lors du retrait.</p>` : '';
  // Colis livré : texte repris du flux Power Automate « Colissimo livré + avis »
  const livreMail = quoi => `${bonjour}<p>Bonne nouvelle : ${quoi}${ctx.suivi ? ` (n° de suivi ${esc(ctx.suivi)})` : ''} a bien été livré${quoi.includes('planche') ? 'e' : ''} !</p>`
    + `<p>Nous espérons que votre commande vous plaît autant qu'on a aimé la réaliser. Si vous avez une question ou le moindre souci, répondez simplement à ce mail, on s'en occupe.</p>`
    + (ctx.lienAvis ? `<p>Votre avis compte énormément pour nous : si vous êtes satisfait(e), pourriez-vous prendre une minute pour nous laisser un avis Google ?</p><p>👉 <a href="${esc(ctx.lienAvis)}">Votre avis ici</a></p>` : '')
    + `<p>Merci pour votre confiance et à très bientôt,</p><p>L'équipe IGS CUSTOM BAR.</p>`;
  const M = {
    prete: `${bonjour}<p>Bonne nouvelle : votre commande${esc(sujetRef)} est <b>prête</b> !</p><p>Vous pouvez venir la récupérer ${HORAIRES}, au ${ADRESSE}.</p>${especesMail}${sig}`,
    expedition: `${bonjour}<p>Votre commande${esc(sujetRef)} a été <b>expédiée</b>.</p><p>Numéro de suivi : <b>${esc(ctx.suivi)}</b><br><a href="${suiviLien(ctx.suivi)}">Suivre mon colis sur La Poste</a></p>${sig}`,
    avis: `${bonjour}<p>Merci encore pour votre confiance !</p><p>Si vous êtes satisfait(e) de votre commande, un petit avis Google nous aiderait beaucoup :</p><p><a href="${esc(ctx.lienAvis)}" style="display:inline-block;padding:12px 18px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">⭐ Laisser un avis</a></p>${sig}`,
    planche_prete: `${bonjour}<p>Votre <b>planche DTF</b> est prête !</p><p>Vous pouvez venir la récupérer ${HORAIRES}, au ${ADRESSE}.</p>${especesMail}${sig}`,
    planche_expedition: `${bonjour}<p>Votre <b>planche DTF</b> a été expédiée.</p><p>Numéro de suivi : <b>${esc(ctx.suivi)}</b><br><a href="${suiviLien(ctx.suivi)}">Suivre mon colis sur La Poste</a></p>${sig}`,
    livree_colis: livreMail('votre colis'),
    planche_livree: livreMail('votre planche DTF'),
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

// Envoyés pendant cette exécution du serveur (filet de sécurité si l'écriture du journal échoue)
const envoyesMemoire = new Set();
async function journal(o) {
  if (o && o.cle && o.type && o.statut !== 'echec') envoyesMemoire.add(`${o.cle}|${o.type}`);
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
// Déjà envoyé / ignoré pour ces clés ? Requête ciblée (jamais de lecture de tout le journal, limité à 1000 lignes par Supabase).
// Une erreur Supabase arrête le cycle : on n'envoie rien plutôt que de renvoyer à tout le monde.
async function dejaTraites(cles) {
  const faits = new Set(), echecsRecents = new Set();
  if (!supabase) return { faits, echecsRecents };
  const liste = [...new Set((cles || []).filter(Boolean))];
  const depuis = new Date(Date.now() - 6 * 3600e3).toISOString();
  for (let i = 0; i < liste.length; i += 80) {
    const { data, error } = await supabase.from('gestion_notifications').select('cle, type, statut, cree_le').in('cle', liste.slice(i, i + 80)).limit(5000);
    if (error) throw new Error(`Journal des messages illisible : ${error.message}`);
    for (const n of data || []) {
      if (n.statut === 'envoye' || n.statut === 'ignore' || n.statut === 'sans_contact') faits.add(`${n.cle}|${n.type}`);
      else if (n.statut === 'echec' && n.cree_le > depuis) echecsRecents.add(`${n.cle}|${n.type}`);
    }
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

// Semaine ISO (planches hebdo : un message « prête » par semaine)
function semaine(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const j = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - j);
  const an = x.getUTCFullYear(), s = Math.ceil(((x - Date.UTC(an, 0, 1)) / 86400e3 + 1) / 7);
  return `${an}-S${String(s).padStart(2, '0')}`;
}
// Clé stable d'une planche (la clé change quand le N° de devis est ajouté) ; anciennes clés gardées pour la vérification
function clesPlanche(p) {
  const stable = p.excel_id ? `PL-${p.excel_id}` : p.cle;
  const cle = p.hebdo ? `${stable}#${semaine(heureGuadeloupe())}` : stable;
  const sansDevis = p.excel_id ? `SANS-DEVIS-${String(p.client || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')}-${p.excel_id}` : null;
  return { cle, alias: p.hebdo ? [] : [p.cle, sansDevis].filter(Boolean) };
}

async function aEnvoyer() {
  const cands = []; // { item, alias }
  const { rows } = await commandes.listCommandes();
  for (const c of rows) {
    const st = statutKey(c.statut);
    const base = { cle: c.cle, devis: c.n_devis, nom: c.client, email: c.email, tel: c.telephone, especes: c.a_payer_especes ? (c.montant_especes != null && !isNaN(Number(c.montant_especes)) ? Number(c.montant_especes).toFixed(2).replace('.', ',') + ' €' : 'le montant') : null };
    if (st === 'TERMINEE') cands.push({ item: { ...base, type: 'prete' }, alias: [] });
    if (c.numero_suivi) cands.push({ item: { ...base, type: 'expedition', suivi: c.numero_suivi }, alias: [] });
  }
  // Avis : le lendemain à 10 h du passage en LIVRÉE (date relevée par le dashboard, après l'activation)
  const lienAvis = await reglage('notif_avis_lien', LIEN_AVIS_DEFAUT);
  const active = await reglage('notif_active_le', null);
  if (supabase && lienAvis && active) {
    const { data, error } = await supabase.from('gestion_commandes').select('cle, n_devis, client, email, telephone, livree_vu_le').not('livree_vu_le', 'is', null).gte('livree_vu_le', active).order('livree_vu_le', { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    const maintenant = heureGuadeloupe();
    for (const c of data || []) {
      const vu = new Date(new Date(c.livree_vu_le).toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
      const du = new Date(vu.getFullYear(), vu.getMonth(), vu.getDate() + 1, 10, 0, 0);
      if (maintenant >= du) cands.push({ item: { cle: c.cle, devis: c.n_devis, nom: c.client, email: c.email, tel: c.telephone, type: 'avis', lienAvis }, alias: [] });
    }
  }
  // Planches
  const pl = await planches.listPlanches();
  const plCands = [];
  for (const p of pl.rows || []) {
    const st = statutKey(p.statut);
    if (st !== 'ARECUPERER' && !(st === 'EXPEDIEE' && p.numero_suivi)) continue;
    const { cle, alias } = clesPlanche(p);
    plCands.push({ p, cle, alias, type: st === 'ARECUPERER' ? 'planche_prete' : 'planche_expedition' });
  }
  const { faits, echecsRecents } = await dejaTraites([...cands.flatMap(c => [c.item.cle, ...c.alias]), ...plCands.flatMap(c => [c.cle, ...c.alias])]);
  const libre = (cles, type) => cles.every(k => !faits.has(`${k}|${type}`) && !echecsRecents.has(`${k}|${type}`) && !envoyesMemoire.has(`${k}|${type}`));
  const out = cands.filter(c => libre([c.item.cle, ...c.alias], c.item.type)).map(c => c.item);
  for (const c of plCands) {
    if (!libre([c.cle, ...c.alias], c.type)) continue;
    const ct = await contactPlanche(c.p.client);
    out.push({ cle: c.cle, devis: c.p.n_devis, nom: c.p.client, email: ct.email, tel: ct.tel, planche: true, especes: null, type: c.type, ...(c.type === 'planche_expedition' ? { suivi: c.p.numero_suivi } : {}) });
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
    lienAvis: await reglage('notif_avis_lien', LIEN_AVIS_DEFAUT),
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

module.exports = { start, cycle, etat, activer, definirLienAvis, envoyer, envoyerTexteWhatsApp, profilClient, contactPlanche, reglage, journal, dejaTraites, _test: { textes, aEnvoyer, clesPlanche, semaine } };
