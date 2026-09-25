// ============================================
// IGS CUSTOM BAR - RÉCAP PRODUCTION
// Appelé par index.js quand Ismaël envoie "récap" ou "planning"
// au numéro WhatsApp IGS depuis son numéro perso.
// Variable d'environnement Render requise : RECAP_FLOW_URL
// ============================================

const RECAP_KEYWORDS = /^(r[ée]cap|planning)$/i;
const EMPTY_RECAP = 'Récap des commandes du jour :\n\nRien en cours 👌';
const ERROR_MESSAGE = '⚠️ Récap indisponible pour le moment, réessaie dans une minute.';

// Est-ce que le texte reçu est une demande de récap ?
function isRecapRequest(text) {
  return RECAP_KEYWORDS.test((text || '').trim());
}

// Appelle le flow Power Automate et renvoie le récap sur WhatsApp
// sendText(to, text) = fonction d'envoi WhatsApp du serveur (sendWhatsAppMessage)
async function handleProductionRecap(to, sendText) {
  try {
    const flowUrl = process.env.RECAP_FLOW_URL;
    if (!flowUrl) throw new Error('RECAP_FLOW_URL non configurée sur Render');

    const res = await fetch(flowUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Flow Power Automate : HTTP ${res.status}`);

    const data = await res.json();
    await sendText(to, data.recap || EMPTY_RECAP);
    console.log('Récap production envoyé à', to);
  } catch (err) {
    console.error('Récap production : erreur', err);
    await sendText(to, ERROR_MESSAGE);
  }
}

module.exports = { isRecapRequest, handleProductionRecap };
