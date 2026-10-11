// ============================================
// IGS GESTION - LEÏLA CONNAÎT LES COMMANDES
// - Contexte ajouté au prompt de Leïla : les commandes du client (retrouvées par son numéro, ou par un N° de devis
//   cité dans la conversation), avec le statut en clair, le N° de suivi et l'état du BAT.
// - Leïla peut renvoyer le BAT : marqueur interne ###BAT:N°DEVIS### (jamais envoyé au client).
// - Question interne de l'équipe à Leïla sur un client (« tu lui as dit quelle heure ? »).
// ============================================

const { supabase } = require('./db');
const commandes = require('./commandes');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const suiviLien = n => `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(n)}`;
const fdate = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'America/Guadeloupe' });

// Statut en clair pour le client (jamais de date de livraison ni de prix)
function statutClair(c) {
  const st = norm(c.statut), bi = c.bat_info || {}, rep = c.bat_reponse;
  if (st === 'LIVREE') return 'commande livrée / récupérée';
  if (st === 'EXPEDIEE') return 'commande expédiée';
  if (st === 'AEXPEDIER') return c.numero_suivi ? 'commande expédiée' : 'commande prête, en cours d\'expédition';
  if (st === 'TERMINEE') return 'commande PRÊTE à être récupérée (du lundi au vendredi de 14h30 à 17h30)';
  if (st === 'ENPRODUCTION' || st === 'ENFLOCAGE') return 'commande en cours de production';
  if (st === 'ENCOMMANDE') return rep && rep.verdict === 'valide' ? 'BAT validé, les textiles sont commandés, la production suivra' : (c.bat_envoye_le ? `textiles commandés ; BAT envoyé le ${fdate(c.bat_envoye_le)}, en attente de la validation du client` : 'textiles commandés, le BAT est en préparation');
  if (st === 'VALIDEE') return rep && rep.verdict === 'valide' || bi.bat || c.bat_envoye_le ? 'BAT validé, la commande va passer en production' : 'commande validée, le BAT (bon à tirer) est en préparation';
  if (rep && rep.verdict === 'modification') return 'le client a demandé une modification du BAT : un BAT corrigé va lui être renvoyé';
  if (c.bat_envoye_le) return `BAT envoyé le ${fdate(c.bat_envoye_le)}, en attente de la validation du client (il peut répondre « je valide »)`;
  if (bi.bat) return 'BAT prêt, il va être envoyé au client très prochainement';
  if (bi.formulaire) return 'formulaire bien reçu, le BAT (bon à tirer) est en préparation';
  if (st === 'PAYEE') return 'commande payée, en attente du formulaire de personnalisation du client (tailles et visuels)';
  if (st === 'ENDEVIS') return 'devis envoyé, en attente de validation et de paiement';
  return 'commande enregistrée';
}

async function commandesDuClient(tel, devisCites = []) {
  const { rows } = await commandes.listCommandes();
  const cites = devisCites.map(d => d.toUpperCase());
  let liste = rows.filter(r => (tel && r.telephone === tel) || (r.n_devis && cites.includes(r.n_devis.toUpperCase())));
  // Commandes livrées récemment (retirées de l'Excel), gardées 30 jours
  if (supabase && tel) {
    const { data } = await supabase.from('gestion_commandes').select('cle, n_devis, client, statut, numero_suivi, telephone, synced_at')
      .eq('telephone', tel).eq('present', false).gte('synced_at', new Date(Date.now() - 30 * 86400e3).toISOString()).limit(5);
    for (const d of data || []) if (!liste.some(x => x.cle === d.cle)) liste.push({ ...d, statut: d.statut || 'LIVRÉE' });
  }
  return liste;
}

