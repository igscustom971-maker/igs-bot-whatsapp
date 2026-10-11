// ============================================
// IGS GESTION - FACTURES PAYÉES JAMAIS ENVOYÉES (tâche « factures_payees »)
// Un virement ou une remise TPE est rapproché dans Odoo (souvent plusieurs jours après), la facture passe « payée »…
// mais personne ne l'a envoyée au client. Cette tâche les repère et les envoie au client avec le gabarit facture d'Odoo
// (le PDF porte la mention « payée ») : le client a sa facture réglée, sans relance à faire.
//  - seulement les factures passées « payées » APRÈS l'activation de la tâche (pas de rattrapage de l'historique :
//    une ancienne facture se renvoie à la main si le client la réclame), pas marquées « envoyée » et sans mail au
//    client dans leur historique ;
//  - de 7 h à 20 h (heure de Guadeloupe), 5 factures au plus par passage ;
//  - pas d'e-mail sur la fiche client : Ismaël est prévenu une fois, à envoyer à la main ;
//  - Ismaël reçoit un récap WhatsApp des factures envoyées.
// ============================================

const { supabase } = require('./db');

const MAX_PAR_PASSAGE = 5;
const eur = n => `${Number(n || 0).toFixed(2).replace('.', ',')} €`;

async function reglage(cle, defaut = null) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (supabase) await supabase.from('gestion_reglages').upsert({ cle, valeur: String(valeur), updated_at: new Date().toISOString() });
}
async function dejaTraitees(ids) {
  if (!supabase || !ids.length) return new Set();
  const { data } = await supabase.from('gestion_actions').select('cle').in('action', ['facture_payee_envoyee', 'facture_payee_sans_email']).in('cle', ids.map(i => `move-${i}`));
  return new Set((data || []).map(a => a.cle));
}
async function journal(action, f, details = {}) {
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: 'IGS Dashboard (automatique)', action, cle: `move-${f.id}`, details: { numero: f.numero, client: f.client, email: f.email, montant_ttc: f.montant_ttc, devis: f.devis, ...details } }).then(() => {}, () => {});
}
async function prevenirIsmael(texte) {
  const fn = require('./sefi-mails').fournisseurs.envoyerAIsmael;
  if (fn) { try { await fn(texte, 'Factures payées envoyées'); } catch (err) { console.error('Factures payées : message à Ismaël :', err.message); } }
}

async function verifier({ maintenant = new Date() } = {}) {
  const odoo = require('./odoo');
  if (!odoo.configured()) return 'Odoo non configuré';
  // Point de départ = première activation : rien avant (ancienne valeur au format date seule : remise à maintenant)
  const depuis = await reglage('factures_payees_depuis');
  if (!depuis || !/T/.test(depuis)) {
    await setReglage('factures_payees_depuis', maintenant.toISOString());
    return 'démarrage : seules les factures payées à partir de maintenant seront envoyées';
  }
  const h = Number(maintenant.toLocaleString('en-US', { timeZone: 'America/Guadeloupe', hour: 'numeric', hour12: false }));
  if (h < 7 || h >= 20) return 'hors horaires (7 h - 20 h)';
  const toutes = await odoo.facturesPayeesNonEnvoyees(depuis);
  const vues = await dejaTraitees(toutes.map(f => f.id));
  const aFaire = toutes.filter(f => !vues.has(`move-${f.id}`));
  const envoyees = [], sansEmail = [], erreurs = [];
  for (const f of aFaire) {
    if (!f.email) { sansEmail.push(f); await journal('facture_payee_sans_email', f); continue; }
    if (envoyees.length >= MAX_PAR_PASSAGE) break;
    try {
      await odoo.envoyerFactureReglee(f.id);
      await journal('facture_payee_envoyee', f);
      envoyees.push(f);
    } catch (err) {
      erreurs.push(`${f.numero} : ${err.message}`);
      console.error(`Factures payées : envoi de ${f.numero} impossible :`, err.message);
    }
  }
  const lignes = [];
  if (envoyees.length) lignes.push(`📨 Factures payées envoyées au client (elles ne l'avaient pas été) :\n${envoyees.map(f => `• ${f.numero} – ${f.client} – ${eur(f.montant_ttc)}`).join('\n')}`);
  if (sansEmail.length) lignes.push(`⚠️ Factures payées jamais envoyées, mais pas d'e-mail sur la fiche client (à envoyer à la main) :\n${sansEmail.map(f => `• ${f.numero} – ${f.client} – ${eur(f.montant_ttc)}`).join('\n')}`);
  if (lignes.length) await prevenirIsmael(lignes.join('\n\n'));
  const r = `${envoyees.length} envoyée(s), ${sansEmail.length} sans e-mail${erreurs.length ? `, ${erreurs.length} erreur(s) : ${erreurs.join(' ; ')}` : ''}${aFaire.length - envoyees.length - sansEmail.length - erreurs.length > 0 ? ' (la suite au prochain passage)' : ''}`;
  if (erreurs.length && !envoyees.length) throw new Error(r);
  return r;
}

module.exports = { verifier };
