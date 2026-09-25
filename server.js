// ============================================
// IGS CUSTOM BAR - BOT WHATSAPP
// Serveur Node.js : reçoit messages via Dualhook,
// répond avec Claude API, envoie récap par email
// ============================================

const express = require('express');
const app = express();
app.use(express.json());

// ============================================
// CONFIGURATION (à mettre dans variables d'environnement Render)
// ============================================
const PORT = process.env.PORT || 3000;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const DUALHOOK_VERIFY_TOKEN = process.env.DUALHOOK_VERIFY_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const DUALHOOK_API_KEY = process.env.DUALHOOK_API_KEY; // clé dh_live_... générée dans Dualhook
const EMAIL_TO = process.env.EMAIL_TO || 'contact@igscustom.fr'; // gardé en fallback, non utilisé pour l'instant
const RECAP_PHONE_NUMBER = process.env.RECAP_PHONE_NUMBER; // ton numéro perso, format international sans + (ex: 590690XXXXXX)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // ta clé secrète perso pour activer/désactiver le bot
const CLOSED_UNTIL = process.env.CLOSED_UNTIL; // format YYYY-MM-DD : bot totalement désactivé jusqu'à cette date incluse (survit aux redéploiements)

// Stockage temporaire des conversations en cours (en mémoire)
// Pour une vraie prod, utiliser une vraie DB (Postgres, etc.)
const conversations = {};

// Logs des échanges du jour, groupés par date (pour le récap du lendemain matin)
const dailyLogs = {}; // { "2026-09-28": [{from, text, reply}, ...] }
const recapSentDates = new Set(); // évite de renvoyer le même récap plusieurs fois

// Log des échanges pendant une session d'activation manuelle (flush à la désactivation)
let manualLog = [];

// Numéros déjà vus (= probablement réguliers). Simple mémoire en RAM,
// fiable tant que le serveur reste éveillé (voir cron job de keep-alive).
const seenNumbers = new Set();

// Jours où le bot répond automatiquement (jours "off" d'Ismaël)
// Mercredi n'est PAS dans la liste : activation uniquement via lien manuel ce jour-là
const DEFAULT_ACTIVE_DAYS = ['Mon', 'Thu'];

// Override manuel : null = suit le planning par défaut, true = forcé ON, false = forcé OFF
let manualOverride = null;

// Mode test : si true, ignore l'attente des horaires ouvrés (réponse immédiate même hors horaires)
let ignoreBusinessHours = false;

// Phrase exacte envoyée quand le bot ne sait pas répondre (déclenche une alerte pour Ismaël)
const FALLBACK_PHRASE = "Ok, je regarde de mon côté et je reviens vers vous !";

// Utilitaires pour le délai artificiel (simuler une frappe humaine)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Récupère l'heure locale en Guadeloupe (UTC-4, pas de changement heure été/hiver)
function getGuadeloupeTime(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guadeloupe',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  parts.forEach(p => (map[p.type] = p.value));
  return { weekday: map.weekday, hour: parseInt(map.hour, 10), minute: parseInt(map.minute, 10) };
}

// Est-ce qu'on est dans les horaires ouvrés (8h30 - 17h30) ?
function isWithinBusinessHours({ hour, minute }) {
  const afterOpen = hour > 8 || (hour === 8 && minute >= 30);
  const beforeClose = hour < 17 || (hour === 17 && minute <= 30);
  return afterOpen && beforeClose;
}

// Est-ce que le bot doit répondre aujourd'hui ? (planning par défaut, sauf override manuel)
function isBotDayActive(weekday) {
  if (manualOverride !== null) return manualOverride;
  return DEFAULT_ACTIVE_DAYS.includes(weekday);
}

// Est-ce qu'on est en période de fermeture prolongée (congés) ? Prioritaire sur tout le reste
function isClosedForBreak(now) {
  if (!CLOSED_UNTIL) return false;
  const todayKey = getGuadeloupeDateKey(now);
  return todayKey <= CLOSED_UNTIL;
}

// Calcule le délai (en ms) jusqu'au PROCHAIN 8h30 (aujourd'hui si on est avant 8h30, sinon demain)
function msUntilNext8am(now) {
  const guadNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
  const target = new Date(guadNow);
  target.setHours(8, 30, 0, 0);
  if (target.getTime() <= guadNow.getTime()) {
    target.setDate(target.getDate() + 1); // 8h30 déjà passé aujourd'hui → viser demain
  }
  return target.getTime() - guadNow.getTime();
}

