// ============================================
// IGS GESTION - ADMIN : collaborateurs et listes (produits, couleurs, tailles)
// - Listes utilisées par le formulaire client (igscustom.fr/formulaire) et par le dashboard
// - Collaborateurs : nom affiché (affectation des commandes), taux horaire (admin uniquement), actif / inactif
// ============================================

const { supabase } = require('./db');

const T_ADULTE = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const T_ENFANT = ['2A', '4A', '6A', '8A', '10A', '12A'];
const DEFAUT = {
  produits: [
    { nom: 'T-Shirt', tailles: T_ADULTE, coupe: true },
    { nom: 'T-Shirt Col V', tailles: T_ADULTE, coupe: true },
    { nom: 'T-Shirt Polyester', tailles: T_ADULTE, coupe: true },
    { nom: 'T-Shirt Longue Manche', tailles: T_ADULTE, coupe: true },
    { nom: 'Polo', tailles: T_ADULTE, coupe: true },
    { nom: 'Débardeur', tailles: T_ADULTE, coupe: true },
    { nom: 'Tote Bag', tailles: ['TU'], coupe: false },
    { nom: 'Casquette', tailles: ['TU'], coupe: false },
    { nom: 'T-Shirt Enfant', tailles: T_ENFANT, coupe: false },
    { nom: 'T-shirt fourni', tailles: T_ADULTE, coupe: true },
    { nom: 'Autre : (saisie manuelle)', tailles: T_ADULTE.concat(['TU']), coupe: true },
  ],
  couleurs: ['Noir profond', 'Gris foncé', 'Gris clair', 'Blanc', 'Rose bonbon', 'Fuchsia', 'Bordeaux', 'Rouge', 'Hibiscus', 'Orange', 'Jaune Citron', 'Jaune Gold', 'Vert pomme', 'Vert prairie', 'Vert bouteille', 'Kaki foncé', 'Terre', 'Chocolat', 'Violet foncé', 'Marine', 'French marine', 'Royal', 'Aqua', 'Bleu atoll', 'Ciel', 'Sable'],
  coupes: ['Unisexe', 'Femme'],
};
const EQUIPE_DEFAUT = [
  { affichage: 'Ismaël G.', nom: 'Ismaël Girondin', taux_horaire: null, ordre: 1 },
  { affichage: 'Maureen G.', nom: 'Maureen', taux_horaire: 20, ordre: 2 },
  { affichage: 'Kelhyan V.', nom: 'Kelhyan', taux_horaire: 15, ordre: 3 },
  { affichage: 'Ilona C.', nom: 'Ilona', taux_horaire: 20, ordre: 4 },
];

const txt = v => String(v ?? '').trim();
function needDb() { if (!supabase) throw new Error('Supabase non configuré'); }

// ---------- Listes ----------
let cacheListes = { v: null, at: 0 };
async function getListes() {
  if (cacheListes.v && Date.now() - cacheListes.at < 60e3) return cacheListes.v;
  let v = DEFAUT;
  if (supabase) {
    const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'listes').maybeSingle();
    if (data && data.valeur) { try { v = { ...DEFAUT, ...JSON.parse(data.valeur) }; } catch {} }
  }
  cacheListes = { v, at: Date.now() };
  return v;
}

async function setListes(data) {
  needDb();
  const produits = (Array.isArray(data.produits) ? data.produits : [])
    .map(p => ({
      nom: txt(p.nom).slice(0, 60),
      tailles: (Array.isArray(p.tailles) ? p.tailles : String(p.tailles || '').split(/[,;\s]+/)).map(t => txt(t).toUpperCase()).filter(Boolean).slice(0, 20),
      coupe: !!p.coupe,
    }))
    .filter(p => p.nom && p.tailles.length);
  const couleurs = [...new Set((Array.isArray(data.couleurs) ? data.couleurs : String(data.couleurs || '').split('\n')).map(c => txt(c).slice(0, 40)).filter(Boolean))];
  const coupes = [...new Set((Array.isArray(data.coupes) ? data.coupes : String(data.coupes || '').split(/[,\n]+/)).map(c => txt(c).slice(0, 30)).filter(Boolean))];
  if (!produits.length) throw new Error('Au moins un produit est nécessaire');
  if (!couleurs.length) throw new Error('Au moins une couleur est nécessaire');
  const v = { produits, couleurs, coupes: coupes.length ? coupes : DEFAUT.coupes };
  const { error } = await supabase.from('gestion_reglages').upsert({ cle: 'listes', valeur: JSON.stringify(v), updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase : ${error.message}`);
  cacheListes = { v, at: Date.now() };
  return v;
}

// ---------- Collaborateurs ----------
async function collaborateurs({ admin = false, tous = false } = {}) {
  if (!supabase) return EQUIPE_DEFAUT.map((c, i) => ({ id: i + 1, actif: true, ...c, taux_horaire: admin ? c.taux_horaire : undefined }));
  let { data, error } = await supabase.from('gestion_collaborateurs').select('*').order('ordre').order('affichage');
  if (error) throw new Error(`Supabase : ${error.message}`);
  if (!data.length) {
    // Première utilisation : reprise de l'équipe actuelle (onglet Paramètres de l'Excel)
    const ins = await supabase.from('gestion_collaborateurs').insert(EQUIPE_DEFAUT.map(c => ({ ...c, actif: true }))).select();
    data = ins.data || [];
  }
  return data
    .filter(c => tous || c.actif)
    .map(c => (admin ? c : { id: c.id, affichage: c.affichage, actif: c.actif }));
}

async function enregistrerCollaborateur(d) {
  needDb();
  const row = {
    affichage: txt(d.affichage).slice(0, 40),
    nom: txt(d.nom).slice(0, 80) || null,
    taux_horaire: d.taux_horaire === '' || d.taux_horaire === null || d.taux_horaire === undefined ? null : Number(String(d.taux_horaire).replace(',', '.')),
    actif: d.actif !== false,
    ordre: Number(d.ordre) || 99,
    updated_at: new Date().toISOString(),
  };
  if (!row.affichage) throw new Error('Le nom affiché est obligatoire (ex. Maureen G.)');
  if (row.taux_horaire !== null && !(row.taux_horaire >= 0 && row.taux_horaire < 1000)) throw new Error('Taux horaire invalide');
  const q = d.id ? supabase.from('gestion_collaborateurs').update(row).eq('id', d.id) : supabase.from('gestion_collaborateurs').insert(row);
  const { error } = await q;
  if (error) throw new Error(`Supabase : ${error.message}`);
}

async function supprimerCollaborateur(id) {
  needDb();
  const { error } = await supabase.from('gestion_collaborateurs').delete().eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
}

module.exports = { getListes, setListes, collaborateurs, enregistrerCollaborateur, supprimerCollaborateur, DEFAUT };
