// ============================================
// IGS GESTION - HISTORIQUE ET DUPLICATION DES COMMANDES
// Deux cas, choisis à chaque fois par l'utilisateur :
//  - "refaire"  : erreur de production -> même devis suffixé -R1, -R2… (pas de nouveau devis Odoo), BAT recopié
//  - "nouveau"  : nouvelle commande -> copie du devis Odoo d'origine (brouillon, à ajuster et envoyer depuis Odoo)
// Dans les deux cas : nouveau dossier SharePoint (visuels recopiés + Tailles.xlsx avec les lignes ajustées)
// et nouvelle ligne dans le tableau Commandes de l'Excel.
// ============================================

const cfg = require('./config');
const g = require('./graph');
const xl = require('./excel');
const odoo = require('./odoo');
const commandes = require('./commandes');
const { supabase } = require('./db');

const key = s => g.norm(s).replace(/[^a-z0-9]/g, '');
const txt = v => (v === null || v === undefined ? '' : String(v).trim());

async function historique(q) {
  const recherche = txt(q).slice(0, 60);
  if (supabase) {
    let req = supabase.from('gestion_commandes').select('*').order('date_commande', { ascending: false, nullsFirst: false }).limit(300);
    if (recherche) req = req.or(`client.ilike.%${recherche.replace(/[%,()]/g, ' ')}%,n_devis.ilike.%${recherche.replace(/[%,()]/g, ' ')}%`);
    const { data, error } = await req;
    if (error) throw new Error(`Supabase : ${error.message}`);
    return data;
  }
  const { rows } = await commandes.listCommandes();
  return rows.filter(r => !recherche || key(`${r.client} ${r.n_devis}`).includes(key(recherche)));
}

async function source(cle) {
  if (supabase) {
    const { data } = await supabase.from('gestion_commandes').select('*').eq('cle', cle).maybeSingle();
    if (data) return data;
  }
  const { rows } = await commandes.listCommandes();
  const r = rows.find(x => x.cle === cle);
  if (!r) throw new Error('Commande d\'origine introuvable');
  return r;
}

// Prochain suffixe libre : DE2601024-R1, -R2…
async function numeroRefaire(base) {
  const existants = new Set();
  if (supabase) {
    const { data } = await supabase.from('gestion_commandes').select('cle').ilike('cle', `${base}-R%`);
    (data || []).forEach(d => existants.add(d.cle.toUpperCase()));
  }
  (await commandes.listCommandes()).rows.forEach(r => existants.add(String(r.cle).toUpperCase()));
  for (let i = 1; i < 50; i++) if (!existants.has(`${base}-R${i}`)) return `${base}-R${i}`;
  throw new Error('Trop de reprises pour cette commande');
}

const TYPES_OK = /./;
function nettoyerLignes(lignes) {
  return (Array.isArray(lignes) ? lignes : [])
    .map(l => ({
      type: txt(l.type).slice(0, 60), couleur: txt(l.couleur).slice(0, 40), quantite: Math.max(0, Math.round(Number(l.quantite) || 0)),
      taille: txt(l.taille).toUpperCase().slice(0, 10), coupe: txt(l.coupe).slice(0, 20), visuel: txt(l.visuel).slice(0, 80), remarques: txt(l.remarques).slice(0, 200),
    }))
    .filter(l => l.quantite > 0 && TYPES_OK.test(l.type));
}

const resume = lignes => {
  const parType = {};
  lignes.forEach(l => { const k = `${l.type} ${l.couleur}`.trim(); parType[k] = (parType[k] || 0) + l.quantite; });
  return Object.entries(parType).map(([k, n]) => `${n} x ${k}`).join(' / ');
};

