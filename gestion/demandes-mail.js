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

// ---------- Formulaire de contact du site (Elementor) : envoyé depuis une adresse @igscustom.fr ----------
const estFormulaireSite = corps => /Powered by\s*:?\s*Elementor/i.test(corps) || (/Nom\s+Pr[ée]nom\s*:/i.test(corps) && /Adresse\s+mail\s*:/i.test(corps));
// Champs « Libellé: valeur » du formulaire
function champsFormulaire(corps) {
  const lire = re => { const m = String(corps).match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
  return {
    nom: lire(/Nom\s+Pr[ée]nom\s*:[ \t]*([^\n]*)/i),
    entreprise: lire(/Nom\s+de\s+l['’]entreprise\s*:[ \t]*([^\n]*)/i),
    email: lire(/Adresse\s+(?:e-?)?mail\s*:[ \t]*([^\s\n]*)/i),
    telephone: lire(/Num[ée]ro\s+de\s+t[ée]l[ée]phone\s*:[ \t]*([^\n]*)/i),
    message: lire(/Type\s+de\s+produit[^:\n]*:[ \t]*([\s\S]*?)(?:\n\s*-{3}|\n\s*Date\s*:|$)/i),
    page: lire(/Page\s+URL\s*:[ \t]*([^\n]*)/i),
  };
}
// Champs vides du formulaire : la ligne suivante (« Nom de l'entreprise: ») ne doit pas être prise pour la valeur
const vide = v => !v || /^[A-ZÉÈ][\wéèêàç' ’,]+\s*:/.test(v) ? '' : v;

// ---------- Spam : score simple, avant toute analyse ----------
const GENERIQUE = /(plus d['’]?\s*informations?|merci de me contacter|me contacter par (e-?)?mail|contactez[- ]moi|more information|contact me|get back to me|i am interested|your (website|site)|seo|backlinks?|referencement|référencement|marketing digital|crypto|bitcoin|investment|loan|pr[êe]t rapide|casino|viagra|telegram)/i;
const PRODUIT = /(t-?shirt|tee-?shirt|polo|sweat|hoodie|casquette|tote|sac|tablier|maillot|veste|planche|dtf|flocage|floquer|logo|brod|impression|imprimer|personnalis|marquage|textile|uniforme|tenue|\b\d+\s*(pi[eè]ces?|pcs|articles?|unit[ée]s?)\b)/i;
function scoreSpam({ message, telephone, entreprise, page, formulaire }) {
  const m = String(message || '');
  let s = 0;
  const raisons = [];
  const plus = (n, r) => { s += n; raisons.push(r); };
  if (GENERIQUE.test(m)) plus(2, 'texte générique');
  if (/igs\s*custom/i.test(m)) plus(2, 'reprend le nom de l\'atelier');
  if (/https?:\/\/|www\./i.test(m)) plus(2, 'lien dans le message');
  if (!String(telephone || '').replace(/\D/g, '')) plus(1, 'sans téléphone');
  if (formulaire && !page) plus(1, 'page d\'envoi vide');
  if (formulaire && !entreprise && m.split(/\s+/).filter(Boolean).length < 15) plus(1, 'message très court');
  if (/[\u0400-\u04FF\u4E00-\u9FFF]/.test(m)) plus(2, 'alphabet étranger');
  if (PRODUIT.test(m)) { s -= 3; raisons.push('besoin concret'); }
  else if (/devis|tarifs?|prix|commander|commande/i.test(m)) { s -= 2; raisons.push('parle de devis ou de prix'); }
  return { spam: s >= 3, score: s, raisons };
}

const SYSTEME = `Tu tries les mails reçus par IGS CUSTOM BAR, atelier de personnalisation textile et d'impression DTF en Guadeloupe.
Réponds uniquement avec un objet JSON, sans texte autour.
Champs : spam (true pour un message automatique, générique ou suspect sans besoin concret : « je souhaite plus d'informations, contactez-moi par mail », prospection SEO/marketing, lien douteux, texte qui reprend juste le nom de l'atelier ; false pour un vrai client, même bref, qui décrit ce qu'il veut), demande_devis (true seulement si l'expéditeur demande un prix, un devis ou veut commander des articles personnalisés ou des planches DTF ; false pour une réclamation, une facture, une prospection commerciale, une candidature, une publicité, un suivi de commande en cours, un remerciement), nom (nom et prénom de la personne, sinon ""), entreprise (nom de la société, association, club, mairie, école… pour laquelle la personne écrit, sinon ""), email (adresse du client ; si le mail est transféré, celle du vrai client), telephone (numéro tel qu'écrit, sinon ""), produit (ex. "T-shirt", "Polo", "Sweat", "Planche DTF", sinon ""), quantite (nombre, sinon 0), zone (zone de marquage, sinon ""), details (résumé de la demande en une ou deux phrases : couleurs, délai, occasion).`;

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

// Spam écarté : noté dans le journal (Admin) pour pouvoir vérifier qu'aucun vrai client n'a été écarté
async function spam(m, exp, sujet, raison) {
  console.log(`Demandes mail : spam écarté « ${sujet.slice(0, 60)} » (${raison})`);
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: 'Leïla (mail)', action: 'demande_spam', cle: String(m.id).slice(-60), details: { expediteur: exp, sujet: sujet.slice(0, 120), raison, recu: m.receivedDateTime } }).then(() => {}, () => {});
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
  let crees = 0, ignores = 0, spams = 0, dernier = depuis;
  const commercial = require('./commercial');
  for (const m of mails) {
    dernier = m.receivedDateTime > dernier ? m.receivedDateTime : dernier;
    if (vus.has(m.id)) continue;
    vus.add(m.id);
    const exp = String(m.from?.emailAddress?.address || '').toLowerCase();
    const sujet = String(m.subject || '');
    const corps = texte(m.body?.content);
    // Le formulaire du site arrive d'une adresse @igscustom.fr : c'est le seul mail « interne » analysé
    // Formulaire = mail envoyé PAR le site (adresse @igscustom.fr), jamais une réponse : la réponse d'un client cite le
    // formulaire d'origine dans l'historique du mail, elle ne doit pas recréer une demande à chaque échange
    const formulaire = estFormulaireSite(corps) && /@igscustom\.fr$/i.test(exp) && !/^(re|tr|fw|fwd|réf|aw)\s*:/i.test(sujet.trim());
    if (!exp || (!formulaire && (IGNORER_EXP.test(exp) || IGNORER_SUJET.test(sujet.trim())))) { ignores++; continue; }
    let f = null;
    if (formulaire) {
      const c = champsFormulaire(corps);
      f = { nom: vide(c.nom), entreprise: vide(c.entreprise), email: vide(c.email), telephone: vide(c.telephone), message: vide(c.message), page: vide(c.page) };
    }
    const sp = scoreSpam(f ? { ...f, formulaire: true } : { message: `${sujet}\n${corps}`.slice(0, 1500), telephone: (corps.match(/(?:\+|00)?\d[\d .]{8,}\d/) || [''])[0], formulaire: false });
    if (sp.spam) { spams++; await spam(m, exp, sujet, sp.raisons.join(', ')); continue; }
    try {
      const a = await analyser({ expediteur: `${m.from?.emailAddress?.name || ''} <${exp}>`, sujet, corps: f ? `Formulaire de contact du site igscustom.fr\nNom : ${f.nom}\nEntreprise : ${f.entreprise}\nE-mail : ${f.email}\nTéléphone : ${f.telephone}\nMessage : ${f.message}` : corps });
      if (a && a.spam === true) { spams++; await spam(m, exp, sujet, 'jugé indésirable à la lecture'); continue; }
      if (!a || a.demande_devis !== true) { ignores++; continue; }
      const valide = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
      // Formulaire : l'adresse du client est dans le champ « Adresse mail », jamais l'expéditeur (@igscustom.fr)
      const email = valide(a.email) && !/@igscustom\.fr$/i.test(a.email) ? String(a.email).trim().toLowerCase() : f ? (valide(f.email) ? f.email.toLowerCase() : null) : exp;
      const nom = String((f && f.nom) || a.nom || (f ? '' : m.from?.emailAddress?.name) || '').trim();
      // Champ « Entreprise » du formulaire (prioritaire), sinon la structure repérée dans le mail
      const entreprise = String((f && f.entreprise) || a.entreprise || '').trim();
      // Même client (même e-mail) déjà en demande ces 30 derniers jours : c'est la suite de l'échange, pas un nouveau devis
      if (email) {
        const { data: ex } = await supabase.from('gestion_demandes').select('id, statut, devis_numero, details').eq('email', email).not('statut', 'in', '(abandonnee,annulee)').gte('cree_le', new Date(Date.now() - 30 * 86400e3).toISOString()).order('cree_le', { ascending: false }).limit(1);
        if (ex && ex[0]) {
          const suite = String(a.details || '').trim();
          if (suite && ['nouvelle', 'brouillon', 'erreur'].includes(ex[0].statut) && !String(ex[0].details || '').includes(suite.slice(0, 60))) {
            await supabase.from('gestion_demandes').update({ details: `${ex[0].details || ''} · Suite (mail du ${new Date(m.receivedDateTime).toLocaleDateString('fr-FR')}) : ${suite}`.slice(0, 600) }).eq('id', ex[0].id);
          }
          await supabase.from('gestion_actions').insert({ utilisateur: 'Leïla (mail)', action: 'demande_suite_mail', cle: ex[0].devis_numero || `demande-${ex[0].id}`, details: { email, sujet: sujet.slice(0, 120) } }).then(() => {}, () => {});
          console.log(`Demandes mail : « ${sujet.slice(0, 60)} » = suite de la demande ${ex[0].id} (${ex[0].devis_numero || 'sans devis'}), pas de nouveau devis`);
          ignores++; continue;
        }
      }
      const d = await commercial.nouvelleDemande({
        source: 'mail', email, nom, entreprise, telephone: normTel(a.telephone || (f && f.telephone)),
        produit: String(a.produit || '').trim(), quantite: Number(a.quantite) || null, zone: String(a.zone || '').trim(),
        details: [String(a.details || '').trim(), f ? `(formulaire du site, ${new Date(m.receivedDateTime).toLocaleDateString('fr-FR')})` : `(mail du ${new Date(m.receivedDateTime).toLocaleDateString('fr-FR')} : « ${sujet.slice(0, 80)} »)`].filter(Boolean).join(' '),
      }, 'Leïla (mail)');
      if (d) crees++;
    } catch (err) { console.error(`Demandes mail : « ${sujet.slice(0, 60)} » non analysé :`, err.message); vus.delete(m.id); }
  }
  // Prochain passage : à partir du dernier mail lu (les ids déjà vus évitent les doublons à la même seconde)
  await setReglage('demandes_mail_depuis', dernier);
  await setReglage('demandes_mail_vus', JSON.stringify([...vus].slice(-300)));
  if (premier && !mails.length) return 'démarrage : aucun mail ces 2 dernières heures';
  return `${mails.length} mail(s) lu(s) : ${crees} demande(s) de devis ajoutée(s), ${spams} spam(s) écarté(s), ${ignores} ignoré(s)`;
}

// ---------- Accusé de réception (tâche « demandes_accuse ») ----------
// Environ 10 min après une vraie demande reçue par mail ou par le formulaire du site, Leïla répond au client que sa demande
// est prise en compte et qu'un devis suivra dans un autre mail. Du lundi au vendredi, 7 h - 19 h (Guadeloupe) seulement :
// une demande du week-end reçoit son accusé le lundi matin. Pas d'accusé si le devis est déjà parti ou la demande classée.
const DELAI_ACCUSE = 10 * 60e3;
const heureGP = (d = new Date()) => new Date(d.toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
const ouvre = (d = new Date()) => { const h = heureGP(d); return h.getDay() >= 1 && h.getDay() <= 5 && h.getHours() >= 7 && h.getHours() < 19; };
const escHtml = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SUJETS_ACCUSE = ['Votre demande de devis – IGS Custom Bar', 'Demande de devis bien reçue – IGS Custom Bar', 'IGS Custom Bar : nous avons bien reçu votre demande'];
const TEXTES_ACCUSE = [
  q => `Nous avons bien reçu votre demande de devis${q} et nous vous en remercions. Elle est prise en compte : vous recevrez votre devis dans un autre mail, dans les meilleurs délais.`,
  q => `Merci pour votre demande${q} ! Elle a bien été enregistrée par notre équipe, qui prépare votre devis. Il vous parviendra par un mail séparé, le plus rapidement possible.`,
  q => `Votre demande de devis${q} nous est bien parvenue. Nous nous en occupons et vous enverrons le devis dans un prochain mail, dans les meilleurs délais.`,
];
function mailAccuse(d) {
  const i = Math.floor(Math.random() * TEXTES_ACCUSE.length);
  const quoi = d.produit ? ` (${[d.quantite ? `${Number(d.quantite)} x` : '', d.produit].filter(Boolean).join(' ')})` : '';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1E1E4B;line-height:1.5">
<p>Bonjour,</p>
<p>${escHtml(TEXTES_ACCUSE[i](quoi))}</p>
<p>Si vous souhaitez ajouter une précision (tailles, couleurs, logo, date souhaitée), il vous suffit de répondre à ce mail.</p>
<p>Belle journée,<br>L'équipe IGS Custom Bar</p></div>`;
  return { subject: SUJETS_ACCUSE[Math.floor(Math.random() * SUJETS_ACCUSE.length)], html };
}
async function accuser() {
  if (!supabase) return 'base non configurée';
  // Premier passage : seulement les demandes reçues à partir de maintenant
  const depuis = await reglage('demandes_accuse_depuis');
  if (!depuis) { await setReglage('demandes_accuse_depuis', new Date().toISOString()); return 'démarrage : les demandes reçues à partir de maintenant recevront un accusé'; }
  if (!ouvre()) return 'hors horaires (lundi-vendredi, 7 h - 19 h) : en attente';
  const min = new Date(Math.max(Date.parse(depuis) || 0, Date.now() - 5 * 86400e3)).toISOString();
  const { data: liste } = await supabase.from('gestion_demandes').select('*').eq('source', 'mail').not('email', 'is', null)
    .in('statut', ['nouvelle', 'brouillon', 'erreur']).gte('cree_le', min).lte('cree_le', new Date(Date.now() - DELAI_ACCUSE).toISOString()).order('cree_le', { ascending: true }).limit(30);
  if (!liste || !liste.length) return 'aucune demande à accuser';
  const { data: faits } = await supabase.from('gestion_actions').select('cle').eq('action', 'demande_accuse').in('cle', liste.map(d => `demande-${d.id}`));
  const deja = new Set((faits || []).map(x => x.cle));
  let n = 0, err = 0;
  for (const d of liste) {
    if (deja.has(`demande-${d.id}`) || /@igscustom\.fr$/i.test(d.email)) continue;
    try {
      const m = mailAccuse(d);
      await g.sendMail(MAILBOX, { to: d.email, subject: m.subject, html: m.html, replyTo: MAILBOX });
      await supabase.from('gestion_actions').insert({ utilisateur: 'Leïla (automatique)', action: 'demande_accuse', cle: `demande-${d.id}`, details: { email: d.email, nom: d.nom } });
      n++;
    } catch (e) { err++; console.error(`Demandes mail : accusé de réception à ${d.email} non envoyé :`, e.message); }
  }
  return `${n} accusé(s) de réception envoyé(s)${err ? `, ${err} en erreur` : ''}`;
}

module.exports = { relever, accuser, _test: { mailAccuse, ouvre, analyser, IGNORER_EXP, IGNORER_SUJET, estFormulaireSite, champsFormulaire, scoreSpam, vide } };
