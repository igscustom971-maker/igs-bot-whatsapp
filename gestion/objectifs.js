// ============================================
// IGS GESTION - OBJECTIFS DE VENTE PAR ARTICLE (onglet Commercial > Chiffre d'affaires, admin)
// Chaque ligne d'objectif (DTF au mètre, t-shirts pro, t-shirts particuliers, casquettes…) a un objectif mensuel en
// quantité et un prix moyen : objectif CA = quantité × prix. Le réalisé vient des factures Odoo du mois, article par
// article (une vente va à la PREMIÈRE ligne dont le filtre correspond). La somme des objectifs est comparée à la cible
// du mois (cible saisie pour ce mois, sinon celle de la phase) et un rééquilibrage est proposé pour l'atteindre.
// Filtre : mots séparés par des virgules (nom ou référence de l'article, sans accents ni majuscules) ;
// « ref:ENT » = référence qui commence par ENT ; « -mot » exclut.
// ============================================
const { supabase } = require('./db');
const odoo = require('./odoo');

const CLE = 'finances_objectifs';
const DEFAUT = {
  lignes: [
    { nom: 'Impression DTF', filtre: 'planche, -uv', unite: 'm', objectif: 120, prix: 25 },
    { nom: 'T-shirts pro', filtre: 'ref:ENT', unite: 'u', objectif: 150, prix: 12.5 },
    { nom: 'T-shirts particuliers', filtre: 't-shirt, tshirt, tee', unite: 'u', objectif: 50, prix: 20 },
    { nom: 'Casquettes', filtre: 'casquette', unite: 'u', objectif: 0, prix: 11 },
    { nom: 'Tabliers', filtre: 'tablier', unite: 'u', objectif: 0, prix: 15 },
    { nom: 'Polos', filtre: 'polo', unite: 'u', objectif: 0, prix: 28 },
    { nom: 'Goodies (mugs, gobelets, porte-clés, tote bags…)', filtre: 'mug, gobelet, eco cup, porte-cle, porte cle, tote, gourde, stylo, nappe', unite: 'u', objectif: 0, prix: 5, depuis: '2026-11' },
  ],
  cibles_mois: { '2026-08': 7470, '2026-09': 8070 },
};
const sansAcc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function lire() {
  if (!supabase) return DEFAUT;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', CLE).maybeSingle();
  try { const v = data && data.valeur ? JSON.parse(data.valeur) : null; return v && Array.isArray(v.lignes) ? { cibles_mois: {}, ...v } : DEFAUT; } catch { return DEFAUT; }
}
async function enregistrer({ lignes, cibles_mois }) {
  const propres = (lignes || []).filter(l => l && String(l.nom || '').trim()).slice(0, 30).map(l => ({
    nom: String(l.nom).trim().slice(0, 80), filtre: String(l.filtre || '').slice(0, 300), unite: l.unite === 'm' ? 'm' : 'u',
    objectif: Math.max(0, Number(String(l.objectif).replace(',', '.')) || 0), prix: Math.max(0, Number(String(l.prix).replace(',', '.')) || 0),
    ...(/^\d{4}-\d{2}$/.test(l.depuis || '') ? { depuis: l.depuis } : {}),
  }));
  const cibles = {};
  for (const [k, v] of Object.entries(cibles_mois || {})) if (/^\d{4}-\d{2}$/.test(k) && Number(v) > 0) cibles[k] = Number(v);
  if (supabase) await supabase.from('gestion_reglages').upsert({ cle: CLE, valeur: JSON.stringify({ lignes: propres, cibles_mois: cibles }), updated_at: new Date().toISOString() });
  return { ok: true };
}

function correspond(filtre, v) {
  const termes = String(filtre || '').split(',').map(t => sansAcc(t).trim()).filter(Boolean);
  const ref = sansAcc(v.ref), txt = sansAcc(`${v.ref} ${v.produit} ${v.libelle}`);
  const test = t => t.startsWith('ref:') ? ref.startsWith(t.slice(4).trim()) : txt.includes(t);
  const inclus = termes.filter(t => !t.startsWith('-')), exclus = termes.filter(t => t.startsWith('-')).map(t => t.slice(1).trim());
  return inclus.length > 0 && inclus.some(test) && !exclus.some(test);
}

