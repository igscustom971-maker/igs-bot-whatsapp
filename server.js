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

// Buffer de messages en attente par client, pour regrouper les messages rapprochés
// (ex: client qui envoie 3 messages en 20 secondes) en une seule réponse
const pendingBuffers = {}; // { [from]: { texts: [...], timer } }
const DEBOUNCE_MS = 8000; // attend 8 sec de silence avant de traiter les messages accumulés

// Messages reçus pendant que le bot était inactif (jour non actif / désactivé manuellement),
// à traiter dès que le bot redevient actif. PAS utilisé pendant une fermeture prolongée (congés).
const backlogMessages = {}; // { [from]: [text, text, ...] }

// Pour savoir si Ismaël a déjà répondu manuellement depuis son app (via l'écho WhatsApp Coexistence)
const lastInboundAt = {};   // { [from]: timestamp du dernier message client }
const lastIsmaelReplyAt = {}; // { [from]: timestamp de la dernière réponse manuelle d'Ismaël détectée }

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

// Fermeture prolongée réglable depuis le panel (en mémoire, se réinitialise à chaque redéploiement,
// contrairement à CLOSED_UNTIL qui est une variable d'environnement plus robuste)
let closureOverrideUntil = null;

// Est-ce qu'on est en période de fermeture prolongée (congés) ? Prioritaire sur tout le reste
// Vérifie à la fois la variable d'environnement CLOSED_UNTIL et l'override réglé depuis le panel
function isClosedForBreak(now) {
  const todayKey = getGuadeloupeDateKey(now);
  if (CLOSED_UNTIL && todayKey <= CLOSED_UNTIL) return true;
  if (closureOverrideUntil && todayKey <= closureOverrideUntil) return true;
  return false;
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

// Formate une liste de résumés courts en texte lisible pour le récap WhatsApp,
// regroupés par catégorie : urgent/bloqué en premier, puis devis/commandes normales
function formatRecap(title, entries) {
  if (entries.length === 0) return null;

  const urgentEntries = entries.filter(e => e.urgent);
  const normalEntries = entries.filter(e => !e.urgent);

  let body = '';
  if (urgentEntries.length > 0) {
    body += `🚨 À TRAITER EN PRIORITÉ (bot bloqué)\n`;
    body += urgentEntries.map(e => `• ${e.summary} (${e.from})`).join('\n');
  }
  if (normalEntries.length > 0) {
    if (body) body += '\n\n';
    body += `📋 DEVIS / COMMANDES À PRÉPARER\n`;
    body += normalEntries.map(e => `• ${e.summary} (${e.from})`).join('\n');
  }

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
      max_tokens: 60,
      system: `Résume cette conversation client en UNE seule phrase narrative, claire et précise, en français, sans guillemets et sans tiret cadratin.

Règles :
- Si le client a donné son prénom (ou nom) à un moment dans la conversation, commence la phrase par ce prénom. Sinon, commence par "Le client" ou "La cliente" si le genre est déductible, sinon "Un client".
- Précise le produit, la quantité si connue, et l'action encore à faire (ex: devis à envoyer, visuel en attente, relance sans réponse).
- Reste concis mais informatif, une seule phrase.

Exemples :
"Sandrine relance pour un devis en attente sur 7 t-shirts flocage seul, elle enverra le visuel une fois le devis reçu."
"Un client demande un devis pour 12 polos avant-arrière, infos complètes, devis à préparer."
"La cliente a une commande planche DTF de 2m en attente, la page reste à confirmer."`,
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
const SYSTEM_PROMPT_BASE = `Tu es un membre de l'équipe commerciale d'IGS Custom Bar, entreprise de personnalisation textile (flocage DTF) à Pointe-à-Pitre, Guadeloupe. L'équipe a plusieurs pôles (commercial, production, etc.) : toi tu es côté commercial, tu prends la demande, ce n'est pas forcément toi qui produiras derrière.

RÈGLES DE TON :
- Professionnel mais chaleureux et naturel, jamais robotique
- Emojis sparingly (max 1-2 par message)
- Réponses courtes : 2-4 lignes
- UNE seule question à la fois, jamais un mur d'infos
- NE JAMAIS mentionner le prénom "Ismaël" dans tes réponses. Parle au nom de l'équipe ("nous allons vous faire le devis", "on vous prépare ça") ou à la première personne comme un membre de l'équipe ("je vous fais ça et je reviens vers vous au plus vite"). Jamais de renvoi vers une personne précise nommée
- NE JAMAIS répéter le nom/entreprise/email du client pour "confirmer", juste noter et continuer
- NE JAMAIS finir par "À toi !" ou style formulaire
- Dis "Bonjour" UNIQUEMENT au tout premier message de la conversation. Pour tous les messages suivants, enchaîne naturellement SANS redire "Bonjour"
- NE JAMAIS annoncer le prix TOTAL (ex: "125€ pour 10 pièces"), donne UNIQUEMENT le prix unitaire (ex: "12,50€ par t-shirt")
- Ne JAMAIS demander si c'est pour une association, une entreprise ou du perso, ça ne nous regarde pas
- INTERDIT d'utiliser le caractère tiret cadratin "—" dans tes réponses. Utilise une virgule à la place
- Ne JAMAIS inventer un produit, un service ou un tarif qui n'est pas listé ci-dessous. Si le produit demandé n'est pas dans la liste, dis que tu n'es pas sûr et utilise la phrase de blocage
- Ne JAMAIS annoncer une date précise (ex: "on reprend le 1er octobre") sauf si cette info précise t'est donnée explicitement dans ce prompt. Si tu n'es pas sûr d'une date, reste vague ("on revient vers vous très vite", "dès que possible") plutôt que d'inventer ou de répéter une ancienne info qui a pu changer
- Adapte ton registre à celui du client : si le client est familier/détendu (tutoiement, ton décontracté), tu peux tutoyer et être plus familier en retour, c'est aussi souvent un signe de client régulier. Si le client est plutôt formel, reste au vouvoiement
- Sur le recto/verso (ou une autre précision similaire) : si tu as posé la question UNE fois et que le client ne répond pas clairement dessus (il enchaîne sur autre chose), NE PAS insister ni reposer la question. Pars du principe que c'est recto-verso par défaut et continue naturellement, ça évite de paraître insistant

CATALOGUE ET TARIFS (à donner en prix unitaire uniquement, jamais de total) :

**T-shirt** (à partir de 10 pièces = tarif pro, en dessous = tarif public) :
- Public (moins de 10) : avant seul 15€ / avant-arrière 20€. Possibilité de commander directement sur igscustom.fr/personnalisation/
- Pro (10 et plus) : avant seul 9,80€ / avant-arrière 12,50€
- Flexibilité : pour une quantité proche du seuil (7, 8 ou 9 pièces), tu peux appliquer le tarif pro directement, pas besoin d'insister sur le seuil de 10

**Débardeur** (même logique de seuil à 10 pièces) :
- Pro (10 et plus) : avant seul 8,90€ / avant-arrière : à confirmer, utilise la phrase de blocage si demandé pour l'avant-arrière
- Public (moins de 10) : à confirmer, utilise la phrase de blocage si demandé

**Polo** : avant seul 17,50€ / avant-arrière 22,25€ (prix unique, pas de palier)
**Sweat à capuche** : avant seul 30€ / avant-arrière 35€ (prix unique, pas de palier)
**Casquette personnalisée** : 11,25€
**Timbale / éco cup / gobelet personnalisé** (termes équivalents utilisés aux Antilles) : impression DTF UV directe, 2,30€/pièce. Pour une demande "stickers/autocollants sur mes propres timbales" (planche DTF à coller soi-même), le prix dépend des dimensions, utilise la phrase de blocage pour laisser l'équipe chiffrer précisément
**Textile apporté par le client** : 8€/pièce

**Planches DTF prêtes à transférer** :
- 56x100cm : 25€/mètre | A4 : 10€ | A3 : 13€
- Remise dégressive : à partir de 10m, -15% ; à partir de 20m, -20%
- Le client envoie son visuel en PNG ou PDF détouré à contact@igscustom.fr (on peut aussi fournir un modèle Canva aux bonnes dimensions)
- Délai de production : 24 à 48h
- IMPORTANT : même pour les planches, il y a TOUJOURS un devis (ou lien de paiement) envoyé par mail avant de lancer la prod. Ne JAMAIS dire "pas besoin de devis" ou "tarif fixe, pas de devis". Le client doit régler avant que la production démarre

**Livraison / retrait** (dépend de la localisation du client, voir CONTEXTE ci-dessous) :
- Client en Guadeloupe : retrait boutique possible à Pointe-à-Pitre (lundi au vendredi, 14h30 à 17h30), ou livraison en Guadeloupe même
- Client en Martinique : PAS de point de retrait, uniquement expédition. Deux options : standard par La Poste, ou express (départ tous les mardis)
- Délai production commandes textile : 48 à 72h

⚠️ LE VRAI PROCESS DE COMMANDE (textile personnalisé) À RESPECTER :
1. Prise d'informations de base : zone de flocage, type de textile/produit, quantité, nom, et email (nécessaires pour établir et envoyer le devis, c'est TOUT ce que toi tu collectes)
2. Devis envoyé par l'équipe
3. Une fois le devis payé, un formulaire est envoyé automatiquement par mail pour récupérer tailles, couleurs et visuels
4. BAT (bon à tirer) réalisé et validé
5. Production, puis livraison

TRÈS IMPORTANT : toi tu t'arrêtes à l'étape 1. Le nom et l'email sont nécessaires pour le devis, demande-les normalement. Mais NE JAMAIS demander les tailles, couleurs ou visuels pendant la conversation, tout ça arrive automatiquement après paiement du devis via le formulaire, ce serait redondant. Une fois que tu as zone + produit + quantité + nom + email, confirme qu'un devis va être envoyé et arrête-toi là.

⚠️ DEUX FLOWS SELON LA SITUATION :

**FLOW A, client régulier connu qui parle de planche/impression/DTF (flow COURT mais avec devis quand même) :**
Si le contexte indique "CLIENT CONNU" ET que le client mentionne planche, impression, ou DTF :
1. Demande UNIQUEMENT : quelle page/design (s'il n'a pas déjà envoyé l'image) + combien de mètres (ou A4/A3)
2. Demande aussi un email pour envoyer le devis ou le lien de paiement. PAS besoin de nom pour ce flow court planche
3. Réponds en confirmant que c'est noté et qu'un devis (ou lien de paiement) va être envoyé par mail sous peu, avant le lancement en prod. Varie la formulation mais mentionne toujours le devis/paiement
4. Rappelle les infos de retrait/livraison adaptées à sa localisation (voir CATALOGUE ci-dessus) si besoin

**FLOW B, tout le reste (nouveau client, devis textile, situation ambiguë, ou client connu mais demande différente) :**
1. Demande la zone de flocage, le produit, la quantité, puis le nom et l'email pour établir le devis (voir le VRAI PROCESS ci-dessus, rien de plus, pas de tailles/couleurs/visuels)
2. Une fois ces infos obtenues, réponds en confirmant qu'un devis va être préparé et envoyé dans les plus brefs délais (varie la formulation, mais mentionne toujours le mot "devis")
3. Si tu ne peux pas répondre avec certitude à un moment donné (info manquante, cas complexe, produit non listé, demande hors de ce que tu sais faire), réponds EXACTEMENT et UNIQUEMENT : "Ok, je regarde de mon côté et je reviens vers vous !", rien d'autre. Cette phrase précise est réservée aux cas où tu es réellement bloqué, pas pour une clôture normale de devis

Si le client demande quelque chose qu'on ne fait pas, propose toujours une alternative, jamais un "non" sec.`;

// Détecte la région du client à partir du préfixe téléphonique (596 = Martinique, 590 = Guadeloupe)
function detectRegion(from) {
  if (from.startsWith('596')) return 'Martinique';
  if (from.startsWith('590')) return 'Guadeloupe';
  return 'inconnue';
}

// Construit le prompt final en ajoutant le contexte "client connu ou nouveau" + région
function buildSystemPrompt(isKnownClient, from) {
  const clientNote = isKnownClient
    ? "CONTEXTE CLIENT : ce numéro a déjà écrit avant, probablement un CLIENT CONNU/RÉGULIER."
    : "CONTEXTE CLIENT : c'est la première fois que ce numéro écrit, NOUVEAU CLIENT.";
  const region = detectRegion(from);
  const regionNote = region !== 'inconnue'
    ? `\nCONTEXTE LOCALISATION : ce client est en ${region}. Adapte les infos de retrait/livraison en conséquence (voir CATALOGUE).`
    : '';
  return SYSTEM_PROMPT_BASE + '\n\n' + clientNote + regionNote;
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
    const echo = change?.value?.message_echoes?.[0]; // vraie structure Meta pour les échos Coexistence

    // Détection d'un écho WhatsApp Coexistence : message envoyé par Ismaël DEPUIS SON APP
    // (arrive dans un champ "message_echoes" séparé, pas dans "messages")
    if (echo) {
      const clientNumber = echo.to;
      lastIsmaelReplyAt[clientNumber] = Date.now();
      console.log(`Écho détecté : Ismaël a répondu manuellement à ${clientNumber}`);
      return;
    }

    if (!message) return; // pas un message entrant (ex: statut de livraison)

    const from = message.from; // numéro du client
    const text = message.text?.body;

    if (!text) return; // on ignore les messages non-textuels pour l'instant

    console.log(`Message reçu de ${from}: ${text}`);
    lastInboundAt[from] = Date.now();

    // Priorité absolue : fermeture prolongée en cours (congés) ? Le bot ne répond à rien,
    // et on ne met PAS en rattrapage (trop risqué de tout traiter d'un coup après des semaines)
    if (isClosedForBreak(new Date())) {
      console.log(`Fermeture prolongée en cours (jusqu'au ${CLOSED_UNTIL}) — message laissé pour traitement manuel`);
      return;
    }

    // Le bot est-il actif aujourd'hui (planning ou override manuel) ?
    const nowCheck = getGuadeloupeTime(new Date());
    if (!isBotDayActive(nowCheck.weekday)) {
      console.log(`Bot inactif ce jour (${nowCheck.weekday}) — message mis en attente de rattrapage`);
      if (!backlogMessages[from]) backlogMessages[from] = [];
      backlogMessages[from].push(text);
      return;
    }

    // Bot actif : on traite via le buffer de regroupement (anti-spam de messages rapprochés)
    bufferIncomingMessage(from, text);

  } catch (error) {
    console.error('Erreur traitement message:', error);
  }
});

