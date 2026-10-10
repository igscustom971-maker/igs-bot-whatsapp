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
    Object.defineProperty(out[out.length - 1], '_row', { value: n, enumerable: false }); // position dans le tableau
  });
  out.idx = idx;
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

// ---------- Date de livraison modifiée à la main (stockée dans Supabase, jamais écrite dans l'Excel) ----------
const overridesMem = new Map(); // repli si Supabase n'est pas configuré

async function loadOverrides() {
  if (!supabase) return overridesMem;
  const { data, error } = await supabase.from('gestion_commandes')
    .select('cle, date_livraison_manuelle, date_livraison_modifiee_par, date_livraison_modifiee_le, a_payer_especes, montant_especes, especes_note_par, bordereaux, bat_envoye_le, bat_envoye_par, bat_reponse, bat_auto_le, bat_auto_erreur, bat_alertes')
    .or('date_livraison_manuelle.not.is.null,a_payer_especes.eq.true,bordereaux.not.is.null,bat_envoye_le.not.is.null,bat_auto_le.not.is.null,bat_auto_erreur.not.is.null');
  if (error) { console.error('Gestion overrides :', error.message); return overridesMem; }
  return new Map(data.map(o => [o.cle, o]));
}

function applyOverride(r, o) {
  const out = { ...r, date_livraison_excel: r.date_livraison };
  if (o && o.date_livraison_manuelle) {
    out.date_livraison = o.date_livraison_manuelle;
    out.date_livraison_manuelle = o.date_livraison_manuelle;
    out.date_livraison_modifiee_par = o.date_livraison_modifiee_par;
    out.date_livraison_modifiee_le = o.date_livraison_modifiee_le;
  }
  out.a_payer_especes = !!(o && o.a_payer_especes);
  out.bordereaux = o && Array.isArray(o.bordereaux) && o.bordereaux.length ? o.bordereaux : null;
  out.bat_envoye_le = (o && o.bat_envoye_le) || null;
  out.bat_envoye_par = (o && o.bat_envoye_par) || null;
  out.bat_reponse = (o && o.bat_reponse) || null;
  out.bat_auto_le = (o && o.bat_auto_le) || null;
  out.bat_auto_erreur = (o && o.bat_auto_erreur) || null;
  out.bat_alertes = (o && Array.isArray(o.bat_alertes) && o.bat_alertes.length) ? o.bat_alertes : null;
  if (out.a_payer_especes) {
    out.montant_especes = o.montant_especes;
    out.especes_note_par = o.especes_note_par;
  }
  return out;
}

async function listCommandes({ force = false } = {}) {
  if (force || !cache.syncedAt || Date.now() - new Date(cache.syncedAt).getTime() > cfg.SYNC_INTERVAL_MS) await syncNow();
  const ov = await loadOverrides();
  return { ...cache, rows: cache.rows.map(r => ({ ...applyOverride(r, ov.get(r.cle)), controle: controles.get(r.cle) || null, bat_info: batInfo.get(r.cle) || null })) };
}

