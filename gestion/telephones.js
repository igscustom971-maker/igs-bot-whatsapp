// ============================================
// IGS GESTION - TÉLÉPHONE DU FORMULAIRE -> FICHE CLIENT ODOO
// Quand le client a donné son numéro dans le formulaire (colonne "Contenu mail") et que sa fiche Odoo
// (client du devis) n'a pas de téléphone, on l'ajoute. Jamais d'écrasement d'un numéro existant.
// ============================================

const { supabase } = require('./db');
const odoo = require('./odoo');
const commandes = require('./commandes');

const vus = new Set(); // "devis|tel" déjà traités depuis le démarrage
let enCours = false;

async function synchroTelephones() {
  if (enCours || !odoo.configured()) return;
  enCours = true;
  try {
    const { rows } = await commandes.listCommandes();
    for (const r of rows) {
      if (!r.n_devis || !r.telephone) continue;
      const k = `${r.n_devis}|${r.telephone}`;
      if (vus.has(k)) continue;
      vus.add(k);
      try {
        const res = await odoo.completerTelephone(r.n_devis, r.telephone);
        if (res.statut === 'ajoute') {
          console.log(`Gestion Odoo : téléphone ${res.phone} ajouté sur la fiche ${res.partner} (devis ${r.n_devis})`);
          if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: 'Synchro automatique', action: 'odoo_telephone_ajoute', cle: r.cle, details: { devis: r.n_devis, client: res.partner, partner_id: res.partnerId, telephone: res.phone } });
        }
      } catch (err) {
        vus.delete(k); // réessai au prochain passage
        console.error(`Gestion Odoo téléphone ${r.n_devis} :`, err.message);
      }
    }
  } finally { enCours = false; }
}

function start() {
  setTimeout(() => synchroTelephones().catch(() => {}), 3 * 60e3);
  setInterval(() => synchroTelephones().catch(() => {}), 30 * 60e3);
}

module.exports = { synchroTelephones, start };