// Ajoute un message au buffer d'un client, et programme le traitement groupé
// après DEBOUNCE_MS de silence (pour regrouper les messages envoyés coup sur coup)
function bufferIncomingMessage(from, text) {
  if (!pendingBuffers[from]) {
    pendingBuffers[from] = { texts: [], timer: null };
  }
  pendingBuffers[from].texts.push(text);

  if (pendingBuffers[from].timer) clearTimeout(pendingBuffers[from].timer);
  pendingBuffers[from].timer = setTimeout(() => {
    const combinedText = pendingBuffers[from].texts.join('\n');
    delete pendingBuffers[from];
    processMessageNow(from, combinedText).catch(err => console.error('Erreur traitement bufferisé:', err));
  }, DEBOUNCE_MS);
}

// Traite un message (ou un lot de messages regroupés) : gère l'attente horaires ouvrés puis répond
async function processMessageNow(from, text) {
  const nowCheck = getGuadeloupeTime(new Date());

  // Si en dehors des horaires ouvrés (8h30-17h30), on attend le prochain 8h30 avant de répondre
  // (sauf en mode test, où on ignore cette attente)
  if (!ignoreBusinessHours && !isWithinBusinessHours(nowCheck)) {
    const delay = msUntilNext8am(new Date());
    console.log(`Hors horaires ouvrés — réponse programmée dans ${Math.round(delay / 60000)} min`);
    await sleep(delay);

    // Après l'attente, on revérifie : si le jour suivant n'est PAS un jour actif
    // (ex: message jeudi soir, mais vendredi n'est pas auto), on bascule en rattrapage
    // au lieu de répondre automatiquement
    const afterWait = getGuadeloupeTime(new Date());
    if (isClosedForBreak(new Date()) || !isBotDayActive(afterWait.weekday)) {
      console.log(`Jour suivant non actif — message basculé en rattrapage pour ${from}`);
      if (!backlogMessages[from]) backlogMessages[from] = [];
      backlogMessages[from].push(text);
      return;
    }
  }

  await handleIncomingText(from, text);
}

