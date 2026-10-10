// ============================================
// IGS GESTION - HEURES DES COLLABORATEURS (remplace l'onglet "⏱ Saisie Heures" et "🔒 Paramètres")
// - Équipe : choisit son nom, saisit un ou plusieurs jours ; voit ses heures (semaine en cours et précédentes)
//   sans taux ni montant, et peut supprimer une saisie tant que la semaine n'est pas payée
// - Admin : vue par semaine (lundi -> dimanche), total, taux horaire, montant dû, bouton « Payé »
// - Récap du dimanche soir envoyé par mail à l'admin (remplace le récap Power Automate)
// Données dans Supabase (gestion_heures, gestion_heures_paiements).
// ============================================

const cfg = require('./config');
const g = require('./graph');
const { supabase } = require('./db');
const admin = require('./admin');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const RECAP_TO = (process.env.HEURES_RECAP_TO || cfg.ADMIN_EMAILS[0] || '').split(',').map(s => s.trim()).filter(Boolean);

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function needDb() { if (!supabase) throw new Error('Supabase non configuré'); }

// ---------- Dates (heure de Guadeloupe) ----------
const heureGuadeloupe = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const aujourdhui = () => iso(heureGuadeloupe());
function lundiDe(s) {
  const d = parseIso(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
const plusJours = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
function semaineIso(s) {
  const d0 = parseIso(s);
  const d = new Date(Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { annee: d.getUTCFullYear(), semaine: Math.ceil(((d - y) / 86400000 + 1) / 7) };
}
const codeSemaine = lundi => { const s = semaineIso(lundi); return `${s.annee}-S${String(s.semaine).padStart(2, '0')}`; };
const fh = min => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
const eur = n => `${(Math.round(n * 100) / 100).toFixed(2).replace('.', ',')} €`;
const fdate = s => { const d = parseIso(s); return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }); };

// "04:30", "4h30", "4h", "4,5", "4.5", "4" -> minutes
function parseDuree(v) {
  const s = txt(v).toLowerCase().replace(/\s/g, '');
  let m = s.match(/^(\d{1,2})[:h](\d{1,2})?$/);
  let min = null;
  if (m) min = Number(m[1]) * 60 + Number(m[2] || 0);
  else if ((m = s.match(/^(\d{1,2})(?:[.,](\d{1,2}))?$/))) min = Math.round(Number(`${m[1]}.${m[2] || 0}`) * 60);
  if (min === null || !(min > 0) || min > 16 * 60 || (m && m[2] && /[:h]/.test(s) && Number(m[2]) > 59)) {
    throw new Error('Durée invalide : écris par exemple 04:30, 4h30 ou 4,5');
  }
  return min;
}

async function equipe(tous = true) {
  return admin.collaborateurs({ admin: true, tous });
}

// ---------- Saisie (équipe et admin) : un ou plusieurs jours d'un coup (rattrapage de retard) ----------
async function verifierCollab(nom) {
  const collaborateur = txt(nom);
  const actifs = (await equipe(false)).map(c => c.affichage);
  if (!actifs.includes(collaborateur)) throw new Error('Choisis ton nom dans la liste');
  return collaborateur;
}

async function saisir(data, user, role) {
  needDb();
  const collaborateur = await verifierCollab(data.collaborateur);
  const brutes = Array.isArray(data.lignes) ? data.lignes : [{ jour: data.jour, duree: data.duree, remarque: data.remarque }];
  if (!brutes.length) throw new Error('Aucune journée à enregistrer');
  if (brutes.length > 31) throw new Error('31 journées maximum par saisie');
  const lignes = brutes.map((l, i) => {
    const n = brutes.length > 1 ? `Ligne ${i + 1} : ` : '';
    const jour = txt(l.jour) || aujourdhui();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new Error(`${n}date invalide`);
    if (jour > aujourdhui()) throw new Error(`${n}impossible de saisir des heures pour une date future`);
    if (role !== 'admin' && jour < plusJours(aujourdhui(), -31)) throw new Error(`${n}date trop ancienne (plus de 31 jours) : demande à Ismaël`);
    let minutes;
    try { minutes = parseDuree(l.duree); } catch (err) { throw new Error(n + err.message); }
    return { collaborateur, jour, minutes, remarque: txt(l.remarque).slice(0, 200) || null, saisi_par: user };
  });
  const jours = lignes.map(l => l.jour);
  const doublon = jours.find((j, i) => jours.indexOf(j) !== i);
  if (doublon) throw new Error(`Le ${fdate(doublon)} est saisi deux fois : additionne les heures sur une seule ligne`);
  const { data: deja } = await supabase.from('gestion_heures').select('jour, minutes').eq('collaborateur', collaborateur).in('jour', jours);
  if (deja && deja.length) {
    throw new Error(`Déjà saisi pour ${collaborateur} : ${deja.map(d => `${fdate(d.jour)} (${fh(d.minutes)})`).join(', ')}. Supprime l'ancienne saisie pour la remplacer.`);
  }
  const { data: ins, error } = await supabase.from('gestion_heures').insert(lignes).select();
  if (error) throw new Error(`Supabase : ${error.message}`);
  console.log(`Gestion heures : ${collaborateur} ${lignes.map(l => `${l.jour} ${fh(l.minutes)}`).join(', ')} (saisi par ${user})`);
  return { collaborateur, lignes: ins.map(l => ({ id: l.id, jour: l.jour, minutes: l.minutes, duree: fh(l.minutes) })), total: fh(lignes.reduce((t, l) => t + l.minutes, 0)) };
}

// Heures d'un collaborateur (sans taux ni montant) : semaine choisie + résumé des 8 dernières semaines
async function mesHeures(nom, lundiDemande) {
  needDb();
  const collaborateur = await verifierCollab(nom);
  const lundi = lundiDe(/^\d{4}-\d{2}-\d{2}$/.test(lundiDemande || '') ? lundiDemande : aujourdhui());
  const depuis = plusJours(lundiDe(aujourdhui()), -7 * 8);
  const debut = lundi < depuis ? lundi : depuis;
  const { data, error } = await supabase.from('gestion_heures').select('id, jour, minutes, remarque, paiement_id')
    .eq('collaborateur', collaborateur).gte('jour', debut).order('jour');
  if (error) throw new Error(`Supabase : ${error.message}`);
  const semaineLignes = data.filter(l => l.jour >= lundi && l.jour <= plusJours(lundi, 6));
  const map = new Map();
  for (const l of data.filter(x => x.jour >= depuis)) {
    const k = lundiDe(l.jour);
    if (!map.has(k)) map.set(k, { lundi: k, numero: semaineIso(k).semaine, minutes: 0, jours: 0, payees: 0 });
    const s = map.get(k); s.minutes += l.minutes; s.jours++; if (l.paiement_id) s.payees++;
  }
  return {
    collaborateur, lundi, dimanche: plusJours(lundi, 6), numero: semaineIso(lundi).semaine,
    lignes: semaineLignes.map(l => ({ id: l.id, jour: l.jour, duree: fh(l.minutes), minutes: l.minutes, remarque: l.remarque, payee: !!l.paiement_id })),
    total: fh(semaineLignes.reduce((t, l) => t + l.minutes, 0)),
    semaines: [...map.values()].sort((a, b) => b.lundi.localeCompare(a.lundi)).map(s => ({ ...s, duree: fh(s.minutes), payee: s.payees === s.jours })),
  };
}

async function ligne(id) {
  const { data, error } = await supabase.from('gestion_heures').select('*').eq('id', id).single();
  if (error || !data) throw new Error('Saisie introuvable');
  return data;
}

// Suppression d'une saisie tant que la semaine n'est pas payée (équipe et admin)
async function supprimer(id, user, role, collab = null) {
  needDb();
  const l = await ligne(id);
  if (collab && l.collaborateur !== collab) throw new Error('Tu ne peux supprimer que tes propres heures');
  if (l.paiement_id) throw new Error('Semaine déjà payée : annule d\'abord le paiement');
  const { error } = await supabase.from('gestion_heures').delete().eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'heures_supprimees', cle: String(id), details: l });
  return { ok: true };
}

