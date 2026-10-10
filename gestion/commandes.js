// ============================================
// IGS GESTION - MODULE COMMANDES (phase 0 : lecture seule)
// - Synchro du tableau Excel "Commandes" vers Supabase (miroir), toutes les 2 min
// - Lecture du dossier client SharePoint : BAT, tailles, visuels
// L'Excel reste la source de vérité : ce module n'écrit JAMAIS dans l'Excel.
// ============================================

const cfg = require('./config');
const g = require('./graph');
const { supabase } = require('./db');

// ---------- Utilitaires ----------
const key = s => g.norm(s).replace(/[^a-z0-9]/g, '');

function excelDate(v) {
  if (typeof v === 'number' && v > 20000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}
const txt = v => (v === null || v === undefined || v === '' ? null : String(v).trim() || null);

// Téléphone -> format international sans "+" (590/596 pour Guadeloupe/Martinique)
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) {
    const p = d.slice(0, 4);
    if (['0690', '0691', '0590'].includes(p)) d = '590' + d.slice(1);
    else if (['0696', '0697', '0596'].includes(p)) d = '596' + d.slice(1);
    else d = '33' + d.slice(1);
  }
  return d.length >= 11 ? d : null;
}

// "Contenu mail" : email, téléphone, instructions (séparés par retour à la ligne ou |)
function parseContenuMail(v) {
  const parts = (v || '').split(/\r?\n|\|/).map(s => s.trim()).filter(Boolean);
  let email = null, telephone = null;
  const reste = [];
  for (const p of parts) {
    if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) email = p.toLowerCase();
    else if (!telephone && /^[+\d][\d\s.\-()]{8,}$/.test(p)) telephone = normalizePhone(p);
    else reste.push(p);
  }
  return { email, telephone, instructions: reste.join('\n') || null };
}

// Correspondance en-têtes Excel -> champs (tolérant aux accents, espaces, majuscules)
const COLUMNS = {
  ndevis: 'n_devis', client: 'client', contenumail: 'contenu_mail',
  informationscomplementaire: 'infos', informationscomplementaires: 'infos',
  zonedeflocage: 'zone_flocage', affectation: 'affectation', planche: 'planche',
  statut: 'statut', datecommande: 'date_commande', datelivraison: 'date_livraison',
  remarque: 'remarque', remarques: 'remarque', id: 'excel_id', mailenvoye: 'mail_envoye',
  numerodesuivi: 'numero_suivi', mailexpeditionenvoye: 'mail_expedition_envoye',
  mailavisenvoye: 'mail_avis_envoye',
};

