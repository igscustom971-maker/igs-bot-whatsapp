// ============================================
// IGS GESTION - MODULE STOCK
// - T-shirts vierges (TableauStock) et consommables (Tableau2) : lus et modifiés dans l'Excel
//   (le flux BDC SEFI peut s'en servir pour passer le stock en priorité)
// - Stocks clients (ex. Sandae) : dans Supabase, avec +/- et historique
// - Chaque mouvement est historisé dans gestion_stock_mouvements
// Pas d'alerte sur les t-shirts vides (pas de stock tenu volontairement) ; alerte seulement sur les consommables.
// ============================================

const xl = require('./excel');
const { supabase } = require('./db');
const source = require('./source');

const T_VIERGES = process.env.SP_TABLE_STOCK || 'TableauStock';
const T_CONSO = process.env.SP_TABLE_CONSO || 'Tableau2';
const T_SANDAE = process.env.SP_TABLE_SANDAE || 'Tableau6';

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const num = v => (typeof v === 'number' ? v : (txt(v) && !isNaN(Number(txt(v).replace(',', '.'))) ? Number(txt(v).replace(',', '.')) : null));
const sig = vals => xl.key(vals.slice(0, 4).join('|')); // signature d'une ligne : vérifie qu'elle n'a pas bougé entre lecture et écriture

function lireVierges(t) {
  const c = n => xl.col(t, n);
  const [cr, cc, ccol, ct, cq] = [c('Référence'), c('COUPE'), c('Couleur'), c('Taille'), c('Quantité')];
  return t.rows
    .filter(r => txt(r.values[cr]) || txt(r.values[ccol]))
    .map(r => ({
      row: r._row, sig: sig([r.values[cr], r.values[cc], r.values[ccol], r.values[ct]]),
      reference: txt(r.values[cr]), coupe: txt(r.values[cc]), couleur: txt(r.values[ccol]),
      taille: txt(r.values[ct]).toUpperCase().replace(/^XXL$/, '2XL'), quantite: num(r.values[cq]) ?? 0,
    }));
}
function lireConso(t) {
  const [cn, cs, cseuil] = [xl.col(t, 'Consommable'), xl.col(t, 'Stock actuel'), xl.col(t, 'Seuil alerte')];
  return t.rows.filter(r => txt(r.values[cn])).map(r => {
    const stock = num(r.values[cs]) ?? 0, seuil = num(r.values[cseuil]);
    return { row: r._row, sig: sig([r.values[cn]]), nom: txt(r.values[cn]), stock, seuil, alerte: seuil !== null && stock <= seuil };
  });
}

async function journal(user, stock, article, avant, apres, motif, client = null) {
  if (!supabase) return;
  const { error } = await supabase.from('gestion_stock_mouvements').insert({ utilisateur: user, stock, client, article, avant, apres, motif: motif || null });
  if (error) console.error('Gestion stock journal :', error.message);
}

async function clients() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('gestion_stock_clients').select('*').order('client').order('couleur').order('taille');
  if (error) throw new Error(`Supabase : ${error.message}`);
  return data;
}

// ---------- Base du dashboard (après la sortie de l'Excel) : gestion_stock_vierges / gestion_stock_conso ----------
async function viergesBase() {
  const { data, error } = await supabase.from('gestion_stock_vierges').select('*').order('id');
  if (error) throw new Error(`Supabase : ${error.message}`);
  return data.map(o => ({ row: o.id, sig: sig([o.reference, o.coupe, o.couleur, o.taille]), reference: txt(o.reference), coupe: txt(o.coupe), couleur: txt(o.couleur), taille: txt(o.taille).toUpperCase().replace(/^XXL$/, '2XL'), quantite: num(o.quantite) ?? 0 }));
}
async function consoBase() {
  const { data, error } = await supabase.from('gestion_stock_conso').select('*').order('id');
  if (error) throw new Error(`Supabase : ${error.message}`);
  return data.map(o => { const stock = num(o.stock) ?? 0, seuil = num(o.seuil); return { row: o.id, sig: sig([o.nom]), nom: txt(o.nom), stock, seuil, alerte: seuil !== null && stock <= seuil }; });
}
// Bascule : copie unique des deux tableaux de l'Excel (si la base est encore vide)
async function importerDepuisExcel() {
  if (!supabase) throw new Error('Supabase non configuré');
  const out = { vierges: 0, consommables: 0 };
  const { count: cv } = await supabase.from('gestion_stock_vierges').select('id', { count: 'exact', head: true });
  if (!cv) {
    const v = lireVierges(await xl.readTable(T_VIERGES)).map(l => ({ reference: l.reference || null, coupe: l.coupe || null, couleur: l.couleur || null, taille: l.taille || null, quantite: l.quantite }));
    if (v.length) { const { error } = await supabase.from('gestion_stock_vierges').insert(v); if (error) throw new Error(`Stock vierges : ${error.message}`); }
    out.vierges = v.length;
  } else out.vierges = `déjà ${cv}`;
  const { count: cc } = await supabase.from('gestion_stock_conso').select('id', { count: 'exact', head: true });
  if (!cc) {
    const c = lireConso(await xl.readTable(T_CONSO)).map(l => ({ nom: l.nom, stock: l.stock, seuil: l.seuil }));
    if (c.length) { const { error } = await supabase.from('gestion_stock_conso').insert(c); if (error) throw new Error(`Consommables : ${error.message}`); }
    out.consommables = c.length;
  } else out.consommables = `déjà ${cc}`;
  return out;
}
// T-shirts vierges pour le bon de commande SEFI (Excel ou base selon la source)
async function vierges() { return source.estBase() ? viergesBase() : lireVierges(await xl.readTable(T_VIERGES)); }

