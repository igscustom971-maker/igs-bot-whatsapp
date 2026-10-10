// ============================================
// IGS GESTION - SUIVI DES ESPÈCES (caisse)
// - Encaissement : un paiement en espèces (commande, planche ou autre), avec montant, client, référence
// - Relevé : la personne en charge récupère les espèces -> on compte, on note l'écart, la caisse repart
// - Totaux mensuels / annuels des paiements en espèces
// Données dans Supabase (table gestion_caisse).
// ============================================

const { supabase } = require('./db');

const num = v => { const n = Number(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const txt = v => (v === null || v === undefined ? '' : String(v).trim());
function needDb() { if (!supabase) throw new Error('Supabase non configuré'); }

async function encaisser(data, user) {
  needDb();
  const montant = num(data.montant);
  if (!(montant > 0)) throw new Error('Montant invalide');
  const row = {
    type: 'encaissement', montant, utilisateur: user,
    client: txt(data.client).slice(0, 80) || null,
    source: ['commande', 'planche', 'autre'].includes(data.source) ? data.source : 'autre',
    ref: txt(data.ref).slice(0, 40) || null,
    note: txt(data.note).slice(0, 300) || null,
  };
  if (data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) row.cree_le = `${data.date}T12:00:00-04:00`;
  const { data: ins, error } = await supabase.from('gestion_caisse').insert(row).select().single();
  if (error) throw new Error(`Supabase : ${error.message}`);
  return ins;
}

async function lignes() {
  needDb();
  const { data, error } = await supabase.from('gestion_caisse').select('*').order('cree_le', { ascending: true }).limit(5000);
  if (error) throw new Error(`Supabase : ${error.message}`);
  return data;
}

// Solde théorique : ce qui reste après le dernier relevé + encaissements depuis
function solde(ls) {
  let s = 0, dernierReleve = null;
  for (const l of ls) {
    if (l.type === 'encaissement') s += Number(l.montant);
    else if (l.type === 'releve') { s = Number(l.compte) - Number(l.montant); dernierReleve = l; }
  }
  return { solde: Math.round(s * 100) / 100, dernierReleve };
}

async function etat() {
  const ls = await lignes();
  const { solde: s, dernierReleve } = solde(ls);
  const enc = ls.filter(l => l.type === 'encaissement');
  const depuis = dernierReleve ? enc.filter(l => l.cree_le > dernierReleve.cree_le) : enc;
  const parMois = {}, parAnnee = {};
  enc.forEach(l => {
    const d = new Date(new Date(l.cree_le).toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    parMois[m] = Math.round(((parMois[m] || 0) + Number(l.montant)) * 100) / 100;
    parAnnee[d.getFullYear()] = Math.round(((parAnnee[d.getFullYear()] || 0) + Number(l.montant)) * 100) / 100;
  });
  return {
    solde: s,
    dernierReleve,
    depuisReleve: depuis.slice().reverse(),
    historique: ls.slice().reverse().slice(0, 200),
    parMois, parAnnee,
  };
}

// Relevé : compte = espèces réellement présentes, montant = espèces récupérées (par défaut tout)
async function relever(data, user) {
  needDb();
  const { solde: theorique } = solde(await lignes());
  const compte = num(data.compte);
  if (!(compte >= 0)) throw new Error('Montant compté invalide');
  const recupere = data.recupere === undefined || data.recupere === '' ? compte : num(data.recupere);
  if (!(recupere >= 0) || recupere > compte) throw new Error('Montant récupéré invalide (entre 0 et le montant compté)');
  const ecart = Math.round((compte - theorique) * 100) / 100;
  const { data: ins, error } = await supabase.from('gestion_caisse').insert({
    type: 'releve', montant: recupere, compte, theorique, ecart, utilisateur: user, note: txt(data.note).slice(0, 300) || null,
  }).select().single();
  if (error) throw new Error(`Supabase : ${error.message}`);
  return ins;
}

async function supprimer(id, user) {
  needDb();
  const { data: l } = await supabase.from('gestion_caisse').select('*').eq('id', id).single();
  if (!l) throw new Error('Ligne introuvable');
  const { error } = await supabase.from('gestion_caisse').delete().eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'caisse_ligne_supprimee', cle: String(id), details: l });
}

module.exports = { encaisser, etat, relever, supprimer };