function rowsFromRange(range) {
  const [header, ...rows] = range.values;
  const formulas = range.formulas || [];
  const idx = {};
  header.forEach((h, i) => { const f = COLUMNS[key(h)]; if (f && idx[f] === undefined) idx[f] = i; });
  if (idx.n_devis === undefined || idx.client === undefined) {
    throw new Error(`En-têtes inattendus dans le tableau Commandes : ${header.join(' | ')}`);
  }
  const out = [];
  rows.forEach((r, n) => {
    const get = f => (idx[f] === undefined ? null : r[idx[f]]);
    const ndevis = txt(get('n_devis'));
    const client = txt(get('client'));
    if (!ndevis && !client) return; // ligne vide
    const contact = parseContenuMail(txt(get('contenu_mail')));
    const fDate = String((formulas[n + 1] || [])[idx.date_commande] || '');
    out.push({
      cle: ndevis || `SANS-DEVIS-${key(client)}`,
      n_devis: ndevis,
      client,
      contenu_mail: txt(get('contenu_mail')),
      email: contact.email,
      telephone: contact.telephone,
      instructions: contact.instructions,
      infos: txt(get('infos')),
      zone_flocage: txt(get('zone_flocage')),
      affectation: txt(get('affectation')),
      planche: txt(get('planche')),
      statut: txt(get('statut'))?.toUpperCase() || null,
      date_commande: excelDate(get('date_commande')),
      date_dynamique: /TODAY\(|AUJOURDHUI\(/i.test(fDate), // =TODAY() : date qui change chaque jour
      date_livraison: excelDate(get('date_livraison')),
      remarque: txt(get('remarque')),
      excel_id: Number(get('excel_id')) || null,
      mail_envoye: txt(get('mail_envoye')),
      numero_suivi: txt(get('numero_suivi')),
      mail_expedition_envoye: txt(get('mail_expedition_envoye')),
      mail_avis_envoye: txt(get('mail_avis_envoye')),
    });
  });
  return out;
}

// ---------- Synchro Excel -> Supabase ----------
let cache = { rows: [], syncedAt: null, error: null };
let excelItemId = null;
let running = null;

async function syncNow() {
  if (running) return running; // une seule synchro à la fois
  running = (async () => {
    try {
      if (!excelItemId) excelItemId = (await g.itemByPath(cfg.EXCEL_PATH)).id;
      const range = await g.tableRange(excelItemId, cfg.TABLE_COMMANDES);
      const rows = rowsFromRange(range);
      const now = new Date().toISOString();

      // Doublons de clé dans l'Excel : on garde la dernière ligne
      const byKey = new Map(rows.map(r => [r.cle, r]));
      const unique = [...byKey.values()];

      if (supabase) {
        if (unique.length) {
          const { error } = await supabase.from('gestion_commandes')
            .upsert(unique.map(r => ({ ...r, present: true, synced_at: now })), { onConflict: 'cle' });
          if (error) throw new Error(`Supabase upsert : ${error.message}`);
        }
        // Lignes disparues de l'Excel (nettoyage LIVRÉE de minuit) : conservées, marquées absentes
        const keys = unique.map(r => r.cle);
        let q = supabase.from('gestion_commandes').update({ present: false, synced_at: now }).eq('present', true);
        if (keys.length) q = q.not('cle', 'in', `(${keys.map(k => `"${k.replace(/"/g, '')}"`).join(',')})`);
        const { error: e2 } = await q;
        if (e2) console.error('Gestion sync : marquage absents', e2.message);
      }
      cache = { rows: unique, syncedAt: now, error: null };
      return cache;
    } catch (err) {
      console.error('Gestion sync commandes :', err.message);
      if (err.status === 404) excelItemId = null;
      cache = { ...cache, error: err.message };
      return cache;
    } finally {
      running = null;
    }
  })();
  return running;
}

async function listCommandes() {
  if (!cache.syncedAt || Date.now() - new Date(cache.syncedAt).getTime() > cfg.SYNC_INTERVAL_MS) await syncNow();
  return cache;
}

// ---------- Dossier client : BAT, tailles, visuels ----------
let commandesFolder = { id: null, list: [], at: 0 };

async function findCommandeFolder(ndevis) {
  if (!commandesFolder.id) commandesFolder.id = (await g.itemByPath(cfg.COMMANDES_PATH)).id;
  if (Date.now() - commandesFolder.at > 60e3) {
    commandesFolder.list = (await g.children(commandesFolder.id)).filter(i => i.folder);
    commandesFolder.at = Date.now();
  }
  const k = key(ndevis);
  return commandesFolder.list.find(f => key(f.name).startsWith(k)) || null;
}

const isImage = n => /\.(png|jpe?g|webp|gif|svg)$/i.test(n);

function face(name) {
  const n = key(name);
  if (/arriere|dos|back/.test(n)) return 'arriere';
  if (/avant|face|front/.test(n)) return 'avant';
  return 'autre';
}

function normTaille(t) {
  const s = (t || '').toString().trim().toUpperCase();
  if (s === 'XXL') return '2XL';
  if (s === 'XXXL') return '3XL';
  return s;
}

async function readTailles(fileId) {
  const range = await g.tableRange(fileId, cfg.TABLE_TAILLES);
  const [header, ...rows] = range.values;
  const idx = {};
  header.forEach((h, i) => { idx[key(h)] = i; });
  const col = (r, ...names) => { for (const n of names) if (idx[n] !== undefined) return r[idx[n]]; return null; };
  return rows.map(r => ({
    type: txt(col(r, 'typedeproduit', 'type')),
    couleur: txt(col(r, 'couleur')),
    quantite: Number(col(r, 'qte', 'quantite')) || 0,
    taille: normTaille(col(r, 'taille')),
    coupe: txt(col(r, 'coupe')),
    visuel: txt(col(r, 'nomduvisueltexte', 'nomduvisuel', 'visuel')),
    remarques: txt(col(r, 'remarques', 'remarque')),
  })).filter(l => l.quantite > 0 && (l.type || l.taille));
}

const ORDRE_TAILLES = ['2A', '4A', '6A', '8A', '10A', '12A', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

async function getDossier(ndevis) {
  const folder = await findCommandeFolder(ndevis);
  if (!folder) return { trouve: false };

  const items = await g.children(folder.id);
  const files = items.filter(i => i.file);
  const folders = items.filter(i => i.folder);

  const bat = files.find(f => key(f.name) === 'bonatirerpdf')
    || files.find(f => /\.pdf$/i.test(f.name) && /bonatirer|^bat/.test(key(f.name)));

  // Tailles : sous-dossier "Taille(s)" -> Tailles.xlsx
  let tailles = null, taillesErreur = null;
  const dossierTailles = folders.find(f => key(f.name).startsWith('taille'));
  try {
    let fichier = null;
    if (dossierTailles) {
      const inside = (await g.children(dossierTailles.id)).filter(i => i.file && /\.xlsx$/i.test(i.name));
      fichier = inside.find(i => key(i.name).startsWith('taille')) || inside[0];
    }
    fichier = fichier || files.find(i => /\.xlsx$/i.test(i.name) && key(i.name).startsWith('taille'));
    if (fichier) tailles = await readTailles(fichier.id);
  } catch (err) {
    taillesErreur = err.message;
    console.error(`Gestion tailles ${ndevis} :`, err.message);
  }

  // Visuels : un dossier par visuel, avec Nom_Avant / Nom_Arriere
  const visuelFolders = folders.filter(f => f !== dossierTailles && !/archive/i.test(f.name));
  const visuels = await Promise.all(visuelFolders.map(async f => {
    const imgs = (await g.children(f.id)).filter(i => i.file && isImage(i.name));
    const images = await Promise.all(imgs.map(async i => ({
      id: i.id, nom: i.name, face: face(i.name), miniature: await g.thumbnailUrl(i.id),
    })));
    images.sort((a, b) => ['avant', 'arriere', 'autre'].indexOf(a.face) - ['avant', 'arriere', 'autre'].indexOf(b.face));
    return { nom: f.name, cle: key(f.name), images };
  }));
  // Images posées directement dans le dossier de la commande (sans sous-dossier)
  const imagesRacine = files.filter(f => isImage(f.name));
  if (imagesRacine.length) {
    visuels.push({
      nom: 'Visuels', cle: '__racine__',
      images: await Promise.all(imagesRacine.map(async i => ({ id: i.id, nom: i.name, face: face(i.name), miniature: await g.thumbnailUrl(i.id) }))),
    });
  }

  // Regroupement des tailles par visuel, rattaché au bon dossier visuel
  let groupes = [];
  if (tailles) {
    const map = new Map();
    for (const l of tailles) {
      const k = key(l.visuel) || '__sans__';
      if (!map.has(k)) map.set(k, { visuel: l.visuel || 'Sans nom de visuel', lignes: [], total: 0, parTaille: {} });
      const gr = map.get(k);
      gr.lignes.push(l);
      gr.total += l.quantite;
      gr.parTaille[l.taille] = (gr.parTaille[l.taille] || 0) + l.quantite;
    }
    groupes = [...map.entries()].map(([k, gr]) => {
      const v = visuels.find(v => v.cle === k) || visuels.find(v => k !== '__sans__' && (v.cle.includes(k) || k.includes(v.cle)));
      gr.dossierVisuel = v ? v.nom : null;
      gr.tailles = Object.entries(gr.parTaille)
        .sort((a, b) => (ORDRE_TAILLES.indexOf(a[0]) + 1 || 99) - (ORDRE_TAILLES.indexOf(b[0]) + 1 || 99));
      return gr;
    });
  }

  return {
    trouve: true,
    dossier: { nom: folder.name, lien: folder.webUrl || null },
    bat: bat ? { id: bat.id, nom: bat.name, modifie: bat.lastModifiedDateTime } : null,
    tailles: { fichierTrouve: !!tailles, erreur: taillesErreur, groupes, total: groupes.reduce((s, x) => s + x.total, 0) },
    visuels,
  };
}

// Sécurité du proxy de fichiers : uniquement des fichiers situés sous le dossier Clients/Commandes
async function fichierAutorise(itemId) {
  const it = await g.item(itemId);
  const path = g.norm(decodeURIComponent(it.parentReference?.path || ''));
  return it.file && path.includes(g.norm(cfg.COMMANDES_PATH)) ? it : null;
}

function startSync() {
  if (!cfg.SITE_ID || !cfg.CLIENT_ID || !cfg.CLIENT_SECRET) {
    console.warn('Gestion : SP_SITE_ID / MS_CLIENT_ID / MS_CLIENT_SECRET manquants, synchro des commandes en pause');
    return;
  }
  setTimeout(syncNow, 5000);
  setInterval(syncNow, cfg.SYNC_INTERVAL_MS);
}

module.exports = { syncNow, listCommandes, getDossier, fichierAutorise, startSync, normalizePhone, _test: { rowsFromRange, parseContenuMail, excelDate } };
