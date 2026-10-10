// ============================================
// IGS GESTION - SOURCE DES DONNÉES : l'Excel (historique) ou la base du dashboard (Supabase)
// Réglage « source_donnees » = excel | base. La bascule (Admin) fait une dernière lecture complète de l'Excel
// (commandes, planches, stock), puis le dashboard ne lit et n'écrit plus que dans sa base.
// L'Excel n'est plus touché ensuite (il reste en archive). Le bon de commande SEFI reste un classeur Excel.
// ============================================

const { supabase } = require('./db');

let mode = process.env.GESTION_SOURCE === 'base' ? 'base' : 'excel';
let charge = false;

async function charger() {
  if (!supabase) return mode;
  try {
    const { data, error } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'source_donnees').maybeSingle();
    if (error) throw new Error(error.message); // relu au prochain appel
    if (data?.valeur === 'base' || data?.valeur === 'excel') mode = data.valeur;
    charge = true;
  } catch (err) { console.error('Gestion source :', err.message); }
  return mode;
}
const estBase = () => mode === 'base';

async function definir(valeur) {
  if (!supabase) throw new Error('Supabase non configuré');
  const { error } = await supabase.from('gestion_reglages').upsert({ cle: 'source_donnees', valeur, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  mode = valeur;
}

// Bascule : dernière synchro Excel -> base (commandes, planches, stock), puis plus que la base
async function basculer(user) {
  if (estBase()) return { ok: true, deja: true };
  const commandes = require('./commandes');
  const planches = require('./planches');
  const c = await commandes.syncNow();
  if (c.error) throw new Error(`Lecture des commandes impossible : ${c.error}`);
  const p = await planches.syncNow();
  if (p.error) throw new Error(`Lecture des planches impossible : ${p.error}`);
  const s = await require('./stock').importerDepuisExcel();
  await definir('base');
  await commandes.syncNow(); await planches.syncNow();
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'bascule_base', cle: 'source', details: { commandes: c.rows.length, planches: p.rows.length, stock: s } });
  console.log(`Gestion : bascule sur la base du dashboard (${c.rows.length} commandes, ${p.rows.length} planches, stock ${JSON.stringify(s)}) par ${user}`);
  return { ok: true, commandes: c.rows.length, planches: p.rows.length, stock: s };
}
// Retour arrière (urgence) : le dashboard relit l'Excel. Ce qui a été saisi entre-temps n'y est pas.
async function revenirExcel(user) {
  await definir('excel');
  console.log(`Gestion : retour sur l'Excel par ${user}`);
  await require('./commandes').syncNow(); await require('./planches').syncNow();
  return { ok: true };
}

module.exports = { charger, estBase, basculer, revenirExcel, etat: () => ({ source: mode, charge }) };