// Écrit les lignes dans le tableau LignesCommande d'un Tailles.xlsx (colonnes Type -> Remarques, la colonne N° est conservée)
async function ecrireTailles(fileId, lignes) {
  let range;
  for (let i = 0; i < 6; i++) { // le classeur fraîchement copié peut mettre quelques secondes à être disponible
    try { range = await g.tableRange(fileId, cfg.TABLE_TAILLES); break; }
    catch (err) { if (i === 5) throw err; await new Promise(r => setTimeout(r, 2000)); }
  }
  const [header, ...rows] = range.values;
  const idx = {}; header.forEach((h, i) => { idx[key(h)] = i; });
  const ordre = [['typedeproduit', 'type'], ['couleur', 'couleur'], ['qte', 'quantite'], ['taille', 'taille'], ['coupe', 'coupe'], ['nomduvisueltexte', 'visuel'], ['remarques', 'remarques']];
  const cols = ordre.map(([h]) => idx[h]);
  if (cols.some(c => c === undefined)) throw new Error(`Tailles.xlsx : colonnes inattendues (${header.join(' | ')})`);
  if (lignes.length > rows.length) throw new Error(`Trop de lignes (${lignes.length}) pour le modèle Tailles.xlsx (${rows.length} max)`);
  const m = String(range.address).match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/);
  const [, sheet, c0, r0, , r1] = m;
  const colL = n => { let s = ''; n++; while (n) { const q = (n - 1) % 26; s = String.fromCharCode(65 + q) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colI = l => l.split('').reduce((t, ch) => t * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const first = Math.min(...cols), last = Math.max(...cols);
  const values = rows.map((_, i) => {
    const l = lignes[i];
    const out = Array(last - first + 1).fill('');
    ordre.forEach(([, f], j) => { out[cols[j] - first] = l ? (l[f] ?? '') : ''; });
    return out;
  });
  const address = `${colL(colI(c0) + first)}${Number(r0) + 1}:${colL(colI(c0) + last)}${r1}`;
  await g.patchRange(fileId, sheet, address, values);
}

async function dupliquer(cleSource, data, user) {
  const mode = data.mode === 'nouveau' ? 'nouveau' : data.mode === 'refaire' ? 'refaire' : null;
  if (!mode) throw new Error('Choisis : refaire la commande ou nouvelle commande');
  const src = await source(cleSource);
  if (!src.n_devis) throw new Error('La commande d\'origine n\'a pas de N° de devis');
  const lignes = nettoyerLignes(data.lignes);
  if (!lignes.length) throw new Error('Ajoute au moins une ligne (quantité > 0)');

  // 1. Numéro de la nouvelle commande
  let devis = null, numero;
  if (mode === 'nouveau') {
    devis = await odoo.copierDevis(src.n_devis);
    numero = devis.numero;
  } else {
    numero = await numeroRefaire(src.n_devis);
  }
  const etapes = [];

  // 2. Dossier SharePoint
  const dossierSrc = await commandes.getDossier(src.n_devis).catch(() => ({ trouve: false }));
  const parent = await g.itemByPath(cfg.COMMANDES_PATH);
  const nomDossier = `${numero} - ${src.client}`.replace(/[\\/:*?"<>|#%]/g, ' ').trim();
  const dossier = await g.createFolder(parent.id, nomDossier);
  etapes.push(`Dossier « ${nomDossier} » créé`);

  if (dossierSrc.trouve) {
    const items = await g.children(dossierSrc.dossier.id);
    for (const it of items) {
      const estTailles = it.folder && key(it.name).startsWith('taille');
      const estBat = it.file && /\.pdf$/i.test(it.name) && /bonatirer/.test(key(it.name));
      if (it.folder && !estTailles) { await g.copyItem(it.id, dossier.id, it.name); etapes.push(`Visuel « ${it.name} » recopié`); }
      else if (estBat && mode === 'refaire') { await g.copyItem(it.id, dossier.id, it.name); etapes.push('BAT recopié'); }
      else if (it.file && /\.(png|jpe?g|webp|svg)$/i.test(it.name)) { await g.copyItem(it.id, dossier.id, it.name); }
    }
    // Tailles.xlsx : copie du fichier d'origine puis réécriture des lignes
    const dt = items.find(it => it.folder && key(it.name).startsWith('taille'));
    const fichier = dt ? (await g.children(dt.id)).find(f => f.file && /\.xlsx$/i.test(f.name)) : null;
    if (fichier) {
      const sousDossier = await g.createFolder(dossier.id, dt.name);
      const copieId = await g.copyItem(fichier.id, sousDossier.id, fichier.name, { attendre: true });
      await ecrireTailles(copieId, lignes);
      etapes.push(`Tailles.xlsx créé (${lignes.reduce((t, l) => t + l.quantite, 0)} pièces)`);
    } else etapes.push('⚠️ Pas de Tailles.xlsx dans la commande d\'origine : tailles non créées');
  } else etapes.push('⚠️ Dossier d\'origine introuvable : visuels non recopiés');

  // 3. Ligne dans le tableau Commandes
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const statut = txt(data.statut).toUpperCase() || (mode === 'refaire' ? 'VALIDÉE' : 'EN DEVIS');
  const t = await xl.readTable(cfg.TABLE_COMMANDES);
  await xl.addRow(t, {
    'N° Devis': numero,
    'Client': src.client,
    'Contenu mail': src.contenu_mail || '',
    'Informations complémentaire': mode === 'refaire' && !data.lignesModifiees ? (src.infos || resume(lignes)) : resume(lignes),
    'Zone de flocage': txt(data.zone_flocage) || src.zone_flocage || '',
    'Statut': statut,
    'Date commande': today,
    'Remarque': [`${mode === 'refaire' ? 'Reprise' : 'Nouvelle commande'} de ${src.n_devis}`, txt(data.remarque)].filter(Boolean).join(' - '),
  }, 'Client');
  etapes.push(`Ligne ajoutée dans l'Excel (${statut})`);
  await commandes.syncNow();

  if (supabase) {
    await supabase.from('gestion_actions').insert({ utilisateur: user, action: mode === 'refaire' ? 'commande_refaite' : 'commande_dupliquee', cle: numero, details: { source: src.n_devis, client: src.client, lignes: lignes.length, devis } });
  }
  return { numero, dossier: dossier.webUrl || null, devis, etapes };
}

module.exports = { historique, dupliquer };
