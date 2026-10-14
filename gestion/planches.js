// ============================================
// IGS GESTION - MODULE PLANCHES DTF (lecture seule)
// - Synchro du tableau Excel "Tableau4" (onglet Planches DTF) vers Supabase, toutes les 2 min
// - Fichiers de la planche : dossier Technique/Planches (PLANCHES A IMPRIMER + Archives)
// L'Excel reste la source de vérité : ce module n'écrit JAMAIS dans l'Excel.
// ============================================

const cfg = require('./config');
const g = require('./graph');
const source = require('./source');
const { supabase } = require('./db');
const odoo = require('./odoo');

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
  rows.forEach((r, rowIndex) => {
    const get = f => (idx[f] === undefined ? null : r[idx[f]]);
    const client = txt(get('client'));
    if (!client) return; // ligne vidée par le nettoyage de minuit
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
    Object.defineProperty(out[out.length - 1], '_row', { value: rowIndex, enumerable: false }); // position dans le tableau
  });
  out.idx = idx;
  return out;
}

// ---------- Base du dashboard (après la sortie de l'Excel) ----------
// Formules reprises de l'Excel : Réduction -15 % dès 10 m, -20 % dès 20 m ; Montant HT = A3 13 €, A4 10 €, sinon m × 25 € × (1 + réduction)
const reductionDe = (metres, format) => (format || !(metres > 0) ? 0 : metres >= 20 ? -0.2 : metres >= 10 ? -0.15 : 0);
const montantDe = (metres, format) => (format === 'A3' ? 13 : format === 'A4' ? 10 : metres > 0 ? Math.round(metres * 25 * (1 + reductionDe(metres)) * 100) / 100 : null);
const CHAMPS_PL = ['cle', 'n_devis', 'client', 'date_commande', 'metres', 'format', 'frequence', 'hebdo', 'paiement', 'remarques', 'statut', 'statut_le', 'excel_id', 'mail_envoye', 'numero_suivi', 'mail_expedition_envoye'];
const cleDe = (o, id) => o.n_devis || `SANS-DEVIS-${key(o.client || '')}-${id || ''}`;
let sansStatutLe = false; // colonne statut_le pas encore créée dans Supabase : on fait sans
async function lireBase() {
  const champs = sansStatutLe ? CHAMPS_PL.filter(c => c !== 'statut_le') : CHAMPS_PL;
  const data = [];
  for (let from = 0; ; from += 1000) { // paginé (plafond Supabase de 1000 lignes par lecture)
    const { data: d, error } = await supabase.from('gestion_planches').select(champs.join(',')).eq('present', true).order('excel_id', { ascending: true, nullsFirst: false }).order('cle').range(from, from + 999);
    if (error && !sansStatutLe && /statut_le/.test(error.message)) { sansStatutLe = true; return lireBase(); }
    if (error) throw new Error(`Supabase : ${error.message}`);
    data.push(...d);
    if (d.length < 1000) break;
  }
  return data.map(o => {
    const metres = o.metres === null ? null : Number(o.metres);
    const row = { ...o, metres, reduction: reductionDe(metres, o.format), montant_ht: montantDe(metres, o.format), hebdo: !!o.hebdo || /hebdo/i.test(o.frequence || '') };
    Object.defineProperty(row, '_row', { value: o.excel_id, enumerable: false }); // identifiant stable de la ligne
    return row;
  });
}
// Champs « Excel » (metres peut valoir A3 / A4 / '') -> colonnes de la base
function versBase(fields, actuel) {
  const o = {};
  for (const [f, v] of Object.entries(fields)) {
    if (f === 'metres') {
      const t = String(v ?? '').trim().toUpperCase();
      if (t === 'A3' || t === 'A4') { o.format = t; o.metres = null; }
      else if (t === '') { o.format = null; o.metres = null; }
      else { o.format = null; o.metres = Number(String(v).replace(',', '.')); }
    } else if (f === 'frequence') { o.frequence = v || null; o.hebdo = /hebdo/i.test(v || ''); }
    else if (f === 'date_commande') o.date_commande = v || null;
    else if (['n_devis', 'client', 'paiement', 'remarques', 'statut', 'mail_envoye', 'numero_suivi', 'mail_expedition_envoye'].includes(f)) o[f] = v === '' ? null : v;
  }
  if ('n_devis' in o || 'client' in o) o.cle = cleDe({ ...actuel, ...o }, actuel.excel_id);
  // Date du changement de statut : une planche hebdo repassée « prête » déclenche un nouveau message
  if ('statut' in o && o.statut !== actuel.statut) o.statut_le = new Date().toISOString();
  return o;
}
// La clé d'une planche = son n° de devis. Si une autre ligne a déjà cette clé :
//  - ancienne planche retirée de la liste (livrée/payée, archivée) : elle est renommée (historique gardé) ;
//  - planche encore en cours sur le même devis : la nouvelle prend « devis-n° de ligne » (deux planches, un devis).
async function cleLibre(voulue, excelId, cleActuelle) {
  if (!voulue || voulue === cleActuelle) return voulue;
  const { data } = await supabase.from('gestion_planches').select('cle, present, excel_id').eq('cle', voulue).limit(1);
  const ex = data && data[0];
  if (!ex) return voulue;
  if (!ex.present) {
    const { error } = await supabase.from('gestion_planches').update({ cle: `${voulue}~${ex.excel_id || Date.now()}` }).eq('cle', voulue);
    if (error) throw new Error(`Supabase : ${error.message}`);
    return voulue;
  }
  return `${voulue}-${excelId || Date.now()}`;
}
async function ecrireBase(cle, fields) {
  const actuel = cache.rows.find(r => r.cle === cle) || (await lireBase()).find(r => r.cle === cle);
  if (!actuel) throw new Error('Planche introuvable : actualise et réessaie');
  const o = versBase(fields, actuel);
  if (o.cle) o.cle = await cleLibre(o.cle, actuel.excel_id, cle);
  if (sansStatutLe) delete o.statut_le;
  let { error } = await supabase.from('gestion_planches').update(o).eq('cle', cle);
  if (error && /statut_le/.test(error.message)) { sansStatutLe = true; delete o.statut_le; ({ error } = await supabase.from('gestion_planches').update(o).eq('cle', cle)); }
  if (error) throw new Error(`Supabase : ${error.message}`);
}
async function insererBase(fields) {
  const { data: mx } = await supabase.from('gestion_planches').select('excel_id').order('excel_id', { ascending: false, nullsFirst: false }).limit(1);
  const id = ((mx && mx[0] && mx[0].excel_id) || 0) + 1;
  const o = { ...versBase(fields, { excel_id: id }), excel_id: id, present: true, synced_at: new Date().toISOString() };
  o.cle = await cleLibre(cleDe(o, id), id, null);
  delete o.statut_le;
  const { error } = await supabase.from('gestion_planches').insert(o);
  if (error) throw new Error(`Supabase : ${error.message}`);
  return id;
}
// Nettoyage de minuit (base) : ponctuelles LIVRÉE + PAYÉE retirées de la liste, hebdo LIVRÉE remises à zéro
async function nettoyerBase() {
  const rows = await lireBase();
  const n = v => String(v || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let retirees = 0, hebdo = 0;
  for (const p of rows) {
    if (n(p.statut) !== 'LIVREE') continue;
    if (p.hebdo) { // nouvelle semaine : statut, suivi et mails remis à zéro (sans statut_le si la colonne manque)
      const raz = { statut: null, numero_suivi: null, mail_envoye: null, mail_expedition_envoye: null, statut_le: new Date().toISOString() };
      let { error } = await supabase.from('gestion_planches').update(raz).eq('cle', p.cle);
      if (error && /statut_le/.test(error.message)) { delete raz.statut_le; ({ error } = await supabase.from('gestion_planches').update(raz).eq('cle', p.cle)); }
      if (error) console.error(`Planche hebdo ${p.client} non remise à zéro :`, error.message); else hebdo++;
    }
    else if (n(p.paiement) === 'PAYEE') { await supabase.from('gestion_planches').update({ present: false, synced_at: new Date().toISOString() }).eq('cle', p.cle); retirees++; }
  }
  await syncNow();
  return { retirees, hebdo };
}

// ---------- Synchro ----------
let cache = { rows: [], syncedAt: null, error: null };
let excelItemId = null;
let running = null;

let encore = null;
async function syncNow() {
  if (running) { if (!encore) encore = running.catch(() => {}).then(() => { encore = null; return syncNow(); }); return encore; }
  running = (async () => {
    try {
      if (!source.etat().charge) await source.charger(); // jamais de synchro Excel avant de connaître la source
      if (source.estBase() && supabase) {
        cache = { rows: await lireBase(), syncedAt: new Date().toISOString(), error: null };
        return cache;
      }
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
  const prio = await chargerPrioritaires();
  return { ...cache, rows: cache.rows.map(r => ({ ...r, prioritaire: prio.has(r.cle) })) };
}

// ---------- Planches prioritaires (case « 🔥 Prioritaire » de la fiche) ----------
// Liste des clés dans gestion_reglages (« planches_prioritaires ») : pas de colonne à ajouter dans la base.
let prioritaires = { set: new Set(), le: 0 };
async function chargerPrioritaires(force = false) {
  if (!supabase) return prioritaires.set;
  if (!force && Date.now() - prioritaires.le < 30e3) return prioritaires.set;
  try {
    const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'planches_prioritaires').maybeSingle();
    const l = data && data.valeur ? JSON.parse(data.valeur) : [];
    prioritaires = { set: new Set(Array.isArray(l) ? l : []), le: Date.now() };
  } catch (err) { console.error('Planches prioritaires :', err.message); }
  return prioritaires.set;
}
async function setPrioritaire(cle, actif, user) {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Planche introuvable');
  const set = await chargerPrioritaires(true);
  if (actif) set.add(cle); else set.delete(cle);
  const presentes = new Set(cache.rows.map(r => r.cle));
  const liste = [...set].filter(k => presentes.has(k));
  if (supabase) {
    const { error } = await supabase.from('gestion_reglages').upsert({ cle: 'planches_prioritaires', valeur: JSON.stringify(liste), updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
  prioritaires = { set: new Set(liste), le: Date.now() };
  await journal(user, actif ? 'planche_prioritaire' : 'planche_non_prioritaire', cle, { client: row.client });
  return { prioritaire: !!actif };
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

// ---------- Visuel importé depuis le dashboard (même rangement que les planches reçues par mail) ----------
// « Client - P<n>.ext » dans PLANCHES A IMPRIMER : un fichier déjà présent fait passer le suivant en P2, P3… ;
// archivé au bout de 24 h comme les autres. note : info pour l'équipe, ajoutée aux remarques de la planche.
async function importerVisuels(cle, fichiers, note, user) {
  const p = cache.rows.find(r => r.cle === cle);
  if (!p) throw new Error('Planche introuvable');
  const ok = (fichiers || []).filter(f => f && f.buffer && f.buffer.length);
  if (!ok.length) throw new Error('Choisis le fichier du visuel');
  for (const f of ok) if (!/\.(png|pdf|jpe?g|tiff?)$/i.test(f.originalname || '')) throw new Error(`Format non accepté : ${f.originalname} (PNG, PDF, JPG ou TIFF)`);
  const noms = await require('./planches-mail').deposer(p.client, ok.map(f => ({ name: f.originalname, buffer: f.buffer, contentType: f.mimetype })));
  dossiers.at = 0; // liste des fichiers relue
  const info = String(note || '').trim().slice(0, 300);
  if (info) {
    const d = new Date().toLocaleDateString('fr-FR', { timeZone: 'America/Guadeloupe', day: '2-digit', month: '2-digit' });
    await modifier(cle, { remarques: [p.remarques, `${d} ${user} : ${info}`].filter(Boolean).join(' | ').slice(0, 500) }, user);
  }
  await journal(user, 'planche_visuel_importe', cle, { fichiers: noms, note: info || null });
  console.log(`Gestion : visuel(s) ${noms.join(', ')} importé(s) pour la planche ${cle} (${user})`);
  return { fichiers: noms };
}

// ---------- Bordereau d'expédition d'une planche ----------
// Rangé dans Technique/Planches/BORDEREAUX (jamais vidé par les nettoyages automatiques),
// nommé « <clé> - <client> - BORDEREAU.pdf » ; déposable à tout moment, dès la création de la planche.
const sansInterdits = s => String(s || '').replace(/[\\"*:<>?/|#%]/g, '').replace(/\s+/g, ' ').trim();
async function dossierBordereaux() {
  const root = await planchesRoot();
  const D = { drive: planchesDrive };
  const f = (await g.children(root.id, D)).find(i => i.folder && /^bordereaux$/i.test(i.name.trim()));
  return { f: f || await g.createFolder(root.id, 'BORDEREAUX', D), D };
}
async function bordereaux(cle) {
  const p = cache.rows.find(r => r.cle === cle);
  if (!p) throw new Error('Planche introuvable');
  const { f, D } = await dossierBordereaux();
  const pre = key(sansInterdits(cle));
  return (await g.children(f.id, D)).filter(i => i.file && key(i.name.split(' - ')[0]) === pre)
    .map(i => ({ id: i.id, nom: i.name, modifie: i.lastModifiedDateTime }))
    .sort((a, b) => String(a.modifie).localeCompare(String(b.modifie)));
}
async function ajouterBordereau(cle, file, user) {
  const p = cache.rows.find(r => r.cle === cle);
  if (!p) throw new Error('Planche introuvable');
  if (!file) throw new Error('Aucun fichier reçu');
  if (!/\.(pdf|png|jpe?g)$/i.test(file.originalname || '')) throw new Error('Format accepté : PDF, PNG ou JPG');
  const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || ['.pdf'])[0].toLowerCase();
  const { f, D } = await dossierBordereaux();
  const nom = `${sansInterdits(cle)} - ${sansInterdits(p.client).slice(0, 60)} - BORDEREAU${ext}`;
  const it = await g.uploadFile(f.id, nom, file.buffer, file.mimetype, D, 'rename');
  await journal(user, 'bordereau_ajoute', cle, { nom: it.name });
  console.log(`Gestion : bordereau ${it.name} déposé pour la planche ${cle} (${user})`);
  return { bordereaux: await bordereaux(cle) };
}
async function supprimerBordereau(cle, itemId, user) {
  const liste = await bordereaux(cle);
  const b = liste.find(x => x.id === itemId);
  if (!b) throw new Error('Fichier non autorisé');
  await g.deleteItem(b.id, { drive: planchesDrive });
  await journal(user, 'bordereau_supprime', cle, { nom: b.nom });
  return { bordereaux: await bordereaux(cle) };
}

// Supprimer un fichier d'une planche (visuel en double, mauvais fichier…) : supprimé dans SharePoint (corbeille du site,
// récupérable 93 jours). Uniquement un fichier rattaché à cette planche (même client, dossiers Planches).
async function supprimerFichier(cle, itemId, user) {
  const liste = (await getFichiers(cle)).fichiers || [];
  const f = liste.find(x => x.id === String(itemId));
  if (!f) throw new Error('Fichier non autorisé ou déjà supprimé : actualise');
  await g.deleteItem(f.id, { drive: planchesDrive });
  dossiers.at = 0;
  await journal(user, 'planche_fichier_supprime', cle, { nom: f.nom, dossier: f.dossier });
  console.log(`Gestion : fichier ${f.nom} (${f.dossier}) supprimé pour la planche ${cle} (${user})`);
  return { ok: true, nom: f.nom };
}

// Proxy : uniquement des fichiers du dossier Planches
async function fichierAutorise(itemId) {
  if (!planchesDrive) await planchesRoot();
  const it = await g.item(itemId, { drive: planchesDrive });
  const path = g.norm(decodeURIComponent(it.parentReference?.path || ''));
  return it.file && path.includes(g.norm(cfg.PLANCHES_PATH)) ? it : null;
}

// ============================================
// ACTIONS (phase 1) : écriture dans l'Excel + Odoo
// L'Excel reste la référence tant que les flux Power Automate en dépendent :
// on y écrit cellule par cellule (les formules Réduction / Montant restent intactes).
// ============================================
const colLetter = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colIndex = l => l.split('').reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0) - 1;

async function lireTableau() {
  if (!excelItemId) excelItemId = (await g.itemByPath(cfg.EXCEL_PATH)).id;
  const range = await g.tableRange(excelItemId, cfg.TABLE_PLANCHES); // lecture fraîche
  const rows = rowsFromRange(range);
  const m = String(range.address || '').match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)/);
  if (!m) throw new Error(`Adresse du tableau illisible : ${range.address}`);
  return { range, rows, sheet: m[1], startCol: m[2], startRow: Number(m[3]) };
}

async function ecrireLigne(t, rowIndex, fields) {
  for (const [field, value] of Object.entries(fields)) {
    if (t.rows.idx[field] === undefined) throw new Error(`Colonne « ${field} » absente du tableau`);
    const address = colLetter(colIndex(t.startCol) + t.rows.idx[field]) + (t.startRow + 1 + rowIndex);
    await g.patchRange(excelItemId, t.sheet, address, [[value]]);
  }
}

async function writeCells(cle, fields) {
  if (source.estBase()) { await ecrireBase(cle, fields); await syncNow(); return; }
  const t = await lireTableau(); // on retrouve la ligne par sa clé juste avant d'écrire
  const row = t.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Ligne introuvable dans l\'Excel (elle a peut-être été modifiée entre-temps) : actualise et réessaie');
  await ecrireLigne(t, row._row, fields);
  await syncNow();
}

// Suppression manuelle : la ligne est vidée (comme le nettoyage de minuit), les formules restent
async function supprimer(cle, user, { fichiers = [], devis = false } = {}) {
  // Fichiers de la planche à supprimer (corbeille SharePoint) : uniquement ceux rattachés à ce client
  const ids = Array.isArray(fichiers) ? fichiers.map(String).slice(0, 30) : [];
  let autorises = [];
  if (ids.length) {
    const liste = (await getFichiers(cle)).fichiers || [];
    autorises = liste.filter(f => ids.includes(f.id));
  }
  let row;
  if (source.estBase()) {
    row = cache.rows.find(r => r.cle === cle);
    if (!row) throw new Error('Planche introuvable : actualise et réessaie');
    const { error } = await supabase.from('gestion_planches').delete().eq('cle', cle);
    if (error) throw new Error(`Supabase : ${error.message}`);
  } else {
  const t = await lireTableau();
  row = t.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Ligne introuvable dans l\'Excel : actualise et réessaie');
  const champs = ['date_commande', 'client', 'metres', 'frequence', 'paiement', 'remarques', 'statut', 'n_devis', 'mail_envoye', 'numero_suivi', 'mail_expedition_envoye']
    .filter(f => t.rows.idx[f] !== undefined);
  await ecrireLigne(t, row._row, Object.fromEntries(champs.map(f => [f, ''])));
  }
  const supprimes = [], erreurs = [];
  for (const f of autorises) {
    try { await g.deleteItem(f.id, { drive: planchesDrive }); supprimes.push(f.nom); }
    catch (err) { erreurs.push(`${f.nom} : ${err.message}`); }
  }
  if (autorises.length) dossiers.at = 0;
  const devisOdoo = devis && row.n_devis ? await require('./commandes').supprimerDevisOdoo(row.n_devis) : null;
  if (devisOdoo && devisOdoo !== 'supprimé') erreurs.push(`devis Odoo : ${devisOdoo}`);
  await syncNow();
  await journal(user, 'planche_supprimee', cle, { client: row.client, metres: row.metres || row.format, n_devis: row.n_devis, statut: row.statut, fichiers_supprimes: supprimes, devis_odoo: devisOdoo });
  return { ok: true, fichiersSupprimes: supprimes, devisOdoo, ...(erreurs.length ? { avertissement: `Ligne supprimée, mais : ${erreurs.join(' ; ')}` } : {}) };
}

// Nom Excel déjà associé à ce client Odoo (pour retrouver sa ligne hebdo)
async function trouverNomExcel(partnerId) {
  for (const r of cache.rows) {
    const a = await odoo.getAlias(r.client);
    if (a && Number(a.partner_id) === Number(partnerId)) return r.client;
  }
  return null;
}

// Nouvelle planche saisie à la main : réutilise une ligne vide du tableau (formules conservées), sinon ajoute une ligne.
// Client hebdo qui a déjà sa ligne : on ajoute le métrage à son compteur.
async function ajouter(data, user) {
  let client = String(data.client || '').trim().slice(0, 80);
  let partner = null;
  if (data.partnerId) {
    partner = await odoo.readPartner(Number(data.partnerId));
    if (!partner) throw new Error('Client Odoo introuvable');
    // Une ligne hebdo existante sous un autre nom (ex. ZePUB pour The Pub) garde son nom Excel
    const existant = await trouverNomExcel(partner.id);
    client = existant || client || partner.name;
  }
  if (!client) throw new Error('Nom du client obligatoire');
  const mv = String(data.metres ?? '').trim().toUpperCase().replace(',', '.');
  const format = mv === 'A3' || mv === 'A4' ? mv : null;
  const metres = format ? null : Number(mv);
  if (!format && !(metres > 0 && metres < 1000)) throw new Error('Métrage invalide (nombre, A3 ou A4)');
  if (partner) await odoo.setAlias(client, partner.id, partner.name, user);
  const t = source.estBase() ? (await syncNow(), { rows: cache.rows }) : await lireTableau();
  // Client qui a déjà sa ligne hebdo : toujours ajouté à son compteur
  const hebdo = !!data.hebdo || t.rows.some(r => r.hebdo && key(r.client) === key(client));

  if (hebdo) {
    const ligne = t.rows.find(r => r.hebdo && key(r.client) === key(client));
    if (ligne) {
      if (format || ligne.format) throw new Error('Client hebdo : le compteur se fait en mètres (pas en A3/A4)');
      const total = Math.round(((ligne.metres || 0) + metres) * 100) / 100;
      const maj = { metres: total };
      // Nouvelle demande sur la ligne hebdo : repasse « À préparer » si la ligne n'est pas déjà en cours (vide, prête, livrée…)
      if (data.statut && !['apreparer', 'averifier', 'aimprimer'].includes(key(ligne.statut))) maj.statut = data.statut;
      // Infos de la demande (pages du Canva…) ajoutées à la suite des remarques de la ligne hebdo
      const info = String(data.remarques || '').trim();
      if (info) {
        const d = new Date().toLocaleDateString('fr-FR', { timeZone: 'America/Guadeloupe', day: '2-digit', month: '2-digit' });
        maj.remarques = [String(ligne.remarques || '').trim(), `${d} +${metres} m : ${info}`].filter(Boolean).join(' | ').slice(-500);
      }
      if (source.estBase()) await ecrireBase(ligne.cle, maj);
      else await ecrireLigne(t, ligne._row, maj);
      await syncNow();
      await journal(user, 'compteur_hebdo_ajoute', ligne.cle, { client: ligne.client, ajout: metres, total });
      return { planche: cache.rows.find(r => r._row === ligne._row) || null, compteur: { avant: ligne.metres || 0, ajout: metres, total } };
    }
  }

  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
  const date = data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date
    : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const fields = {
    date_commande: date,
    client,
    metres: format || Math.round(metres * 100) / 100,
    frequence: hebdo ? 'Hebdomadaire (lundi)' : 'Ponctuel',
    remarques: String(data.remarques || '').trim().slice(0, 500) || `Ajoutée à la main par ${user}`,
  };
  if (!hebdo) { fields.paiement = 'NON PAYÉE'; fields.statut = String(data.statut || 'A PREPARER').toUpperCase(); }
  if (source.estBase()) {
    const id = await insererBase(fields);
    await syncNow();
    const p = cache.rows.find(r => r._row === id) || null;
    await journal(user, 'planche_ajoutee', p?.cle || client, { ...fields });
    return { planche: p };
  }

  // Première ligne vide (client vide) du tableau
  const [, ...valeurs] = t.range.values;
  const iClient = t.rows.idx.client;
  const vide = valeurs.findIndex(r => !String(r[iClient] ?? '').trim());
  let rowIndex;
  if (vide >= 0) {
    rowIndex = vide;
    await ecrireLigne(t, rowIndex, fields);
  } else {
    // Ajout en bas du tableau : les colonnes calculées (Réduction, Montant, ID) se remplissent seules
    const header = t.range.values[0];
    const ligne = header.map(() => null);
    for (const [f, v] of Object.entries(fields)) ligne[t.rows.idx[f]] = v;
    await g.addTableRow(excelItemId, cfg.TABLE_PLANCHES, ligne);
    rowIndex = valeurs.length;
  }
  await syncNow();
  const p = cache.rows.find(r => r._row === rowIndex) || null;
  await journal(user, 'planche_ajoutee', p?.cle || client, { ...fields });
  return { planche: p };
}

async function journal(user, action, cle, details) {
  console.log(`Gestion action : ${action} ${cle} par ${user}`, details || '');
  if (!supabase) return;
  const { error } = await supabase.from('gestion_actions').insert({ utilisateur: user, action, cle, details });
  if (error) console.error('Gestion journal :', error.message);
}

const trouve = cle => {
  const p = cache.rows.find(r => r.cle === cle);
  if (!p) throw new Error('Planche introuvable, actualise la page');
  return p;
};

// Métrage / statut / numéro de suivi
async function modifier(cle, champs, user) {
  const p = trouve(cle);
  const fields = {};
  if ('metres' in champs) {
    const v = String(champs.metres ?? '').trim().toUpperCase().replace(',', '.');
    if (v === 'A3' || v === 'A4') fields.metres = v;
    else if (v === '' && p.hebdo) fields.metres = '';
    else if (Number(v) > 0 && Number(v) < 1000) fields.metres = Math.round(Number(v) * 100) / 100;
    else throw new Error('Métrage invalide (nombre, A3 ou A4)');
  }
  if ('statut' in champs) {
    const v = String(champs.statut || '').trim().toUpperCase();
    // Statut vide (« — ») : client hebdo sans planche en cours (rien à préparer)
    if (v.length > 30) throw new Error('Statut invalide');
    if (!v && !p.hebdo) throw new Error('Choisis un statut (seule une planche hebdo peut rester sans statut)');
    fields.statut = v;
  }
  if ('numero_suivi' in champs) {
    const v = String(champs.numero_suivi || '').trim().toUpperCase().replace(/\s+/g, '');
    if (v && !/^[A-Z0-9]{8,20}$/.test(v)) throw new Error('Numéro de suivi invalide');
    fields.numero_suivi = v;
  }
  if ('client' in champs) {
    const v = String(champs.client || '').trim().slice(0, 80);
    if (!v) throw new Error('Le nom du client ne peut pas être vide');
    if (v !== p.client) fields.client = v;
  }
  if ('n_devis' in champs) {
    const v = String(champs.n_devis || '').trim().toUpperCase().replace(/\s+/g, '');
    if (v && !/^[A-Z]{1,5}\d{3,}$/.test(v)) throw new Error('N° de devis invalide (ex. DE2601064)');
    fields.n_devis = v;
  }
  if ('paiement' in champs) {
    const v = String(champs.paiement || '').trim().toUpperCase().slice(0, 25);
    fields.paiement = v;
  }
  if ('remarques' in champs) fields.remarques = String(champs.remarques || '').trim().slice(0, 500);
  // Planche EN ATTENTE (devis pas encore validé) qui passe payée : à préparer
  if (fields.paiement && /^PAY/.test(key(fields.paiement).toUpperCase()) && !('statut' in fields) && key(p.statut) === 'enattente') fields.statut = 'A PREPARER';
  if (!Object.keys(fields).length) throw new Error('Rien à modifier');
  // Renommage : le lien avec le client Odoo suit le nouveau nom
  if (fields.client) {
    const a = await odoo.getAlias(p.client);
    if (a) await odoo.setAlias(fields.client, a.partner_id, a.partner_name, user);
  }
  await writeCells(cle, fields);
  await journal(user, 'planche_modifiee', cle, { client: p.client, ...fields });
  return trouveApres(p);
}

// Après une écriture, la clé peut changer (ex. N° de devis ajouté) : on retrouve la ligne par sa position
const trouveApres = p => (p._row != null ? cache.rows.find(r => r._row === p._row) : null) || (p.excel_id != null ? cache.rows.find(r => r.excel_id === p.excel_id) : null) || cache.rows.find(r => r.cle === p.cle) || (p.n_devis ? cache.rows.find(r => r.n_devis === p.n_devis) : null) || null;

async function clientOdoo(p, partnerId, user) {
  if (partnerId) {
    const partner = await odoo.readPartner(Number(partnerId));
    if (!partner) throw new Error('Client Odoo introuvable');
    await odoo.setAlias(p.client, partner.id, partner.name, user); // mémorisé : ZePUB -> Manuel KOMLHA, etc.
    return { partner };
  }
  return odoo.findPartner(p.client);
}

// Client Odoo associé à une planche (affiché dans la fiche, modifiable)
async function clientPlanche(cle) {
  const p = trouve(cle);
  const r = await odoo.findPartner(p.client);
  const fmt = x => x && { id: x.id, name: x.name, email: x.email || null, zip: x.zip || null, ville: x.city || null, martinique: odoo.isMartinique(x) };
  return r.partner ? { partner: fmt(r.partner), source: r.source } : { candidats: r.candidats };
}
async function choisirClient(cle, partnerId, user) {
  const p = trouve(cle);
  const partner = await odoo.readPartner(Number(partnerId));
  if (!partner) throw new Error('Client Odoo introuvable');
  await odoo.setAlias(p.client, partner.id, partner.name, user);
  await journal(user, 'client_associe', cle, { client: p.client, partenaire: partner.name, partner_id: partner.id });
  return clientPlanche(cle);
}

// Devis Odoo pour une planche ponctuelle (sans N° de devis)
async function devis(cle, user, { partnerId, force } = {}) {
  const p = trouve(cle);
  if (p.n_devis) throw new Error(`Cette planche a déjà un devis (${p.n_devis})`);
  if (p.hebdo) throw new Error('Client hebdo : on facture le lundi, pas de devis');
  if (!p.format && !(p.metres > 0)) throw new Error('Renseigne d\'abord le métrage');
  const c = await clientOdoo(p, partnerId, user);
  if (!c.partner) return { besoinClient: true, candidats: c.candidats };
  if (!force) {
    const recent = await odoo.devisRecent(c.partner.id);
    if (recent) return { doublon: recent };
  }
  const titre = `PLANCHE DTF - ${p.format || String(p.metres).replace('.', ',') + ' m'}`;
  // Planche "A VERIFIER" : devis préparé dans Odoo mais PAS envoyé (Ismaël l'ajuste puis l'envoie depuis Odoo)
  const envoyer = key(p.statut) !== 'averifier'; // insensible aux accents (A VÉRIFIER)
  const d = await odoo.creerEtEnvoyerDevis({ partner: c.partner, metres: p.metres, format: p.format, titre, envoyer });
  await writeCells(cle, { n_devis: d.numero });
  await journal(user, envoyer ? 'devis_envoye' : 'devis_prepare', d.numero, { client: p.client, partenaire: c.partner.name, ...d });
  return { ok: true, devis: d, planche: trouveApres(p) };
}

// ---------- Facturation hebdo ----------
function semaineIso(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { annee: d.getUTCFullYear(), semaine: Math.ceil(((d - y) / 86400000 + 1) / 7) };
}
const heureGuadeloupe = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
// Lundi : semaine écoulée. Autres jours (envoi manuel) : semaine en cours.
function titreParDefaut() {
  const now = heureGuadeloupe();
  const ref = new Date(now);
  if (now.getDay() === 1) ref.setDate(ref.getDate() - 7);
  return `PLANCHE DTF SEMAINE ${semaineIso(ref).semaine}`;
}

async function facturer(cle, user, { partnerId, titre } = {}) {
  const p = trouve(cle);
  if (!p.hebdo) throw new Error('Facture hebdo réservée aux clients en fréquence hebdomadaire');
  if (!p.format && !(p.metres > 0)) throw new Error('Compteur à zéro : rien à facturer');
  const c = await clientOdoo(p, partnerId, user);
  if (!c.partner) return { besoinClient: true, candidats: c.candidats };
  const t = (titre || titreParDefaut()).trim().slice(0, 120);
  const f = await odoo.creerEtEnvoyerFacture({ partner: c.partner, metres: p.metres, format: p.format, titre: t });
  // Remise à zéro du compteur (seulement après envoi réussi)
  await writeCells(cle, { metres: '' });
  await journal(user, 'facture_hebdo', f.numero, { client: p.client, partenaire: c.partner.name, metres: p.metres || p.format, titre: t, ...f });
  return { ok: true, facture: f, planche: trouveApres(p) };
}

// ---------- Réglages (facturation automatique du lundi) ----------
const reglagesMem = new Map();
async function getReglage(cle, defaut = null) {
  if (!supabase) return reglagesMem.has(cle) ? reglagesMem.get(cle) : defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (!supabase) { reglagesMem.set(cle, valeur); return; }
  const { error } = await supabase.from('gestion_reglages').upsert({ cle, valeur, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase : ${error.message}`);
}

let autoEnCours = false;
async function facturationAutoSiDue() {
  if (autoEnCours) return;
  const now = heureGuadeloupe();
  if (now.getDay() !== 1 || now.getHours() < 8) return; // lundi à partir de 8h
  if ((await getReglage('facturation_hebdo_auto', 'off')) !== 'on') return;
  const ref = new Date(now); ref.setDate(ref.getDate() - 7);
  const { annee, semaine } = semaineIso(ref);
  const marque = `${annee}-S${semaine}`;
  if ((await getReglage('facturation_hebdo_derniere')) === marque) return;
  autoEnCours = true;
  try {
    await setReglage('facturation_hebdo_derniere', marque); // marqué avant l'envoi : jamais deux fois la même semaine
    await syncNow();
    const aFacturer = cache.rows.filter(p => p.hebdo && (p.format || p.metres > 0));
    const bilan = [];
    for (const p of aFacturer) {
      try {
        const r = await facturer(p.cle, 'Facturation automatique', { titre: `PLANCHE DTF SEMAINE ${semaine}` });
        bilan.push(r.ok ? `✅ ${p.client} : ${r.facture.numero}` : `⚠️ ${p.client} : client Odoo à préciser`);
      } catch (err) {
        bilan.push(`❌ ${p.client} : ${err.message}`);
      }
    }
    await setReglage('facturation_hebdo_bilan', JSON.stringify({ semaine: marque, le: new Date().toISOString(), lignes: bilan }));
    console.log('Gestion facturation hebdo', marque, bilan);
  } finally {
    autoEnCours = false;
  }
}

async function etatFacturationAuto() {
  let bilan = null;
  try { bilan = JSON.parse(await getReglage('facturation_hebdo_bilan', 'null')); } catch {}
  return { active: (await getReglage('facturation_hebdo_auto', 'off')) === 'on', bilan, titreParDefaut: titreParDefaut(), odoo: odoo.configured() };
}

function startSync() {
  if (!cfg.SITE_ID || !cfg.CLIENT_ID || !cfg.CLIENT_SECRET) return;
  setTimeout(() => syncNow().then(correctionsUniques).catch(e => console.error('Gestion planches :', e.message)), 8000);
  setInterval(() => { syncNow().then(() => facturationAutoSiDue()).catch(e => console.error('Gestion planches :', e.message)); }, cfg.SYNC_INTERVAL_MS);
}

// Corrections ponctuelles de données (une seule fois, mémorisées dans gestion_reglages)
async function correctionsUniques() {
  if (!supabase || !cache.rows.length) return;
  // 12/10/2026 : ZePUB ANTILLES = Manuel (prénom utilisé dans les messages)
  if (!(await getReglage('correction_zepub_prenom'))) {
    try {
      const base = require('../supabase'), tel = '590690598773';
      const note = String((await base.getClientNote(tel)) || '');
      if (!/pr[ée]nom\s*:/i.test(note)) await base.upsertClientNote(tel, [note.trim(), 'Prénom : Manuel (ZePUB ANTILLES)'].filter(Boolean).join('\n'));
      await setReglage('correction_zepub_prenom', new Date().toISOString());
    } catch (err) { console.error('Correction prénom ZePUB :', err.message); }
  }
  // 12/10/2026 15:19 : 2e planche de Micky Mug Custom (page 2) demandée alors que Leïla était désactivée
  if (!(await getReglage('correction_micky_1210'))) {
    await setReglage('correction_micky_1210', new Date().toISOString());
    require('./leila').veillePlanche('590690001243').catch(err => console.error('Correction Micky :', err.message));
  }
  // 12/10/2026 : demande WhatsApp de Jennifer (Presta Plus) ajoutée à la ligne hebdo sans statut ni remarque
  const flag = 'correction_presta_plus_1210';
  if (await getReglage(flag)) return;
  const l = cache.rows.find(r => r.hebdo && key(r.client) === 'prestaplus');
  if (!l) return;
  const champs = {};
  if (!['apreparer', 'averifier', 'aimprimer'].includes(key(l.statut))) champs.statut = 'A PREPARER';
  if (!/pages 1 [àa] 3/i.test(l.remarques || '')) champs.remarques = [String(l.remarques || '').trim(), '12/10 +3.5 m : Demande WhatsApp (Jennifer, via Leïla) : pages 1 à 3 du Canva, quantités dans le nom du fichier, pour aujourd’hui'].filter(Boolean).join(' | ').slice(-500);
  try {
    if (Object.keys(champs).length) await modifier(l.cle, champs, 'IGS Dashboard (correction)');
    await setPrioritaire(l.cle, true, 'IGS Dashboard (correction)');
    await setReglage(flag, new Date().toISOString());
    console.log(`Gestion planches : ligne hebdo ${l.client} corrigée (${Object.keys(champs).join(', ') || 'rien à changer'}, prioritaire)`);
  } catch (err) { console.error('Gestion planches : correction Presta Plus impossible :', err.message); }
}

const drive = () => ({ drive: planchesDrive });

// Colonne « Mail Envoyé » / « Mail Expédition Envoyé » d'une planche (messages automatiques)
async function ecrireDrapeau(cle, champ, valeur) {
  if (!['mail_envoye', 'mail_expedition_envoye'].includes(champ)) throw new Error('Champ non autorisé');
  await writeCells(cle, { [champ]: valeur });
}

// Paiement confirmé dans Odoo (devis confirmé) : colonne Paiement = PAYÉE
async function marquerPayee(cle) {
  const p = cache.rows.find(r => r.cle === cle);
  // Devis validé : une planche EN ATTENTE passe À PRÉPARER
  await writeCells(cle, p && key(p.statut) === 'enattente' ? { paiement: 'PAYÉE', statut: 'A PREPARER' } : { paiement: 'PAYÉE' });
}
// Dossier Technique/Planches et bibliothèque où il se trouve (tâches de rangement des fichiers)
async function dossierPlanches() { const root = await planchesRoot(); return { root, D: { drive: planchesDrive } }; }

module.exports = { setPrioritaire, supprimerFichier, importerVisuels, bordereaux, ajouterBordereau, supprimerBordereau, nettoyerBase, marquerPayee, dossierPlanches, ecrireDrapeau, supprimer, clientPlanche, choisirClient, ajouter, modifier, devis, facturer, setReglage, etatFacturationAuto, facturationAutoSiDue, drive, syncNow, listPlanches, getFichiers, fichierAutorise, startSync, _test: { rowsFromRange, excelDate } };
