// ============================================
// IGS CUSTOM BAR - RÉCAP PRODUCTION
// Appelé par server.js quand Ismaël envoie "récap" ou "planning"
// au numéro WhatsApp IGS depuis son numéro perso.
// Les commandes et planches sont lues directement dans le dashboard (module gestion),
// plus besoin du flux Power Automate ni de l'Excel. Repli sur RECAP_FLOW_URL si le dashboard ne répond pas.
// ============================================

const RECAP_KEYWORDS = /^(r[ée]cap|planning)$/i;
const ERROR_MESSAGE = '⚠️ Récap indisponible pour le moment, réessaie dans une minute.';

// Est-ce que le texte reçu est une demande de récap ?
function isRecapRequest(text) {
  return RECAP_KEYWORDS.test((text || '').trim());
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const jour = d => { const [y, m, j] = String(d).split('-'); return `${j}/${m}`; };
const aujourdHui = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guadeloupe' }); // AAAA-MM-JJ

// Blocs du récap, dans l'ordre de priorité de l'atelier
const BLOCS = [
  ['AEXPEDIER', '📦 À EXPÉDIER'],
  ['ENFLOCAGE', '🔥 EN FLOCAGE'],
  ['ENPRODUCTION', '🧵 EN PRODUCTION'],
  ['ENCOMMANDE', '🛒 EN COMMANDE (textiles commandés)'],
  ['VALIDEE', '✅ VALIDÉE (BAT validé)'],
  ['PAYEE', '💳 PAYÉE (formulaire / BAT)'],
];

function ligneCommande(c, today) {
  const morceaux = [`• ${c.n_devis || 'sans devis'} · ${c.client || '?'}`];
  if (c.infos) morceaux.push(String(c.infos).replace(/\s+/g, ' ').slice(0, 70));
  if (c.zone_flocage) morceaux.push(c.zone_flocage);
  if (c.date_livraison) morceaux.push(`📅 ${jour(c.date_livraison)}${c.date_livraison < today ? ' ⚠️ en retard' : c.date_livraison === today ? ' ⏰ aujourd\'hui' : ''}`);
  if (c.affectation) morceaux.push(`👤 ${c.affectation}`);
  if (c.a_payer_especes) morceaux.push('💶 espèces');
  return morceaux.join(' · ');
}

// Construit le récap à partir des données du dashboard
async function construireRecap() {
  const commandes = require('./gestion/commandes');
  const planches = require('./gestion/planches');
  const today = aujourdHui();
  const { rows, syncedAt } = await commandes.listCommandes();
  if (!syncedAt) throw new Error('commandes pas encore chargées');
  const tri = (a, b) => String(a.date_livraison || '9999').localeCompare(String(b.date_livraison || '9999'));
  const parties = [];
  for (const [k, titre] of BLOCS) {
    const l = rows.filter(c => norm(c.statut) === k).sort(tri);
    if (l.length) parties.push(`*${titre}* (${l.length})\n${l.map(c => ligneCommande(c, today)).join('\n')}`);
  }
  const pretes = rows.filter(c => norm(c.statut) === 'TERMINEE');
  if (pretes.length) parties.push(`*🙌 PRÊTES, À RÉCUPÉRER* (${pretes.length})\n${pretes.map(c => `• ${c.n_devis || 'sans devis'} · ${c.client || '?'}${c.a_payer_especes ? ' · 💶 espèces' : ''}`).join('\n')}`);
  try {
    const pl = await planches.listPlanches();
    const aImprimer = (pl.rows || []).filter(p => ['APREPARER', 'AVERIFIER', 'AIMPRIMER'].includes(norm(p.statut)));
    if (aImprimer.length) parties.push(`*🖨️ PLANCHES À IMPRIMER* (${aImprimer.length})\n${aImprimer.map(p => `• ${p.client || '?'} · ${p.format || (p.metres != null && p.metres !== '' ? (/^A[34]$/i.test(String(p.metres)) ? String(p.metres).toUpperCase() : String(p.metres).replace('.', ',') + ' m') : '?')}${norm(p.statut) === 'AVERIFIER' ? ' · ⚠️ à vérifier' : ''}`).join('\n')}`);
  } catch (err) { console.error('Récap production (planches) :', err.message); }
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Guadeloupe' });
  if (!parties.length) return `📋 Récap des commandes du ${date} :\n\nRien en cours 👌`;
  return `📋 Récap des commandes du ${date} :\n\n${parties.join('\n\n')}`;
}

// Ancien fonctionnement (flux Power Automate), gardé en secours
async function recapViaFlux() {
  const flowUrl = process.env.RECAP_FLOW_URL;
  if (!flowUrl) throw new Error('RECAP_FLOW_URL non configurée');
  const res = await fetch(flowUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`Flow Power Automate : HTTP ${res.status}`);
  const data = await res.json();
  return data.recap || 'Récap des commandes du jour :\n\nRien en cours 👌';
}

// sendText(to, text) = fonction d'envoi WhatsApp du serveur (sendWhatsAppMessage)
async function handleProductionRecap(to, sendText) {
  let recap;
  try { recap = await construireRecap(); }
  catch (err) {
    console.error('Récap production (dashboard) : erreur', err.message);
    try { recap = await recapViaFlux(); } catch (e) { console.error('Récap production (flux) : erreur', e.message); }
  }
  // WhatsApp limite un message à ~4 000 caractères : découpage par bloc si besoin
  const morceaux = [];
  for (const bloc of String(recap || ERROR_MESSAGE).split('\n\n')) {
    const dernier = morceaux[morceaux.length - 1];
    if (dernier && dernier.length + bloc.length + 2 <= 3800) morceaux[morceaux.length - 1] = dernier + '\n\n' + bloc;
    else morceaux.push(bloc.slice(0, 3800));
  }
  for (const m of morceaux) await sendText(to, m);
  if (recap) console.log('Récap production envoyé à', to);
}

module.exports = { isRecapRequest, handleProductionRecap, construireRecap };
