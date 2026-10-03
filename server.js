// ============================================
// IGS CUSTOM BAR - BOT WHATSAPP
// Serveur Node.js : reçoit messages via Dualhook,
// répond avec Claude API, envoie récap par email
// ============================================

const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' })); // limite augmentée pour accepter les longs historiques importés

// Récap production (Excel via Power Automate), déclenché quand Ismaël écrit "récap"/"planning"
// depuis son numéro perso, indépendant du bot client
const { isRecapRequest, handleProductionRecap } = require('./recap-handler');

// Supabase : historique de conversation persistant, prénoms clients, notes de contexte, réglages
const db = require('./supabase');

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

// Logs des échanges du jour, groupés par date (pour le récap du lendemain matin)
const dailyLogs = {}; // { "2026-09-28": [{from, text, reply}, ...] }
const recapSentDates = new Set(); // évite de renvoyer le même récap plusieurs fois

// Log des échanges pendant une session d'activation manuelle (flush à la désactivation)
let manualLog = [];

// Dédoublonnage des alertes (urgence / récap) par conversation : reste en mémoire,
// se réinitialise au redéploiement (impact mineur : au pire une alerte reposée après redéploiement)
const urgentAlertedAt = new Map(); // { [from]: timestamp de la dernière alerte urgente envoyée }
const loggedForRecapAt = new Map(); // { [from]: timestamp du dernier log récap }
const DEDUPE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h : au-delà, on considère que c'est une nouvelle situation

// Limite anti-spam : max 3 alertes urgentes EN TEMPS RÉEL par jour (au-delà, toujours loggé au récap, juste pas en ping immédiat)
const MAX_URGENT_PER_DAY = 3;
let urgentCountDate = null;
let urgentCountToday = 0;

function canSendUrgentNow() {
  const todayKey = getGuadeloupeDateKey(new Date());
  if (urgentCountDate !== todayKey) {
    urgentCountDate = todayKey;
    urgentCountToday = 0;
  }
  return urgentCountToday < MAX_URGENT_PER_DAY;
}

// Est-ce qu'on doit (re)déclencher une alerte/log pour ce numéro ? (jamais déclenché, ou expiré depuis le cooldown)
function shouldTrigger(map, key) {
  const last = map.get(key);
  return !last || (Date.now() - last > DEDUPE_COOLDOWN_MS);
}

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

// Marqueur invisible que Claude ajoute en fin de réponse pour signaler une urgence réelle
// (jamais montré au client, détecté puis retiré avant l'envoi WhatsApp)
const URGENT_MARKER = '###URGENT###';

// Marqueur signalant un message totalement hors-sujet/incompréhensible après clarification :
// aucune réponse n'est envoyée au client, juste noté au récap pour qu'Ismaël gère lui-même
const IGNORE_MARKER = '###IGNORER###';

// Marqueur interne (jamais vu par Claude ni le client) signalant un message vocal/média sans texte
const MEDIA_NO_TEXT_MARKER = '[[MEDIA_SANS_TEXTE]]';

// Excuses plausibles et ponctuelles pour demander au client d'écrire plutôt qu'envoyer un vocal
const VOICE_EXCUSES = [
  "Désolé, je ne peux pas écouter ça pour le moment, tu peux m'écrire en quelques mots stp ? 🙏",
  "Je suis en communication là, tu peux m'envoyer ça par écrit ?",
  "Ça tombe mal, je ne peux pas écouter pour l'instant, dis-moi en texte stp 😊",
];

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
    body += urgentEntries.map(e => `• ${e.summary} (${e.display || e.from})`).join('\n');
  }
  if (normalEntries.length > 0) {
    if (body) body += '\n\n';
    body += `📋 DEVIS / COMMANDES À PRÉPARER\n`;
    body += normalEntries.map(e => `• ${e.summary} (${e.display || e.from})`).join('\n');
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

// Détecte si le client a donné son prénom/nom quelque part dans la conversation
async function extractClientName(history) {
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
      max_tokens: 20,
      system: "Le client a-t-il donné son prénom ou son nom à un moment dans cette conversation ? Réponds UNIQUEMENT par ce prénom/nom (ex: \"Sandrine\"), ou par \"INCONNU\" si ce n'est pas mentionné. Rien d'autre.",
      messages: [{ role: 'user', content: conversationText }],
    }),
  });
  const data = await response.json();
  const textBlock = data.content?.find(item => item.type === 'text');
  const name = textBlock?.text?.trim();
  return name && name.toUpperCase() !== 'INCONNU' ? name : null;
}

// Résout le libellé d'affichage d'un client pour le récap : prénom connu + numéro, ou juste le numéro
async function resolveClientDisplay(from, history) {
  let name = await db.getClientName(from);
  if (!name) {
    name = await extractClientName(history);
    if (name) await db.upsertClientName(from, name);
  }
  return name ? `${name} - ${from}` : from;
}

