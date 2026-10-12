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
    { nom: 'Sweat à capuche', tailles: ['XS', 'S', 'M', 'L', 'XL', '2XL'], coupe: false, couleurs: ['Noir profond', 'Gris foncé', 'Blanc', 'Rouge', 'Marine', 'Kaki'] },
    { nom: 'Sweat col rond', tailles: ['S', 'M', 'L', 'XL', '2XL', '3XL'], coupe: false, couleurs: ['Gris clair', 'Gris chiné', 'Gris foncé', 'Noir profond', 'Blanc', 'Bordeaux', 'Rouge', 'Orange', 'Vert bouteille'] },
    { nom: 'Sweat zippé à capuche', tailles: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], coupe: false, couleurs: ['Noir profond', 'Blanc', 'Rouge', 'Vert prairie', 'French marine', 'Royal'] },
    { nom: 'Tote Bag', tailles: ['TU'], coupe: false },
    { nom: 'Tablier', tailles: ['TU'], coupe: false, couleurs: ['Blanc', 'Noir profond'] },
    // T-shirt vierge (sans flocage, 7 € l'unité) : commandé chez SEFI comme un T-shirt, pas de BAT ; saisi sur la fiche commande
    { nom: 'T-Shirt vierge (sans flocage)', tailles: T_ADULTE, coupe: true, formulaire: false },
    // Eco cup : commandes d'objets remplies directement sur la fiche commande (pas dans le formulaire client, hors SEFI)
    { nom: 'Eco cup 33 cl', tailles: ['TU'], coupe: false, couleurs: ['Transparent givré'], formulaire: false },
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
    // Nouveaux produits ajoutés une seule fois aux listes déjà enregistrées depuis l'Admin (un retrait ensuite est respecté)
    if (data && data.valeur) {
      for (const [flag, re, avant] of [['listes_sweats_ajoutes', /^sweat/i, /tote/i], ['listes_tablier_ajoute', /^tablier$/i, /casquette/i], ['listes_ecocup_ajoute', /^eco ?cup/i, /casquette/i], ['listes_tshirt_vierge_ajoute', /vierge/i, /^t-shirt fourni/i]]) {
        const { data: f } = await supabase.from('gestion_reglages').select('valeur').eq('cle', flag).maybeSingle();
        if (f) continue;
        const noms = new Set(v.produits.map(p => p.nom.toLowerCase()));
        const ajout = DEFAUT.produits.filter(p => re.test(p.nom) && !noms.has(p.nom.toLowerCase()));
        if (ajout.length) {
          const i = v.produits.findIndex(p => avant.test(p.nom));
          v = { ...v, produits: i >= 0 ? [...v.produits.slice(0, i), ...ajout, ...v.produits.slice(i)] : [...v.produits, ...ajout] };
          await supabase.from('gestion_reglages').upsert({ cle: 'listes', valeur: JSON.stringify(v), updated_at: new Date().toISOString() });
        }
        await supabase.from('gestion_reglages').upsert({ cle: flag, valeur: new Date().toISOString(), updated_at: new Date().toISOString() });
      }
    }
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
      // Couleurs disponibles pour ce produit (vide = toutes les couleurs de la liste)
      couleurs: [...new Set((Array.isArray(p.couleurs) ? p.couleurs : String(p.couleurs || '').split(/[,;\n]+/)).map(c => txt(c).slice(0, 40)).filter(Boolean))],
    }))
    .map(p => (p.couleurs.length ? p : { nom: p.nom, tailles: p.tailles, coupe: p.coupe }))
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
  // Jamais de mot de passe ni de jeton renvoyé, même à l'admin
  return data
    .filter(c => tous || c.actif)
    .map(c => (admin
      ? { id: c.id, affichage: c.affichage, nom: c.nom, taux_horaire: c.taux_horaire, actif: c.actif, ordre: c.ordre,
          identifiant: c.identifiant || null, profils: require('./comptes').profilsDe(c), email_perso: c.email_perso || null, acces: !!c.mdp_hash, invitation: !c.mdp_hash && !!c.identifiant && !!c.reset_expire && new Date(c.reset_expire) > new Date(), mdp_provisoire: !!c.mdp_provisoire, derniere_connexion: c.derniere_connexion || null }
      : { id: c.id, affichage: c.affichage, actif: c.actif }));
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
  if (Array.isArray(d.profils)) {
    const { PROFILS } = require('./comptes');
    row.profils = d.profils.filter(p => PROFILS.includes(p));
    if (!row.profils.length) throw new Error('Choisis au moins un profil (admin, technique ou commercial)');
  }
  const q = () => (d.id ? supabase.from('gestion_collaborateurs').update(row).eq('id', d.id) : supabase.from('gestion_collaborateurs').insert(row));
  let { error } = await q();
  if (error && /profils/.test(error.message)) throw new Error('Colonne « profils » absente : passe le SQL du module Commercial dans Supabase');
  if (error) throw new Error(`Supabase : ${error.message}`);
  if (d.id) require('./comptes').oublierCache(d.id);
}

async function supprimerCollaborateur(id) {
  needDb();
  const { error } = await supabase.from('gestion_collaborateurs').delete().eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  require('./comptes').oublierCache(id); // la session du compte supprimé tombe tout de suite
}

module.exports = { getListes, setListes, collaborateurs, enregistrerCollaborateur, supprimerCollaborateur, DEFAUT };