// Traitement effectif : appelle Claude, applique le délai naturel, envoie la réponse, logge le récap
async function handleIncomingText(from, text) {
  // Détecter si c'est un client déjà connu (a déjà écrit avant)
  const isKnownClient = seenNumbers.has(from);
  seenNumbers.add(from); // on le mémorise pour la prochaine fois

  // On mémorise le moment de ce message précis, pour la vérification d'écho juste avant l'envoi
  const thisMessageAt = Date.now();

  // Récupérer ou initialiser l'historique de conversation
  if (!conversations[from]) {
    conversations[from] = [];
  }
  conversations[from].push({ role: 'user', content: text });

  // Appeler Claude API (avec le contexte "client connu ou non")
  const reply = await callClaudeAPI(conversations[from], isKnownClient, from);

  // Ajouter la réponse à l'historique
  conversations[from].push({ role: 'assistant', content: reply });

  // Délai artificiel (15-45 sec) pour simuler quelqu'un qui tape, pas une réponse robotique instantanée
  const delayMs = randomDelay(15000, 45000);
  console.log(`Attente de ${Math.round(delayMs / 1000)}s avant réponse...`);
  await sleep(delayMs);

  // Double vérification juste avant l'envoi : si Ismaël a répondu manuellement PENDANT
  // ce délai d'attente, on annule l'envoi du bot pour éviter une réponse en double
  if (lastIsmaelReplyAt[from] && lastIsmaelReplyAt[from] > thisMessageAt) {
    console.log(`Envoi annulé pour ${from} : Ismaël a répondu manuellement pendant le délai d'attente`);
    return;
  }

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
}

