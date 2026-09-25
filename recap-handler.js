// ============================================================
// Récap production IGS – à ajouter au serveur du bot WhatsApp
// Variables d'environnement Render :
//   ISMAEL_NUMBER   = ton numéro perso au format international sans + (ex. 590690XXXXXX)
//   RECAP_FLOW_URL  = URL du déclencheur HTTP du flow Power Automate
// ============================================================

const RECAP_KEYWORDS = /^(r[ée]cap|planning)$/i;

/**
 * À appeler dans le handler du webhook, AVANT la vérification des horaires
 * du bot et AVANT la logique client / délai artificiel.
 * Retourne true si le message a été traité comme une demande de récap.
 *
 * sendText(to, text) = ta fonction existante d'envoi de message WhatsApp.
 */
async function handleRecapRequest(msg, sendText) {
  const from = msg.from;
  const text = (msg.text?.body || '').trim();

  if (from !== process.env.ISMAEL_NUMBER || !RECAP_KEYWORDS.test(text)) {
    return false; // message normal → le bot client continue
  }

  try {
    const res = await fetch(process.env.RECAP_FLOW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Flow HTTP ${res.status}`);
    const { recap } = await res.json();
    await sendText(from, recap || 'Récap pour la commande aujd :\n\nRien en cours 👌');
  } catch (err) {
    console.error('Récap : erreur', err);
    await sendText(from, '⚠️ Récap indisponible pour le moment, réessaie dans une minute.');
  }
  return true;
}

module.exports = { handleRecapRequest };

// ------------------------------------------------------------
// Exemple d'intégration dans ton webhook :
//
// app.post('/webhook', async (req, res) => {
//   res.sendStatus(200); // répondre à Meta tout de suite, le flow peut prendre 20-30 s
//   const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
//   if (!msg) return;
//
//   if (await handleRecapRequest(msg, sendWhatsAppText)) return;
//
//   // ... ensuite : vérification des horaires, délai 30-60 s, logique Claude client
// });
// ------------------------------------------------------------
