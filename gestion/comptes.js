// ============================================
// IGS GESTION - COMPTES INDIVIDUELS DES COLLABORATEURS (connexion à distance)
// - Identifiant = prénom sans accent (ex. maureen), mot de passe fixé par l'admin (provisoire),
//   à changer à la première connexion ; réinitialisation par lien envoyé sur l'e-mail perso.
// - Accès identique au compte équipe contact@, page Heures verrouillée sur le nom du collaborateur.
// Mots de passe : scrypt + sel, jamais stockés en clair. Données dans gestion_collaborateurs.
// ============================================

const crypto = require('crypto');
const { supabase } = require('./db');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const RESET_MINUTES = 60;
const MDP_MIN = 8;

const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normIdentifiant = s => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function needDb() { if (!supabase) throw new Error('Supabase non configuré'); }

function hacher(mdp) {
  const sel = crypto.randomBytes(16);
  const h = crypto.scryptSync(mdp, sel, 64);
  return `scrypt$${sel.toString('base64')}$${h.toString('base64')}`;
}
function verifierHash(mdp, stocke) {
  const [algo, sel, h] = String(stocke || '').split('$');
  if (algo !== 'scrypt' || !sel || !h) return false;
  const attendu = Buffer.from(h, 'base64');
  const calcule = crypto.scryptSync(String(mdp), Buffer.from(sel, 'base64'), attendu.length);
  return crypto.timingSafeEqual(attendu, calcule);
}
function controleMdp(mdp) {
  if (String(mdp || '').length < MDP_MIN) throw new Error(`Le mot de passe doit faire au moins ${MDP_MIN} caractères`);
  if (String(mdp).length > 200) throw new Error('Mot de passe trop long');
}

// ---------- Anti-force brute : 8 échecs / 15 min par IP et par identifiant ----------
const echecs = new Map();
function bloque(k) {
  const l = (echecs.get(k) || []).filter(t => Date.now() - t < 15 * 60e3);
  echecs.set(k, l);
  return l.length >= 8;
}
const echec = k => echecs.set(k, [...(echecs.get(k) || []), Date.now()]);

async function parIdentifiant(identifiant) {
  const { data } = await supabase.from('gestion_collaborateurs').select('*').eq('identifiant', identifiant).maybeSingle();
  return data;
}

// Connexion : renvoie la session (sans mot de passe) ou lève une erreur générique
async function connecter(identifiant, mdp, ip) {
  needDb();
  const id = normIdentifiant(identifiant);
  if (bloque(`ip:${ip}`) || bloque(`id:${id}`)) throw new Error('Trop de tentatives : réessaie dans 15 minutes');
  const c = id ? await parIdentifiant(id) : null;
  if (!c || !c.actif || !c.mdp_hash || !verifierHash(mdp, c.mdp_hash)) {
    echec(`ip:${ip}`); echec(`id:${id}`);
    throw new Error('Identifiant ou mot de passe incorrect');
  }
  echecs.delete(`id:${id}`);
  await supabase.from('gestion_collaborateurs').update({ derniere_connexion: new Date().toISOString() }).eq('id', c.id);
  console.log(`Gestion : connexion individuelle ${id} (${c.affichage})`);
  return session(c);
}
const session = c => ({ email: `local:${c.identifiant}`, name: c.affichage, role: 'equipe', collab: c.affichage, cid: c.id, pv: c.mdp_version || 0, provisoire: !!c.mdp_provisoire });

// Contrôle à chaque requête (cache 60 s) : compte toujours actif, mot de passe pas changé depuis
const cacheEtat = new Map();
async function sessionValide(u) {
  if (!supabase || !u.cid) return false;
  const k = u.cid;
  let e = cacheEtat.get(k);
  if (!e || Date.now() - e.at > 60e3) {
    const { data } = await supabase.from('gestion_collaborateurs').select('actif, mdp_hash, mdp_version, mdp_provisoire, affichage').eq('id', u.cid).maybeSingle();
    e = { at: Date.now(), data };
    cacheEtat.set(k, e);
  }
  const d = e.data;
  if (!d || !d.actif || !d.mdp_hash || (d.mdp_version || 0) !== u.pv) return false;
  return { provisoire: !!d.mdp_provisoire, affichage: d.affichage };
}
const oublierCache = id => cacheEtat.delete(id);

// ---------- Admin : identifiant, e-mail perso, mot de passe provisoire ----------
async function definirAcces(id, data) {
  needDb();
  const { data: c } = await supabase.from('gestion_collaborateurs').select('*').eq('id', id).maybeSingle();
  if (!c) throw new Error('Collaborateur introuvable');
  const identifiant = normIdentifiant(data.identifiant || c.identifiant || (c.nom || c.affichage).split(/\s+/)[0]);
  if (!identifiant || identifiant.length < 2) throw new Error('Identifiant invalide (prénom sans accent, ex. maureen)');
  const email = txt(data.email_perso).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail perso invalide');
  const autre = await parIdentifiant(identifiant);
  if (autre && autre.id !== c.id) throw new Error(`L'identifiant « ${identifiant} » est déjà pris par ${autre.affichage}`);
  const maj = { identifiant, email_perso: email || null, updated_at: new Date().toISOString() };
  if (txt(data.mot_de_passe)) {
    controleMdp(data.mot_de_passe);
    Object.assign(maj, { mdp_hash: hacher(data.mot_de_passe), mdp_provisoire: true, mdp_version: (c.mdp_version || 0) + 1, reset_hash: null, reset_expire: null });
  } else if (!c.mdp_hash) throw new Error('Indique un mot de passe provisoire');
  const { error } = await supabase.from('gestion_collaborateurs').update(maj).eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  oublierCache(id);
  return { identifiant };
}

