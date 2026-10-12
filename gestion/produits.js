// ============================================
// IGS GESTION - ONGLET PRODUITS : tous les produits IGS d'Odoo avec leur prix TTC, rangés par catégorie.
// Consultation : toute l'équipe. Modification du prix : profils admin et commercial (écrit dans Odoo).
// ============================================
const odoo = require('./odoo');
const { supabase } = require('./db');

// Catégorie lisible : celle d'Odoo (dernier niveau) si elle est parlante, sinon déduite du nom du produit
const GENERIQUES = /^(all|tous|toutes|saleable|vendable|vendables|goods|biens|services?|divers|default|par d[ée]faut)$/i;
const FAMILLES = [
  [/planche|dtf|m[eè]tre|\ba[34]\b/i, 'Planches DTF'],
  [/t.?shirt|tee|polo|d[ée]bardeur|sweat|hoodie|capuche|zip|maillot|veste/i, 'Textile'],
  [/tote|sac|casquette|tablier|bob|chapeau/i, 'Accessoires textile'],
  [/gobelet|eco.?cup|mug|tasse|timbale|verre|gourde|bouteille/i, 'Objets'],
  [/flocage|impression|marquage|personnalis|logo|cr[ée]ation|graphi|retouche/i, 'Prestations'],
  [/livraison|exp[ée]dition|frais|port|transport/i, 'Livraison et frais'],
  [/acompte|remise|r[ée]duction|avoir/i, 'Remises et acomptes'],
];
function categorie(p) {
  const odooCat = String(p.categorie || '').split('/').map(x => x.trim()).filter(Boolean).pop() || '';
  if (odooCat && !GENERIQUES.test(odooCat)) return odooCat;
  const f = FAMILLES.find(([re]) => re.test(`${p.nom} ${p.ref || ''}`));
  return f ? f[1] : 'Autres';
}

let cache = { le: 0, data: null };
async function liste({ force = false } = {}) {
  if (!odoo.configured()) throw new Error('Odoo non configuré');
  if (!force && cache.data && Date.now() - cache.le < 5 * 60e3) return cache.data;
  const ps = (await odoo.catalogueProduits()).map(p => ({ ...p, categorie_affichee: categorie(p) }));
  const ordre = ['Textile', 'Accessoires textile', 'Objets', 'Planches DTF', 'Prestations', 'Livraison et frais', 'Remises et acomptes', 'Autres'];
  const cats = [...new Set(ps.map(p => p.categorie_affichee))].sort((a, b) => {
    const ia = ordre.indexOf(a), ib = ordre.indexOf(b);
    return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b, 'fr');
  });
  const data = { le: new Date().toISOString(), categories: cats.map(c => ({ nom: c, produits: ps.filter(p => p.categorie_affichee === c).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')) })), total: ps.length };
  cache = { le: Date.now(), data };
  return data;
}

async function changerPrix(id, prixTtc, user) {
  const r = await odoo.prixProduit(id, prixTtc);
  cache.le = 0;
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'produit_prix', cle: `produit-${r.id}`, details: { produit: r.nom, avant_ttc: r.avant_ttc, prix_ttc: r.prix_ttc } }).then(() => {}, () => {});
  console.log(`Gestion produits : prix de « ${r.nom} » ${r.avant_ttc ?? '?'} -> ${r.prix_ttc} € TTC (${user})`);
  return r;
}

module.exports = { liste, changerPrix };
