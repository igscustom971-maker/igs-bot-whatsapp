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
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN; // token Meta pour envoyer messages
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const EMAIL_TO = process.env.EMAIL_TO || 'contact@igscustom.fr';

// Stockage temporaire des conversations en cours (en mémoire)
// Pour une vraie prod, utiliser une vraie DB (Postgres, etc.)
const conversations = {};

// ============================================
// PROMPT PERSONA (résumé condensé du fichier complet)
// ============================================
const SYSTEM_PROMPT = `Tu es un commercial/collaborateur d'IGS Custom Bar, entreprise de personnalisation textile (flocage DTF) à Pointe-à-Pitre, Guadeloupe. Tu N'ES PAS Ismaël — tu es un membre de l'équipe qui le représente en son absence.

RÈGLES DE TON :
- Professionnel mais chaleureux et naturel, jamais robotique
- Emojis sparingly (max 1-2 par message)
- Réponses courtes : 2-4 lignes
- UNE seule question à la fois, jamais un mur d'infos
- Parle d'Ismaël à la 3ème personne ("Ismaël reviendra", "l'équipe")
- NE JAMAIS répéter le nom/entreprise/email du client pour "confirmer" - juste noter et continuer
- NE JAMAIS finir par "À toi !" ou style formulaire

TARIFS :
- T-shirt recto seul: 9,80€ (min 10 pièces)
- T-shirt recto+dos: 12,50€ (min 10 pièces)
- Polo recto+dos: 12,50€ (min 10 pièces)
- Textile apporté par client: 8€/pièce
- Planche DTF 56x100cm: 25€ | A4: 10€ | A3: 13€
- Délai: 24-48h (planches), 48-72h (commandes)
- Livraison Martinique: 13€ standard / 17€ express
- Retrait boutique Guadeloupe: gratuit

INFOS À COLLECTER (progressivement, une question à la fois) :
1. Produit (t-shirt, polo, textile perso...)
2. Zone flocage (recto, dos, etc.)
3. Quantité
4. Nom / nom entreprise
5. Email

Une fois ces infos réunies, dis que l'équipe/Ismaël va envoyer le devis par mail.
Si le client demande quelque chose qu'on ne fait pas, propose toujours une alternative — jamais un "non" sec.`;

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

    // Récupérer ou initialiser l'historique de conversation
    if (!conversations[from]) {
      conversations[from] = [];
    }
    conversations[from].push({ role: 'user', content: text });

    // Appeler Claude API
    const reply = await callClaudeAPI(conversations[from]);

    // Ajouter la réponse à l'historique
    conversations[from].push({ role: 'assistant', content: reply });

    // Envoyer la réponse via WhatsApp
    await sendWhatsAppMessage(from, reply);

    // Vérifier si on a assez d'infos pour envoyer le récap
    await checkAndSendSummaryEmail(from, conversations[from]);

  } catch (error) {
    console.error('Erreur traitement message:', error);
  }
});

// ============================================
// 3. APPEL CLAUDE API
// ============================================
async function callClaudeAPI(conversationHistory) {
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
      system: SYSTEM_PROMPT,
      messages: conversationHistory,
    }),
  });

  const data = await response.json();
  const textBlock = data.content?.find(item => item.type === 'text');
  return textBlock?.text || "Désolé, un souci technique. L'équipe revient vers vous très vite !";
}

// ============================================
// 4. ENVOI MESSAGE WHATSAPP (via Meta Cloud API)
// ============================================
async function sendWhatsAppMessage(to, text) {
  await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
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
// 5. RÉCAP EMAIL (déclenché quand assez d'infos collectées)
// ============================================
async function checkAndSendSummaryEmail(from, history) {
  const fullText = history.map(m => m.content).join(' ').toLowerCase();

  // Détection simple : email présent dans la conversation = probablement complet
  const emailMatch = fullText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);

  if (emailMatch && !conversations[from]._summarySent) {
    conversations[from]._summarySent = true; // évite les doublons

    const summary = `
📋 NOUVEAU LEAD - ${new Date().toLocaleString('fr-FR')}
Numéro client: ${from}
Email détecté: ${emailMatch[0]}

--- Conversation complète ---
${history.filter(m => m.role !== undefined).map(m => `${m.role === 'user' ? 'Client' : 'Bot'}: ${m.content}`).join('\n')}

→ À traiter par Ismaël dès que possible
    `;

    console.log('RÉCAP À ENVOYER PAR EMAIL:', summary);
    // TODO: brancher un vrai service d'envoi email (ex: Resend, SendGrid, Nodemailer + Gmail)
    // sendEmail(EMAIL_TO, 'Nouveau lead IGS Bot', summary);
  }
}

// ============================================
// LANCEMENT SERVEUR
// ============================================
app.get('/', (req, res) => {
  res.send('IGS Bot WhatsApp - Serveur actif ✅');
});

app.listen(PORT, () => {
  console.log(`Serveur IGS Bot démarré sur le port ${PORT}`);
});
