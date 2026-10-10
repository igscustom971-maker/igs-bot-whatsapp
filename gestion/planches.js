// ============================================
// IGS GESTION - MODULE PLANCHES DTF (lecture seule)
// - Synchro du tableau Excel "Tableau4" (onglet Planches DTF) vers Supabase, toutes les 2 min
// - Fichiers de la planche : dossier Technique/Planches (PLANCHES A IMPRIMER + Archives)
// L'Excel reste la source de vérité : ce module n'écrit JAMAIS dans l'Excel.
// ============================================

const cfg = require('./config');
const g = require('./graph');
const { supabase } = require('./db');

const key = s => g.norm(s).replace(/[^a-z0-9]/g, '');
const txt = v => (v === null || v === undefined || v === '' ? null : String(v).trim() || null);

const MOIS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
function excelDate(v) {
  if (typeof v === 'number' && v > 20000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (typeof v === 'string') {
    let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    m = g.norm(v).match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/); // "mardi 29 septembre 2026"
    if (m && MOIS[m[2]]) return `${m[3]}-${String(MOIS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}
const num = v => (typeof v === 'number' ? v : (v && !isNaN(Number(String(v).replace(',', '.'))) ? Number(String(v).replace(',', '.')) : null));

const COLUMNS = {
  datedecommande: 'date_commande', datecommande: 'date_commande', client: 'client', metres: 'metres',
  reduction: 'reduction', montantht: 'montant_ht', montanthteur: 'montant_ht', frequence: 'frequence',
  paiement: 'paiement', remarques: 'remarques', remarque: 'remarques', statut: 'statut', ndevis: 'n_devis',
  id: 'excel_id', mailenvoye: 'mail_envoye', numerodesuivi: 'numero_suivi', mailexpeditionenvoye: 'mail_expedition_envoye',
};

function rowsFromRange(range) {
  const [header, ...rows] = range.values;
  const idx = {};
  header.forEach((h, i) => { const f = COLUMNS[key(h)]; if (f && idx[f] === undefined) idx[f] = i; });
  if (idx.client === undefined) throw new Error(`En-têtes inattendus dans Planches DTF : ${header.join(' | ')}`);
  const out = [];
  for (const r of rows) {
    const get = f => (idx[f] === undefined ? null : r[idx[f]]);
    const client = txt(get('client'));
    if (!client) continue; // ligne vidée par le nettoyage de minuit
    const ndevis = txt(get('n_devis'));
    const metresRaw = get('metres');
    const format = typeof metresRaw === 'string' && /^a[34]$/i.test(metresRaw.trim()) ? metresRaw.trim().toUpperCase() : null;
    const date = excelDate(get('date_commande'));
    const excelId = Number(get('excel_id')) || null;
    out.push({
      cle: ndevis || `SANS-DEVIS-${key(client)}-${excelId || ''}`,
      n_devis: ndevis,
      client,
      date_commande: date,
      metres: format ? null : num(metresRaw),
      format,
      reduction: num(get('reduction')),
      montant_ht: num(get('montant_ht')),
      frequence: txt(get('frequence')),
      hebdo: /hebdo/i.test(get('frequence') || ''),
      paiement: txt(get('paiement'))?.toUpperCase() || null,
      remarques: txt(get('remarques')),
      statut: txt(get('statut'))?.toUpperCase() || null,
      excel_id: excelId,
      mail_envoye: txt(get('mail_envoye')),
      numero_suivi: txt(get('numero_suivi')),
      mail_expedition_envoye: txt(get('mail_expedition_envoye')),
    });
  }
  return out;
}

// ---------- Synchro ----------
let cache = { rows: [], syncedAt: null, error: null };
let excelItemId = null;
let running = null;

async function syncNow() {
  if (running) return running;
  running = (async () => {
    try {
      if (!excelItemId) excelItemId = (await g.itemByPath(cfg.EXCEL_PATH)).id;
      const rows = rowsFromRange(await g.tableRange(excelItemId, cfg.TABLE_PLANCHES));
      const unique = [...new Map(rows.map(r => [r.cle, r])).values()];
      const now = new Date().toISOString();
      if (supabase) {
        if (unique.length) {
          const { error } = await supabase.from('gestion_planches')
            .upsert(unique.map(r => ({ ...r, present: true, synced_at: now })), { onConflict: 'cle' });
          if (error) throw new Error(`Supabase upsert planches : ${error.message}`);
        }
        let q = supabase.from('gestion_planches').update({ present: false, synced_at: now }).eq('present', true);
        if (unique.length) q = q.not('cle', 'in', `(${unique.map(r => `"${r.cle.replace(/"/g, '')}"`).join(',')})`);
        const { error: e2 } = await q;
        if (e2) console.error('Gestion sync planches : marquage absents', e2.message);
      }
      cache = { rows: unique, syncedAt: now, error: null };
    } catch (err) {
      console.error('Gestion sync planches :', err.message);
      if (err.status === 404) excelItemId = null;
      cache = { ...cache, error: err.message };
    } finally {
      running = null;
    }
    return cache;
  })();
  return running;
}

async function listPlanches({ force = false } = {}) {
  if (force || !cache.syncedAt || Date.now() - new Date(cache.syncedAt).getTime() > cfg.SYNC_INTERVAL_MS) await syncNow();
  return cache;
}

// ---------- Fichiers de la planche ----------
// Fichiers nommés "Client - P1.png" dans PLANCHES A IMPRIMER (ou Archives après 48 h)
let dossiers = { at: 0, files: [] };
let planchesDrive = null; // bibliothèque où le dossier Technique/Planches a été trouvé

async function planchesRoot() {
  const candidats = planchesDrive ? [planchesDrive] : [cfg.PLANCHES_LIBRARY, cfg.LIBRARY_NAME];
  let last;
  for (const drive of candidats) {
    try {
      const root = await g.itemByPath(cfg.PLANCHES_PATH, { drive });
      planchesDrive = drive;
      return root;
    } catch (err) { last = err; }
  }
  throw new Error(`Dossier ${cfg.PLANCHES_PATH} introuvable (${last?.status || last?.message})`);
}

async function planchesFiles() {
  if (Date.now() - dossiers.at < 60e3) return dossiers.files;
  const root = await planchesRoot();
  const D = { drive: planchesDrive };
  const subs = (await g.children(root.id, D)).filter(i => i.folder);
  const files = [];
  for (const f of subs) {
    const archive = /archive/i.test(f.name);
    const inside = await g.children(f.id, D);
    inside.filter(i => i.file).forEach(i => files.push({ ...i, dossier: f.name, archive }));
  }
  dossiers = { at: Date.now(), files };
  return files;
}

async function getFichiers(cle) {
  const p = cache.rows.find(r => r.cle === cle);
  if (!p) return { erreur: 'Planche introuvable' };
  const k = key(p.client);
  const files = (await planchesFiles()).filter(f => {
    const prefix = f.name.replace(/\s*-\s*P\d+.*$/i, '').replace(/\.[a-z0-9]+$/i, '');
    return key(prefix) === k;
  });
  const out = await Promise.all(files.map(async f => ({
    id: f.id, nom: f.name, dossier: f.dossier, archive: f.archive, taille: f.size,
    modifie: f.lastModifiedDateTime, lien: f.webUrl || null,
    miniature: await g.thumbnailUrl(f.id, 'large', { drive: planchesDrive }),
  })));
  out.sort((a, b) => a.archive - b.archive || a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
  return { fichiers: out };
}

// Proxy : uniquement des fichiers du dossier Planches
async function fichierAutorise(itemId) {
  if (!planchesDrive) await planchesRoot();
  const it = await g.item(itemId, { drive: planchesDrive });
  const path = g.norm(decodeURIComponent(it.parentReference?.path || ''));
  return it.file && path.includes(g.norm(cfg.PLANCHES_PATH)) ? it : null;
}

function startSync() {
  if (!cfg.SITE_ID || !cfg.CLIENT_ID || !cfg.CLIENT_SECRET) return;
  setTimeout(syncNow, 8000);
  setInterval(syncNow, cfg.SYNC_INTERVAL_MS);
}

const drive = () => ({ drive: planchesDrive });

module.exports = { drive, syncNow, listPlanches, getFichiers, fichierAutorise, startSync, _test: { rowsFromRange, excelDate } };