// ---------- Identification par le nom, le contact (e-mail) ou le téléphone ----------
// Mots significatifs d'un nom (sans accents, 4 lettres et plus, hors mots trop courants)
const MOTS_COURANTS = new Set(['team', 'factory', 'association', 'asso', 'club', 'sarl', 'sasu', 'eurl', 'entreprise', 'societe', 'commande', 'commandes', 'planche', 'planches', 'tshirt', 'tshirts', 'shirt', 'maillot', 'maillots', 'polo', 'polos', 'sweat', 'custom', 'madame', 'monsieur', 'mairie', 'ecole', 'college', 'lycee', 'groupe', 'sport', 'sports', 'boutique', 'store', 'shop', 'bonjour', 'bonsoir', 'merci', 'pour', 'avec', 'dans', 'votre', 'notre', 'cest', 'nous', 'vous', 'elle', 'quand', 'est', 'prete', 'pret', 'guadeloupe', 'martinique', 'gmail', 'hotmail', 'yahoo', 'outlook', 'orange', 'wanadoo', 'icloud', 'live']);
const mots = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !MOTS_COURANTS.has(w) && !/^\d+$/.test(w));
// Le nom d'une commande correspond-il à ce que le client a écrit / à son nom WhatsApp ?
function correspondNom(nom, motsClient, frequence) {
  const m = [...new Set(mots(nom))];
  if (!m.length) return false;
  const trouves = m.filter(w => motsClient.has(w));
  if (trouves.length >= 2) return true;                                   // prénom + nom, ou deux mots de l'enseigne
  if (m.length === 1 && trouves.length === 1 && trouves[0].length >= 5) return true; // nom d'un seul mot (ex. une enseigne)
  return trouves.some(w => w.length >= 6 && (frequence.get(w) || 0) <= 1); // mot rare, propre à ce client
}

// Contact Odoo des clients planches (le tableau des planches n'a pas le téléphone) : mis en cache 6 h
const contactsPlanches = new Map();
async function contactPlancheCache(client) {
  const k = String(client || '').trim().toLowerCase();
  const c = contactsPlanches.get(k);
  if (c && Date.now() - c.le < 6 * 3600e3) return c;
  let r = { email: null, tel: null };
  try {
    r = await Promise.race([require('./notifications').contactPlanche(client), new Promise(ok => setTimeout(() => ok({ email: null, tel: null }), 4000))]);
  } catch {}
  const v = { email: (r.email || '').toLowerCase() || null, tel: r.tel || null, le: Date.now() };
  contactsPlanches.set(k, v);
  return v;
}

function statutPlanche(p) {
  const st = norm(p.statut);
  if (st === 'LIVREE') return 'planche récupérée / livrée';
  if (st === 'EXPEDIEE') return 'planche expédiée';
  if (st === 'ARECUPERER') return 'planche PRÊTE à être récupérée (du lundi au vendredi de 14h30 à 17h30)';
  return 'planche en cours de préparation (production sous 24 à 48 h)';
}

// Toutes les commandes et planches qui peuvent concerner ce client
async function trouverPourClient(tel, { devisCites = [], emails = [], motsClient = new Set() } = {}) {
  const { rows } = await commandes.listCommandes();
  const cites = devisCites.map(d => d.toUpperCase());
  let pl = [];
  try { pl = ((await require('./planches').listPlanches()).rows || []).filter(p => norm(p.statut) !== 'LIVREE' || (p.statut_le && Date.now() - Date.parse(p.statut_le) < 7 * 86400e3)); } catch {}
  const frequence = new Map();
  for (const n of [...rows.map(r => r.client), ...pl.map(p => p.client)]) for (const w of new Set(mots(n))) frequence.set(w, (frequence.get(w) || 0) + 1);
  const out = [];
  for (const c of rows) {
    let par = null;
    if (tel && c.telephone === tel) par = 'telephone';
    else if (c.n_devis && cites.includes(c.n_devis.toUpperCase())) par = 'devis';
    else if (c.email && emails.includes(String(c.email).toLowerCase())) par = 'email';
    else if (correspondNom(c.client, motsClient, frequence)) par = 'nom';
    if (par) out.push({ type: 'commande', par, c });
  }
  // Commandes livrées récemment (gardées 30 jours), retrouvées par le téléphone
  if (supabase && tel) {
    const { data } = await supabase.from('gestion_commandes').select('cle, n_devis, client, statut, numero_suivi, telephone, synced_at')
      .eq('telephone', tel).eq('present', false).gte('synced_at', new Date(Date.now() - 30 * 86400e3).toISOString()).limit(5);
    for (const d of data || []) if (!out.some(x => x.c.cle === d.cle)) out.push({ type: 'commande', par: 'telephone', c: { ...d, statut: d.statut || 'LIVRÉE' } });
  }
  const contacts = await Promise.all(pl.slice(0, 30).map(p => contactPlancheCache(p.client)));
  pl.slice(0, 30).forEach((p, i) => {
    const ct = contacts[i];
    let par = null;
    if (tel && ct.tel === tel) par = 'telephone';
    else if (p.n_devis && cites.includes(String(p.n_devis).toUpperCase())) par = 'devis';
    else if (ct.email && emails.includes(ct.email)) par = 'email';
    else if (correspondNom(p.client, motsClient, frequence)) par = 'nom';
    if (par) out.push({ type: 'planche', par, c: p });
  });
  const rang = { telephone: 0, devis: 1, email: 2, nom: 3 };
  return out.sort((a, b) => rang[a.par] - rang[b.par]);
}