async function bilan(mois) {
  if (!/^\d{4}-\d{2}$/.test(mois || '')) throw new Error('Mois invalide');
  const conf = await lire();
  const { lignes: ventes, factures } = await odoo.ventesParProduit(mois);
  const actives = conf.lignes.map((l, i) => ({ ...l, i, active: !l.depuis || l.depuis <= mois }));
  const res = actives.map(l => ({ ...l, qte: 0, ca: 0, articles: new Map() }));
  const autres = new Map();
  let total = 0;
  for (const v of ventes) {
    total += v.ht;
    const l = res.find(x => correspond(x.filtre, v));
    if (l) { l.qte += v.qte; l.ca += v.ht; l.articles.set(v.produit, (l.articles.get(v.produit) || 0) + v.ht); }
    else { const k = v.ref ? `[${v.ref}] ${v.produit}` : v.produit; const a = autres.get(k) || { produit: k, qte: 0, ca: 0 }; a.qte += v.qte; a.ca += v.ht; autres.set(k, a); }
  }
  // Cible du mois : saisie pour ce mois, sinon la phase en cours (paramètres de l'onglet)
  let cible = Number(conf.cibles_mois[mois]) || 0;
  if (!cible) { try { const p = (await require('./finances').parametres()).params; const ph = (p.phases || []).slice().sort((a, b) => a.jusqua.localeCompare(b.jusqua)).find(x => mois <= x.jusqua); cible = ph ? Number(ph.cible) || 0 : 0; } catch {} }
  const objCA = res.filter(l => l.active).reduce((t, l) => t + l.objectif * l.prix, 0);
  // Rééquilibrage : objectifs (lignes actives avec un prix) ajustés au prorata pour que leur total atteigne la cible
  let suggestion = null;
  if (cible && objCA > 0 && Math.abs(cible - objCA) >= 50) {
    const k = cible / objCA;
    suggestion = res.filter(l => l.active && l.prix > 0 && l.objectif > 0).map(l => ({ i: l.i, nom: l.nom, objectif: l.objectif, propose: l.unite === 'm' ? Math.ceil(l.objectif * k) : Math.ceil(l.objectif * k / 5) * 5 }));
  }
  const parClient = new Map();
  for (const f of factures) parClient.set(f.client, (parClient.get(f.client) || 0) + f.ht);
  const top = [...parClient].sort((a, b) => b[1] - a[1])[0];
  return {
    mois, cible, total_ht: r2(total), objectif_ca: r2(objCA),
    lignes: res.map(l => ({ i: l.i, nom: l.nom, filtre: l.filtre, unite: l.unite, objectif: l.objectif, prix: l.prix, depuis: l.depuis || null, active: l.active,
      objectif_ca: r2(l.objectif * l.prix), qte: r2(l.qte), ca: r2(l.ca), pct: l.objectif ? Math.round(l.qte / l.objectif * 100) : null, reste: l.objectif ? r2(Math.max(0, l.objectif - l.qte)) : null,
      articles: [...l.articles].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => ({ produit: n, ca: r2(v) })) })),
    autres: [...autres.values()].sort((a, b) => b.ca - a.ca).slice(0, 12).map(a => ({ ...a, qte: r2(a.qte), ca: r2(a.ca) })),
    autres_ca: r2([...autres.values()].reduce((t, a) => t + a.ca, 0)),
    commandes: factures.length, panier_moyen: factures.length ? r2(factures.reduce((t, f) => t + f.ht, 0) / factures.length) : null,
    top_client: top ? { nom: top[0], ht: r2(top[1]) } : null,
    suggestion, cibles_mois: conf.cibles_mois,
  };
}

module.exports = { bilan, lire, enregistrer, _test: { correspond } };
