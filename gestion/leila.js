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
  if (st === 'AEXPEDIER') return c.numero_suivi ? 'commande expédiée' : 'commande prête, en cours d\'expédition';
  if (st === 'TERMINEE') return 'commande PRÊTE à être récupérée (du lundi au vendredi de 14h30 à 17h30, 62 rue Louis Vatable, Pointe-à-Pitre)';
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

// Bloc ajouté au prompt système de Leïla
async function contexteCommandes(tel) {
  try {
    let devisCites = [];
    if (supabase && tel) {
      const { data } = await supabase.from('conversations').select('content').eq('phone_number', tel).eq('role', 'user').order('created_at', { ascending: false }).limit(10);
      devisCites = [...new Set((data || []).flatMap(m => String(m.content || '').toUpperCase().match(/\bDE\s?\d{6,8}(?:-R\d+)?\b/g) || []).map(d => d.replace(/\s/g, '')))];
    }
    const liste = await commandesDuClient(tel, devisCites);
    if (!liste.length) {
      return '\n\nCOMMANDES DU CLIENT : aucune commande trouvée pour ce numéro. Si le client demande où en est sa commande, demande-lui gentiment son numéro de devis (il commence par DE).';
    }
    const lignes = liste.slice(0, 6).map(c => `- ${c.n_devis || 'sans devis'}${c.infos ? ' (' + String(c.infos).slice(0, 80) + ')' : ''} : ${statutClair(c)}${c.numero_suivi ? ` ; N° de suivi La Poste : ${c.numero_suivi} (${suiviLien(c.numero_suivi)})` : ''}${(c.bat_envoye_le || (c.bat_info && c.bat_info.bat)) ? (tel && c.telephone === tel ? ' ; BAT disponible' : ' ; BAT existant mais ce numéro n\'est pas celui de la commande : ne le renvoie pas, propose que l\'équipe le renvoie au numéro ou à l\'e-mail de la commande') : ''}`);
    return `\n\nCOMMANDES DU CLIENT (informations internes à jour, à utiliser UNIQUEMENT si le client demande où en est sa commande, son BAT ou son colis) :
${lignes.join('\n')}
RÈGLES COMMANDES : donne le statut en phrase simple et naturelle, jamais tel quel et jamais de jargon interne. Tu peux donner le N° de suivi avec le lien. Ne donne JAMAIS de date de livraison, de délai précis ni de prix. S'il y a plusieurs commandes et que ce n'est pas clair, demande laquelle (N° de devis). Si le client demande à recevoir (à nouveau) son BAT et que « BAT disponible » est indiqué, dis-lui que tu le lui renvoies tout de suite et ajoute À LA FIN de ton message le marqueur interne ###BAT:N°DEVIS### (ex: ###BAT:DE2601069###), le client ne le voit jamais. Si le BAT n'est pas encore disponible, dis qu'il est en préparation.`;
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

module.exports = { contexteCommandes, extraireBat, renvoyerBat, journalCommande, question, statutClair };
