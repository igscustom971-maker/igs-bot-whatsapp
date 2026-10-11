// ============================================
// IGS GESTION - DEMANDES DE DEVIS REÇUES PAR MAIL (tâche « demandes_mail »)
// Leïla lit les nouveaux mails de la boîte de réception de contact@ : quand c'est une NOUVELLE demande de devis
// (personnalisation textile, planches DTF…), elle l'enregistre dans Commercial > Demandes (brouillon Odoo préparé).
// Les mails internes, automatiques (Odoo, Stripe, Qonto, SEFI, formulaire…) et les réponses à un échange en cours
// sont ignorés. Analyse par l'API Claude (modèle léger), comme les planches reçues par mail.
// ============================================

const g = require('./graph');
const { supabase } = require('./db');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const MODELE = process.env.DEMANDES_MAIL_MODELE || process.env.PLANCHES_MODELE || 'claude-haiku-4-5';
const texte = html => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// Expéditeurs jamais analysés (interne, automatique, fournisseurs)
const IGNORER_EXP = /(@igscustom\.fr|@ghs-|noreply|no-reply|ne-pas-repondre|nepasrepondre|notification|mailer-daemon|postmaster|@odoo|odoo\.com|stripe|qonto|sefi|paypal|sumup|microsoft|google\.com|facebook|instagram|linkedin|wordpress|woocommerce|newsletter|marketing)/i;
const IGNORER_SUJET = /^(re|tr|fw|fwd|réf|aw)\s*:|nouvelle commande -|planche|facture|invoice|bon de commande|commande n°|livraison|colis|suivi/i;

const SYSTEME = `Tu tries les mails reçus par IGS CUSTOM BAR, atelier de personnalisation textile et d'impression DTF en Guadeloupe.
Réponds uniquement avec un objet JSON, sans texte autour.
Champs : demande_devis (true seulement si l'expéditeur demande un prix, un devis ou veut commander des articles personnalisés ou des planches DTF ; false pour une réclamation, une facture, une prospection commerciale, une candidature, une publicité, un suivi de commande en cours, un remerciement), nom (nom de la personne ou de la structure, sinon ""), email (adresse du client ; si le mail est transféré, celle du vrai client), telephone (numéro tel qu'écrit, sinon ""), produit (ex. "T-shirt", "Polo", "Sweat", "Planche DTF", sinon ""), quantite (nombre, sinon 0), zone (zone de marquage, sinon ""), details (résumé de la demande en une ou deux phrases : couleurs, délai, occasion).`;

async function reglage(cle, defaut = null) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (supabase) await supabase.from('gestion_reglages').upsert({ cle, valeur: String(valeur), updated_at: new Date().toISOString() });
}

async function analyser({ expediteur, sujet, corps }) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY non configurée');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELE, max_tokens: 500, system: SYSTEME,
      messages: [{ role: 'user', content: `Expéditeur : ${expediteur}\nObjet : ${sujet}\nTexte :\n${String(corps).slice(0, 3000)}` }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Claude : ${j.error?.message || res.status}`);
  const t = (j.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

const normTel = brut => (String(brut || '').replace(/\D/g, '') ? require('./telephones-bat').telValide(brut) : null);

// Une passe : mails arrivés depuis le dernier passage (au plus 30), déjà vus ignorés
async function relever() {
  if (!supabase) return 'base non configurée';
  const premier = !(await reglage('demandes_mail_depuis'));
  const depuis = (await reglage('demandes_mail_depuis')) || new Date(Date.now() - 2 * 3600e3).toISOString();
  const vus = new Set(JSON.parse((await reglage('demandes_mail_vus', '[]')) || '[]'));
  const u = `/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox/messages`;
  const q = `?$filter=${encodeURIComponent(`receivedDateTime ge ${depuis}`)}&$orderby=receivedDateTime%20asc&$top=30&$select=id,subject,from,receivedDateTime,body`;
  const r = await g.graph(u + q);
  const mails = r.value || [];
  let crees = 0, ignores = 0, dernier = depuis;
  const commercial = require('./commercial');
  for (const m of mails) {
    dernier = m.receivedDateTime > dernier ? m.receivedDateTime : dernier;
    if (vus.has(m.id)) continue;
    vus.add(m.id);
    const exp = String(m.from?.emailAddress?.address || '').toLowerCase();
    const sujet = String(m.subject || '');
    if (!exp || IGNORER_EXP.test(exp) || IGNORER_SUJET.test(sujet.trim())) { ignores++; continue; }
    try {
      const a = await analyser({ expediteur: `${m.from?.emailAddress?.name || ''} <${exp}>`, sujet, corps: texte(m.body?.content) });
      if (!a || a.demande_devis !== true) { ignores++; continue; }
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(a.email || '')) ? String(a.email).toLowerCase() : exp;
      const d = await commercial.nouvelleDemande({
        source: 'mail', email, nom: String(a.nom || m.from?.emailAddress?.name || '').trim(), telephone: normTel(a.telephone),
        produit: String(a.produit || '').trim(), quantite: Number(a.quantite) || null, zone: String(a.zone || '').trim(),
        details: [String(a.details || '').trim(), `(mail du ${new Date(m.receivedDateTime).toLocaleDateString('fr-FR')} : « ${sujet.slice(0, 80)} »)`].filter(Boolean).join(' '),
      }, 'Leïla (mail)');
      if (d) crees++;
    } catch (err) { console.error(`Demandes mail : « ${sujet.slice(0, 60)} » non analysé :`, err.message); vus.delete(m.id); }
  }
  // Prochain passage : à partir du dernier mail lu (les ids déjà vus évitent les doublons à la même seconde)
  await setReglage('demandes_mail_depuis', dernier);
  await setReglage('demandes_mail_vus', JSON.stringify([...vus].slice(-300)));
  if (premier && !mails.length) return 'démarrage : aucun mail ces 2 dernières heures';
  return `${mails.length} mail(s) lu(s) : ${crees} demande(s) de devis ajoutée(s), ${ignores} ignoré(s)`;
}

module.exports = { relever, _test: { analyser, IGNORER_EXP, IGNORER_SUJET } };