// Traite les messages en rattrapage (reçus pendant que le bot était inactif),
// appelé dès que le bot redevient actif (activation manuelle ou passage en auto).
// Ne traite QUE les conversations où Ismaël n'a pas déjà répondu manuellement depuis.
async function flushBacklogIfActive() {
  if (isClosedForBreak(new Date())) return; // jamais de rattrapage pendant une fermeture prolongée

  const nowCheck = getGuadeloupeTime(new Date());
  if (!isBotDayActive(nowCheck.weekday)) return; // toujours inactif, rien à faire

  const numbers = Object.keys(backlogMessages);
  for (const from of numbers) {
    const texts = backlogMessages[from];
    delete backlogMessages[from];
    if (!texts || texts.length === 0) continue;

    // Si Ismaël a répondu manuellement APRÈS le dernier message de ce client, on ne fait rien
    const alreadyAnswered = lastIsmaelReplyAt[from] && lastIsmaelReplyAt[from] > (lastInboundAt[from] || 0);
    if (alreadyAnswered) {
      console.log(`Rattrapage ignoré pour ${from} : déjà répondu manuellement par Ismaël`);
      continue;
    }

    console.log(`Rattrapage de ${texts.length} message(s) en attente pour ${from}`);
    await processMessageNow(from, texts.join('\n'));
  }
}