// ============================================
// PROMPT PERSONA (résumé condensé du fichier complet)
// ============================================
const SYSTEM_PROMPT_BASE = `Tu es un membre de l'équipe commerciale d'IGS Custom Bar, entreprise de personnalisation textile (flocage DTF) à Pointe-à-Pitre, Guadeloupe. L'équipe a plusieurs pôles (commercial, production, etc.) : toi tu es côté commercial, tu prends la demande, ce n'est pas forcément toi qui produiras derrière.

RÈGLES DE TON :
- Réponds TOUJOURS en français, même si le client écrit en créole, anglais, ou une autre langue
- Si le client a un devis/une demande en attente et change complètement de sujet (nouvelle demande sans rapport), clarifie d'abord si c'est séparé ou à ajouter à la demande précédente, avant de traiter la nouvelle demande
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
- Évite de répéter la même idée deux fois dans la même réponse (ex: dire "je transmets à l'équipe" puis reformuler la même chose juste après). Dis les choses une fois, clairement, et passe à la suite

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
**Textile apporté par le client** : avant-arrière 8€/pièce, avant seul petit (ex: côté cœur) 4€/pièce, avant seul en grand 8€/pièce (même tarif que avant-arrière). Même règle de paiement avant production que le textile classique, MAIS flexibilité : si le client veut payer en espèces, ne pas insister, lui dire de passer et régler sur place directement
**Tote bag personnalisé** : généralement IGS fournit le tote bag (rare que le client fournisse le sien). Pro (10 et plus) : 8,35€/pièce. Public (moins de 10) : 12€/pièce
**Goodies (gourdes/mugs, stylos, porte-clés)** : pas de tarif fixe listé, propose de faire un devis sur mesure selon quantité et besoin précis, comme pour n'importe quel produit personnalisable. NE JAMAIS dire "on ne propose pas ça" pour ces catégories (gourde, mug, stylo, porte-clé), elles font partie de l'offre. "Bic" est juste un nom de marque pour un stylo, c'est la même chose

**Planches DTF prêtes à transférer** :
- 56x100cm : 25€/mètre | A4 : 10€ | A3 : 13€
- Remise dégressive : à partir de 10m, -15% ; à partir de 20m, -20%
- Le client envoie son visuel en PNG ou PDF détouré à contact@igscustom.fr (on peut aussi fournir un modèle Canva aux bonnes dimensions)
- Délai de production : 24 à 48h
- Si le client ne précise pas de métrage, pars sur 1m par défaut sauf indication contraire de sa part
- Devis/lien de paiement envoyé par mail avant la prod, MAIS paiement possible SUR PLACE (espèces ou TPE) à la récupération. On n'est PAS obligé d'attendre le règlement pour lancer une planche en production (contrairement au textile personnalisé, voir plus bas)
- REDIMENSIONNEMENT : si le client envoie UN SEUL visuel déjà composé (une planche déjà montée) et demande juste d'ajuster les proportions à la taille demandée, c'est OK, on peut le faire. Mais si le client envoie plusieurs images séparées (ex: 5 fichiers différents) en demandant de les disposer/dimensionner nous-mêmes sur la planche (ex: "4 ronds en 6cm et 3 en 27cm"), ce n'est PAS un service qu'on fait, ça crée des erreurs de commande. Dans ce cas, explique que le client doit composer sa planche lui-même (on peut lui fournir un modèle Canva aux bonnes dimensions pour l'aider)

**Livraison / retrait** (dépend de la localisation du client, voir CONTEXTE ci-dessous) :
- Client en Guadeloupe : retrait boutique possible à Pointe-à-Pitre (lundi au vendredi, 14h30 à 17h30), ou livraison en Guadeloupe même
- Client en Martinique : PAS de point de retrait, uniquement expédition. Deux options : standard par La Poste, ou express (départ tous les mardis)
- Délai production commandes textile : 48 à 72h

⚠️ LE VRAI PROCESS DE COMMANDE (textile personnalisé) À RESPECTER :
1. Prise d'informations de base : zone de flocage, type de textile/produit, quantité, nom, et email (nécessaires pour établir et envoyer le devis, c'est TOUT ce que toi tu collectes)
2. Devis envoyé par l'équipe
3. Pour le textile (pas les planches), le règlement est TOUJOURS fait avant de lancer la commande/production
4. Une fois le devis payé, un formulaire est envoyé automatiquement par mail pour récupérer tailles, couleurs et visuels
5. BAT (bon à tirer) réalisé et validé
6. Production, puis livraison

TRÈS IMPORTANT : toi tu t'arrêtes à l'étape 1. Le nom et l'email sont nécessaires pour le devis, demande-les normalement. Mais NE JAMAIS demander les tailles, couleurs ou visuels pendant la conversation, tout ça arrive automatiquement après paiement du devis via le formulaire, ce serait redondant. Une fois que tu as zone + produit + quantité + nom + email, confirme qu'un devis va être envoyé et arrête-toi là.

SI LE CLIENT A DU MAL À COMMANDER SUR LE SITE WEB (ex: une option qu'il veut n'est pas disponible dans le configurateur en ligne) : propose de lui faire le devis et le BAT directement avec l'équipe plutôt que de le laisser bloqué sur le site. Ne te contente pas d'expliquer la limite, offre la solution.

⚠️ DEUX FLOWS SELON LA SITUATION :

**FLOW A, client régulier connu qui parle de planche/impression/DTF (flow COURT mais avec devis quand même) :**
Si le contexte indique "CLIENT CONNU" ET que le client mentionne planche, impression, ou DTF :
IMPORTANT : nos clients réguliers qui commandent des planches passent systématiquement par une planche Canva PARTAGÉE qu'on a nous-mêmes créée avec eux. On y a donc déjà accès en permanence. Un client régulier qui parle de planche n'a JAMAIS besoin d'envoyer un visuel, fichier, PNG ou PDF, ni qu'on lui redonne la procédure d'envoi (ça, c'est uniquement pour un nouveau client en FLOW B). Ne demande donc jamais de visuel à un client régulier planche.
1. Demande UNIQUEMENT : quelle(s) page(s) du Canva partagé. Chaque page = 1 mètre (le Canva est conçu pour ça), donc le métrage se déduit automatiquement du nombre de pages mentionnées (ex: "page 2 et 5" = 2 pages = 2m). Ne demande PAS séparément "combien de mètres", c'est inutile et redondant. Si le client veut plusieurs exemplaires de la même page, il le précise lui-même (ex: "page 3 deux fois" = 2m) ; sinon pars du principe qu'une page mentionnée = un seul exemplaire = 1m
2. Demande un email UNIQUEMENT si on ne l'a pas déjà de notre côté (contexte "CLIENT CONNU" = on l'a déjà, ne redemande rien)
3. Réponds en confirmant brièvement que c'est noté et qu'un devis (ou lien de paiement) va être envoyé par mail sous peu. Précise que le règlement peut se faire sur place si besoin. Reste court, pas de longue explication à un régulier
4. Rappelle les infos de retrait/livraison adaptées à sa localisation (voir CATALOGUE ci-dessus) uniquement si besoin

**FLOW B, tout le reste (nouveau client, devis textile, situation ambiguë, ou client connu mais demande différente) :**
1. Demande la zone de flocage, le produit, la quantité, puis le nom et l'email pour établir le devis (voir le VRAI PROCESS ci-dessus, rien de plus, pas de tailles/couleurs/visuels). EXCEPTION : si le contexte indique "CLIENT CONNU" (déjà échangé avant, déjà commandé ou déjà eu un devis), ne redemande PAS le nom ni l'email, on les a déjà de notre côté. Demande uniquement ce qui concerne cette nouvelle demande (zone, produit, quantité)
2. Une fois ces infos obtenues, réponds en confirmant qu'un devis va être préparé et envoyé dans les plus brefs délais (varie la formulation, mais mentionne toujours le mot "devis")
3. Si tu ne peux pas répondre avec certitude à un moment donné (info manquante, cas complexe, produit non listé, demande hors de ce que tu sais faire), réponds EXACTEMENT et UNIQUEMENT : "Ok, je regarde de mon côté et je reviens vers vous !", rien d'autre. Cette phrase précise est réservée aux cas où tu es réellement bloqué, pas pour une clôture normale de devis

⚠️ CAS PARTICULIERS :
- **Planche ET textile dans la même demande** : traite les deux séparément (chacun son flow), mais propose au client de tout regrouper sur un seul devis si ça semble pertinent selon le contexte (ex: "Je te prépare la planche de mon côté, et pour les t-shirts je te fais un devis, tu veux qu'on mette tout sur le même devis ?")
- **Client envoie une photo/image directement dans le chat WhatsApp pour une planche** (plutôt que par email) : dis-lui que c'est plus simple de l'envoyer par mail à contact@igscustom.fr, car c'est difficile à traiter correctement depuis WhatsApp
- **Nouveau client qui commande plusieurs planches d'affilée** : tu peux lui proposer qu'on lui crée un Canva partagé dédié pour la prochaine fois, histoire de simplifier ses futures commandes

⚠️ NE JAMAIS AFFIRMER UN STATUT DE COMMANDE (RÈGLE ABSOLUE) :
Même si l'historique de cette conversation contient d'anciens échanges mentionnant une commande, TU N'AS AUCUN MOYEN DE SAVOIR où en est réellement la production aujourd'hui (pas d'accès à Odoo, pas de visibilité en temps réel). Un ancien message disant "ce sera prêt le X" ou "entre 14h30 et 17h30" ne veut PAS dire que c'est le cas MAINTENANT.
Donc : si le client demande si sa commande est prête, où elle en est, si elle a été reçue/expédiée/payée, ou toute question sur l'état ACTUEL d'une commande, NE REPONDS JAMAIS par une confirmation déduite de l'historique (ex: ne dis jamais "oui c'est bon, tu peux passer" en te basant sur un ancien message qui disait ça pour une autre commande ou un autre jour). C'est systématiquement un cas d'urgence (voir marqueur ###URGENT### ci-dessous), car seule l'équipe a la vraie info à jour.

⚠️ DÉTECTION D'URGENCE RÉELLE (très important) :
Tu n'as PAS d'accès à l'état réel des commandes ni de visibilité à jour au-delà de ce qui est explicitement écrit dans les tout derniers messages de cette conversation. Si le client :
- demande le statut actuel d'une commande (prête ? reçue ? expédiée ? payée ?) sans que ce statut exact vienne d'être confirmé dans les tout derniers messages de cette conversation
- fait référence à une commande ou modification déjà en cours ailleurs (ex: "j'ai déjà passé commande hier", "j'ai informé d'un changement", "comme convenu avec vous hier")
- réclame une action immédiate ou dans un délai très court (ex: "il me faut ça avant midi", "c'est urgent", "vous deviez me revenir")
- semble faire un rappel/une relance sur quelque chose que tu ne peux pas confirmer avec certitude
- demande une remise, un prix cassé ou une négociation tarifaire (toujours une décision humaine, jamais la tienne)
- exprime une plainte (mauvaise qualité, retard, erreur de commande, insatisfaction)
- demande à annuler une commande en cours (toujours une urgence, impact sur la prod/le stock)
Alors la situation nécessite une intervention humaine rapide que toi tu ne peux pas garantir. Réponds normalement au client de façon rassurante SANS RIEN AFFIRMER sur le fond (ex: "Je fais le point avec le responsable et je reviens vers vous", ou "Je vérifie ça tout de suite avec l'équipe"). Si le client a donné des détails précis sur une modification ou un problème (ex: "il fallait changer le visuel pour X"), reprends ces détails pour qu'ils soient bien transmis ; s'il n'a rien précisé, ne lui redemande pas de détail, contente-toi d'escalader tel quel. Dans tous les cas, ajoute EXACTEMENT ce marqueur tout seul sur la toute dernière ligne de ta réponse : ###URGENT### (ce marqueur est invisible pour le client, il sera retiré avant l'envoi, ne l'explique jamais au client). Si c'est une plainte, précise "PLAINTE :" au tout début de ta réponse interne pour que ce soit identifiable dans le résumé.

NOTE : promettre qu'un devis ou un lien de paiement "arrive par mail sous peu" n'est PAS une urgence, c'est le fonctionnement normal (l'équipe traite ça à son retour). N'ajoute PAS ###URGENT### juste pour ça.

⚠️ MESSAGE TOTALEMENT HORS-SUJET (spam, question sans rapport, incompréhensible) :
Si un message semble n'avoir aucun rapport avec IGS Custom Bar ou est incompréhensible, réponds UNE FOIS poliment : "Bonjour, je ne suis pas sûr de bien comprendre votre demande, pouvez-vous préciser ?" (varie la formulation). Si après cette clarification le message reste incompréhensible ou toujours hors-sujet, n'envoie plus AUCUNE réponse : à la place, réponds EXACTEMENT et UNIQUEMENT avec ###IGNORER### (rien d'autre). Ce marqueur signale qu'aucun message ne doit partir, mais que la situation sera quand même notée pour qu'Ismaël la vérifie lui-même.

Si le client demande quelque chose qu'on ne fait pas, propose toujours une alternative, jamais un "non" sec.`;

