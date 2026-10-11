// ============================================
// IGS GESTION - DEMANDES DE DEVIS TRANSMISES PAR ISMAËL À LEÏLA (WhatsApp)
// Ismaël écrit au numéro IGS depuis son numéro perso : « Devis pour BLACHA GRILL, 5 t-shirts flocage avant arrière… ».
// Leïla enregistre la demande dans Commercial > Demandes (mention « demandée par Ismaël »), prépare le brouillon Odoo
// (client retrouvé, sinon fiche créée avec ce qu'elle a) et répond à Ismaël avec ce qui reste à compléter.
// ============================================

const MODELE = process.env.DEMANDES_MAIL_MODELE || process.env.PLANCHES_MODELE || 'claude-haiku-4-5';

// Le message commence par « devis », « demande de devis », « dde devis »… (le récap/planning reste à part)
const DECLENCHEUR = /^\s*(?:nouvelle\s+)?(?:demande\s+de\s+devis|dde\s+(?:de\s+)?devis|devis)\b/i;
const estDemande = texte => DECLENCHEUR.test(String(texte || ''));

const SYSTEME = `Ismaël, gérant d'IGS CUSTOM BAR (personnalisation textile et impression DTF en Guadeloupe), transmet une demande de devis d'un client en quelques mots.
Réponds uniquement avec un objet JSON, sans texte autour.
Champs : nom (client : entreprise, association ou personne, tel qu'écrit, sinon ""), email (sinon ""), telephone (tel qu'écrit, sinon ""), produit (ex. "T-shirt", "Polo", "Sweat", "Casquette", "Planche DTF", sinon ""), quantite (nombre total, sinon 0), zone (zone(s) de marquage et technique, ex. "flocage avant + arrière", sinon ""), details (le reste utile en une ou deux phrases : couleurs, tailles, délai, remarques ; sinon "").`;

async function analyser(texte) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY non configurée');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELE, max_tokens: 400, system: SYSTEME, messages: [{ role: 'user', content: String(texte).slice(0, 2000) }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Claude : ${j.error?.message || res.status}`);
  const t = (j.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

// Repli sans IA : « Devis pour NOM, 5 t-shirts … »
function analyseSimple(texte) {
  const corps = String(texte).replace(DECLENCHEUR, '').replace(/^\s*(?:pour|:|-)\s*/i, '').trim();
  const nom = (corps.split(/[,;\n]| - /)[0] || '').trim().slice(0, 80);
  const reste = corps.slice(nom.length).replace(/^[,;\s-]+/, '');
  const q = reste.match(/\b(\d{1,4})\b/);
  const p = reste.match(/t-?shirts?|polos?|sweats?|hoodies?|casquettes?|tote ?bags?|tabliers?|planches?(?: dtf)?/i);
  const email = (corps.match(/[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i) || [''])[0];
  return { nom, email, telephone: (corps.match(/(?:\+|00)?\d[\d .]{8,}\d/) || [''])[0], produit: p ? p[0] : '', quantite: q ? Number(q[1]) : 0, zone: '', details: reste };
}

// Traite le message d'Ismaël ; renvoie le texte de confirmation à lui renvoyer
async function traiter(texte) {
  let a;
  try { a = await analyser(texte); } catch (err) { console.error('Demande Ismaël : analyse IA impossible, repli simple :', err.message); a = analyseSimple(texte); }
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(a.email || '').trim()) ? String(a.email).trim().toLowerCase() : '';
  const telBrut = String(a.telephone || '').replace(/\D/g, '');
  const telephone = telBrut ? require('./telephones-bat').telValide(a.telephone) : null;
  const details = [String(a.details || '').trim(), '(demandé par Ismaël)'].filter(Boolean).join(' ');
  const d = await require('./commercial').nouvelleDemande({
    source: 'ismael', nom: String(a.nom || '').trim(), email, telephone,
    produit: String(a.produit || '').trim(), quantite: Number(a.quantite) || null, zone: String(a.zone || '').trim(), details,
  }, 'Ismaël (WhatsApp)');
  if (!d) return '⚠️ Je n\'ai pas pu enregistrer la demande (base indisponible). Réessaie dans une minute.';

  const quoi = [d.quantite ? `${d.quantite} x` : '', d.produit || 'produit à préciser', d.zone ? `(${d.zone})` : ''].filter(Boolean).join(' ');
  const l = [`✅ Demande de devis enregistrée : *${d.nom || 'client sans nom'}* – ${quoi}.`];
  if (d.devis_numero) {
    l.push(d.client_cree === true
      ? `Brouillon *${d.devis_numero}* prêt dans Odoo, avec une *nouvelle fiche client* « ${d.client_odoo || d.nom} » : je ne l'ai pas trouvé, ajoute son mail et son téléphone (ou rattache le devis au bon client).`
      : `Brouillon *${d.devis_numero}* prêt dans Odoo${d.client_odoo ? ` pour ${d.client_odoo}` : ''}.`);
    if (d.client_odoo && !d.produit_odoo) l.push('Produit à choisir dans le brouillon.');
    if (!email && !telephone && d.client_cree === true) l.push('Sans mail, le devis ne pourra pas partir.');
  } else {
    l.push(`Pas de brouillon Odoo${d.erreur ? ` (${String(d.erreur).slice(0, 120)})` : ''} : à finaliser dans Commercial > Demandes.`);
  }
  l.push('Tu la retrouves dans Commercial > Demandes, avec la mention « demandée par Ismaël ».');
  return l.join('\n');
}

module.exports = { estDemande, traiter, _test: { analyseSimple, DECLENCHEUR } };