// ---------- Contrôle devis / tableau des tailles ----------
// Quantité du devis lue dans "Contenu" (ex. "100 x [ENTSHAVR] T-shirt personnalisé / 6 x [ENTABLIER] Tablier")
function qteDevis(infos) {
  const re = /(\d+(?:[.,]\d+)?)\s*x\s*\[/gi;
  let m, total = 0, n = 0;
  while ((m = re.exec(String(infos || '')))) { total += Number(m[1].replace(',', '.')); n++; }
  return n ? Math.round(total) : null;
}
function controleDe(row, totalTableau) {
  const devis = qteDevis(row.infos);
  if (devis === null || !totalTableau) return null;
  return { devis, tableau: totalTableau, ecart: totalTableau - devis };
}
const controles = new Map(); // cle -> { devis, tableau, ecart, le }
const STATUTS_A_CONTROLER = /^(PAYEE|VALIDEE|EN COMMANDE|EN PRODUCTION|EN FLOCAGE)$/;
let controleEnCours = false;
async function controlerQuantites() {
  if (controleEnCours) return;
  controleEnCours = true;
  try {
    for (const r of cache.rows) {
      if (!r.n_devis || !STATUTS_A_CONTROLER.test(g.norm(r.statut || '').toUpperCase()) || qteDevis(r.infos) === null) continue;
      const d = await getDossier(r.n_devis).catch(() => null);
      const c = d && d.trouve && d.tailles ? controleDe(r, d.tailles.total) : null;
      if (c) controles.set(r.cle, { ...c, le: new Date().toISOString() }); else controles.delete(r.cle);
    }
  } catch (err) {
    console.error('Gestion contrôle quantités :', err.message);
  } finally {
    controleEnCours = false;
  }
}

// ---------- Paiement à encaisser en espèces à la remise (Supabase uniquement) ----------
async function setEspeces(cle, { actif, montant }, user) {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Commande introuvable');
  let m = null;
  if (actif && montant !== undefined && montant !== null && String(montant).trim() !== '') {
    m = Number(String(montant).replace(',', '.').replace(/\s/g, ''));
    if (!(m > 0)) throw new Error('Montant invalide');
    m = Math.round(m * 100) / 100;
  }
  const o = actif
    ? { a_payer_especes: true, montant_especes: m, especes_note_par: user }
    : { a_payer_especes: false, montant_especes: null, especes_note_par: null };
  if (supabase) {
    const { error } = await supabase.from('gestion_commandes').update(o).eq('cle', cle);
    if (error) throw new Error(`Supabase : ${error.message}`);
  } else {
    overridesMem.set(cle, { ...(overridesMem.get(cle) || { cle }), ...o });
  }
  console.log(`Gestion : ${cle} ${actif ? `à payer en espèces${m ? ` (${m} €)` : ''}` : 'paiement espèces retiré'} (${user})`);
  const ov = await loadOverrides();
  return applyOverride(row, ov.get(cle));
}

async function setLivraison(cle, date, user) {
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date invalide');
  const row = cache.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Commande introuvable');
  const o = date === null
    ? { date_livraison_manuelle: null, date_livraison_modifiee_par: null, date_livraison_modifiee_le: null }
    : { date_livraison_manuelle: date, date_livraison_modifiee_par: user, date_livraison_modifiee_le: new Date().toISOString() };
  if (supabase) {
    const { error } = await supabase.from('gestion_commandes').update(o).eq('cle', cle);
    if (error) throw new Error(`Supabase : ${error.message}`);
  } else if (date === null) overridesMem.delete(cle);
  else overridesMem.set(cle, { cle, ...o });
  console.log(`Gestion : date de livraison ${cle} -> ${date || 'date Excel'} (${user})`);
  return applyOverride(row, date === null ? null : o);
}

// ---------- Dossier client : BAT, tailles, visuels ----------
let commandesFolder = { id: null, list: [], at: 0 };

let archivesFolder = { list: [], at: 0 };
const devisDuDossier = name => key(String(name).split(/\s+-\s+/)[0]); // "DE2600446 - Erick JUDOR" -> de2600446

async function findCommandeFolder(ndevis) {
  if (!commandesFolder.id) commandesFolder.id = (await g.itemByPath(cfg.COMMANDES_PATH)).id;
  if (Date.now() - commandesFolder.at > 60e3) {
    commandesFolder.list = (await g.children(commandesFolder.id)).filter(i => i.folder);
    commandesFolder.at = Date.now();
  }
  const k = key(ndevis);
  const actif = commandesFolder.list.find(f => devisDuDossier(f.name) === k);
  if (actif) return actif;
  // Commande traitée : dossier déplacé dans Clients/Commandes/ARCHIVES
  const arch = commandesFolder.list.find(f => /^archives?$/i.test(f.name.trim()));
  if (!arch) return null;
  if (Date.now() - archivesFolder.at > 120e3) {
    archivesFolder = { list: (await g.children(arch.id)).filter(i => i.folder), at: Date.now() };
  }
  const f = archivesFolder.list.find(x => devisDuDossier(x.name) === k);
  return f ? { ...f, archive: true } : null;
}

// Commande LIVRÉE : son dossier part dans Clients/Commandes/ARCHIVES ; repassée dans un autre statut : il en ressort
async function rangerDossier(ndevis, livree) {
  const f = await findCommandeFolder(ndevis);
  if (!f) return null;
  if (livree && f.archive) return null;
  if (!livree && !f.archive) return null;
  let arch = commandesFolder.list.find(x => /^archives?$/i.test(x.name.trim()));
  if (livree && !arch) arch = await g.createFolder(commandesFolder.id, 'ARCHIVES');
  await g.moveItem(f.id, livree ? arch.id : commandesFolder.id);
  commandesFolder.at = 0; archivesFolder.at = 0;
  console.log(`Gestion : dossier « ${f.name} » ${livree ? 'archivé' : 'sorti des archives'}`);
  return livree ? `Dossier « ${f.name} » déplacé dans ARCHIVES` : `Dossier « ${f.name} » sorti des ARCHIVES`;
}

// ---------- Liste des BAT (commandes PAYÉE : formulaire reçu -> BAT à faire -> envoyé -> VALIDÉE) ----------
const batInfo = new Map(); // cle -> { dossier, formulaire, bat, le }
let batScanEnCours = false;
async function scannerBat() {
  if (batScanEnCours) return;
  batScanEnCours = true;
  aGenerer = [];
  try {
    for (const r of cache.rows.filter(x => x.n_devis && avantBat(x.statut))) {
      try {
        const f = await findCommandeFolder(r.n_devis);
        if (!f) { batInfo.set(r.cle, { dossier: false, formulaire: false, bat: false, le: new Date().toISOString() }); continue; }
        const items = await g.children(f.id);
        const files = items.filter(i => i.file), folders = items.filter(i => i.folder);
        const info = {
          dossier: true,
          formulaire: !!folders.find(x => key(x.name).startsWith('taille')) || files.some(x => /\.xlsx$/i.test(x.name)),
          bat: !!(files.find(x => key(x.name) === 'bonatirerpdf') || files.find(x => /\.pdf$/i.test(x.name) && /bonatirer|^bat/.test(key(x.name)))),
          le: new Date().toISOString(),
        };
        batInfo.set(r.cle, info);
        // BAT automatique : formulaire reçu (tailles + dossier visuel), pas encore de BAT, jamais tenté
        const ov = (await overridesCache()).get(r.cle);
        const aVisuel = folders.some(x => !key(x.name).startsWith('taille') && !/archive/i.test(x.name)) || files.some(x => /\.(png|jpe?g|webp)$/i.test(x.name));
        if (info.formulaire && aVisuel && !info.bat && !(ov && ov.bat_auto_le) && !batAutoTentes.has(r.cle)) aGenerer.push(r.cle);
      } catch (err) { console.error(`Gestion BAT ${r.n_devis} :`, err.message); }
    }
    for (const cle of aGenerer) {
      batAutoTentes.add(cle);
      try {
        const res = await require('./bat-auto').generer(cle);
        if (!res.ok) console.log(`Gestion BAT auto ${cle} : ${res.raison}`);
      } catch (err) {
        console.error(`Gestion BAT auto ${cle} :`, err.message);
        await marquerBatAuto(cle, err.message).catch(() => {});
      }
    }
  } finally { batScanEnCours = false; }
}
const batAutoTentes = new Set(); // une tentative par démarrage du serveur (erreur notée sur la commande)
let aGenerer = [];
let ovCache = { at: 0, v: new Map() };
async function overridesCache() {
  if (Date.now() - ovCache.at > 30e3) ovCache = { at: Date.now(), v: await loadOverrides() };
  return ovCache.v;
}
// BAT automatique créé (ou échec) : noté sur la commande
async function marquerBatAuto(cle, erreur, user = 'BAT automatique', pages = null, alertes = []) {
  if (!erreur) batInfo.set(cle, { ...(batInfo.get(cle) || { dossier: true, formulaire: true }), bat: true, le: new Date().toISOString() });
  ovCache.at = 0;
  if (!supabase) return;
  const o = erreur ? { bat_auto_erreur: String(erreur).slice(0, 300) } : { bat_auto_le: new Date().toISOString(), bat_auto_erreur: null, bat_alertes: alertes && alertes.length ? alertes : null };
  await supabase.from('gestion_commandes').update(o).eq('cle', cle);
  await supabase.from('gestion_actions').insert({ utilisateur: user, action: erreur ? 'bat_auto_echec' : 'bat_auto_cree', cle, details: erreur ? { erreur } : { pages, alertes } });
}

// BON A TIRER.pdf du dossier de la commande (ou null)
async function trouverBat(ndevis) {
  const f = await findCommandeFolder(ndevis);
  if (!f) return null;
  const files = (await g.children(f.id)).filter(i => i.file);
  return files.find(x => key(x.name) === 'bonatirerpdf') || files.find(x => /\.pdf$/i.test(x.name) && /bonatirer|^bat/.test(key(x.name))) || null;
}

// Nouvelle commande saisie à la main (ligne ajoutée dans le tableau Commandes de l'Excel)
async function creerCommande(data, user) {
  const t = v => String(v ?? '').trim();
  const n_devis = t(data.n_devis).toUpperCase().replace(/\s+/g, '');
  const client = t(data.client).slice(0, 100);
  if (!client) throw new Error('Le client est obligatoire');
  if (n_devis && !/^[A-Z0-9-]{3,30}$/.test(n_devis)) throw new Error('N° de devis invalide');
  if (n_devis && cache.rows.some(r => key(r.n_devis || '') === key(n_devis))) throw new Error(`La commande ${n_devis} existe déjà`);
  const email = t(data.email).toLowerCase(), tel = t(data.telephone);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail invalide');
  const statut = STATUTS.find(s => key(s) === key(data.statut || 'PAYÉE')) || 'PAYÉE';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const xl = require('./excel');
  const tab = await xl.readTable(cfg.TABLE_COMMANDES);
  await xl.addRow(tab, {
    'N° Devis': n_devis,
    'Client': client,
    'Contenu mail': [email, tel].filter(Boolean).join('\n'),
    'Informations complémentaire': t(data.infos).slice(0, 500),
    'Zone de flocage': t(data.zone_flocage).slice(0, 200),
    'Statut': statut,
    'Date commande': today,
    'Remarque': t(data.remarque).slice(0, 500),
    ...(t(data.affectation) ? { 'Affectation': t(data.affectation) } : {}),
  }, 'Client');
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'commande_creee', cle: n_devis || client, details: { client, statut } });
  console.log(`Gestion : commande ${n_devis || '(sans devis)'} ${client} créée à la main (${user})`);
  await syncNow();
  const r = cache.rows.find(x => (n_devis && x.n_devis === n_devis) || (!n_devis && x.client === client));
  return { cle: r ? r.cle : null };
}