// Détecte la région du client à partir du préfixe téléphonique (596 = Martinique, 590 = Guadeloupe)
function detectRegion(from) {
  if (from.startsWith('596')) return 'Martinique';
  if (from.startsWith('590')) return 'Guadeloupe';
  return 'inconnue';
}

// Construit le prompt final en ajoutant le contexte "client connu ou nouveau" + région
// + note de contexte spécifique au client + contexte général, tous deux éditables depuis le panel
async function buildSystemPrompt(isKnownClient, from) {
  const clientKnownNote = isKnownClient
    ? "CONTEXTE CLIENT : ce numéro a déjà écrit avant, c'est un CLIENT CONNU/RÉGULIER. Il connaît déjà tout le fonctionnement (formats de fichiers acceptés, modèle Canva, délais, process). NE RÉEXPLIQUE JAMAIS les bases (comment envoyer un visuel, quels formats, qu'on peut fournir un Canva, etc.) sauf s'il le demande explicitement lui-même. Reste très bref et direct : accuse réception, demande UNIQUEMENT l'info strictement manquante pour cette commande précise (ex: juste la page ou le métrage), puis dis simplement que tu reviens vers lui une fois prêt. Pas de message explicatif ou pédagogique, un client régulier n'en a pas besoin."
    : "CONTEXTE CLIENT : c'est la première fois que ce numéro écrit, NOUVEAU CLIENT. Dans ce cas, tu peux expliquer le fonctionnement normalement.";

  const region = detectRegion(from);
  const regionNote = region !== 'inconnue'
    ? `\nCONTEXTE LOCALISATION : ce client est en ${region}. Adapte les infos de retrait/livraison en conséquence (voir CATALOGUE).`
    : '';

  const [extraInstructions, clientNote] = await Promise.all([
    db.getSetting('extra_instructions'),
    db.getClientNote(from),
  ]);

  const extraNote = extraInstructions ? `\n\nINSTRUCTIONS SUPPLÉMENTAIRES (ajoutées depuis le panel) :\n${extraInstructions}` : '';

  // La note spécifique au client est placée EN TÊTE du prompt (position la plus prioritaire),
  // avec une mention explicite qu'elle prime sur les règles générales en cas de contradiction
  const clientSpecificBlock = clientNote
    ? `⚠️⚠️ NOTE SPÉCIFIQUE À CE CLIENT, PRIORITÉ ABSOLUE ⚠️⚠️\nCette note prime sur TOUTES les règles générales ci-dessous en cas de contradiction (ex: si elle dit de ne pas demander l'email, tu ne le demandes pas, même si une règle générale plus bas dit le contraire) :\n${clientNote}\n\n---\n\n`
    : '';

  return clientSpecificBlock + SYSTEM_PROMPT_BASE + '\n\n' + clientKnownNote + regionNote + extraNote;
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
      urgentAlertedAt.delete(clientNumber); // une réponse manuelle règle le sujet, réarme immédiatement
      loggedForRecapAt.delete(clientNumber); // idem pour le récap groupé
      console.log(`Écho détecté : Ismaël a répondu manuellement à ${clientNumber}`);
      return;
    }

    if (!message) return; // pas un message entrant (ex: statut de livraison)

    const from = message.from; // numéro du client
    let text = message.text?.body;

    // Message vocal, image, document... sans texte : on utilise un marqueur interne
    // pour déclencher une excuse plausible demandant d'écrire plutôt
    if (!text && message.type && message.type !== 'text') {
      text = MEDIA_NO_TEXT_MARKER;
    }

    if (!text) return; // rien d'exploitable (ex: statut de livraison mal formé)

    // PRIORITÉ ABSOLUE : si c'est Ismaël qui écrit depuis son propre numéro perso,
    // ce n'est jamais un client. Seul "récap"/"planning" déclenche le récap production
    // (Excel via Power Automate) ; tout le reste venant de ce numéro est ignoré par le bot client.
    if (RECAP_PHONE_NUMBER && from === RECAP_PHONE_NUMBER) {
      if (isRecapRequest(text)) {
        console.log(`Demande de récap production reçue d'Ismaël (${from})`);
        await handleProductionRecap(from, sendWhatsAppMessage);
      } else {
        console.log(`Message d'Ismaël sur son propre numéro (hors récap), ignoré par le bot client`);
      }
      return;
    }

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
  // On mémorise le moment de ce message précis, pour la vérification d'écho juste avant l'envoi
  const thisMessageAt = Date.now();

  // Récupérer l'historique persistant depuis Supabase (100 par défaut, 200 pour un client importé)
  const customLimit = await db.getHistoryLimit(from);
  const history = await db.getHistory(from, customLimit || undefined);
  const isKnownClient = history.length > 0; // déjà des échanges enregistrés = client connu

  // Sauvegarder le message client (version lisible si c'est un vocal/média), puis reconstituer l'historique
  const storedText = text === MEDIA_NO_TEXT_MARKER ? '[Message vocal/média reçu, sans texte]' : text;
  await db.appendMessage(from, 'user', storedText);
  const fullHistory = [...history, { role: 'user', content: storedText }];

  // Message vocal/média sans texte : réponse fixe (excuse plausible), pas d'appel Claude nécessaire
  if (text === MEDIA_NO_TEXT_MARKER) {
    const excuse = VOICE_EXCUSES[Math.floor(Math.random() * VOICE_EXCUSES.length)];
    await db.appendMessage(from, 'assistant', excuse);

    const delayMs = randomDelay(15000, 45000);
    await sleep(delayMs);

    if (lastIsmaelReplyAt[from] && lastIsmaelReplyAt[from] > thisMessageAt) {
      console.log(`Envoi annulé pour ${from} : Ismaël a répondu manuellement pendant le délai d'attente`);
      return;
    }
    await sendWhatsAppMessage(from, excuse);
    return;
  }

  // Appeler Claude API (avec le contexte "client connu ou non")
  const rawReply = await callClaudeAPI(fullHistory, isKnownClient, from);

  // Cas "message hors-sujet, on arrête de répondre" : rien à envoyer, juste noter au récap
  if (rawReply.includes(IGNORE_MARKER)) {
    console.log(`Message hors-sujet détecté pour ${from}, aucune réponse envoyée`);
    if (shouldTrigger(loggedForRecapAt, from)) {
      loggedForRecapAt.set(from, Date.now());
      const display = await resolveClientDisplay(from, fullHistory);
      const logEntry = { from, display, summary: `Message hors-sujet/incompréhensible reçu, à vérifier (bot n'a pas répondu) : "${text}"`, urgent: false };
      if (manualOverride === true) {
        manualLog.push(logEntry);
      } else {
        const dateKey = getGuadeloupeDateKey(new Date());
        if (!dailyLogs[dateKey]) dailyLogs[dateKey] = [];
        dailyLogs[dateKey].push(logEntry);
      }
    }
    return;
  }

  // Détecter le marqueur d'urgence, et le retirer avant d'envoyer quoi que ce soit au client
  const isUrgent = rawReply.includes(URGENT_MARKER);
  const reply = rawReply.replace(URGENT_MARKER, '').trim();

  // Sauvegarder la réponse (sans le marqueur) dans l'historique persistant
  await db.appendMessage(from, 'assistant', reply);
  fullHistory.push({ role: 'assistant', content: reply });

  // Si c'est urgent, on alerte immédiatement Ismaël par WhatsApp (pas d'attente du récap groupé)
  // Dédoublonné 12h ou jusqu'à une réponse manuelle d'Ismaël, selon ce qui arrive en premier.
  // Limité à 3 pings temps réel par jour : au-delà, on loggue quand même au récap (urgent) sans spammer
  if (isUrgent && RECAP_PHONE_NUMBER && shouldTrigger(urgentAlertedAt, from)) {
    urgentAlertedAt.set(from, Date.now());
    const urgentDisplay = await resolveClientDisplay(from, fullHistory);
    const urgentSummary = await summarizeForRecap(fullHistory);

    if (canSendUrgentNow()) {
      urgentCountToday++;
      await sendWhatsAppMessage(RECAP_PHONE_NUMBER, `🚨 URGENT, intervention nécessaire\n\n${urgentSummary}\n\nClient : ${urgentDisplay}`);
      console.log(`Alerte urgente envoyée pour ${from} (${urgentCountToday}/${MAX_URGENT_PER_DAY} aujourd'hui)`);
    } else {
      console.log(`Limite de ${MAX_URGENT_PER_DAY} alertes/jour atteinte, ${from} loggé au récap sans ping immédiat`);
      const dateKey = getGuadeloupeDateKey(new Date());
      if (!dailyLogs[dateKey]) dailyLogs[dateKey] = [];
      dailyLogs[dateKey].push({ from, display: urgentDisplay, summary: urgentSummary, urgent: true });
    }
  }

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

  if ((isEscalation || isDevisOrPlanche) && shouldTrigger(loggedForRecapAt, from)) {
    loggedForRecapAt.set(from, Date.now()); // dédoublonné 12h ou jusqu'à une réponse manuelle
    const summary = await summarizeForRecap(fullHistory);
    const display = await resolveClientDisplay(from, fullHistory);
    const logEntry = { from, display, summary, urgent: isEscalation };

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
  const systemPrompt = await buildSystemPrompt(isKnownClient, from);
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
      system: systemPrompt,
      messages: conversationHistory,
    }),
  });

  const data = await response.json();
  const textBlock = data.content?.find(item => item.type === 'text');

  if (!textBlock) {
    console.error(`Claude API erreur (status ${response.status}):`, JSON.stringify(data));
    return "Désolé, un souci technique. L'équipe revient vers vous très vite !";
  }

  return textBlock.text;
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