// Date du jour au format YYYY-MM-DD (heure Guadeloupe)
function getGuadeloupeDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guadeloupe' }).format(date); // en-CA = format YYYY-MM-DD
}

// Formate une liste de résumés courts en texte lisible pour le récap WhatsApp
function formatRecap(title, entries) {
  if (entries.length === 0) return null;
  const body = entries.map(e => `${e.urgent ? '🚨' : '•'} ${e.summary} (${e.from})`).join('\n');
  return `${title}\n\n${body}`;
}

// Génère un résumé très court (une phrase) d'une conversation pour le récap
async function summarizeForRecap(history) {
  const conversationText = history.map(m => `${m.role === 'user' ? 'Client' : 'Bot'}: ${m.content}`).join('\n');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 40,
      system: "Résume cette conversation client en UNE seule phrase courte (moins de 12 mots), factuelle, en français, sans guillemets et sans tiret cadratin. Exemples : \"Client demande 12 t-shirts avant-arrière\" ou \"Devis débardeurs à faire, quantité non précisée\" ou \"Commande planche 2m, page à confirmer\".",
      messages: [{ role: 'user', content: conversationText }],
    }),
  });
  const data = await response.json();
  const textBlock = data.content?.find(item => item.type === 'text');
  return textBlock?.text?.trim() || "Nouvelle demande client, voir conversation";
}

// ============================================
// PROMPT PERSONA (résumé condensé du fichier complet)
// ============================================
const SYSTEM_PROMPT_BASE = `Tu es un commercial/collaborateur d'IGS Custom Bar, entreprise de personnalisation textile (flocage DTF) à Pointe-à-Pitre, Guadeloupe. Tu N'ES PAS Ismaël, tu es un membre de l'équipe qui le représente en son absence.

RÈGLES DE TON :
- Professionnel mais chaleureux et naturel, jamais robotique
- Emojis sparingly (max 1-2 par message)
- Réponses courtes : 2-4 lignes
- UNE seule question à la fois, jamais un mur d'infos
- Parle d'Ismaël à la 3ème personne ("Ismaël reviendra", "l'équipe")
- NE JAMAIS répéter le nom/entreprise/email du client pour "confirmer", juste noter et continuer
- NE JAMAIS finir par "À toi !" ou style formulaire
- Dis "Bonjour" UNIQUEMENT au tout premier message de la conversation. Pour tous les messages suivants, enchaîne naturellement SANS redire "Bonjour"
- NE JAMAIS annoncer le prix TOTAL (ex: "125€ pour 10 pièces"), donne UNIQUEMENT le prix unitaire (ex: "12,50€ par t-shirt")
- Ne JAMAIS demander si c'est pour une association, une entreprise ou du perso, ça ne nous regarde pas
- INTERDIT d'utiliser le caractère tiret cadratin "—" dans tes réponses. Utilise une virgule à la place
- Ne JAMAIS inventer un produit, un service ou un tarif qui n'est pas listé ci-dessous. Si le produit demandé n'est pas dans la liste, dis que tu n'es pas sûr et utilise la phrase de blocage

CATALOGUE ET TARIFS (à donner en prix unitaire uniquement, jamais de total) :

**T-shirt** (à partir de 10 pièces = tarif pro, en dessous = tarif public) :
- Public (moins de 10) : avant seul 15€ / avant-arrière 20€. Possibilité de commander directement sur igscustom.fr/personnalisation/
- Pro (10 et plus) : avant seul 9,80€ / avant-arrière 12,50€

**Débardeur** (même logique de seuil à 10 pièces) :
- Pro (10 et plus) : avant seul 8,90€ / avant-arrière : à confirmer, utilise la phrase de blocage si demandé pour l'avant-arrière
- Public (moins de 10) : à confirmer, utilise la phrase de blocage si demandé

**Polo** : avant seul 17,50€ / avant-arrière 22,25€ (prix unique, pas de palier)
**Sweat à capuche** : avant seul 30€ / avant-arrière 35€ (prix unique, pas de palier)
**Casquette personnalisée** : 11,25€
**Textile apporté par le client** : 8€/pièce

**Planches DTF prêtes à transférer** :
- 56x100cm : 25€/mètre | A4 : 10€ | A3 : 13€
- Remise dégressive : à partir de 10m, -15% ; à partir de 20m, -20%
- Le client envoie son visuel en PNG ou PDF détouré à contact@igscustom.fr (on peut aussi fournir un modèle Canva aux bonnes dimensions)
- Délai de production : 24 à 48h
- IMPORTANT : même pour les planches, il y a TOUJOURS un devis (ou lien de paiement) envoyé par mail avant de lancer la prod. Ne JAMAIS dire "pas besoin de devis" ou "tarif fixe, pas de devis". Le client doit régler avant que la production démarre

**Livraison / retrait** (valable pour TOUS les produits) :
- Retrait boutique Pointe-à-Pitre : lundi au vendredi, 14h30 à 17h30
- Livraison possible en Guadeloupe même
- Livraison Martinique : tarif indicatif (varie selon le poids du colis), environ 13€ standard / 17€ express, dépôt le lundi, retrait à Ducos
- Délai production commandes textile : 48 à 72h

⚠️ DEUX FLOWS SELON LA SITUATION :

**FLOW A, client régulier connu qui parle de planche/impression/DTF (flow COURT mais avec devis quand même) :**
Si le contexte indique "CLIENT CONNU" ET que le client mentionne planche, impression, ou DTF :
1. Demande UNIQUEMENT : quelle page/design (s'il n'a pas déjà envoyé l'image) + combien de mètres (ou A4/A3)
2. Demande aussi un email pour lui envoyer le devis ou le lien de paiement. PAS besoin de nom
3. Réponds en confirmant que c'est noté et qu'un devis (ou lien de paiement) va lui être envoyé par mail sous peu, avant le lancement en prod. Varie la formulation mais mentionne toujours le devis/paiement
4. Rappelle le retrait boutique si besoin : lundi-vendredi, 14h30-17h30

**FLOW B, tout le reste (nouveau client, devis textile, situation ambiguë, ou client connu mais demande différente) :**
1. Demande UNIQUEMENT la quantité, et une précision minimale sur le produit si besoin pour comprendre la demande (ex: t-shirt ou polo, recto ou recto-dos)
2. Une fois cette info obtenue, réponds en confirmant qu'un devis va être préparé et envoyé dans les plus brefs délais (varie la formulation, mais mentionne toujours le mot "devis"). Ne demande PAS de nom ni d'email, c'est Ismaël qui reprendra contact directement
3. Si tu ne peux pas répondre avec certitude à un moment donné (info manquante, cas complexe, produit non listé, demande hors de ce que tu sais faire), réponds EXACTEMENT et UNIQUEMENT : "Ok, je regarde de mon côté et je reviens vers vous !", rien d'autre. Cette phrase précise est réservée aux cas où tu es réellement bloqué, pas pour une clôture normale de devis

Si le client demande quelque chose qu'on ne fait pas, propose toujours une alternative, jamais un "non" sec.`;