async function retirerAcces(id) {
  needDb();
  const { data: c } = await supabase.from('gestion_collaborateurs').select('mdp_version').eq('id', id).maybeSingle();
  const { error } = await supabase.from('gestion_collaborateurs').update({ mdp_hash: null, mdp_provisoire: false, mdp_version: ((c && c.mdp_version) || 0) + 1, reset_hash: null, reset_expire: null }).eq('id', id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  oublierCache(id);
}

// ---------- Collaborateur : changement du mot de passe ----------
async function changerMdp(cid, actuel, nouveau, confirmation) {
  needDb();
  const { data: c } = await supabase.from('gestion_collaborateurs').select('*').eq('id', cid).maybeSingle();
  if (!c || !c.mdp_hash) throw new Error('Compte introuvable');
  if (!verifierHash(actuel, c.mdp_hash)) throw new Error('Mot de passe actuel incorrect');
  if (nouveau !== confirmation) throw new Error('Les deux nouveaux mots de passe ne sont pas identiques');
  controleMdp(nouveau);
  if (nouveau === actuel) throw new Error('Choisis un mot de passe différent du mot de passe provisoire');
  const version = (c.mdp_version || 0) + 1;
  const { error } = await supabase.from('gestion_collaborateurs').update({ mdp_hash: hacher(nouveau), mdp_provisoire: false, mdp_version: version, reset_hash: null, reset_expire: null }).eq('id', cid);
  if (error) throw new Error(`Supabase : ${error.message}`);
  oublierCache(cid);
  return session({ ...c, mdp_version: version, mdp_provisoire: false });
}

// ---------- Mot de passe oublié : lien par e-mail perso (réponse identique que le compte existe ou non) ----------
async function demanderReset(saisie, baseUrl, ip) {
  needDb();
  if (bloque(`reset:${ip}`)) return;
  echec(`reset:${ip}`); // compte aussi les demandes : 8 par 15 min et par IP
  const s = txt(saisie).toLowerCase();
  let c = null;
  if (s.includes('@')) {
    const { data } = await supabase.from('gestion_collaborateurs').select('*').eq('email_perso', s).limit(1);
    c = data && data[0];
  } else c = await parIdentifiant(normIdentifiant(s));
  if (!c || !c.actif || !c.email_perso || !c.identifiant) { console.log('Gestion : demande de réinitialisation sans suite'); return; }
  const token = crypto.randomBytes(32).toString('base64url');
  await supabase.from('gestion_collaborateurs').update({ reset_hash: sha(token), reset_expire: new Date(Date.now() + RESET_MINUTES * 60e3).toISOString() }).eq('id', c.id);
  const lien = `${baseUrl}/gestion/auth/reset?t=${token}`;
  const html = `<p>Bonjour ${esc(c.affichage.split(' ')[0])},</p>
<p>Tu as demandé à réinitialiser ton mot de passe IGS DASHBOARD (identifiant : <b>${esc(c.identifiant)}</b>).</p>
<p><a href="${lien}" style="display:inline-block;padding:12px 18px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Choisir un nouveau mot de passe</a></p>
<p>Ce lien est valable ${RESET_MINUTES} minutes. Si tu n'es pas à l'origine de cette demande, ignore ce message.</p>
<p style="color:#6b7280;font-size:12px">IGS CUSTOM BAR</p>`;
  await require('./graph').sendMail(MAILBOX, { to: c.email_perso, subject: 'IGS DASHBOARD - Réinitialisation du mot de passe', html });
  console.log(`Gestion : lien de réinitialisation envoyé à ${c.identifiant}`);
}

async function compteDuToken(token) {
  needDb();
  if (!token || token.length < 20) return null;
  const { data } = await supabase.from('gestion_collaborateurs').select('*').eq('reset_hash', sha(token)).maybeSingle();
  if (!data || !data.actif || !data.reset_expire || new Date(data.reset_expire) < new Date()) return null;
  return data;
}

async function reinitialiser(token, nouveau, confirmation) {
  const c = await compteDuToken(token);
  if (!c) throw new Error('Lien expiré ou déjà utilisé : refais une demande');
  if (nouveau !== confirmation) throw new Error('Les deux mots de passe ne sont pas identiques');
  controleMdp(nouveau);
  const version = (c.mdp_version || 0) + 1;
  const { error } = await supabase.from('gestion_collaborateurs').update({ mdp_hash: hacher(nouveau), mdp_provisoire: false, mdp_version: version, reset_hash: null, reset_expire: null }).eq('id', c.id);
  if (error) throw new Error(`Supabase : ${error.message}`);
  oublierCache(c.id);
  return session({ ...c, mdp_version: version, mdp_provisoire: false });
}

module.exports = { connecter, sessionValide, definirAcces, retirerAcces, changerMdp, demanderReset, compteDuToken, reinitialiser, normIdentifiant, MDP_MIN, _test: { hacher, verifierHash } };
