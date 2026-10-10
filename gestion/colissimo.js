// ============================================
// IGS GESTION - COLIS LIVRÉ (remplace le flux Power Automate « Colissimo livré + avis »)
// Toutes les 5 minutes, lecture de la boîte contact@ : mail de La Poste « Confirmation de la livraison »
// (noreply@notif-colissimo-laposte.info). Le N° de suivi du mail est rapproché des commandes et planches
// expédiées (N° de suivi saisi, pas encore LIVRÉE) :
//  - la commande / la planche passe en LIVRÉE ;
//  - le client reçoit le mail « livrée + avis » (+ WhatsApp si la fenêtre de 24 h est ouverte) ;
//  - la demande d'avis du lendemain n'est pas envoyée pour celle-ci (déjà faite).
// Actif uniquement quand les messages automatiques sont activés dans Admin (même interrupteur).
// ============================================

const g = require('./graph');
const { supabase } = require('./db');
const commandes = require('./commandes');
const planches = require('./planches');
const notif = require('./notifications');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const EXPEDITEUR = /notif-colissimo-laposte\.info$/i;
const SUJET = /confirmation de la livraison/i;
const statutKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const texteMail = m => String(m.body?.content || m.bodyPreview || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
// N° de suivi La Poste : 8J02311670484 (Colissimo), 6A…, ou format international LA123456789FR
const NUMEROS = /\b(?:\d[A-Z]\d{11}|[A-Z]{2}\d{9}[A-Z]{2})\b/g;

async function lus() {
  if (!supabase) return new Set();
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'colissimo_mails_lus').maybeSingle();
  return new Set(data ? JSON.parse(data.valeur) : []);
}
async function noterLus(set) {
  if (!supabase) return;
  await supabase.from('gestion_reglages').upsert({ cle: 'colissimo_mails_lus', valeur: JSON.stringify([...set].slice(-500)), updated_at: new Date().toISOString() });
}

// Commandes et planches expédiées, en attente de livraison
async function enAttenteLivraison() {
  const out = [];
  const { rows } = await commandes.listCommandes();
  for (const c of rows) if (c.numero_suivi && statutKey(c.statut) !== 'LIVREE') out.push({ planche: false, cle: c.cle, suivi: c.numero_suivi.toUpperCase().replace(/\s/g, ''), ligne: c });
  const pl = await planches.listPlanches();
  for (const p of pl.rows || []) if (p.numero_suivi && statutKey(p.statut) !== 'LIVREE') out.push({ planche: true, cle: p.cle, suivi: p.numero_suivi.toUpperCase().replace(/\s/g, ''), ligne: p });
  return out;
}

// Un colis livré : statut LIVRÉE + mail « livrée + avis »
async function livrer(cible, recuLe) {
  const l = cible.ligne;
  if (cible.planche) await planches.modifier(cible.cle, { statut: 'LIVRÉE' }, 'Colissimo (automatique)');
  else await commandes.modifier(cible.cle, { statut: 'LIVRÉE' }, 'Colissimo (automatique)');
  console.log(`Gestion Colissimo : ${cible.planche ? 'planche' : 'commande'} ${l.n_devis || l.client} (${cible.suivi}) passée en LIVRÉE`);

  const type = cible.planche ? 'planche_livree' : 'livree_colis';
  const { faits } = await notif.dejaTraites();
  if (faits.has(`${cible.cle}|${type}`)) return;
  let email = l.email || null, tel = l.telephone || null;
  if (cible.planche) ({ email, tel } = await notif.contactPlanche(l.client));
  else if ((!email || !tel) && l.n_devis) {
    try {
      const p = await require('./odoo').clientDuDevis(l.n_devis);
      if (p) { email = email || p.email || null; tel = tel || commandes.normalizePhone(p.phone || '') || null; }
    } catch (err) { console.error('Gestion Colissimo (Odoo) :', err.message); }
  }
  const lienAvis = await notif.reglage('notif_avis_lien', 'https://g.page/r/CWIVVFwaHQYBEBM/review');
  await notif.envoyer({ cle: cible.cle, type, devis: l.n_devis, nom: l.client, email, tel, suivi: cible.suivi, lienAvis }, 'Colissimo (automatique)');
  // L'avis est déjà demandé dans ce mail : pas de seconde demande le lendemain
  if (!cible.planche) await notif.journal({ cle: cible.cle, type: 'avis', canal: null, statut: 'ignore', destinataire: null, sujet: null, message: null, erreur: `Avis déjà demandé dans le mail « colis livré » (${new Date(recuLe).toLocaleDateString('fr-FR')})`, par: 'Colissimo (automatique)' });
}

let enCours = false;
async function cycle() {
  if (enCours || !supabase) return;
  enCours = true;
  try {
    if ((await notif.reglage('notif_actives', 'off')) !== 'on') return;
    const depuis = new Date(Date.now() - 3 * 86400e3).toISOString();
    const url = `/users/${encodeURIComponent(MAILBOX)}/messages?$filter=receivedDateTime ge ${depuis}`
      + `&$select=id,subject,from,receivedDateTime,body,bodyPreview&$orderby=receivedDateTime desc&$top=100`;
    const { value = [] } = await g.graph(url);
    const mails = value.filter(m => EXPEDITEUR.test(m.from?.emailAddress?.address || '') && SUJET.test(m.subject || ''));
    if (!mails.length) return;
    const dejaLus = await lus();
    const nouveaux = mails.filter(m => !dejaLus.has(m.id));
    if (!nouveaux.length) return;
    const attente = await enAttenteLivraison();
    for (const m of nouveaux.reverse()) {
      const texte = texteMail(m).toUpperCase();
      const compact = texte.replace(/\s/g, '');
      const cibles = attente.filter(a => a.suivi.length >= 8 && compact.includes(a.suivi));
      if (!cibles.length) {
        console.log(`Gestion Colissimo : mail livré sans commande correspondante (${(texte.match(NUMEROS) || []).join(', ') || 'N° introuvable'})`);
      }
      let ok = true;
      for (const c of cibles) {
        try { await livrer(c, m.receivedDateTime); }
        catch (err) { ok = false; console.error(`Gestion Colissimo ${c.suivi} :`, err.message); }
      }
      if (ok) dejaLus.add(m.id); // en cas d'erreur, le mail est relu au prochain passage
    }
    await noterLus(dejaLus);
  } catch (err) {
    console.error('Gestion Colissimo :', err.message);
  } finally { enCours = false; }
}

function start() {
  setTimeout(() => cycle().catch(() => {}), 120e3);
  setInterval(() => cycle().catch(() => {}), 5 * 60e3);
}

module.exports = { start, cycle, _test: { texteMail, NUMEROS } };
