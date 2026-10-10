// ============================================
// IGS GESTION - ENVOI DU BAT AU CLIENT
// - Mail depuis contact@ (Microsoft 365) avec le BON A TIRER.pdf en pièce jointe
// - WhatsApp par le numéro de Leïla (Dualhook) si le client a écrit dans les dernières 24 h (règle Meta) ;
//   sinon le dashboard indique que seul le mail est parti.
// Le PDF est transmis à WhatsApp par un lien signé à durée limitée (/gestion/public/bat/...).
// ============================================

const g = require('./graph');
const { supabase } = require('./db');
const commandes = require('./commandes');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const LIEN_JOURS = 15;
const FENETRE_H = 23.5; // marge sous les 24 h de Meta

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prenom = client => String(client || '').trim().split(/\s+/)[0] || '';

// Heure de chaque message reçu sur le WhatsApp de Leïla (notée depuis le webhook, même bot en pause)
async function noterMessagesEntrants(nums) {
  if (!supabase || !nums.length) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from('gestion_whatsapp_entrants').upsert(nums.map(telephone => ({ telephone, dernier_message: now })));
  if (error) console.error('Gestion WhatsApp entrants :', error.message);
}

// Dernier message reçu du client : le plus récent entre le relevé du webhook et l'historique de Leïla
async function dernierMessageClient(tel) {
  if (!supabase || !tel) return null;
  const [a, b] = await Promise.all([
    supabase.from('gestion_whatsapp_entrants').select('dernier_message').eq('telephone', tel).maybeSingle(),
    supabase.from('conversations').select('created_at').eq('phone_number', tel).eq('role', 'user').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const dates = [a?.data?.dernier_message, b?.data?.created_at].filter(Boolean).map(d => new Date(d));
  return dates.length ? new Date(Math.max(...dates)) : null;
}

async function envoyerWhatsAppDocument(tel, lien, nomFichier, legende) {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID, key = process.env.DUALHOOK_API_KEY;
  if (!id || !key) throw new Error('WhatsApp non configuré sur le serveur');
  const res = await fetch(`https://api.dualhook.com/v25.0/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: tel, type: 'document', document: { link: lien, filename: nomFichier, caption: legende } }),
  });
  if (!res.ok) throw new Error(`WhatsApp refusé (${res.status}) : ${(await res.text()).slice(0, 200)}`);
}

// Lien public signé vers un fichier du dossier Commandes (pour que WhatsApp puisse récupérer le PDF)
function lienSigne(baseUrl, itemId) {
  const { sign } = require('./auth');
  return `${baseUrl}/gestion/public/bat/${sign({ t: 'bat', f: itemId, exp: Date.now() + LIEN_JOURS * 86400e3 })}`;
}

async function envoyer(cle, { mail = true, whatsapp = true } = {}, user, baseUrl) {
  const { rows } = await commandes.listCommandes();
  const c = rows.find(r => r.cle === cle);
  if (!c) throw new Error('Commande introuvable');
  if (!c.n_devis) throw new Error('Pas de N° de devis : impossible de retrouver le BAT');
  const bat = await commandes.trouverBat(c.n_devis);
  if (!bat) throw new Error('Pas de « BON A TIRER.pdf » dans le dossier de la commande');

  const nomFichier = `BAT ${c.n_devis} - ${c.client}.pdf`.replace(/[\\/:*?"<>|]/g, '');
  const p = prenom(c.client);
  const resultat = { mail: null, whatsapp: null };

  // WhatsApp d'abord (pour pouvoir le mentionner dans le mail)
  if (whatsapp) {
    if (!c.telephone) resultat.whatsapp = { ok: false, raison: 'pas de numéro de téléphone sur la commande' };
    else {
      const dernier = await dernierMessageClient(c.telephone);
      const heures = dernier ? (Date.now() - dernier.getTime()) / 3600e3 : null;
      if (heures === null || heures > FENETRE_H) {
        resultat.whatsapp = { ok: false, raison: dernier ? `dernier message du client il y a ${heures < 48 ? Math.round(heures) + ' h' : Math.round(heures / 24) + ' jours'} (plus de 24 h)` : 'le client n\'a jamais écrit sur le WhatsApp de Leïla' };
      } else {
        try {
          const legende = `Bonjour${p ? ' ' + p : ''} 👋 Voici votre BAT (bon à tirer) pour la commande ${c.n_devis}. Merci de le vérifier attentivement (visuels, couleurs, tailles) et de nous confirmer votre validation en répondant à ce message 🙏`;
          await envoyerWhatsAppDocument(c.telephone, lienSigne(baseUrl, bat.id), nomFichier, legende);
          if (supabase) await supabase.from('conversations').insert({ phone_number: c.telephone, role: 'assistant', content: `[BAT envoyé par l'équipe : ${nomFichier}] ${legende}` });
          resultat.whatsapp = { ok: true };
        } catch (err) { resultat.whatsapp = { ok: false, raison: err.message }; }
      }
    }
  }

  if (mail) {
    if (!c.email) resultat.mail = { ok: false, raison: 'pas d\'adresse e-mail sur la commande' };
    else {
      try {
        const r = await g.content(bat.id);
        const buffer = Buffer.from(await r.arrayBuffer());
        const html = `<p>Bonjour${p ? ' ' + esc(p) : ''},</p>
<p>Veuillez trouver ci-joint le <b>BAT (bon à tirer)</b> de votre commande <b>${esc(c.n_devis)}</b>.</p>
<p>Merci de le vérifier attentivement (visuels, positionnement, couleurs, tailles et quantités) puis de nous <b>confirmer votre validation en répondant à ce mail</b>. La production démarre dès réception de votre accord.</p>
<p>Pour toute modification, indiquez-la simplement dans votre réponse.</p>
<p>Belle journée,<br>L'équipe IGS CUSTOM BAR</p>`;
        await g.sendMail(MAILBOX, { to: c.email, subject: `Votre BAT à valider - commande ${c.n_devis} - IGS CUSTOM BAR`, html, attachments: [{ name: nomFichier, contentType: 'application/pdf', buffer }] });
        resultat.mail = { ok: true, a: c.email };
      } catch (err) { resultat.mail = { ok: false, raison: err.message }; }
    }
  }

  const canaux = [resultat.mail?.ok && 'mail', resultat.whatsapp?.ok && 'WhatsApp'].filter(Boolean);
  if (!canaux.length) {
    throw new Error(`BAT non envoyé. Mail : ${resultat.mail ? resultat.mail.raison || 'non demandé' : 'non demandé'}. WhatsApp : ${resultat.whatsapp ? resultat.whatsapp.raison || 'non demandé' : 'non demandé'}.`);
  }
  const commande = await commandes.setBatEnvoye(cle, true, `${user} (${canaux.join(' + ')})`);
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'bat_envoye_client', cle, details: { mail: resultat.mail, whatsapp: resultat.whatsapp } });
  console.log(`Gestion : BAT ${c.n_devis} envoyé par ${canaux.join(' + ')} (${user})`);
  return { ...resultat, canaux, commande };
}

// Route publique : fichier du lien signé (uniquement un fichier du dossier Commandes, lien non expiré)
function mount(app) {
  app.get('/gestion/public/bat/:jeton', async (req, res) => {
    try {
      const d = require('./auth').verify(req.params.jeton);
      if (!d || d.t !== 'bat' || !d.f) return res.status(404).send('Lien expiré');
      const it = await commandes.fichierAutorise(d.f);
      if (!it) return res.status(404).send('Fichier introuvable');
      const r = await g.content(it.id);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(it.name)}`);
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.error('Gestion lien BAT :', err.message);
      res.status(502).send('Fichier indisponible');
    }
  });
}

module.exports = { noterMessagesEntrants, envoyer, envoyerDocument: envoyerWhatsAppDocument, lienSigne, mount, _test: { dernierMessageClient } };