// Visuel déposé depuis le générateur de BAT : nouveau fichier dans le dossier du visuel (NOM_Avant / NOM_Arriere),
// ou remplacement d'un fichier existant du dossier de la commande (même nom, extension du nouveau fichier)
async function deposerVisuel(cle, { visuel, face, remplace, file }, user) {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row || !row.n_devis) throw new Error('Commande introuvable');
  if (!file || !/^image\//.test(file.mimetype || '')) throw new Error('Fichier image attendu (PNG, JPG…)');
  const f = await findCommandeFolder(row.n_devis);
  if (!f) throw new Error(`Dossier « ${row.n_devis} - … » introuvable dans Clients/Commandes`);
  const ext = ((file.originalname || '').match(/\.[A-Za-z0-9]{2,5}$/) || ['.png'])[0].toLowerCase();
  let it;
  if (remplace) {
    const ancien = await g.item(remplace);
    const chemin = g.norm(decodeURIComponent(ancien.parentReference?.path || ''));
    if (!ancien.file || !chemin.includes(g.norm(f.name))) throw new Error('Ce fichier n\'appartient pas au dossier de la commande');
    const nom = ancien.name.replace(/\.[^.]+$/, '') + ext;
    it = await g.uploadFile(ancien.parentReference.id, nom, file.buffer, file.mimetype, undefined, 'replace');
    if (nom !== ancien.name) await g.deleteItem(ancien.id).catch(() => {});
  } else {
    const nomVisuel = String(visuel || '').trim().replace(/[\\/:*?"<>|#%{}~&]/g, '').replace(/\s+/g, '_').slice(0, 60);
    if (!nomVisuel) throw new Error('Nom du visuel manquant');
    const enfants = await g.children(f.id);
    let dossier = enfants.find(x => x.folder && g.norm(x.name) === g.norm(nomVisuel));
    if (!dossier) dossier = await g.createFolder(f.id, nomVisuel);
    const base = `${nomVisuel}_${face === 'arriere' ? 'Arriere' : 'Avant'}`;
    const deja = (await g.children(dossier.id)).filter(x => x.file).map(x => g.norm(x.name.replace(/\.[^.]+$/, '')));
    let nom = base, n = 2;
    while (deja.includes(g.norm(nom))) nom = `${base}${n++}`;
    it = await g.uploadFile(dossier.id, nom + ext, file.buffer, file.mimetype, undefined, 'rename');
  }
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: remplace ? 'visuel_remplace' : 'visuel_ajoute', cle, details: { nom: it.name } });
  console.log(`Gestion : visuel ${it.name} ${remplace ? 'remplacé' : 'ajouté'} pour ${row.n_devis} (${user})`);
  return { id: it.id, nom: it.name };
}