// Construit le prompt final en ajoutant le contexte "client connu ou nouveau"
function buildSystemPrompt(isKnownClient) {
  const contextNote = isKnownClient
    ? "\n\nCONTEXTE : ce numéro a déjà écrit avant, probablement un CLIENT CONNU/RÉGULIER."
    : "\n\nCONTEXTE : c'est la première fois que ce numéro écrit, NOUVEAU CLIENT.";
  return SYSTEM_PROMPT_BASE + contextNote;
}

// ============================================
// 1. VÉRIFICATION WEBHOOK (Meta/Dualhook handshake GET)
// ============================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === DUALHOOK_VERIFY_TOKEN) {
    console.log('Webhook vérifié avec succès');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================
// 2. RÉCEPTION DES MESSAGES (webhook POST)
// ============================================
app.post('/webhook', async (req, res) => {
  // Réponse immédiate à Meta pour éviter les timeouts/retries
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return; // pas un message entrant (ex: statut de livraison)

    const from = message.from; // numéro du client
    const text = message.text?.body;

    if (!text) return; // on ignore les messages non-textuels pour l'instant

    console.log(`Message reçu de ${from}: ${text}`);

    // Priorité absolue : fermeture prolongée en cours (congés) ? Le bot ne répond à rien, peu importe le reste
    if (isClosedForBreak(new Date())) {
      console.log(`Fermeture prolongée en cours (jusqu'au ${CLOSED_UNTIL}) — message laissé pour traitement manuel`);
      return;
    }

    // Vérifier si le bot doit intervenir aujourd'hui (planning ou override manuel)
    const nowCheck = getGuadeloupeTime(new Date());
    if (!isBotDayActive(nowCheck.weekday)) {
      console.log(`Bot inactif ce jour (${nowCheck.weekday}) — message laissé pour traitement manuel par Ismaël`);
      return;
    }

    // Si en dehors des horaires ouvrés (8h30-17h30), on attend le prochain 8h30 avant de répondre
    // (sauf en mode test, où on ignore cette attente)
    if (!ignoreBusinessHours && !isWithinBusinessHours(nowCheck)) {
      const delay = msUntilNext8am(new Date());
      console.log(`Hors horaires ouvrés — réponse programmée dans ${Math.round(delay / 60000)} min`);
      await sleep(delay);
    }

    // Détecter si c'est un client déjà connu (a déjà écrit avant)
    const isKnownClient = seenNumbers.has(from);
    seenNumbers.add(from); // on le mémorise pour la prochaine fois

    // Récupérer ou initialiser l'historique de conversation
    if (!conversations[from]) {
      conversations[from] = [];
    }
    conversations[from].push({ role: 'user', content: text });

    // Appeler Claude API (avec le contexte "client connu ou non")
    const reply = await callClaudeAPI(conversations[from], isKnownClient);

    // Ajouter la réponse à l'historique
    conversations[from].push({ role: 'assistant', content: reply });

    // Délai artificiel (15-45 sec) pour simuler quelqu'un qui tape, pas une réponse robotique instantanée
    const delayMs = randomDelay(15000, 45000);
    console.log(`Attente de ${Math.round(delayMs / 1000)}s avant réponse...`);
    await sleep(delayMs);

    // Envoyer la réponse via WhatsApp
    await sendWhatsAppMessage(from, reply);

    // Logger un résumé court pour le récap groupé, uniquement au moment clé
    // (bot vraiment bloqué OU devis/commande à préparer), pas à chaque message
    const isEscalation = reply.includes(FALLBACK_PHRASE);
    const isDevisOrPlanche = /devis|c'est noté/i.test(reply) && !isEscalation;

    if ((isEscalation || isDevisOrPlanche) && !conversations[from]._loggedForRecap) {
      conversations[from]._loggedForRecap = true; // évite les doublons sur la même conversation
      const summary = await summarizeForRecap(conversations[from]);
      const logEntry = { from, summary, urgent: isEscalation };

      if (manualOverride === true) {
        manualLog.push(logEntry);
      } else {
        const dateKey = getGuadeloupeDateKey(new Date());
        if (!dailyLogs[dateKey]) dailyLogs[dateKey] = [];
        dailyLogs[dateKey].push(logEntry);
      }
    }

  } catch (error) {
    console.error('Erreur traitement message:', error);
  }
});