async function modifier(id, data, user) {
  needDb();
  const l = await ligne(id);
  if (l.paiement_id) throw new Error('Semaine déjà payée : annule d\'abord le paiement');
  const maj = {};
  if (data.duree !== undefined) maj.minutes = parseDuree(data.duree);
  if (data.remarque !== undefined) maj.remarque = txt(data.remarque).slice(0, 200) || null;
  if (data.jour !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.jour) || data.jour > aujourdhui()) throw new Error('Date invalide');
    maj.jour = data.jour;
  }
  if (!Object.keys(maj).length) throw new Error('Rien à modifier');
  const { error } = await supabase.from('gestion_heures').update(maj).eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'heures_modifiees', cle: String(id), details: { avant: l, apres: maj } });
  return { ok: true };
}

// ---------- Vue admin ----------
async function semaine(lundiDemande) {
  needDb();
  const lundi = lundiDe(/^\d{4}-\d{2}-\d{2}$/.test(lundiDemande || '') ? lundiDemande : aujourdhui());
  const dimanche = plusJours(lundi, 6);
  const [collabs, { data: lignes, error }, { data: paiements }, { data: impayees }, { data: historique }] = await Promise.all([
    equipe(true),
    supabase.from('gestion_heures').select('*').gte('jour', lundi).lte('jour', dimanche).order('jour'),
    supabase.from('gestion_heures_paiements').select('*').eq('semaine', codeSemaine(lundi)),
    supabase.from('gestion_heures').select('collaborateur, jour, minutes').is('paiement_id', null).lt('jour', lundi).order('jour'),
    supabase.from('gestion_heures_paiements').select('*').order('paye_le', { ascending: false }).limit(30),
  ]);
  if (error) throw new Error(`Supabase : ${error.message}`);
  const taux = new Map(collabs.map(c => [c.affichage, c.taux_horaire == null ? null : Number(c.taux_horaire)]));

  const noms = [...new Set(collabs.filter(c => c.actif).map(c => c.affichage).concat(lignes.map(l => l.collaborateur)))];
  const parCollab = noms.map(nom => {
    const ls = lignes.filter(l => l.collaborateur === nom);
    const minutes = ls.reduce((t, l) => t + l.minutes, 0);
    const p = (paiements || []).find(x => x.collaborateur === nom);
    const t = taux.get(nom);
    return {
      collaborateur: nom, taux: t, minutes, duree: fh(minutes),
      montant: t == null ? null : Math.round(minutes / 60 * t * 100) / 100,
      lignes: ls.map(l => ({ ...l, duree: fh(l.minutes) })),
      paiement: p || null,
      nonPayees: ls.filter(l => !l.paiement_id).length,
    };
  }).filter(c => c.lignes.length || c.paiement || collabs.find(x => x.affichage === c.collaborateur && x.actif && x.taux_horaire != null));

  // Semaines précédentes avec des heures non payées
  const map = new Map();
  for (const l of impayees || []) {
    const k = `${l.collaborateur}|${lundiDe(l.jour)}`;
    if (!map.has(k)) map.set(k, { collaborateur: l.collaborateur, lundi: lundiDe(l.jour), minutes: 0 });
    map.get(k).minutes += l.minutes;
  }
  const aPayer = [...map.values()].map(x => {
    const t = taux.get(x.collaborateur);
    return { ...x, semaine: codeSemaine(x.lundi), duree: fh(x.minutes), montant: t == null ? null : Math.round(x.minutes / 60 * t * 100) / 100 };
  });

  return {
    lundi, dimanche, semaine: codeSemaine(lundi), numero: semaineIso(lundi).semaine,
    collaborateurs: parCollab,
    total: { minutes: parCollab.reduce((t, c) => t + c.minutes, 0), montant: Math.round(parCollab.reduce((t, c) => t + (c.montant || 0), 0) * 100) / 100 },
    aPayer, historique: historique || [],
    recapAuto: (await getReglage('heures_recap_auto', 'on')) === 'on',
    importFait: !!(await getReglage('heures_import_excel')),
    recapA: RECAP_TO,
  };
}