// Dépôt du BAT généré (« BON A TIRER.pdf », remplace l'existant)
async function deposerBat(cle, buffer, user) {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row || !row.n_devis) throw new Error('Commande introuvable');
  if (!buffer || buffer.length < 1000 || buffer.slice(0, 4).toString() !== '%PDF') throw new Error('PDF invalide');
  const f = await findCommandeFolder(row.n_devis);
  if (!f) throw new Error(`Dossier « ${row.n_devis} - … » introuvable dans Clients/Commandes`);
  const it = await g.uploadFile(f.id, 'BON A TIRER.pdf', buffer, 'application/pdf', undefined, 'replace');
  batInfo.set(cle, { ...(batInfo.get(cle) || { dossier: true, formulaire: true }), bat: true, le: new Date().toISOString() });
  if (supabase) {
    await supabase.from('gestion_commandes').update({ bat_auto_le: null, bat_auto_erreur: null, bat_alertes: null }).eq('cle', cle);
    await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'bat_genere', cle, details: { taille: buffer.length } });
  }
  console.log(`Gestion : BAT généré et déposé pour ${row.n_devis} (${user})`);
  return { ok: true, id: it.id };
}

// BAT validé par le client : PAYÉE / sans statut / EN DEVIS -> VALIDÉE ; EN COMMANDE : statut conservé, validation notée
async function validerBat(cle, user, canal = 'manuel', message = 'Validé') {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Commande introuvable');
  const reponse = { message, canal, le: new Date().toISOString(), verdict: 'valide' };
  if (supabase) await supabase.from('gestion_commandes').update({ bat_reponse: reponse }).eq('cle', cle);
  if (key(row.statut || '') !== 'encommande') return modifier(cle, { statut: 'VALIDÉE' }, user);
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'bat_valide', cle, details: { statut: row.statut } });
  const ov = await loadOverrides();
  return { ...applyOverride(row, ov.get(cle)), bat_info: batInfo.get(cle) || null };
}

