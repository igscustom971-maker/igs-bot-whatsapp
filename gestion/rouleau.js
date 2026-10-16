// ============================================
// IGS GESTION - ROULEAU DE FILM DTF (100 m) : décompte et alerte de réapprovisionnement
// « Nouveau rouleau posé » (dashboard ou Leïla) remet le compteur à 100 m. Chaque planche qui passe imprimée
// (A RECUPERER, A EXPEDIER, EXPÉDIÉE, LIVRÉE) retire ses mètres du rouleau (A3 ≈ 0,30 m, A4 ≈ 0,21 m).
// Client hebdo : seuls les mètres pas encore décomptés depuis sa dernière facture (son compteur grossit dans la semaine).
// À 20 m restants (réglable), Leïla prévient Ismaël sur WhatsApp qu'il faut commander ; second rappel à 5 m.
// État dans gestion_reglages (clé « rouleau_dtf »).
// ============================================
const { supabase } = require('./db');

const CLE = 'rouleau_dtf';
const IMPRIMEE = ['ARECUPERER', 'AEXPEDIER', 'EXPEDIEE', 'LIVREE'];
const FORMAT_M = { A3: 0.30, A4: 0.21 };
const key = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
let mem = null;

const DEFAUT = () => ({ longueur: 100, pose_le: null, pose_par: null, consomme: 0, ajustement: 0, seuil: 20, seuil_critique: 5, alertes: {}, comptes: {}, journal: [] });
async function lire() {
  if (!supabase) return mem || DEFAUT();
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', CLE).maybeSingle();
  try { return { ...DEFAUT(), ...(data && JSON.parse(data.valeur)) }; } catch { return DEFAUT(); }
}
async function ecrire(e) {
  e.journal = (e.journal || []).slice(-80);
  if (!supabase) { mem = e; return; }
  const { error } = await supabase.from('gestion_reglages').upsert({ cle: CLE, valeur: JSON.stringify(e), updated_at: new Date().toISOString() });
  if (error) throw new Error(`Supabase : ${error.message}`);
}
let file = Promise.resolve();
const enFile = fn => { const p = file.then(fn, fn); file = p.catch(() => {}); return p; };

const restantDe = e => r2(e.longueur - e.consomme + (e.ajustement || 0));
function vue(e) {
  const restant = restantDe(e);
  return {
    actif: !!e.pose_le, longueur: e.longueur, pose_le: e.pose_le, pose_par: e.pose_par, consomme: r2(e.consomme), restant, seuil: e.seuil, seuil_critique: e.seuil_critique,
    pct: e.longueur ? Math.max(0, Math.min(100, Math.round(restant / e.longueur * 100))) : 0,
    niveau: !e.pose_le ? 'inconnu' : restant <= e.seuil_critique ? 'critique' : restant <= e.seuil ? 'commander' : 'ok',
    journal: (e.journal || []).slice().reverse().slice(0, 30),
  };
}
async function etat() { return vue(await lire()); }

async function prevenir(texte) {
  const fn = require('./sefi-mails').fournisseurs.envoyerAIsmael;
  if (fn) { try { await fn(texte, 'Rouleau DTF'); } catch (err) { console.error('Rouleau : message à Ismaël :', err.message); } }
}
// Alertes : une seule fois par rouleau et par seuil
async function verifierAlertes(e) {
  if (!e.pose_le) return;
  const restant = restantDe(e);
  const envoi = async (niveau, texte) => { if (e.alertes[niveau]) return; e.alertes[niveau] = new Date().toISOString(); await prevenir(texte); };
  if (restant <= e.seuil_critique) await envoi('critique', `🚨 *Rouleau DTF presque fini* : il reste environ *${String(restant).replace('.', ',')} m* sur le rouleau. Si le nouveau n'est pas commandé, c'est urgent.`);
  else if (restant <= e.seuil) await envoi('commander', `🧻 *Rouleau DTF* : il reste environ *${String(restant).replace('.', ',')} m* sur ${e.longueur} m. Pense à commander un nouveau rouleau avant qu'il se termine.`);
}