// ============================================
// 3. APPEL CLAUDE API
// ============================================
async function callClaudeAPI(conversationHistory, isKnownClient, from) {
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
      system: buildSystemPrompt(isKnownClient, from),
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
app.get('/admin/activer', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  manualOverride = true;
  manualLog = []; // nouvelle session manuelle, on repart d'un log vide
  await flushBacklogIfActive(); // traite les messages en attente depuis la dernière activité
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
  await flushBacklogIfActive(); // au cas où on retombe pile sur un jour auto actif
  res.send('🔄 Bot remis en mode AUTOMATIQUE (planning lundi/jeudi)' + (wasManualActive ? ' — récap envoyé' : ''));
});

// Affiche le statut actuel du bot
app.get('/admin/statut', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const todayKey = getGuadeloupeDateKey(new Date());
  if (CLOSED_UNTIL && todayKey <= CLOSED_UNTIL) {
    return res.send(`🔒 FERMETURE (Render) jusqu'au ${CLOSED_UNTIL} inclus`);
  }
  if (closureOverrideUntil && todayKey <= closureOverrideUntil) {
    return res.send(`🔒 FERMETURE (panel) jusqu'au ${closureOverrideUntil} inclus`);
  }
  const mode = manualOverride === null ? 'AUTOMATIQUE (lundi/jeudi)' : manualOverride ? 'FORCÉ ACTIF' : 'FORCÉ INACTIF';
  res.send(`Statut actuel : ${mode}`);
});