async function etat() {
  if (source.estBase()) {
    const [v, c] = await Promise.all([viergesBase(), consoBase()]);
    let mouvements = [];
    const { data } = await supabase.from('gestion_stock_mouvements').select('*').order('cree_le', { ascending: false }).limit(60);
    mouvements = data || [];
    return { vierges: v, consommables: c, clients: await clients(), mouvements };
  }
  const [tv, tc] = await Promise.all([xl.readTable(T_VIERGES), xl.readTable(T_CONSO)]);
  let mouvements = [];
  if (supabase) {
    const { data } = await supabase.from('gestion_stock_mouvements').select('*').order('cree_le', { ascending: false }).limit(60);
    mouvements = data || [];
  }
  return { vierges: lireVierges(tv), consommables: lireConso(tc), clients: await clients(), mouvements };
}

// Mouvement sur une ligne Excel : { row, sig, delta } ou { row, sig, set }
async function mouvementExcel(type, { row, sig: s, delta, set, champ }, user, motif) {
  const base = source.estBase();
  const t = base ? null : await xl.readTable(type === 'vierges' ? T_VIERGES : T_CONSO);
  const lignes = base ? (type === 'vierges' ? await viergesBase() : await consoBase()) : (type === 'vierges' ? lireVierges(t) : lireConso(t));
  const ecrire = async (colExcel, colBase, v) => {
    if (!base) return xl.setCell(t, l.row, colExcel, v);
    const { error } = await supabase.from(type === 'vierges' ? 'gestion_stock_vierges' : 'gestion_stock_conso').update({ [colBase]: v }).eq('id', l.row);
    if (error) throw new Error(`Supabase : ${error.message}`);
  };
  const l = lignes.find(x => x.row === Number(row));
  if (!l || l.sig !== s) throw new Error('La ligne a changé dans l\'Excel entre-temps : actualise et réessaie');
  if (champ === 'seuil' && type === 'consommables') {
    const v = num(set);
    if (v === null || v < 0) throw new Error('Seuil invalide');
    await ecrire('Seuil alerte', 'seuil', v);
    await journal(user, type, l.nom, l.seuil, v, 'Seuil d\'alerte modifié');
    return;
  }
  const avant = type === 'vierges' ? l.quantite : l.stock;
  const apres = set !== undefined && set !== null && set !== '' ? num(set) : avant + Number(delta || 0);
  if (apres === null || !isFinite(apres)) throw new Error('Quantité invalide');
  if (apres < 0) throw new Error('Le stock ne peut pas être négatif');
  await ecrire(type === 'vierges' ? 'Quantité' : 'Stock actuel', type === 'vierges' ? 'quantite' : 'stock', apres);
  const article = type === 'vierges' ? [l.reference, l.coupe, l.couleur, l.taille].filter(Boolean).join(' · ') : l.nom;
  await journal(user, type, article, avant, apres, motif);
}

async function ajouterExcel(type, data, user) {
  if (source.estBase()) {
    if (type === 'vierges') {
      const o = { reference: txt(data.reference).toUpperCase() || null, coupe: txt(data.coupe).toUpperCase() || null, couleur: txt(data.couleur).toUpperCase(), taille: txt(data.taille).toUpperCase(), quantite: num(data.quantite) ?? 0 };
      if (!o.couleur || !o.taille) throw new Error('Couleur et taille obligatoires');
      const { error } = await supabase.from('gestion_stock_vierges').insert(o); if (error) throw new Error(`Supabase : ${error.message}`);
      await journal(user, type, [o.reference, o.coupe, o.couleur, o.taille].filter(Boolean).join(' · '), null, o.quantite, 'Nouvel article');
    } else {
      const o = { nom: txt(data.nom), stock: num(data.stock) ?? 0, seuil: num(data.seuil) ?? 0 };
      if (!o.nom) throw new Error('Nom du consommable obligatoire');
      const { error } = await supabase.from('gestion_stock_conso').insert(o); if (error) throw new Error(`Supabase : ${error.message}`);
      await journal(user, type, o.nom, null, o.stock, 'Nouveau consommable');
    }
    return;
  }
  const t = await xl.readTable(type === 'vierges' ? T_VIERGES : T_CONSO);
  if (type === 'vierges') {
    const f = {
      'Référence': txt(data.reference).toUpperCase(), 'COUPE': txt(data.coupe).toUpperCase(),
      'Couleur': txt(data.couleur).toUpperCase(), 'Taille': txt(data.taille).toUpperCase(), 'Quantité': num(data.quantite) ?? 0,
    };
    if (!f['Couleur'] || !f['Taille']) throw new Error('Couleur et taille obligatoires');
    await xl.addRow(t, f, 'Couleur');
    await journal(user, type, [f['Référence'], f['COUPE'], f['Couleur'], f['Taille']].filter(Boolean).join(' · '), null, f['Quantité'], 'Nouvel article');
  } else {
    const f = { 'Consommable': txt(data.nom), 'Stock actuel': num(data.stock) ?? 0, 'Seuil alerte': num(data.seuil) ?? 0 };
    if (!f['Consommable']) throw new Error('Nom du consommable obligatoire');
    await xl.addRow(t, f, 'Consommable');
    await journal(user, type, f['Consommable'], null, f['Stock actuel'], 'Nouveau consommable');
  }
}