// ============================================
// 3. APPEL CLAUDE API
// ============================================
async function callClaudeAPI(conversationHistory, isKnownClient) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: buildSystemPrompt(isKnownClient),
      messages: conversationHistory,
    }),
  });

  const data = await response.json();
  const textBlock = data.content?.find(item => item.type === 'text');
  return textBlock?.text || "Désolé, un souci technique. L'équipe revient vers vous très vite !";
}

// ============================================
// 4. ENVOI MESSAGE WHATSAPP (via Dualhook, qui relaie vers Meta)
// ============================================
async function sendWhatsAppMessage(to, text) {
  await fetch(`https://api.dualhook.com/v25.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DUALHOOK_API_KEY}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: text },
    }),
  });
}

// ============================================
// 5. RÉCAP GROUPÉ VIA WHATSAPP
// - Jours auto (lundi/jeudi) : envoyé le lendemain matin (mardi/vendredi)
// - Session manuelle : envoyé dès la désactivation
// ============================================

// Vérifie si un récap "jour auto" est dû (appelé par le cron de keep-alive)
async function checkDailyRecapDue() {
  const now = new Date();
  const local = getGuadeloupeTime(now);

  // Mardi matin = récap de lundi ; Vendredi matin = récap de jeudi
  const recapMap = { Tue: 'Mon', Fri: 'Thu' };
  const targetDay = recapMap[local.weekday];
  if (!targetDay) return;
  if (local.hour < 8 || local.hour >= 10) return; // fenêtre d'envoi : 8h-10h

  // Trouver la date d'hier (le jour auto concerné)
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateKey = getGuadeloupeDateKey(yesterday);

  if (recapSentDates.has(dateKey)) return; // déjà envoyé
  const entries = dailyLogs[dateKey] || [];
  if (entries.length === 0) return; // rien à envoyer

  const recap = formatRecap(`📋 RÉCAP AUTO — ${dateKey}`, entries);
  await sendRecap(recap);
  recapSentDates.add(dateKey);
}

// Envoie le récap de la session manuelle en cours, puis vide le log
async function flushManualRecap() {
  if (manualLog.length === 0) return;
  const recap = formatRecap(`📋 RÉCAP SESSION MANUELLE — ${new Date().toLocaleString('fr-FR')}`, manualLog);
  await sendRecap(recap);
  manualLog = [];
}

// Envoi effectif du récap (WhatsApp vers le numéro perso d'Ismaël)
async function sendRecap(text) {
  if (!text) return;
  if (RECAP_PHONE_NUMBER) {
    await sendWhatsAppMessage(RECAP_PHONE_NUMBER, text);
    console.log('Récap envoyé par WhatsApp à', RECAP_PHONE_NUMBER);
  } else {
    console.log('RECAP_PHONE_NUMBER non configuré — récap ci-dessous:\n', text);
  }
}

// ============================================
// ADMINISTRATION - Activation/désactivation manuelle du bot
// ============================================

// Force le bot à répondre, peu importe le jour (ex: vendredi matin si besoin)
app.get('/admin/activer', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  manualOverride = true;
  manualLog = []; // nouvelle session manuelle, on repart d'un log vide
  res.send('✅ Bot ACTIVÉ manuellement (répond peu importe le jour)');
});

// Force le bot à ne jamais répondre — envoie le récap de la session manuelle en cours
app.get('/admin/desactiver', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const wasManualActive = manualOverride === true;
  manualOverride = false;
  if (wasManualActive) await flushManualRecap();
  res.send('🛑 Bot DÉSACTIVÉ manuellement' + (wasManualActive ? ' — récap envoyé' : ''));
});

// Remet le bot sur son planning normal — envoie aussi le récap si une session manuelle était en cours
app.get('/admin/auto', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const wasManualActive = manualOverride === true;
  manualOverride = null;
  if (wasManualActive) await flushManualRecap();
  res.send('🔄 Bot remis en mode AUTOMATIQUE (planning lundi/jeudi)' + (wasManualActive ? ' — récap envoyé' : ''));
});

// Affiche le statut actuel du bot
app.get('/admin/statut', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  if (isClosedForBreak(new Date())) {
    return res.send(`🔒 FERMETURE PROLONGÉE jusqu'au ${CLOSED_UNTIL} inclus (bot totalement inactif, peu importe le reste)`);
  }
  const mode = manualOverride === null ? 'AUTOMATIQUE (lundi/jeudi)' : manualOverride ? 'FORCÉ ACTIF' : 'FORCÉ INACTIF';
  res.send(`Statut actuel : ${mode}`);
});

