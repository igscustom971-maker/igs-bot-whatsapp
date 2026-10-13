// ============================================
// IGS GESTION - PRÉNOM FIABLE D'UN CLIENT
// Le nom WhatsApp n'est souvent pas le vrai nom (surnom, entreprise, nom d'un proche…). On cherche le prénom un peu
// partout et on ne l'utilise que s'il est sûr ; sinon aucun prénom (« Bonjour » tout court).
//  Sources sûres (une seule suffit) : note client « Prénom : X », nom du répertoire d'Ismaël (note), prénom avec lequel
//    l'équipe salue le client dans ses réponses manuelles, prénom que le client donne lui-même (« je m'appelle X »).
//  Sources simples (il en faut DEUX qui concordent) : nom WhatsApp, nom de la commande / du devis / de la fiche Odoo,
//    e-mail (marie.dupont@… -> marie).
// ============================================
const { supabase } = require('./db');

const sansAccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ENTREPRISE = /\b(sas|sarl|eurl|sasu|asso|association|club|mairie|ecole|école|ets|sci|team|factory|bar|restaurant|ste|société|societe|store|shop|custom|antilles|martinique|guadeloupe|caraibes|caraïbes|pub|events?|cosm[ée]tiques?|services?|prod|studio|boutique|3d|groupe|agence|collectif|famille|family|official|officiel)\b/i;
const PAS_PRENOM = new Set(['mr', 'mme', 'mlle', 'm', 'madame', 'monsieur', 'mademoiselle', 'de', 'la', 'le', 'les', 'du', 'des', 'et', 'van', 'von', 'da', 'di', 'tout', 'tous', 'toutes', 'toi', 'vous', 'a', 'à', 'ma', 'mon', 'ok', 'bien', 'super', 'merci', 'bonjour', 'salut', 'contact', 'info', 'infos', 'commande', 'commandes', 'devis', 'facture', 'compta', 'admin', 'service', 'equipe', 'équipe', 'igs', 'client', 'gmail', 'hotmail', 'yahoo', 'outlook', 'orange', 'wanadoo', 'live', 'icloud', 'pro', 'perso', 'la', 'chef', 'boss', 'frere', 'frère', 'soeur', 'sœur', 'cousin', 'cousine', 'tata', 'tonton', 'maman', 'papa', 'mamie', 'papi', 'doudou', 'cherie', 'chérie', 'cheri', 'chéri', 'beaucoup', 'encore', 'infiniment', 'pour', 'bonne', 'bon', 'journee', 'journée', 'soiree', 'soirée', 'ca', 'ça', 'oui', 'non', 'voila', 'voilà', 'cher', 'chere', 'chère', 'chers', 'ami', 'amie', 'amis', 'gars', 'bro', 'frerot', 'everyone', 'the', 'again', 'mille', 'fois', 'vraiment', 'aussi', 'madame', 'messieurs', 'mesdames', 'docteur', 'maitre', 'maître', 'patron', 'patronne']);
const motValide = w => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'-]{1,24}$/.test(w) && !PAS_PRENOM.has(sansAccent(w));
const joli = w => w.split('-').map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join('-');