// Bloc ajouté au prompt système de Leïla
async function contexteCommandes(tel) {
  try {
    let devisCites = [], emails = [], textes = '';
    if (supabase && tel) {
      const [{ data }, { data: cl }] = await Promise.all([
        supabase.from('conversations').select('content').eq('phone_number', tel).eq('role', 'user').order('created_at', { ascending: false }).limit(15),
        supabase.from('clients').select('name').eq('phone_number', tel).maybeSingle(),
      ]);
      textes = (data || []).map(m => String(m.content || '')).join('\n') + '\n' + (cl?.name || '');
      devisCites = [...new Set((textes.toUpperCase().match(/\bDE\s?\d{6,8}(?:-R\d+)?\b/g) || []).map(d => d.replace(/\s/g, '')))];
      emails = [...new Set((textes.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).map(e => e.toLowerCase()))];
    }
    const motsClient = new Set(mots(textes));
    const liste = await trouverPourClient(tel, { devisCites, emails, motsClient });
    if (!liste.length) {
      return '\n\nCOMMANDES DU CLIENT : aucune commande ni planche en cours retrouvée pour ce numéro, ce nom ou ce contact. Si le client demande où en est sa commande, demande-lui simplement à quel nom (ou quelle entreprise) la commande a été passée, ou son adresse e-mail. Le numéro de devis (il commence par DE) aide aussi s\'il l\'a, mais il ne le connaît pas forcément.';
    }
    const lignes = liste.slice(0, 8).map(({ type, par, c }) => {
      const sur = par === 'nom' ? 'IDENTIFIÉE PAR LE NOM SEULEMENT (à confirmer)' : par === 'email' ? 'identifiée par l\'e-mail' : par === 'devis' ? 'identifiée par le N° de devis cité' : 'identifiée par le numéro de téléphone';
      const fort = par === 'telephone' || par === 'email';
      if (type === 'planche') {
        return `- Planche DTF ${c.n_devis || ''} au nom de ${c.client}${c.format ? ' (' + c.format + ')' : c.metres ? ' (' + String(c.metres).replace('.', ',') + ' m)' : ''} [${sur}] : ${statutPlanche(c)}${c.numero_suivi && fort ? ` ; N° de suivi La Poste : ${c.numero_suivi} (${suiviLien(c.numero_suivi)})` : ''}`;
      }
      return `- Commande ${c.n_devis || 'sans devis'} au nom de ${c.client || '?'}${c.infos ? ' (' + String(c.infos).replace(/\s+/g, ' ').slice(0, 80) + ')' : ''} [${sur}] : ${statutClair(c)}${c.numero_suivi && fort ? ` ; N° de suivi La Poste : ${c.numero_suivi} (${suiviLien(c.numero_suivi)})` : ''}${(c.bat_envoye_le || (c.bat_info && c.bat_info.bat)) ? (tel && c.telephone === tel ? ' ; BAT disponible' : ' ; BAT existant mais ce numéro n\'est pas celui de la commande : ne le renvoie pas, propose que l\'équipe le renvoie au numéro ou à l\'e-mail de la commande') : ''}`;
    });
    return `\n\nCOMMANDES DU CLIENT (informations internes À JOUR EN TEMPS RÉEL, seule source fiable sur l'état des commandes ; à utiliser UNIQUEMENT si le client demande où en est sa commande, sa planche, son BAT ou son colis) :
${lignes.join('\n')}
RÈGLES COMMANDES :
- Le client ne connaît pas forcément son numéro de devis : identifie sa commande par son nom, le nom de son entreprise, son e-mail ou son numéro. Ne lui demande le N° de devis qu'en dernier recours.
- Une ligne « IDENTIFIÉE PAR LE NOM SEULEMENT » peut être celle d'un homonyme : avant de donner le statut, vérifie avec une question simple que c'est bien sa commande (ex : « C'est bien pour la commande au nom de … ? » en reprenant le nom qu'il t'a donné lui-même, ou ce qu'il avait commandé). Ne donne jamais de N° de suivi ni de BAT sur une ligne identifiée par le nom seulement.
- Donne le statut en phrase simple et naturelle, jamais tel quel et jamais de jargon interne. Tu peux donner le N° de suivi avec le lien quand il est indiqué. Ne donne JAMAIS de date de livraison, de délai précis ni de prix. S'il y a plusieurs commandes et que ce n'est pas clair, demande laquelle (ce qu'il a commandé ou à quel nom).
- Si le client demande à recevoir (à nouveau) son BAT et que « BAT disponible » est indiqué, dis-lui que tu le lui renvoies tout de suite et ajoute À LA FIN de ton message le marqueur interne ###BAT:N°DEVIS### (ex: ###BAT:DE2601069###), le client ne le voit jamais. Si le BAT n'est pas encore disponible, dis qu'il est en préparation.`;
  } catch (err) {
    console.error('Gestion Leïla contexte :', err.message);
    return '';
  }
}

