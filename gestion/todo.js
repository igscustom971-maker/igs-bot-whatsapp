// ============================================
// IGS GESTION - TÂCHES À FAIRE D'ISMAËL (onglet « Mes tâches », admin)
// Liste personnelle : ajoutée depuis le dashboard ou en demandant à Leïla sur WhatsApp (« mets-moi une tâche… »).
// Rangée dans gestion_reglages (clé « ismael_todo »). Chaque matin (7 h 30, heure de Guadeloupe), Leïla envoie à
// Ismaël les tâches du jour et celles en retard.
// ============================================
const { supabase } = require('./db');

const CLE = 'ismael_todo';
let mem = [];
const txt = v => String(v ?? '').trim();
const gp = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guadeloupe' }));
const jour = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aujourdhui = () => jour(gp());

async function lireTout() {
  if (!supabase) return mem;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', CLE).maybeSingle();
  try { const v = data && JSON.parse(data.valeur); return Array.isArray(v) ? v : []; } catch { return []; }
}
async function ecrire(l) {
  if (!supabase) { mem = l; return; }
  const { error } = await supabase.from('gestion_reglages').upsert({ cle: CLE, valeur: JSON.stringify(l), updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase : ${error.message}`);
}
// Une seule écriture à la fois (dashboard et WhatsApp en même temps)
let file = Promise.resolve();
const enFile = fn => { const p = file.then(fn, fn); file = p.catch(() => {}); return p; };

const PRIO = ['haute', 'normale', 'basse'];
function normEcheance(v) {
  const s = txt(v).toLowerCase();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = gp();
  if (s === "aujourd'hui" || s === 'aujourdhui') return jour(d);
  if (s === 'demain') { d.setDate(d.getDate() + 1); return jour(d); }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : d.getFullYear(); return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
const tri = (a, b) => (a.fait ? 1 : 0) - (b.fait ? 1 : 0) || String(a.echeance || '9999').localeCompare(String(b.echeance || '9999')) || PRIO.indexOf(a.priorite) - PRIO.indexOf(b.priorite) || String(a.cree_le).localeCompare(String(b.cree_le));

async function liste({ faites = true } = {}) {
  const l = (await lireTout()).slice().sort(tri);
  const auj = aujourdhui();
  return l.filter(t => faites || !t.fait).map(t => ({ ...t, en_retard: !t.fait && t.echeance && t.echeance < auj, aujourdhui: !t.fait && t.echeance === auj }));
}

async function ajouter({ texte, echeance, priorite, note }, par = 'Dashboard') {
  const t = txt(texte).slice(0, 300);
  if (!t) throw new Error('Écris la tâche');
  const ech = echeance ? normEcheance(echeance) : null;
  if (echeance && !ech) throw new Error('Date invalide (ex. 2026-10-20, 20/10, demain)');
  const item = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, texte: t, note: txt(note).slice(0, 600) || null, echeance: ech, priorite: PRIO.includes(priorite) ? priorite : 'normale', fait: false, cree_le: new Date().toISOString(), par };
  await enFile(async () => { const l = await lireTout(); l.push(item); await ecrire(l.slice(-500)); });
  return item;
}

async function modifier(id, champs, par = 'Dashboard') {
  return enFile(async () => {
    const l = await lireTout();
    const t = l.find(x => x.id === id);
    if (!t) throw new Error('Tâche introuvable');
    if ('texte' in champs) { const v = txt(champs.texte).slice(0, 300); if (!v) throw new Error('Écris la tâche'); t.texte = v; }
    if ('note' in champs) t.note = txt(champs.note).slice(0, 600) || null;
    if ('echeance' in champs) { if (!txt(champs.echeance)) t.echeance = null; else { const e = normEcheance(champs.echeance); if (!e) throw new Error('Date invalide'); t.echeance = e; } }
    if ('priorite' in champs && PRIO.includes(champs.priorite)) t.priorite = champs.priorite;
    if ('fait' in champs) { t.fait = !!champs.fait; t.fait_le = t.fait ? new Date().toISOString() : null; t.fait_par = t.fait ? par : null; }
    // Faites depuis plus de 30 jours : retirées de la liste
    const limite = Date.now() - 30 * 86400e3;
    await ecrire(l.filter(x => !x.fait || !x.fait_le || Date.parse(x.fait_le) > limite));
    return t;
  });
}
async function supprimer(id) {
  return enFile(async () => { const l = await lireTout(); const n = l.filter(x => x.id !== id); if (n.length === l.length) throw new Error('Tâche introuvable'); await ecrire(n); return { ok: true }; });
}

// Pour Leïla : retrouver une tâche par quelques mots (« la tâche Sandae »)
async function trouver(recherche) {
  const s = txt(recherche).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const l = (await lireTout()).filter(t => !t.fait);
  const mots = s.split(/\s+/).filter(w => w.length > 2);
  return l.filter(t => { const x = t.texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); return t.id === recherche || (mots.length && mots.every(w => x.includes(w))); });
}

// Rappel du matin (WhatsApp à Ismaël) : tâches du jour + en retard (+ sans date en haute priorité)
const fdate = s => new Date(`${s}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
async function rappelDuJour() {
  const l = await liste({ faites: false });
  const retard = l.filter(t => t.en_retard), auj = l.filter(t => t.aujourdhui), urgentes = l.filter(t => !t.echeance && t.priorite === 'haute');
  if (!retard.length && !auj.length && !urgentes.length) return null;
  const ligne = t => `• ${t.priorite === 'haute' ? '🔥 ' : ''}${t.texte}${t.en_retard ? ` (prévu ${fdate(t.echeance)})` : ''}`;
  const parts = ['📝 *Tes tâches du jour*'];
  if (auj.length) parts.push(`Aujourd'hui :\n${auj.map(ligne).join('\n')}`);
  if (retard.length) parts.push(`⏰ En retard :\n${retard.map(ligne).join('\n')}`);
  if (urgentes.length) parts.push(`Prioritaires sans date :\n${urgentes.map(ligne).join('\n')}`);
  parts.push(`(${l.length} tâche(s) en cours au total, dans l'onglet « Mes tâches » du dashboard. Réponds « fait : … » pour en cocher une.)`);
  return parts.join('\n\n');
}

module.exports = { liste, ajouter, modifier, supprimer, trouver, rappelDuJour, normEcheance };