// Enregistre une instruction de contexte générale, injectée dans le prompt de tous les clients
// (ex: une consigne ponctuelle, sans avoir à toucher au code ni redéployer)
// En POST avec corps JSON (pas en query string) pour ne jamais être limité par la longueur d'URL
app.post('/admin/contexte', async (req, res) => {
  if (req.body.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const texte = req.body.texte || '';
  await db.setSetting('extra_instructions', texte);
  res.send(texte ? `✅ Contexte général mis à jour :\n\n${texte}` : '✅ Contexte général effacé');
});

// Affiche le contexte général actuellement actif
app.get('/admin/contexte-voir', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const texte = await db.getSetting('extra_instructions');
  res.send(texte ? `Contexte général actuel :\n\n${texte}` : 'Aucun contexte général actif pour le moment.');
});

// Ajoute du texte à la suite du contexte général existant, SANS l'écraser
app.post('/admin/contexte-ajouter', async (req, res) => {
  if (req.body.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const nouveauTexte = req.body.texte || '';
  const actuel = await db.getSetting('extra_instructions');
  const combine = actuel ? `${actuel}\n\n${nouveauTexte}` : nouveauTexte;
  await db.setSetting('extra_instructions', combine);
  res.send(`✅ Ajouté. Contexte général complet désormais :\n\n${combine}`);
});

// Enregistre une note de contexte pour UN client précis (par numéro)
// En POST avec corps JSON pour ne jamais être limité par la longueur d'URL
app.post('/admin/note-client', async (req, res) => {
  if (req.body.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const numero = (req.body.numero || '').trim();
  const texte = req.body.texte || '';
  if (!numero) return res.status(400).send('Numéro manquant (paramètre "numero")');
  await db.upsertClientNote(numero, texte);
  res.send(texte ? `✅ Note enregistrée pour ${numero} :\n\n${texte}` : `✅ Note effacée pour ${numero}`);
});

// Affiche la note de contexte actuelle d'un client précis
app.get('/admin/note-client-voir', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const numero = (req.query.numero || '').trim();
  if (!numero) return res.status(400).send('Numéro manquant (paramètre "numero")');
  const texte = await db.getClientNote(numero);
  res.send(texte ? `Note actuelle pour ${numero} :\n\n${texte}` : `Aucune note pour ${numero}.`);
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
// IMPORT D'HISTORIQUE WHATSAPP EXPORTÉ
// Format WhatsApp : "JJ/MM/AAAA, HH:MM - Nom: message" (les lignes suivantes sans ce motif
// sont considérées comme la suite du message précédent)
// ============================================
function parseWhatsAppExport(rawText, teamLabel) {
  const lineRegex = /^\u200E?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s(\d{1,2}:\d{2}(?:\s?[APap][Mm])?)\s-\s([^:]+):\s(.*)$/;
  const lines = rawText.split(/\r?\n/);
  const messages = [];
  const normalizedTeamLabel = teamLabel.trim().toLowerCase();

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (match) {
      const sender = match[3].trim();
      const content = match[4].trim();
      const role = sender.toLowerCase() === normalizedTeamLabel ? 'assistant' : 'user';
      messages.push({ role, content });
    } else if (messages.length > 0 && line.trim()) {
      // Ligne de continuation d'un message multi-lignes
      messages[messages.length - 1].content += '\n' + line.trim();
    }
  }
  // On retire les messages au contenu vide (ex: média/ligne système mal interprétée),
  // puis on fusionne les rôles consécutifs identiques (l'API Claude exige une alternance stricte)
  const cleaned = messages.filter(m => m.content && m.content.trim().length > 0);
  const result = [];
  for (const m of cleaned) {
    const last = result[result.length - 1];
    if (last && last.role === m.role) {
      last.content += '\n' + m.content;
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

app.post('/admin/importer-historique', async (req, res) => {
  if (req.body.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const { numero, nomEquipe, texte } = req.body;
  if (!numero || !nomEquipe || !texte) {
    return res.status(400).send('Champs manquants (numero, nomEquipe, texte requis)');
  }

  const parsed = parseWhatsAppExport(texte, nomEquipe);
  if (parsed.length === 0) {
    return res.send('⚠️ Aucun message reconnu dans le texte fourni. Vérifie le format et le nom d\'équipe.');
  }

  // On ne garde que les 200 derniers messages pour rester cohérent avec la nouvelle limite
  const trimmed = parsed.slice(-200);
  await db.bulkAppendMessages(numero, trimmed);
  await db.setHistoryLimit(numero, 200);

  res.send(`✅ ${trimmed.length} message(s) importé(s) pour ${numero}, limite d'historique passée à 200 pour ce client`);
});

// TEST UNIQUEMENT : simule la réponse du bot pour un numéro donné avec un message fictif,
// en utilisant le VRAI historique stocké pour ce numéro. RIEN n'est envoyé sur WhatsApp,
// RIEN n'est ajouté à l'historique réel. Sert à vérifier que le bot a bien le bon contexte.
app.post('/admin/simuler', async (req, res) => {
  if (req.body.token !== ADMIN_TOKEN) return res.status(403).send('Token invalide');
  const { numero, message } = req.body;
  if (!numero || !message) return res.status(400).send('Champs manquants (numero, message requis)');

  try {
    const customLimit = await db.getHistoryLimit(numero);
    const history = await db.getHistory(numero, customLimit || undefined);
    const isKnownClient = history.length > 0;
    const fullHistory = [...history, { role: 'user', content: message }];

    const rawReply = await callClaudeAPI(fullHistory, isKnownClient, numero);

    if (rawReply.includes(IGNORE_MARKER)) {
      return res.send(
        `🧪 SIMULATION (rien envoyé, rien enregistré)\n\n` +
        `Historique chargé : ${history.length} message(s)\n` +
        `Message testé : "${message}"\n\n` +
        `🙈 Le bot n'aurait RIEN envoyé (message jugé hors-sujet), juste noté pour le récap`
      );
    }

    const isUrgent = rawReply.includes(URGENT_MARKER);
    const reply = rawReply.replace(URGENT_MARKER, '').trim();

    res.send(
      `🧪 SIMULATION (rien envoyé, rien enregistré)\n\n` +
      `Historique chargé : ${history.length} message(s)\n` +
      `Message testé : "${message}"\n\n` +
      `Réponse du bot :\n${reply}` +
      (isUrgent ? `\n\n🚨 Aurait déclenché une alerte urgente` : '')
    );
  } catch (err) {
    console.error('Erreur simulation:', err);
    res.status(500).send('Erreur pendant la simulation, vérifie les logs.');
  }
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

  <div class="section-title">Contexte général (injecté dans le prompt du bot)</div>
  <textarea id="contexteGeneral" placeholder="Ex: Attention, rupture de stock sur les polos noirs cette semaine..." style="width:100%; min-height:70px; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px; font-family:inherit; margin-bottom:10px;"></textarea>
  <div class="grid">
    <button class="btn-desactiver" onclick="sauverContexte()">
      <span class="btn-emoji">🔄</span> Remplacer tout
    </button>
    <button class="btn-auto" onclick="ajouterContexte()">
      <span class="btn-emoji">➕</span> Ajouter à la suite
    </button>
    <button class="btn-statut btn-full" onclick="callAdmin('contexte-voir')">
      <span class="btn-emoji">👁️</span> Voir l'actuel
    </button>
  </div>

  <div class="section-title">Note pour un client précis</div>
  <input id="noteNumero" type="text" placeholder="Numéro (ex: 590690XXXXXX)" style="width:100%; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px; margin-bottom:8px;">
  <textarea id="noteTexte" placeholder="Ex: Cliente régulière, tutoiement ok, anniversaire le 27/10..." style="width:100%; min-height:70px; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px; font-family:inherit; margin-bottom:10px;"></textarea>
  <div class="grid">
    <button class="btn-auto" onclick="sauverNoteClient()">
      <span class="btn-emoji">💾</span> Enregistrer
    </button>
    <button class="btn-statut" onclick="voirNoteClient()">
      <span class="btn-emoji">👁️</span> Voir la note
    </button>
  </div>

  <div class="section-title">Importer un historique (clients importants)</div>
  <input id="importNumero" type="text" placeholder="Numéro (ex: 590690XXXXXX)" style="width:100%; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px; margin-bottom:8px;">
  <input id="importNomEquipe" type="text" value="Igs Custom bar" placeholder="Ton nom tel qu'affiché dans l'export" style="width:100%; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px; margin-bottom:8px;">
  <input id="importFichier" type="file" accept=".txt" style="width:100%; color:#f4f4f5; font-size:13px; margin-bottom:8px;">
  <textarea id="importTexte" placeholder="...ou colle ici le contenu du fichier .txt exporté depuis WhatsApp" style="width:100%; min-height:100px; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:13px; font-family:inherit; margin-bottom:10px;"></textarea>
  <div class="grid">
    <button class="btn-auto btn-full" onclick="importerHistorique()">
      <span class="btn-emoji">📥</span> Importer cet historique
    </button>
  </div>

  <div class="section-title">Simuler une réponse (sans rien envoyer)</div>
  <input id="simNumero" type="text" placeholder="Numéro (ex: 590690XXXXXX)" style="width:100%; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px; margin-bottom:8px;">
  <textarea id="simMessage" placeholder="Message fictif à tester (ex: Bonjour, du nouveau pour ma commande ?)" style="width:100%; min-height:70px; border-radius:10px; border:1px solid #2a2d35; background:#1a1d24; color:#f4f4f5; padding:10px; font-size:14px; font-family:inherit; margin-bottom:10px;"></textarea>
  <div class="grid">
    <button class="btn-auto btn-full" onclick="simulerReponse()">
      <span class="btn-emoji">🧪</span> Simuler la réponse
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

function sauverContexte() {
  var texte = document.getElementById('contexteGeneral').value;
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Chargement...';
  fetch('/admin/contexte', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, texte: texte })
  })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function() {
      statusBox.classList.remove('loading');
      statusBox.textContent = 'Erreur de connexion, réessaie.';
    });
}

function ajouterContexte() {
  var texte = document.getElementById('contexteGeneral').value;
  if (!texte) { alert('Écris d\\'abord quelque chose à ajouter'); return; }
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Chargement...';
  fetch('/admin/contexte-ajouter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, texte: texte })
  })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function() {
      statusBox.classList.remove('loading');
      statusBox.textContent = 'Erreur de connexion, réessaie.';
    });
}

function sauverNoteClient() {
  var numero = document.getElementById('noteNumero').value;
  var texte = document.getElementById('noteTexte').value;
  if (!numero) { alert('Indique un numéro d\\'abord'); return; }
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Chargement...';
  fetch('/admin/note-client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, numero: numero, texte: texte })
  })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function() {
      statusBox.classList.remove('loading');
      statusBox.textContent = 'Erreur de connexion, réessaie.';
    });
}

function voirNoteClient() {
  var numero = document.getElementById('noteNumero').value;
  if (!numero) { alert('Indique un numéro d\\'abord'); return; }
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Chargement...';
  fetch('/admin/note-client-voir?token=' + TOKEN + '&numero=' + encodeURIComponent(numero))
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function() {
      statusBox.classList.remove('loading');
      statusBox.textContent = 'Erreur de connexion, réessaie.';
    });
}

document.getElementById('importFichier').addEventListener('change', function(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(evt) {
    document.getElementById('importTexte').value = evt.target.result;
  };
  reader.readAsText(file, 'UTF-8');
});

function importerHistorique() {
  var numero = document.getElementById('importNumero').value;
  var nomEquipe = document.getElementById('importNomEquipe').value;
  var texte = document.getElementById('importTexte').value;
  if (!numero || !nomEquipe || !texte) { alert('Remplis les 3 champs (numéro, ton nom, texte)'); return; }
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Import en cours...';
  fetch('/admin/importer-historique', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, numero: numero, nomEquipe: nomEquipe, texte: texte })
  })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function() {
      statusBox.classList.remove('loading');
      statusBox.textContent = 'Erreur de connexion, réessaie.';
    });
}

function simulerReponse() {
  var numero = document.getElementById('simNumero').value;
  var message = document.getElementById('simMessage').value;
  if (!numero || !message) { alert('Remplis le numéro et le message'); return; }
  var statusBox = document.getElementById('status');
  statusBox.classList.add('loading');
  statusBox.textContent = 'Simulation en cours...';
  fetch('/admin/simuler', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, numero: numero, message: message })
  })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      statusBox.classList.remove('loading');
      statusBox.textContent = text;
    })
    .catch(function() {
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