// ###BAT:DE…### retiré de la réponse
function extraireBat(texte) {
  const m = String(texte || '').match(/###BAT:([A-Z0-9-]+)###/i);
  return { clean: String(texte || '').replace(/###BAT:[^#]*###/gi, '').trim(), devis: m ? m[1].toUpperCase() : null };
}

// ###PLANCHE:2|pages 3 et 4 du Canva### retiré de la réponse
function extrairePlanche(texte) {
  const t = String(texte || '');
  const m = t.match(/###PLANCHE:([^|#]+)\|?([^#]*)###/i);
  const clean = t.replace(/###PLANCHE:[^#]*###/gi, '').trim();
  if (!m) return { clean, planche: null };
  const v = m[1].trim().toUpperCase().replace(',', '.');
  const metres = /^A[34]$/.test(v) ? v : Number(v) > 0 && Number(v) < 100 ? String(Math.round(Number(v) * 100) / 100) : null;
  return { clean, planche: metres ? { metres, detail: m[2].trim().slice(0, 200) || 'demande WhatsApp' } : null };
}

// Planche commandée sur WhatsApp : ajoutée au tableau des planches (À PRÉPARER), au nom déjà utilisé pour ce client
const planchesRecentes = new Map(); // anti-doublon : même client + même demande dans les 6 h
async function creerPlancheWhatsApp(tel, { metres, detail }) {
  const cleDoublon = `${tel}|${metres}|${detail}`;
  if (Date.now() - (planchesRecentes.get(cleDoublon) || 0) < 6 * 3600e3) return;
  planchesRecentes.set(cleDoublon, Date.now());
  try {
    const planches = require('./planches');
    // 1. Nom de ses planches précédentes (même numéro dans Odoo) : même ligne hebdo, même client Odoo
    let client = null, sur = '', partnerId = null;
    const pl = ((await planches.listPlanches()).rows || []).slice().reverse();
    for (const p of pl.slice(0, 60)) {
      const ct = await contactPlancheCache(p.client);
      if (ct.tel === tel) { client = p.client; sur = 'client retrouvé par son numéro'; break; }
    }
    const odoo = require('./odoo');
    // 2. Fiche client Odoo avec ce numéro de téléphone
    if (!client && odoo.configured()) {
      const p = await odoo.partnerParTelephone(tel).catch(() => null);
      if (p) { client = p.name; partnerId = p.id; sur = 'client Odoo retrouvé par son numéro'; }
    }
    // 3. Nom de contact (prénom donné ou nom WhatsApp) reconnu sans ambiguïté dans Odoo
    if (!client && supabase && odoo.configured()) {
      const { data } = await supabase.from('clients').select('name').eq('phone_number', tel).maybeSingle();
      if (data?.name) {
        const r = await odoo.findPartner(data.name).catch(() => ({}));
        if (r.partner) { client = r.partner.name; partnerId = r.partner.id; sur = `client Odoo reconnu par son nom (${data.name})`; }
      }
    }
    if (!client) throw new Error('client non reconnu dans Odoo (ni par son numéro, ni par son nom)');
    const res = await planches.ajouter({ client, ...(partnerId ? { partnerId } : {}), metres, statut: 'A PREPARER', remarques: `Demande WhatsApp (Leïla) : ${detail} · ${tel}${sur ? ' · ' + sur : ''}` }, 'Leïla (WhatsApp)');
    console.log(`Gestion Leïla : planche ${metres} ajoutée pour ${client} (${detail})${res?.compteur ? ' sur son compteur hebdo' : ''}`);
  } catch (err) {
    console.error(`Gestion Leïla : planche WhatsApp non ajoutée pour ${tel} :`, err.message);
    try {
      const g = require('./graph');
      const box = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
      await g.sendMail(box, { to: box, subject: `Planche WhatsApp à ajouter à la main - ${tel}`, html: `<p>Leïla a pris une commande de planche sur WhatsApp mais n'a pas pu l'ajouter au tableau (${String(err.message).replace(/</g, '&lt;')}).</p><p>Numéro : ${tel}<br>Métrage : ${metres}<br>Détail : ${String(detail).replace(/</g, '&lt;')}</p>` });
    } catch {}
  }
}

// Renvoi du BAT demandé par le client à Leïla (uniquement une commande de ce numéro ou citée par lui)
async function renvoyerBat(tel, devis) {
  try {
    const liste = await commandesDuClient(tel, [devis]);
    // Sécurité : uniquement une commande enregistrée avec CE numéro (un N° de devis cité ne suffit pas)
    const c = liste.find(x => x.n_devis && x.n_devis.toUpperCase() === devis && x.telephone === tel);
    if (!c) throw new Error('commande introuvable pour ce numéro');
    const bat = await commandes.trouverBat(c.n_devis);
    if (!bat) throw new Error('pas de BAT dans le dossier');
    const be = require('./bat-envoi');
    const base = process.env.PUBLIC_BASE_URL || 'https://igs-bot-whatsapp.onrender.com';
    const nom = `BAT ${c.n_devis} - ${c.client}.pdf`.replace(/[\\/:*?"<>|]/g, '');
    await be.envoyerDocument(tel, be.lienSigne(base, bat.id), nom, `Voici votre BAT pour la commande ${c.n_devis} 📄`);
    if (supabase) await supabase.from('gestion_notifications').insert({ cle: c.cle, type: 'bat_renvoye', canal: 'WhatsApp', statut: 'envoye', destinataire: tel, sujet: null, message: `BAT renvoyé à la demande du client (${nom})`, erreur: null, par: 'Leïla' });
    console.log(`Gestion Leïla : BAT ${c.n_devis} renvoyé à ${tel}`);
  } catch (err) { console.error(`Gestion Leïla : renvoi du BAT ${devis} impossible`, err.message); }
}

// ---------- Journal d'une commande ----------
async function journalCommande(cle) {
  const { rows } = await commandes.listCommandes();
  const c = rows.find(r => r.cle === cle);
  if (!c) throw new Error('Commande introuvable');
  const out = { messages: [], conversation: [], questions: [], telephone: c.telephone || null };
  if (!supabase) return out;
  const [{ data: notifs }, { data: actions }, conv] = await Promise.all([
    supabase.from('gestion_notifications').select('*').eq('cle', cle).order('cree_le', { ascending: false }).limit(50),
    supabase.from('gestion_actions').select('*').eq('cle', cle).in('action', ['bat_envoye_client', 'bat_reponse_client', 'question_leila']).order('cree_le', { ascending: false }).limit(50),
    c.telephone ? supabase.from('conversations').select('role, content, created_at').eq('phone_number', c.telephone).order('created_at', { ascending: false }).limit(80) : Promise.resolve({ data: [] }),
  ]);
  const lib = { prete: 'Commande prête', expedition: 'Commande expédiée', avis: 'Demande d\'avis', planche_prete: 'Planche prête', planche_expedition: 'Planche expédiée', bat_renvoye: 'BAT renvoyé' };
  for (const n of notifs || []) out.messages.push({ le: n.cree_le, titre: lib[n.type] || n.type, canal: n.canal, statut: n.statut, detail: n.statut === 'envoye' ? n.message : n.erreur });
  for (const a of actions || []) {
    if (a.action === 'bat_envoye_client') out.messages.push({ le: a.cree_le, titre: 'BAT envoyé', canal: [a.details?.mail?.ok && 'mail', a.details?.whatsapp?.ok && 'WhatsApp'].filter(Boolean).join(' + '), statut: 'envoye', detail: a.details?.whatsapp && !a.details.whatsapp.ok ? 'WhatsApp : ' + a.details.whatsapp.raison : '' });
    if (a.action === 'bat_reponse_client') out.messages.push({ le: a.cree_le, titre: 'Réponse du client au BAT', canal: a.details?.canal, statut: a.details?.verdict, detail: a.details?.message });
    if (a.action === 'question_leila') out.questions.push({ le: a.cree_le, par: a.utilisateur, question: a.details?.question, reponse: a.details?.reponse });
  }
  out.messages.sort((a, b) => String(b.le).localeCompare(String(a.le)));
  out.conversation = (conv.data || []).reverse().map(m => ({ role: m.role, texte: m.content, le: m.created_at }));
  return out;
}

// ---------- Question interne de l'équipe à Leïla ----------
async function question(cle, q, user) {
  const texte = String(q || '').trim().slice(0, 500);
  if (!texte) throw new Error('Pose une question');
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('Clé Claude non configurée');
  const { rows } = await commandes.listCommandes();
  const c = rows.find(r => r.cle === cle);
  if (!c) throw new Error('Commande introuvable');
  let historique = 'Aucun échange WhatsApp trouvé pour ce client.', note = '';
  if (supabase && c.telephone) {
    const [{ data }, { data: n }] = await Promise.all([
      supabase.from('conversations').select('role, content, created_at').eq('phone_number', c.telephone).order('created_at', { ascending: false }).limit(120),
      supabase.from('client_notes').select('note').eq('phone_number', c.telephone).maybeSingle(),
    ]);
    if (data && data.length) historique = data.reverse().map(m => `[${new Date(m.created_at).toLocaleString('fr-FR', { timeZone: 'America/Guadeloupe' })}] ${m.role === 'user' ? 'Client' : 'IGS (Leïla ou équipe)'} : ${m.content}`).join('\n');
    note = n?.note || '';
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.LEILA_MODELE || 'claude-sonnet-4-6',
      max_tokens: 400,
      system: `Tu es Leïla, l'assistante WhatsApp d'IGS CUSTOM BAR. Un membre de l'équipe te pose une question INTERNE sur un client (le client ne voit pas cet échange). Réponds en français, brièvement et précisément, en te basant UNIQUEMENT sur l'historique des échanges, la note client et les infos de commande ci-dessous. Si l'information n'y est pas, dis-le clairement (« je ne trouve pas ça dans nos échanges »). Cite la date de l'échange quand c'est utile.`,
      messages: [{ role: 'user', content: `COMMANDE : ${c.n_devis || 'sans devis'} · client ${c.client} · statut ${c.statut || '—'} · zone ${c.zone_flocage || '—'} · remarque ${c.remarque || '—'}\nNOTE CLIENT : ${note || '—'}\n\nHISTORIQUE WHATSAPP :\n${historique}\n\nQUESTION DE L'ÉQUIPE : ${texte}` }],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || 'Claude indisponible');
  const reponse = (j.content || []).map(x => x.text || '').join('').trim();
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'question_leila', cle, details: { question: texte, reponse } });
  return { reponse };
}

module.exports = { extrairePlanche, creerPlancheWhatsApp, trouverPourClient, _test: { mots, correspondNom }, contexteCommandes, extraireBat, renvoyerBat, journalCommande, question, statutClair };