async function payer(collaborateur, lundiDemande, user) {
  needDb();
  const lundi = lundiDe(lundiDemande);
  const { data: ls, error } = await supabase.from('gestion_heures').select('*')
    .eq('collaborateur', collaborateur).gte('jour', lundi).lte('jour', plusJours(lundi, 6)).is('paiement_id', null);
  if (error) throw new Error(`Supabase : ${error.message}`);
  if (!ls.length) throw new Error('Aucune heure non payée pour cette semaine');
  const c = (await equipe(true)).find(x => x.affichage === collaborateur);
  const taux = c && c.taux_horaire != null ? Number(c.taux_horaire) : null;
  if (taux === null) throw new Error(`Pas de taux horaire pour ${collaborateur} : renseigne-le dans Admin`);
  const minutes = ls.reduce((t, l) => t + l.minutes, 0);
  const montant = Math.round(minutes / 60 * taux * 100) / 100;
  const { data: p, error: e2 } = await supabase.from('gestion_heures_paiements').insert({
    collaborateur, semaine: codeSemaine(lundi), debut: lundi, fin: plusJours(lundi, 6), minutes, taux, montant, paye_par: user,
  }).select().single();
  if (e2) throw new Error(`Supabase : ${e2.message}`);
  const { error: e3 } = await supabase.from('gestion_heures').update({ paiement_id: p.id }).in('id', ls.map(l => l.id));
  if (e3) throw new Error(`Supabase : ${e3.message}`);
  console.log(`Gestion heures : ${collaborateur} ${codeSemaine(lundi)} payé ${eur(montant)} (${user})`);
  return { paiement: p };
}