async function setBatEnvoye(cle, envoye, user) {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Commande introuvable');
  // (Re)envoi : la réponse précédente du client est effacée
  const o = envoye ? { bat_envoye_le: new Date().toISOString(), bat_envoye_par: user, bat_reponse: null } : { bat_envoye_le: null, bat_envoye_par: null, bat_reponse: null };
  if (supabase) {
    const { error } = await supabase.from('gestion_commandes').update(o).eq('cle', cle);
    if (error) throw new Error(`Supabase : ${error.message}`);
    await supabase.from('gestion_actions').insert({ utilisateur: user, action: envoye ? 'bat_envoye' : 'bat_envoye_annule', cle, details: { client: row.client } });
  } else overridesMem.set(cle, { ...(overridesMem.get(cle) || { cle }), ...o });
  const ov = await loadOverrides();
  return { ...applyOverride(row, ov.get(cle)), bat_info: batInfo.get(cle) || null };
}

// Dossiers de Clients/Commandes/ARCHIVES (commandes livrées et archivées), pour l'historique
async function listArchives() {
  if (!commandesFolder.id) commandesFolder.id = (await g.itemByPath(cfg.COMMANDES_PATH)).id;
  if (Date.now() - commandesFolder.at > 60e3) {
    commandesFolder.list = (await g.children(commandesFolder.id)).filter(i => i.folder);
    commandesFolder.at = Date.now();
  }
  const arch = commandesFolder.list.find(f => /^archives?$/i.test(f.name.trim()));
  if (!arch) return [];
  if (Date.now() - archivesFolder.at > 120e3) {
    archivesFolder = { list: (await g.children(arch.id)).filter(i => i.folder), at: Date.now() };
  }
  return archivesFolder.list.map(f => {
    const [devis, ...reste] = f.name.split(/\s+-\s+/);
    return { n_devis: devis.trim().toUpperCase(), client: reste.join(' - ').trim() || f.name, date: (f.lastModifiedDateTime || '').slice(0, 10) || null };
  }).filter(x => /^[A-Z]{1,5}\d{3,}/.test(x.n_devis));
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

  const rowB = cache.rows.find(r => r.n_devis === ndevis);
  if (rowB) batInfo.set(rowB.cle, { dossier: true, formulaire: !!folders.find(f => key(f.name).startsWith('taille')) || files.some(f => /\.xlsx$/i.test(f.name)), bat: !!(files.find(f => key(f.name) === 'bonatirerpdf') || files.find(f => /\.pdf$/i.test(f.name) && /bonatirer|^bat/.test(key(f.name)))), le: new Date().toISOString() });
  const bordereaux = files.filter(f => key(f.name).startsWith('bordereau'))
    .map(f => ({ id: f.id, nom: f.name, modifie: f.lastModifiedDateTime }));
  majBordereaux(ndevis, bordereaux).catch(() => {});
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
    dossier: { id: folder.id, nom: folder.name, lien: folder.webUrl || null, archive: !!folder.archive },
    bat: bat ? { id: bat.id, nom: bat.name, modifie: bat.lastModifiedDateTime } : null,
    bordereaux,
    tailles: { fichierTrouve: !!tailles, erreur: taillesErreur, groupes, total: groupes.reduce((s, x) => s + x.total, 0) },
    visuels,
  };
}

