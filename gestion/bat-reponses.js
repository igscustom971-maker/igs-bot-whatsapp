// ============================================
// IGS GESTION - RÉPONSES DES CLIENTS AU BAT (WhatsApp et mail)
// Après l'envoi du BAT, la réponse du client est lue :
//  - WhatsApp : message reçu sur le numéro de Leïla (relevé au webhook, en lecture seule)
//  - Mail : réponse au mail « Votre BAT à valider - commande DE… » dans la boîte contact@ (toutes les 5 min)
// Réponse clairement favorable -> la commande passe en VALIDÉE automatiquement.
// Demande de modification ou réponse ambiguë -> notée sur la commande, à traiter à la main.
// ============================================

const g = require('./graph');
const { supabase } = require('./db');
const commandes = require('./commandes');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
const txt = v => String(v ?? '').trim();
const sansAccent = s => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- Lecture de la réponse : "valide", "modification" ou "autre" ----------
const OUI = /\b(je valide|valide|validee?|valider|c'?est (bon|ok|parfait|top|nickel)|ok pour (moi|le bat)|bon pour (moi|tirage|impression|accord)|bon a tirer|go|parfait|nickel|top|d'?accord|ca me va|tout est bon|lancez|vous pouvez (lancer|imprimer|y aller))\b/;
const NON = /\b(modif|changer|change|corrig|erreur|faute|pas bon|pas ok|non\b|plus (grand|petit|haut|bas)|deplac|remplac|enlev|ajout|autre couleur|mauvais|attend|attendez|pas encore|sauf|mais)\b/;

function lireRegex(message) {
  const m = sansAccent(message);
  if (!m) return 'autre';
  if (NON.test(m)) return 'modification';
  if (OUI.test(m) || /^(ok|oui|yes|👍|✅|👌)[\s!.👍✅👌]*$/u.test(txt(message).toLowerCase())) return 'valide';
  return 'autre';
}

async function lireReponse(message) {
  if (!CLAUDE_KEY) return lireRegex(message);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.BAT_MODELE || 'claude-sonnet-4-6',
        max_tokens: 5,
        system: `Un atelier de personnalisation textile a envoyé à son client le BAT (bon à tirer) de sa commande et lui demande de le valider. Voici la réponse du client.
Réponds par UN SEUL mot :
- VALIDE : le client accepte le BAT sans rien demander de changer (ex. "je valide", "ok c'est parfait", "👍", "c'est bon pour moi, merci").
- MODIFICATION : le client demande un changement, signale une erreur ou émet une réserve.
- AUTRE : la réponse ne parle pas du BAT, pose une question ou est ambiguë.
En cas de doute, réponds AUTRE.`,
        messages: [{ role: 'user', content: txt(message).slice(0, 1500) }],
      }),
    });
    const j = await res.json();
    const mot = sansAccent(j?.content?.[0]?.text || '');
    if (mot.startsWith('valide')) return 'valide';
    if (mot.startsWith('modif')) return 'modification';
    if (mot.startsWith('autre')) return 'autre';
    return lireRegex(message);
  } catch (err) {
    console.error('Gestion BAT réponse (Claude) :', err.message);
    return lireRegex(message);
  }
}

// ---------- Traitement d'une réponse pour une commande en attente de validation ----------
async function traiter(c, { message, canal, le }) {
  if (!txt(message)) return null;
  if (c.bat_envoye_le && new Date(le) < new Date(c.bat_envoye_le)) return null; // réponse antérieure à l'envoi
  if (c.bat_reponse && c.bat_reponse.verdict === 'valide') return null; // déjà validé : on ne revient pas en arrière
  const verdict = await lireReponse(message);
  const reponse = { message: txt(message).slice(0, 500), canal, le: new Date(le).toISOString(), verdict };
  if (supabase) {
    await supabase.from('gestion_commandes').update({ bat_reponse: reponse }).eq('cle', c.cle);
    await supabase.from('gestion_actions').insert({ utilisateur: `Client (${canal})`, action: 'bat_reponse_client', cle: c.cle, details: reponse });
  }
  console.log(`Gestion BAT ${c.n_devis} : réponse ${canal} « ${reponse.message.slice(0, 80)} » -> ${verdict}`);
  if (verdict === 'valide') {
    try { await commandes.validerBat(c.cle, `Client (${canal})`, canal, reponse.message); }
    catch (err) { console.error(`Gestion BAT ${c.n_devis} : passage en VALIDÉE impossible`, err.message); }
  }
  return reponse;
}

// En attente de validation : BAT envoyé, pas encore validé (un « merci » après validation ne doit rien effacer)
const enAttente = rows => rows.filter(r => r.bat_envoye_le && commandes.avantBat(r.statut) && !(r.bat_reponse && r.bat_reponse.verdict === 'valide'));

// WhatsApp : appelé depuis le webhook (lecture seule) pour chaque message texte reçu
async function messagesWhatsApp(msgs) {
  if (!msgs.length) return;
  const { rows } = await commandes.listCommandes();
  const attente = enAttente(rows);
  if (!attente.length) return;
  for (const m of msgs) {
    const c = attente.filter(r => r.telephone === m.from).sort((a, b) => String(b.bat_envoye_le).localeCompare(String(a.bat_envoye_le)))[0];
    if (c) await traiter(c, { message: m.texte, canal: 'WhatsApp', le: m.le }).catch(err => console.error('Gestion BAT réponse WhatsApp :', err.message));
  }
}

// Mail : réponses dans la boîte contact@ (sujet contenant « Votre BAT à valider - commande DE… »)
let lectureEnCours = false;
async function lireMails() {
  if (lectureEnCours || !supabase) return;
  lectureEnCours = true;
  try {
    const { rows } = await commandes.listCommandes();
    const attente = enAttente(rows);
    if (!attente.length) return;
    const depuis = attente.map(r => r.bat_envoye_le).sort()[0];
    const url = `/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox/messages?$filter=receivedDateTime ge ${new Date(depuis).toISOString()}`
      + `&$select=id,subject,from,receivedDateTime,uniqueBody,bodyPreview&$orderby=receivedDateTime asc&$top=100`;
    const { value = [] } = await g.graph(url);
    const { data: deja } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'bat_mails_lus').maybeSingle();
    const lus = new Set(deja ? JSON.parse(deja.valeur) : []);
    let change = false;
    for (const m of value) {
      if (lus.has(m.id)) continue;
      const devis = (String(m.subject || '').match(/BAT\s+[àa]\s+valider\s*-\s*commande\s+([A-Z]{1,6}\d+(?:-R\d+)?)/i) || [])[1];
      const exp = String(m.from?.emailAddress?.address || '').toLowerCase();
      if (!devis || exp === MAILBOX) continue;
      lus.add(m.id); change = true;
      const c = attente.find(r => String(r.n_devis).toUpperCase() === devis.toUpperCase());
      if (!c) continue;
      const corps = txt(String(m.uniqueBody?.content || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')) || txt(m.bodyPreview);
      await traiter(c, { message: corps, canal: 'mail', le: m.receivedDateTime });
    }
    if (change) await supabase.from('gestion_reglages').upsert({ cle: 'bat_mails_lus', valeur: JSON.stringify([...lus].slice(-500)), updated_at: new Date().toISOString() });
  } catch (err) {
    console.error('Gestion BAT réponses mail :', err.message);
  } finally { lectureEnCours = false; }
}

function start() {
  setTimeout(() => lireMails().catch(() => {}), 90e3);
  setInterval(() => lireMails().catch(() => {}), 5 * 60e3);
}

module.exports = { messagesWhatsApp, lireMails, start, _test: { lireRegex, lireReponse } };