async function annulerPaiement(id, user) {
  needDb();
  const { data: p } = await supabase.from('gestion_heures_paiements').select('*').eq('id', id).single();
  if (!p) throw new Error('Paiement introuvable');
  await supabase.from('gestion_heures').update({ paiement_id: null }).eq('paiement_id', id);
  const { error } = await supabase.from('gestion_heures_paiements').delete().eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'heures_paiement_annule', cle: String(id), details: p });
  return { ok: true };
}

// ---------- Récap du dimanche (mail à l'admin) ----------
async function getReglage(cle, defaut = null) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (!supabase) return;
  const { error } = await supabase.from('gestion_reglages').upsert({ cle, valeur, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase : ${error.message}`);
}

async function envoyerRecap(lundiDemande, user = 'Récap automatique') {
  const s = await semaine(lundiDemande);
  if (!RECAP_TO.length) throw new Error('Aucun destinataire pour le récap (HEURES_RECAP_TO)');
  const lignes = s.collaborateurs.filter(c => c.minutes > 0);
  const html = `<h2>Heures de la semaine ${s.numero}</h2>
<p>Du ${fdate(s.lundi)} au ${fdate(s.dimanche)}</p>
${lignes.length ? `<table cellpadding="8" style="border-collapse:collapse;border:1px solid #ddd">
<tr style="background:#f3f4f6"><th align="left">Collaborateur</th><th align="left">Détail</th><th align="right">Heures</th><th align="right">Taux</th><th align="right">Montant dû</th><th align="left">Statut</th></tr>
${lignes.map(c => `<tr style="border-top:1px solid #ddd"><td><b>${esc(c.collaborateur)}</b></td><td>${c.lignes.map(l => `${esc(fdate(l.jour))} : ${l.duree}`).join('<br>')}</td><td align="right"><b>${c.duree}</b></td><td align="right">${c.taux == null ? '—' : eur(c.taux) + '/h'}</td><td align="right"><b>${c.montant == null ? '—' : eur(c.montant)}</b></td><td>${c.paiement ? 'Payé' : 'À payer'}</td></tr>`).join('')}
<tr style="border-top:2px solid #111"><td colspan="2"><b>TOTAL</b></td><td align="right"><b>${fh(s.total.minutes)}</b></td><td></td><td align="right"><b>${eur(s.total.montant)}</b></td><td></td></tr>
</table>` : '<p>Aucune heure saisie cette semaine.</p>'}
${s.aPayer.length ? `<h3>Semaines précédentes encore à payer</h3><ul>${s.aPayer.map(x => `<li>${esc(x.collaborateur)} · semaine ${esc(x.semaine.split('-S')[1])} : ${x.duree}${x.montant == null ? '' : ` = ${eur(x.montant)}`}</li>`).join('')}</ul>` : ''}
<p style="color:#6b7280;font-size:12px">Envoyé par IGS DASHBOARD · ${esc(user)}</p>`;
  await g.sendMail(MAILBOX, { to: RECAP_TO, subject: `Heures semaine ${s.numero} - ${fh(s.total.minutes)} - ${eur(s.total.montant)} à payer`, html });
  console.log(`Gestion heures : récap ${s.semaine} envoyé à ${RECAP_TO.join(', ')}`);
  return { ok: true, semaine: s.semaine, a: RECAP_TO };
}

let recapEnCours = false;
async function recapSiDu() {
  if (recapEnCours || !supabase) return;
  const now = heureGuadeloupe();
  if (now.getDay() !== 0 || now.getHours() < 20) return; // dimanche à partir de 20h
  if ((await getReglage('heures_recap_auto', 'on')) !== 'on') return;
  const lundi = lundiDe(iso(now));
  const marque = codeSemaine(lundi);
  if ((await getReglage('heures_recap_derniere')) === marque) return;
  recapEnCours = true;
  try {
    await setReglage('heures_recap_derniere', marque); // jamais deux fois la même semaine
    await envoyerRecap(lundi);
  } catch (err) {
    console.error('Gestion heures : récap automatique', err.message);
  } finally {
    recapEnCours = false;
  }
}

// ---------- Reprise de l'onglet "⏱ Saisie Heures" (tableau Tableau5) ----------
async function importerExcel(user) {
  needDb();
  const t = await require('./excel').readTable(process.env.SP_TABLE_HEURES || 'Tableau5');
  const ic = t.idx.collaborateur, id = t.idx.date, ih = t.idx.heurestravaillees ?? t.idx.heures;
  if (ic === undefined || id === undefined || ih === undefined) throw new Error(`Colonnes inattendues : ${t.header.join(' | ')}`);
  const serieVersIso = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(n)) * 86400000); return d.toISOString().slice(0, 10); };
  const { data: existants } = await supabase.from('gestion_heures').select('collaborateur, jour');
  const deja = new Set((existants || []).map(e => `${e.collaborateur}|${e.jour}`));
  const nouvelles = [];
  for (const r of t.rows) {
    const nom = txt(r.values[ic]), date = r.values[id], h = Number(r.values[ih]);
    if (!nom || !date || !(h > 0)) continue;
    const jour = typeof date === 'number' ? serieVersIso(date) : (String(date).match(/^\d{4}-\d{2}-\d{2}/) || [])[0];
    if (!jour) continue;
    const minutes = Math.round(h * 24 * 60);
    if (deja.has(`${nom}|${jour}`)) continue;
    deja.add(`${nom}|${jour}`);
    nouvelles.push({ collaborateur: nom, jour, minutes, remarque: 'Repris de l\'Excel', saisi_par: user });
  }
  if (nouvelles.length) {
    const { error } = await supabase.from('gestion_heures').insert(nouvelles);
    if (error) throw new Error(`Supabase : ${error.message}`);
  }
  await setReglage('heures_import_excel', new Date().toISOString());
  return { importees: nouvelles.length };
}

function startRecap() {
  setInterval(() => recapSiDu().catch(() => {}), 10 * 60e3);
}

module.exports = { mesHeures, saisir, supprimer, modifier, semaine, payer, annulerPaiement, envoyerRecap, recapSiDu, importerExcel, setReglage, startRecap, _test: { parseDuree, lundiDe, codeSemaine } };
