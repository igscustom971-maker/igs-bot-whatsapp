// ============================================
// IGS GESTION - MODULE PLANCHES DTF (lecture seule)
// - Synchro du tableau Excel "Tableau4" (onglet Planches DTF) vers Supabase, toutes les 2 min
// - Fichiers de la planche : dossier Technique/Planches (PLANCHES A IMPRIMER + Archives)
// L'Excel reste la source de vérité : ce module n'écrit JAMAIS dans l'Excel.
// ============================================

const cfg = require('./config');
const g = require('./graph');
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
  const t = await lireTableau(); // on retrouve la ligne par sa clé juste avant d'écrire
  const row = t.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Ligne introuvable dans l\'Excel (elle a peut-être été modifiée entre-temps) : actualise et réessaie');
  await ecrireLigne(t, row._row, fields);
  await syncNow();
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
  const t = await lireTableau();
  // Client qui a déjà sa ligne hebdo : toujours ajouté à son compteur
  const hebdo = !!data.hebdo || t.rows.some(r => r.hebdo && key(r.client) === key(client));

  if (hebdo) {
    const ligne = t.rows.find(r => r.hebdo && key(r.client) === key(client));
    if (ligne) {
      if (format || ligne.format) throw new Error('Client hebdo : le compteur se fait en mètres (pas en A3/A4)');
      const total = Math.round(((ligne.metres || 0) + metres) * 100) / 100;
      await ecrireLigne(t, ligne._row, { metres: total });
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
    if (!v || v.length > 30) throw new Error('Statut invalide');
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
const trouveApres = p => cache.rows.find(r => r._row === p._row) || null;

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
  setTimeout(syncNow, 8000);
  setInterval(() => { syncNow().then(() => facturationAutoSiDue()).catch(e => console.error('Gestion planches :', e.message)); }, cfg.SYNC_INTERVAL_MS);
}

const drive = () => ({ drive: planchesDrive });

module.exports = { clientPlanche, choisirClient, ajouter, modifier, devis, facturer, setReglage, etatFacturationAuto, facturationAutoSiDue, drive, syncNow, listPlanches, getFichiers, fichierAutorise, startSync, _test: { rowsFromRange, excelDate } };