// TEST UNIQUEMENT : ignore l'attente des horaires ouvrés (réponse immédiate, peu importe l'heure)
app.get('/admin/test-horaires-on', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  ignoreBusinessHours = true;
  res.send('🧪 Mode test activé : le bot répond immédiatement peu importe l\'heure');
});

// Remet la vérification normale des horaires ouvrés
app.get('/admin/test-horaires-off', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  ignoreBusinessHours = false;
  res.send('✅ Mode test désactivé : le bot respecte à nouveau les horaires ouvrés (8h30-17h30)');
});

// TEST UNIQUEMENT : force l'envoi immédiat du récap (jour auto d'aujourd'hui + session manuelle en cours)
// Pratique pendant la phase de test, sans attendre le lendemain matin ou une désactivation
app.get('/admin/test-recap', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const todayKey = getGuadeloupeDateKey(new Date());
  const todayEntries = dailyLogs[todayKey] || [];
  let sent = 0;

  if (todayEntries.length > 0) {
    await sendRecap(formatRecap(`📋 RÉCAP TEST — ${todayKey}`, todayEntries));
    sent++;
  }
  if (manualLog.length > 0) {
    await flushManualRecap();
    sent++;
  }
  res.send(sent > 0 ? `✅ ${sent} récap(s) de test envoyé(s)` : 'Rien à envoyer pour l\'instant (aucun échange enregistré aujourd\'hui)');
});

// Route appelée par le Cron Job Render toutes les X minutes : garde le serveur éveillé
// + vérifie si un récap auto (mardi/vendredi matin) est dû
app.get('/cron/keepalive', async (req, res) => {
  await checkDailyRecapDue();
  res.send('OK');
});

// ============================================
// LANCEMENT SERVEUR
// ============================================
app.get('/', (req, res) => {
  res.send('IGS Bot WhatsApp - Serveur actif ✅');
});

app.listen(PORT, () => {
  console.log(`Serveur IGS Bot démarré sur le port ${PORT}`);
});