// Mots d'un nom (« DUPONT Marie », « Marie D. 🌺 ») ; un nom d'entreprise ne donne rien
function mots(nom) {
  const t = String(nom || '').replace(/[^\p{L}' -]/gu, ' ').trim();
  if (!t || ENTREPRISE.test(t)) return [];
  return t.split(/\s+/).filter(motValide);
}
function motsEmail(email) {
  const m = String(email || '').toLowerCase().match(/^([^@\s]+)@/);
  if (!m) return [];
  return m[1].split(/[._\-+\d]+/).filter(w => w.length >= 3 && motValide(w));
}

// Prénom avec lequel l'équipe salue le client (« Salut Marina », « Merci Jean ! »)
function prenomsSalues(textes) {
  const compte = new Map();
  for (const t of textes) {
    const re = /(?:^|[\s,.!])(?:[Bb]onjour|[Bb]onsoir|[Ss]alut|[Cc]oucou|[Hh]ello|[Hh]ey|[Rr]e|[Mm]erci|[Cc]c|CC|[Yy]o)\s+([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'-]{1,24})\b/g;
    let m;
    while ((m = re.exec(String(t || '')))) { if (motValide(m[1])) { const k = sansAccent(m[1]); compte.set(k, { mot: m[1], n: (compte.get(k)?.n || 0) + 1 }); } }
  }
  const l = [...compte.values()].sort((a, b) => b.n - a.n);
  if (!l.length || (l[1] && l[1].n === l[0].n)) return null; // plusieurs prénoms à égalité : doute
  return l[0].mot;
}
// Prénom donné par le client lui-même
function prenomDonne(textes) {
  for (const t of textes) {
    const m = String(t || '').match(/(?:je m'?appelle|je m’appelle|moi c'?est|moi c’est|mon pr[ée]nom (?:est|c'?est)|pr[ée]nom\s*:)\s*([A-Za-zÀ-ÖØ-öø-ÿ'-]{2,25})/i);
    if (m && motValide(m[1])) return m[1];
  }
  return null;
}

// Décision à partir des sources (pure, testable)
function decider({ note = '', salues = [], clientTextes = [], whatsapp = '', noms = [], emails = [] }) {
  const n = String(note || '');
  const pn = n.match(/pr[ée]nom\s*:\s*([A-Za-zÀ-ÖØ-öø-ÿ'-]{2,30})/i);
  if (pn && motValide(pn[1])) return { prenom: joli(pn[1]), source: 'note client' };
  const rep = n.match(/Nom dans le répertoire d'Ismaël\s*:\s*([^\n]+)/i);
  if (rep) { const w = mots(rep[1]); if (w.length) return { prenom: joli(w[0]), source: 'répertoire d\'Ismaël' }; }
  const s = prenomsSalues(salues);
  if (s) return { prenom: joli(s), source: 'réponses de l\'équipe' };
  const d = prenomDonne(clientTextes);
  if (d) return { prenom: joli(d), source: 'donné par le client' };
  // Sources simples : il en faut deux qui concordent
  const sources = [];
  const wa = mots(whatsapp);
  if (wa.length) sources.push({ nom: 'whatsapp', mots: wa });
  for (const x of noms) { const w = mots(x); if (w.length) sources.push({ nom: 'nom', mots: w, brut: x }); }
  for (const e of emails) { const w = motsEmail(e); if (w.length) sources.push({ nom: 'email', mots: w }); }
  const vus = new Map(); // mot -> { sources:Set, premier:n, formes:[] }
  sources.forEach((src, i) => src.mots.forEach((w, j) => {
    const k = sansAccent(w);
    const v = vus.get(k) || { srcs: new Set(), premier: 0, formes: [] };
    v.srcs.add(`${src.nom}:${i}`); if (j === 0) v.premier++; v.formes.push(w);
    vus.set(k, v);
  }));
  // Deux sources distinctes (deux noms identiques de commandes différentes comptent aussi)
  let ok = [...vus.entries()].filter(([, v]) => v.srcs.size >= 2);
  // Nom de famille en MAJUSCULES dans un nom (« DUPONT Marie ») : pas un prénom
  ok = ok.filter(([, v]) => !v.formes.some(f => f.length > 2 && f === f.toUpperCase() && f !== f.toLowerCase()) || v.formes.every(f => f === f.toUpperCase()));
  if (ok.length > 1) ok = ok.filter(([, v]) => v.premier >= 2);
  if (ok.length !== 1) return { prenom: '', source: ok.length ? 'doute' : 'aucune source sûre' };
  const formes = ok[0][1].formes;
  const forme = formes.find(f => /[À-ÖØ-öø-ÿ]/.test(f)) || formes.find(f => f !== f.toUpperCase()) || formes[0];
  return { prenom: joli(forme), source: 'nom et e-mail / WhatsApp concordants' };
}

const cache = new Map(); // tel|noms|emails -> { le, r }
async function prenomFiable({ tel = '', noms = [], emails = [] } = {}) {
  noms = [].concat(noms || []).filter(Boolean).map(String);
  emails = [].concat(emails || []).filter(Boolean).map(String);
  const cle = `${tel}|${noms.join(',')}|${emails.join(',')}`;
  const c = cache.get(cle);
  if (c && Date.now() - c.le < 10 * 60e3) return c.r;
  const src = { noms: [...noms], emails: [...emails] };
  if (supabase && tel) {
    const q = p => Promise.resolve(p).catch(() => ({ data: null }));
    const [note, cl, eq, conv, dem] = await Promise.all([
      q(supabase.from('client_notes').select('note').eq('phone_number', tel).maybeSingle()),
      q(supabase.from('clients').select('name').eq('phone_number', tel).maybeSingle()),
      q(supabase.from('gestion_actions').select('details').eq('action', 'reponse_equipe').eq('cle', String(tel)).order('cree_le', { ascending: false }).limit(40)),
      q(supabase.from('conversations').select('content').eq('phone_number', tel).eq('role', 'user').order('created_at', { ascending: false }).limit(60)),
      q(supabase.from('gestion_demandes').select('nom, email').eq('telephone', tel).limit(5)),
    ]);
    src.note = note.data?.note || '';
    src.whatsapp = cl.data?.name || '';
    src.salues = (eq.data || []).map(a => a.details?.texte || '');
    src.clientTextes = (conv.data || []).map(m => m.content || '');
    for (const t of src.clientTextes) for (const e of String(t).match(/[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi) || []) src.emails.push(e);
    for (const d of dem.data || []) { if (d.nom) src.noms.push(d.nom); if (d.email) src.emails.push(d.email); }
  }
  src.emails = [...new Set(src.emails.map(e => e.toLowerCase()))];
  src.noms = [...new Set(src.noms)];
  const r = decider(src);
  cache.set(cle, { le: Date.now(), r });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return r;
}

module.exports = { prenomFiable, _test: { decider, mots, motsEmail, prenomsSalues, prenomDonne } };