// Dossier + contrôle devis / tableau (et mise à jour du cache de contrôle)
async function getDossierControle(ndevis) {
  const d = await getDossier(ndevis);
  const row = cache.rows.find(r => r.n_devis === ndevis);
  if (d.trouve && row) {
    d.controle = controleDe(row, d.tailles.total);
    if (d.controle) controles.set(row.cle, { ...d.controle, le: new Date().toISOString() });
  }
  return d;
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
  // Contrôle des quantités devis / tableau : au démarrage puis toutes les 20 min
  setTimeout(controlerQuantites, 60e3);
  setInterval(controlerQuantites, 20 * 60e3);
  // BAT : dossiers des commandes PAYÉE relus au démarrage puis toutes les 10 min
  setTimeout(scannerBat, 30e3);
  setInterval(scannerBat, 10 * 60e3);
}

// ============================================
// ACTIONS (phase 1) : modification d'une commande, écrite cellule par cellule dans l'Excel
// (les formules Date livraison / ID restent intactes ; ligne retrouvée par N° devis juste avant d'écrire)
// ============================================
const colLetter = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colIndex = l => l.split('').reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0) - 1;

const STATUTS = ['EN DEVIS', 'PAYÉE', 'VALIDÉE', 'EN COMMANDE', 'EN PRODUCTION', 'EN FLOCAGE', 'TERMINÉE', 'A EXPEDIER', 'LIVRÉE'];

