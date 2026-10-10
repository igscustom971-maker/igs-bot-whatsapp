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

// Produits lus dans « Informations complémentaire » : "5 x [ENTSHAVR] T-shirt personnalisé AV/AR" -> "5 t-shirts"
function produits(infos) {
  const out = [];
  for (const l of String(infos || '').split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:[.,]\d+)?)\s*x\s*\[[^\]]*\]\s*(.+)$/i);
    if (!m) continue;
    const n = Number(m[1].replace(',', '.'));
    let lib = m[2].replace(/(^|\s)personnalis\S*/gi, ' ').replace(/\bAV\s*\/\s*AR\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!lib) continue;
    if (n > 1) {
      const mots = lib.split(' ');
      const i = /^tote$/.test(mots[0]) && mots[1] ? 1 : 0; // "tote bag" -> "tote bags"
      if (!/[sx]$/.test(mots[i])) mots[i] += 's';
      lib = mots.join(' ');
    }
    out.push(`${n} ${lib}`);
  }
  return out.join(' + ');
}

// Récap léger, mêmes règles que l'ancien récap (flux Power Automate) : neutre, sans N° de devis ni affectation
async function construireRecap() {
  const commandes = require('./gestion/commandes');
  const planches = require('./gestion/planches');
  const today = aujourdHui();
  const { rows, syncedAt } = await commandes.listCommandes();
  if (!syncedAt) throw new Error('commandes pas encore chargées');
  const st = c => norm(c.statut);
  const parties = [];
  const enCommande = rows.some(c => st(c) === 'ENCOMMANDE');

  const aProduire = rows.filter(c => ['ENCOMMANDE', 'ENPRODUCTION', 'ENFLOCAGE'].includes(st(c)))
    .sort((a, b) => String(a.date_livraison || '9999').localeCompare(String(b.date_livraison || '9999')));
  if (aProduire.length) parties.push('*🔥 À produire*\n' + aProduire.map(c => {
    let l = `• ${c.client || '?'}`;
    const p = produits(c.infos);
    if (p) l += ` – ${p}`;
    if (c.date_livraison) l += ` – livraison ${jour(c.date_livraison)}`;
    if (c.date_livraison && c.date_livraison < today) l += ' ⚠️ en retard';
    if (c.remarque) l += ` (${String(c.remarque).replace(/\s+/g, ' ').slice(0, 60)})`;
    if (['ENCOMMANDE', 'ENPRODUCTION'].includes(st(c)) && norm(c.planche) === 'AFAIRE') l += ' – 🎞 planche à faire';
    return l;
  }).join('\n'));

  const aExpedier = rows.filter(c => st(c) === 'AEXPEDIER');
  if (aExpedier.length) parties.push('*📦 À expédier*\n' + aExpedier.map(c => `• ${c.client || '?'}`).join('\n'));
  const terminees = rows.filter(c => st(c) === 'TERMINEE');
  if (terminees.length) parties.push('*✅ Terminées – en attente de retrait*\n' + terminees.map(c => `• ${c.client || '?'}`).join('\n'));

  try {
    const pl = (await planches.listPlanches()).rows || [];
    const metres = p => (p.format ? ` – ${p.format}` : p.metres > 0 ? ` – ${String(p.metres).replace('.', ',')} m` : '');
    const paiement = p => (['NONPAYEE', 'ESPECE', 'ESPECES'].includes(norm(p.paiement)) ? ' ⚠️ pas encore payée, vérifier avant remise' : '');
    const groupes = [['AIMPRIMER', 'À imprimer'], ['APREPARER', 'À préparer'], ['ARECUPERER', 'À récupérer']]
      .map(([k, t]) => [t, pl.filter(p => norm(p.statut) === k)]).filter(([, l]) => l.length);
    if (groupes.length) parties.push('*🎞 Planches DTF*\n' + groupes.map(([t, l]) => `*_${t}_*\n` + l.map(p => `• ${p.client}${metres(p)}${paiement(p)}`).join('\n')).join('\n\n'));
  } catch (err) { console.error('Récap production (planches) :', err.message); }

  if (!parties.length) return 'Récap des commandes du jour :\n\nRien en cours 👌';
  return `Récap des commandes du jour :\n\n${enCommande ? '*📍 PASSER À SEFI*\n\n' : ''}${parties.join('\n\n')}`;
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
    // L'ancien flux lit l'Excel archivé : jamais utilisé une fois le dashboard sur sa base
    if (!require('./gestion/source').estBase()) { try { recap = await recapViaFlux(); } catch (e) { console.error('Récap production (flux) : erreur', e.message); } }
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