// Appelé quand une planche change de statut (ou de métrage) : décompte des mètres imprimés
async function surPlanche(p, nouveauStatut) {
  if (!p) return null;
  return enFile(async () => {
    const e = await lire();
    if (!e.pose_le) return null;
    const metres = p.format ? (FORMAT_M[String(p.format).toUpperCase()] || 0) : Number(p.metres) || 0;
    const k = p.cle;
    const dejaCompte = Number(e.comptes[k]) || 0;
    // Compteur hebdo remis à zéro (facture du lundi) : on repart de zéro pour ce client
    if (metres < dejaCompte) { e.comptes[k] = 0; await ecrire(e); }
    if (!IMPRIMEE.includes(key(nouveauStatut || p.statut)) || !(metres > 0)) return null;
    const ajout = r2(metres - (Number(e.comptes[k]) || 0));
    if (ajout <= 0) return null;
    e.comptes[k] = metres;
    e.consomme = r2(e.consomme + ajout);
    e.journal.push({ le: new Date().toISOString(), type: 'planche', client: p.client || '', metres: ajout, restant: restantDe(e) });
    await verifierAlertes(e);
    await ecrire(e);
    return { ajout, restant: restantDe(e) };
  });
}

async function nouveauRouleau({ longueur = 100, restant = null } = {}, par = 'Dashboard') {
  return enFile(async () => {
    const e = await lire();
    const L = Number(String(longueur).replace(',', '.')) || 100;
    if (!(L > 0 && L <= 1000)) throw new Error('Longueur invalide');
    const n = { ...DEFAUT(), seuil: e.seuil, seuil_critique: e.seuil_critique, longueur: L, pose_le: new Date().toISOString(), pose_par: par, journal: [...(e.journal || []), { le: new Date().toISOString(), type: 'nouveau', metres: L, par, restant: L }] };
    // Les planches déjà imprimées ne sont pas recomptées sur le nouveau rouleau
    const { rows } = await require('./planches').listPlanches().catch(() => ({ rows: [] }));
    for (const p of rows || []) if (IMPRIMEE.includes(key(p.statut))) n.comptes[p.cle] = p.format ? (FORMAT_M[String(p.format).toUpperCase()] || 0) : Number(p.metres) || 0;
    if (restant != null && restant !== '') { const r = Number(String(restant).replace(',', '.')); if (!(r >= 0 && r <= L)) throw new Error('Restant invalide'); n.ajustement = r2(r - L); }
    await ecrire(n);
    return vue(n);
  });
}

// Correction : « il reste en fait 35 m », ou perte / test (« -2 m de réglages »)
async function corriger({ restant, perte, note } = {}, par = 'Dashboard') {
  return enFile(async () => {
    const e = await lire();
    if (!e.pose_le) throw new Error('Aucun rouleau en cours : indique d\'abord qu\'un rouleau neuf est posé');
    if (restant != null && restant !== '') {
      const r = Number(String(restant).replace(',', '.'));
      if (!(r >= 0 && r <= e.longueur)) throw new Error('Restant invalide');
      const avant = restantDe(e);
      e.ajustement = r2((e.ajustement || 0) + (r - avant));
      e.journal.push({ le: new Date().toISOString(), type: 'correction', metres: r2(r - avant), par, note: note || null, restant: r });
      if (r > e.seuil) delete e.alertes.commander;
      if (r > e.seuil_critique) delete e.alertes.critique;
    } else if (perte) {
      const m = Number(String(perte).replace(',', '.'));
      if (!(m > 0 && m < 100)) throw new Error('Perte invalide');
      e.consomme = r2(e.consomme + m);
      e.journal.push({ le: new Date().toISOString(), type: 'perte', metres: m, par, note: note || null, restant: restantDe(e) });
    } else throw new Error('Rien à corriger');
    await verifierAlertes(e);
    await ecrire(e);
    return vue(e);
  });
}

async function reglerSeuils({ seuil, seuil_critique }) {
  return enFile(async () => {
    const e = await lire();
    if (seuil != null) { const s = Number(String(seuil).replace(',', '.')); if (!(s >= 0 && s < 1000)) throw new Error('Seuil invalide'); e.seuil = s; }
    if (seuil_critique != null) { const s = Number(String(seuil_critique).replace(',', '.')); if (!(s >= 0 && s < 1000)) throw new Error('Seuil invalide'); e.seuil_critique = s; }
    await ecrire(e);
    return vue(e);
  });
}

module.exports = { etat, surPlanche, nouveauRouleau, corriger, reglerSeuils, _test: { IMPRIMEE, FORMAT_M } };