async function modifier(cle, champs, user) {
  const fields = {};
  if ('statut' in champs) {
    const v = String(champs.statut || '').trim().toUpperCase();
    const st = STATUTS.find(x => key(x) === key(v));
    if (!st) throw new Error('Statut inconnu');
    fields.statut = st;
  }
  for (const f of ['remarque', 'affectation', 'zone_flocage', 'planche', 'infos']) {
    if (f in champs) fields[f] = String(champs[f] ?? '').trim().slice(0, 500);
  }
  // Contact (e-mail / téléphone) : réécrit dans "Contenu mail" en gardant les instructions et le séparateur d'origine
  if ('email' in champs || 'telephone' in champs) {
    const actuel = cache.rows.find(r => r.cle === cle);
    if (!actuel) throw new Error('Commande introuvable : actualise et réessaie');
    const email = 'email' in champs ? String(champs.email || '').trim().toLowerCase() : null;
    const tel = 'telephone' in champs ? String(champs.telephone || '').trim() : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail invalide');
    if (tel && !/^[+\d][\d\s.\-()]{8,}$/.test(tel)) throw new Error('Téléphone invalide');
    const brut = actuel.contenu_mail || '';
    const sep = /\r?\n/.test(brut) || !brut.includes('|') ? '\n' : ' | ';
    let parts = brut.split(/\r?\n|\|/).map(s => s.trim()).filter(Boolean);
    const estEmail = p => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p);
    const estTel = p => /^[+\d][\d\s.\-()]{8,}$/.test(p);
    if (email !== null) { const i = parts.findIndex(estEmail); if (i >= 0) { if (email) parts[i] = email; else parts.splice(i, 1); } else if (email) parts.unshift(email); }
    if (tel !== null) {
      const i = parts.findIndex(estTel);
      if (i >= 0) { if (tel) parts[i] = tel; else parts.splice(i, 1); }
      else if (tel) { const j = parts.findIndex(estEmail); parts.splice(j >= 0 ? j + 1 : 0, 0, tel); }
    }
    fields.contenu_mail = parts.join(sep);
  }
  if ('numero_suivi' in champs) {
    const v = String(champs.numero_suivi || '').trim().toUpperCase().replace(/\s+/g, '');
    if (v && !/^[A-Z0-9]{8,20}$/.test(v)) throw new Error('Numéro de suivi invalide');
    fields.numero_suivi = v;
  }
  if (!Object.keys(fields).length) throw new Error('Rien à modifier');

  if (!excelItemId) excelItemId = (await g.itemByPath(cfg.EXCEL_PATH)).id;
  const range = await g.tableRange(excelItemId, cfg.TABLE_COMMANDES);
  const rows = rowsFromRange(range);
  const row = rows.find(r => r.cle === cle);
  if (!row) throw new Error('Commande introuvable dans l\'Excel (supprimée ou modifiée entre-temps) : actualise et réessaie');
  const m = String(range.address || '').match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)/);
  if (!m) throw new Error(`Adresse du tableau illisible : ${range.address}`);
  const [, sheet, startCol, startRow] = m;
  for (const [field, value] of Object.entries(fields)) {
    if (rows.idx[field] === undefined) throw new Error(`Colonne « ${field} » absente du tableau Commandes`);
    const address = colLetter(colIndex(startCol) + rows.idx[field]) + (Number(startRow) + 1 + row._row);
    await g.patchRange(excelItemId, sheet, address, [[value]]);
  }
  console.log(`Gestion action : commande_modifiee ${cle} par ${user}`, fields);
  if (supabase) {
    const { error } = await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'commande_modifiee', cle, details: { client: row.client, ...fields } });
    if (error) console.error('Gestion journal :', error.message);
  }
  // Rangement du dossier SharePoint selon le statut (n'empêche pas l'enregistrement en cas d'échec)
  let dossierInfo = null;
  if (fields.statut && row.n_devis && key(fields.statut) !== key(row.statut || '')) {
    try { dossierInfo = await rangerDossier(row.n_devis, fields.statut === 'LIVRÉE'); }
    catch (err) { console.error('Gestion archivage dossier :', err.message); dossierInfo = `⚠ Dossier non déplacé : ${err.message}`; }
  }
  await syncNow();
  const ov = await loadOverrides();
  const r = cache.rows.find(x => x.cle === cle);
  const out = r ? applyOverride(r, ov.get(cle)) : null;
  if (out && dossierInfo) out.dossier_info = dossierInfo;
  return out;
}

// Suppression manuelle (erreur, test) : la ligne est vidée dans l'Excel en une seule écriture,
// les cellules à formule (date de livraison, ID…) gardent leur formule. Le dossier SharePoint n'est pas touché.
async function supprimer(cle, user, { dossier = false } = {}) {
  if (!excelItemId) excelItemId = (await g.itemByPath(cfg.EXCEL_PATH)).id;
  const range = await g.tableRange(excelItemId, cfg.TABLE_COMMANDES);
  const rows = rowsFromRange(range);
  const row = rows.find(r => r.cle === cle);
  if (!row) throw new Error('Commande introuvable dans l\'Excel (déjà supprimée ?) : actualise et réessaie');
  const m = String(range.address || '').match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)/);
  if (!m) throw new Error(`Adresse du tableau illisible : ${range.address}`);
  const [, sheet, startCol, startRow] = m;
  const f = (range.formulas || [])[row._row + 1] || [];
  const nbCol = range.values[0].length;
  const ligne = Array.from({ length: nbCol }, (_, i) => (typeof f[i] === 'string' && f[i].startsWith('=') ? f[i] : ''));
  const n = Number(startRow) + 1 + row._row;
  const address = `${startCol}${n}:${colLetter(colIndex(startCol) + nbCol - 1)}${n}`;
  await g.patchRange(excelItemId, sheet, address, [ligne], undefined, 'formulas');
  // Dossier SharePoint de la commande (corbeille SharePoint, récupérable 93 jours)
  let dossierSupprime = null;
  if (dossier && row.n_devis) {
    try {
      const f = await findCommandeFolder(row.n_devis);
      if (f) { await g.deleteItem(f.id); dossierSupprime = f.name; commandesFolder.at = 0; archivesFolder.at = 0; }
    } catch (err) { console.error('Gestion suppression dossier :', err.message); dossierSupprime = `ERREUR : ${err.message}`; }
  }
  console.log(`Gestion action : commande_supprimee ${cle} par ${user}${dossierSupprime ? ` (dossier : ${dossierSupprime})` : ''}`);
  if (supabase) {
    await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'commande_supprimee', cle, details: { ...row, dossier_supprime: dossierSupprime } });
    const { error } = await supabase.from('gestion_commandes').delete().eq('cle', cle);
    if (error) console.error('Gestion suppression Supabase :', error.message);
  }
  controles.delete(cle);
  await syncNow();
  if (dossierSupprime && dossierSupprime.startsWith('ERREUR')) return { ok: true, avertissement: `Ligne supprimée, mais le dossier n'a pas pu l'être (${dossierSupprime.slice(10)})` };
  return { ok: true, dossierSupprime };
}