// ---------- Stocks clients (Supabase) ----------
function needDb() { if (!supabase) throw new Error('Supabase non configuré'); }

async function ajouterClient(data, user) {
  needDb();
  const row = {
    client: txt(data.client).toUpperCase(), couleur: txt(data.couleur).toUpperCase() || null, taille: txt(data.taille).toUpperCase() || null,
    coupe: txt(data.coupe).toUpperCase() || null, article: txt(data.article) || null, quantite: Math.max(0, Math.round(num(data.quantite) ?? 0)),
    note: txt(data.note) || null,
  };
  if (!row.client) throw new Error('Nom du client obligatoire');
  const { data: ins, error } = await supabase.from('gestion_stock_clients').insert(row).select().single();
  if (error) throw new Error(`Supabase : ${error.message}`);
  await journal(user, 'client', libelle(ins), null, ins.quantite, 'Dépôt / nouvelle ligne', ins.client);
  return ins;
}
const libelle = l => [l.article, l.couleur, l.taille, l.coupe].filter(Boolean).join(' · ') || 'Article';

async function mouvementClient(id, { delta, set, note }, user, motif) {
  needDb();
  const { data: l, error } = await supabase.from('gestion_stock_clients').select('*').eq('id', id).single();
  if (error || !l) throw new Error('Ligne de stock introuvable');
  const patch = { updated_at: new Date().toISOString() };
  if (note !== undefined) patch.note = txt(note) || null;
  let apres = l.quantite;
  if (set !== undefined && set !== null && set !== '') apres = Math.round(num(set));
  else if (delta) apres = l.quantite + Math.round(Number(delta));
  if (!isFinite(apres) || apres < 0) throw new Error('Le stock ne peut pas être négatif');
  patch.quantite = apres;
  const { error: e2 } = await supabase.from('gestion_stock_clients').update(patch).eq('id', id);
  if (e2) throw new Error(`Supabase : ${e2.message}`);
  if (apres !== l.quantite) await journal(user, 'client', libelle(l), l.quantite, apres, motif, l.client);
}

async function supprimerClientLigne(id, user) {
  needDb();
  const { data: l } = await supabase.from('gestion_stock_clients').select('*').eq('id', id).single();
  const { error } = await supabase.from('gestion_stock_clients').delete().eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  if (l) await journal(user, 'client', libelle(l), l.quantite, null, 'Ligne supprimée', l.client);
}

// Import unique du stock Sandae (Tableau6 de l'Excel) vers les stocks clients
async function importerSandae(user) {
  needDb();
  const { count } = await supabase.from('gestion_stock_clients').select('id', { count: 'exact', head: true }).eq('client', 'SANDAE');
  if (count) throw new Error('Le stock Sandae est déjà importé');
  const t = await xl.readTable(T_SANDAE);
  const [cc, ct, ccp, cq] = [xl.col(t, 'Couleur'), xl.col(t, 'Taille'), xl.col(t, 'Coupe'), xl.col(t, 'Quantité')];
  let n = 0; const notes = [];
  for (const r of t.rows) {
    const couleur = txt(r.values[cc]);
    if (!couleur) continue;
    const q = num(r.values[cq]);
    if (q === null && !txt(r.values[ct])) { notes.push(couleur); continue; } // ligne de note ("a racheter ...")
    await ajouterClient({ client: 'SANDAE', couleur, taille: txt(r.values[ct]).replace(/^XXL$/i, '2XL'), coupe: r.values[ccp], quantite: q ?? 0 }, user);
    n++;
  }
  if (notes.length) await ajouterClient({ client: 'SANDAE', article: 'Note', quantite: 0, note: notes.join(' / ') }, user);
  return { importees: n, notes: notes.length };
}

module.exports = { vierges, importerDepuisExcel, etat, mouvementExcel, ajouterExcel, ajouterClient, mouvementClient, supprimerClientLigne, importerSandae };
