// ============================================
// IGS GESTION - DÉPÔT DU FORMULAIRE CLIENT (remplace « IGS - Dépôt fichiers commande » et le déclencheur
// de « IGS - Remplissage BDC SEFI »)
// Appelé par formulaire.js juste après l'envoi du mail « Nouvelle commande - … », quand la tâche est activée :
//  1. dossier « N° devis - Client » dans Clients/Commandes (repris s'il existe) ;
//  2. un sous-dossier par pièce jointe, comme avant : « Logo_Avant.png » -> Logo/, « Tailles.xlsx » -> Tailles/, zip -> son nom ;
//  3. ligne de la commande mise à jour (contact, zone, PLANCHE « À FAIRE ») ; elle reste PAYÉE (BAT à faire) ;
//  4. Tailles.xlsx reçu -> bon de commande SEFI rempli.
// Le mail « Nouvelle commande » continue d'arriver dans contact@ (trace).
// ============================================

const g = require('./graph');
const commandes = require('./commandes');

const sansCaracteresInterdits = s => String(s || '').replace(/[\\"*:<>?/|#%]/g, '').replace(/\s+/g, ' ').trim();

async function actif() {
  const { supabase } = require('./db');
  if (!supabase) return false;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'tache_depot_formulaire').maybeSingle();
  return data?.valeur === 'on';
}

// attachments : [{ name, contentType, buffer }] (déjà nommés par formulaire.js)
async function deposer({ devis, client, email, tel, zone, instructions, attachments }) {
  const nomDossier = sansCaracteresInterdits(`${devis} - ${client}`).slice(0, 120);
  const dossier = await commandes.dossierCommande(nomDossier, devis);
  // Sécurité (formulaire public, N° de devis devinable) : si la commande a déjà un contact et que l'envoi vient d'un
  // autre e-mail ET d'un autre téléphone, rien n'est remplacé : les fichiers vont dans « A VERIFIER - date »,
  // pas de BDC SEFI, et l'équipe est prévenue.
  if ((await commandes.contactFormulaireConnu(devis, email, tel).catch(() => null)) === false) {
    const date = new Date().toLocaleString('fr-FR', { timeZone: 'America/Guadeloupe', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[/:]/g, '-').replace(/\s+/g, ' ');
    const q = await g.createFolder(dossier.id, sansCaracteresInterdits(`A VERIFIER - ${date}`));
    for (const a of attachments) await g.uploadFile(q.id, a.name, a.buffer, a.contentType, undefined, 'rename');
    const ligne = await commandes.majFormulaire({ devis, client, email, tel, instructions, zone });
    console.warn(`Dépôt formulaire ${devis} : contact différent de celui de la commande, fichiers mis de côté dans « ${q.name} »`);
    const box = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
    const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    await g.sendMail(box, { to: box, subject: `⚠️ Formulaire ${devis} reçu d'un autre contact : à vérifier`,
      html: `<p>Un formulaire pour la commande <b>${esc(devis)}</b> est arrivé avec un e-mail et un téléphone différents de ceux déjà enregistrés (${esc(email)} / ${esc(tel)}).</p><p>Par sécurité, les fichiers n'ont rien remplacé : ils sont dans le sous-dossier « ${esc(q.name)} » du dossier de la commande, et le bon de commande SEFI n'a pas été modifié. Vérifie auprès du client, puis déplace les fichiers si c'est bien lui.</p>` }).catch(() => {});
    return { dossier: dossier.name, ligne, bdc: null, a_verifier: q.name };
  }
  const sousDossiers = new Map((await g.children(dossier.id)).filter(i => i.folder).map(i => [i.name.toLowerCase(), i]));
  const contenus = new Map(); // sous-dossier -> fichiers déjà présents
  let tailles = null;
  for (const a of attachments) {
    const nomSous = sansCaracteresInterdits(a.name.replace(/_Avant|_Arriere/g, '').replace(/\.[^.]+$/, '')) || 'Fichiers';
    let sd = sousDossiers.get(nomSous.toLowerCase());
    if (!sd) { sd = await g.createFolder(dossier.id, nomSous); sousDossiers.set(nomSous.toLowerCase(), sd); contenus.set(sd.id, []); }
    // Formulaire renvoyé : l'ancien fichier est rangé dans « Ancien » (gardé, mais plus lu), le nouveau prend sa place
    if (!contenus.has(sd.id)) contenus.set(sd.id, await g.children(sd.id).catch(() => []));
    const ancien = contenus.get(sd.id).find(i => i.file && i.name.toLowerCase() === a.name.toLowerCase());
    if (ancien) {
      try {
        let rangement = contenus.get(sd.id).find(i => i.folder && i.name === 'Ancien');
        if (!rangement) { rangement = await g.createFolder(sd.id, 'Ancien'); contenus.get(sd.id).push({ ...rangement, folder: {} }); }
        await g.moveItem(ancien.id, rangement.id);
      } catch (err) { console.error(`Dépôt ${devis} : ancien ${a.name} non rangé`, err.message); }
    }
    const it = await g.uploadFile(sd.id, a.name, a.buffer, a.contentType, undefined, 'replace');
    if (/^tailles\.xlsx$/i.test(a.name)) tailles = it;
  }
  const ligne = await commandes.majFormulaire({ devis, client, email, tel, instructions, zone });
  let bdc = null;
  // BDC SEFI rempli seulement tant que la commande n'est pas passée chez SEFI (PAYÉE / VALIDÉE) : un nouvel envoi du
  // formulaire après la commande ne remet rien dans le bon de commande
  const st = String(commandes.statutDuDevis(devis) || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (tailles && !/^(PAYEE|VALIDEE)$/.test(st)) { bdc = { ok: false, raison: `commande ${st || 'introuvable'} : BDC non rempli (Tailles.xlsx déposé dans le dossier)` }; tailles = null; }
  if (tailles) {
    try { bdc = await require('./sefi').remplirDepuisTailles(devis, client, tailles.id); }
    catch (err) { console.error(`Dépôt ${devis} : BDC SEFI non rempli`, err.message); bdc = { ok: false, raison: err.message }; }
  }
  console.log(`Dépôt formulaire ${devis} : dossier « ${dossier.name} », ${attachments.length} fichier(s), ${ligne}${bdc ? `, BDC : ${bdc.ok ? (bdc.deja ? 'déjà rempli' : bdc.lignes + ' ligne(s)') : bdc.raison}` : ''}`);
  return { dossier: dossier.name, ligne, bdc };
}

// Commande passée EN DEVIS -> PAYÉE (paiement confirmé dans Odoo après le formulaire) : le BDC SEFI est rempli à ce
// moment-là avec le Tailles.xlsx déjà déposé dans le dossier
async function remplirApresPaiement(devis, client) {
  const dossier = await commandes.dossierCommande(sansCaracteresInterdits(`${devis} - ${client}`).slice(0, 120), devis);
  const sd = (await g.children(dossier.id)).find(i => i.folder && /^tailles?$/i.test(i.name.trim()));
  if (!sd) return { ok: false, raison: 'pas de dossier Tailles' };
  const f = (await g.children(sd.id)).find(i => i.file && /^tailles\.xlsx$/i.test(i.name));
  if (!f) return { ok: false, raison: 'pas de Tailles.xlsx' };
  return require('./sefi').remplirDepuisTailles(devis, client, f.id);
}

module.exports = { actif, deposer, remplirApresPaiement };