// ---------- Bordereau d'expédition (déposé dans le dossier de la commande, à imprimer par l'équipe) ----------
async function majBordereaux(ndevis, liste) {
  const row = cache.rows.find(r => r.n_devis === ndevis);
  if (!row || !supabase) return;
  const v = liste.length ? liste.map(b => ({ id: b.id, nom: b.nom })) : null;
  await supabase.from('gestion_commandes').update({ bordereaux: v }).eq('cle', row.cle);
}

async function ajouterBordereau(cle, file, user) {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row) throw new Error('Commande introuvable');
  if (!row.n_devis) throw new Error('Pas de N° de devis : impossible de retrouver le dossier de la commande');
  if (!file) throw new Error('Aucun fichier reçu');
  if (!/\.(pdf|png|jpe?g)$/i.test(file.originalname || '')) throw new Error('Format accepté : PDF, PNG ou JPG');
  const f = await findCommandeFolder(row.n_devis);
  if (!f) throw new Error(`Dossier « ${row.n_devis} - … » introuvable dans Clients/Commandes`);
  const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || ['.pdf'])[0].toLowerCase();
  const it = await g.uploadFile(f.id, `BORDEREAU${ext}`, file.buffer, file.mimetype);
  const d = await getDossier(row.n_devis); // relit le dossier et met à jour la liste
  await majBordereaux(row.n_devis, d.bordereaux || []);
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'bordereau_ajoute', cle, details: { nom: it.name } });
  console.log(`Gestion : bordereau ${it.name} déposé pour ${cle} (${user})`);
  return { bordereaux: d.bordereaux || [] };
}

async function supprimerBordereau(cle, itemId, user) {
  const row = cache.rows.find(r => r.cle === cle);
  if (!row || !row.n_devis) throw new Error('Commande introuvable');
  const it = await fichierAutorise(itemId);
  if (!it || !key(it.name).startsWith('bordereau')) throw new Error('Fichier non autorisé');
  await g.deleteItem(it.id);
  const d = await getDossier(row.n_devis);
  await majBordereaux(row.n_devis, d.bordereaux || []);
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'bordereau_supprime', cle, details: { nom: it.name } });
  return { bordereaux: d.bordereaux || [] };
}

const statutEst = (statut, attendu) => key(statut || '') === key(attendu);
// Commandes concernées par le BAT : PAYÉE, EN COMMANDE (t-shirts commandés en avance, BAT validé ensuite),
// et aussi EN DEVIS / sans statut / statut inconnu (contenu vide, commande saisie à la main)
const APRES_BAT = ['validee', 'enproduction', 'enflocage', 'terminee', 'aexpedier', 'livree'];
const avantBat = statut => !APRES_BAT.includes(key(statut || ''));

module.exports = { creerCommande, validerBat, avantBat, marquerBatAuto, deposerVisuel, deposerBat, statutEst, trouverBat, scannerBat, setBatEnvoye, ajouterBordereau, supprimerBordereau, supprimer, setEspeces, getDossierControle, listArchives, modifier, syncNow, listCommandes, setLivraison, getDossier, fichierAutorise, startSync, normalizePhone, _test: { rowsFromRange, parseContenuMail, excelDate } };