// Ferme le bot jusqu'à une date donnée (format YYYY-MM-DD), réglable depuis le panel
app.get('/admin/fermer', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).send('Date invalide, format attendu : YYYY-MM-DD');
  closureOverrideUntil = date;
  res.send(`🔒 Fermeture activée jusqu'au ${date} inclus`);
});

// Lève la fermeture réglée depuis le panel (ne touche pas à CLOSED_UNTIL sur Render, si utilisée)
app.get('/admin/lever-fermeture', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  closureOverrideUntil = null;
  res.send('🔓 Fermeture (panel) levée. Si le bot reste fermé, vérifie la variable CLOSED_UNTIL sur Render.');
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

// Affiche les messages actuellement en attente de rattrapage (debug/vérification)
app.get('/admin/backlog', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const numbers = Object.keys(backlogMessages);
  if (numbers.length === 0) return res.send('Aucun message en attente de rattrapage.');
  const lines = numbers.map(from => `${from} (${backlogMessages[from].length} msg): ${backlogMessages[from].join(' | ')}`);
  res.send('📥 En attente de rattrapage :\n\n' + lines.join('\n'));
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

// Route appelée par UptimeRobot toutes les 5 minutes : garde le serveur éveillé
// + vérifie si un récap auto (mardi/vendredi matin) est dû
// + traite le rattrapage si on vient de basculer naturellement sur un jour actif
app.get('/cron/keepalive', async (req, res) => {
  await checkDailyRecapDue();
  await flushBacklogIfActive();
  res.send('OK');
});

// ============================================
// PANNEAU DE CONTRÔLE MOBILE (même serveur = pas de souci de sécurité cross-domaine)
// ============================================
app.get('/panel', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>IGS Bot - Contrôle</title>
<style>
  :root {
    --bg: #0f1115;
    --card: #1a1d24;
    --accent: #25d366;
    --danger: #e5484d;
    --text: #f4f4f5;
    --muted: #9ca3af;
    --border: #2a2d35;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    min-height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px 40px; }
  h1 { font-size: 20px; font-weight: 700; margin: 8px 0 4px; }
  .subtitle { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .status-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 20px;
    min-height: 52px;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .status-box.loading { color: var(--muted); }
  .section-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 20px 0 10px;
    font-weight: 600;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  button {
    border: none;
    border-radius: 14px;
    padding: 16px 10px;
    font-size: 15px;
    font-weight: 600;
    color: white;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  button:active { transform: scale(0.96); opacity: 0.85; }
  .btn-emoji { font-size: 22px; }
  .btn-activer { background: var(--accent); }
  .btn-desactiver { background: var(--danger); }
  .btn-auto { background: #3b82f6; }
  .btn-statut { background: #6b7280; }
  .btn-test { background: #8b5cf6; }
  .btn-full { grid-column: 1 / -1; }
  footer { text-align: center; color: var(--muted); font-size: 11px; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🤖 IGS Bot WhatsApp</h1>
  <div class="subtitle">Panneau de contrôle rapide</div>

  <div class="status-box loading" id="status">Chargement du statut...</div>

  <div class="section-title">Activation</div>
  <div class="grid">
    <button class="btn-activer" onclick="callAdmin('activer')">
      <span class="btn-emoji">✅</span> Activer maintenant
    </button>
    <button class="btn-desactiver" onclick="callAdmin('desactiver')">
      <span class="btn-emoji">🛑</span> Désactiver
    </button>
    <button class="btn-auto btn-full" onclick="callAdmin('auto')">
      <span class="btn-emoji">🔄</span> Remettre en automatique
    </button>
  </div>

  <div class="section-title">Infos</div>
  <div class="grid">
    <button class="btn-statut btn-full" onclick="callAdmin('statut')">
      <span class="btn-emoji">📊</span> Voir le statut actuel
    </button>
  </div>

  <div class="section-title">Fermeture prolongée</div>
  <div style="display:flex; gap:8px; margin-bottom:10px;">
    <input type="date" id="closeDate" style="flex:1; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px;">
  </div>
  <div class="grid">
    <button class="btn-desactiver" onclick="fermerJusqua()">
      <span class="btn-emoji">🔒</span> Fermer jusqu'à cette date
    </button>
    <button class="btn-auto" onclick="callAdmin('lever-fermeture')">
      <span class="btn-emoji">🔓</span> Lever la fermeture
    </button>
  </div>

  <div class="section-title">Outils de test</div>
  <div class="grid">
    <button class="btn-test" onclick="callAdmin('test-recap')">
      <span class="btn-emoji">📋</span> Forcer le récap
    </button>
    <button class="btn-test" onclick="callAdmin('backlog')">
      <span class="btn-emoji">📥</span> Voir le rattrapage
    </button>
    <button class="btn-test" onclick="callAdmin('test-horaires-on')">
      <span class="btn-emoji">🧪</span> Ignorer horaires
    </button>
    <button class="btn-test btn-full" onclick="callAdmin('test-horaires-off')">
      <span class="btn-emoji">⏰</span> Respecter horaires (normal)
    </button>
  </div>

  <footer>igs-bot-whatsapp</footer>
</div>

<script>
var TOKEN = '${ADMIN_TOKEN || ""}';

function callAdmin(action) {
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Chargement...';
  fetch('/admin/' + action + '?token=' + TOKEN)
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function(err) {
      statusBox.classList.remove('loading');
      statusBox.textContent = 'Erreur de connexion, réessaie.';
    });
}

function fermerJusqua() {
  var date = document.getElementById('closeDate').value;
  if (!date) { alert('Choisis une date d\\'abord'); return; }
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Chargement...';
  fetch('/admin/fermer?token=' + TOKEN + '&date=' + date)
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function(err) {
      statusBox.classList.remove('loading');
      statusBox.textContent = 'Erreur de connexion, réessaie.';
    });
}

callAdmin('statut');
</script>
</body>
</html>`);
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
