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
  const sousDossiers = new Map((await g.children(dossier.id)).filter(i => i.folder).map(i => [i.name.toLowerCase(), i]));
  let tailles = null;
  for (const a of attachments) {
    const nomSous = sansCaracteresInterdits(a.name.replace(/_Avant|_Arriere/g, '').replace(/\.[^.]+$/, '')) || 'Fichiers';
    let sd = sousDossiers.get(nomSous.toLowerCase());
    if (!sd) { sd = await g.createFolder(dossier.id, nomSous); sousDossiers.set(nomSous.toLowerCase(), sd); }
    const it = await g.uploadFile(sd.id, a.name, a.buffer, a.contentType, undefined, 'replace');
    if (/^tailles\.xlsx$/i.test(a.name)) tailles = it;
  }
  const ligne = await commandes.majFormulaire({ devis, client, email, tel, instructions, zone });
  let bdc = null;
  if (tailles) {
    try { bdc = await require('./sefi').remplirDepuisTailles(devis, client, tailles.id); }
    catch (err) { console.error(`Dépôt ${devis} : BDC SEFI non rempli`, err.message); bdc = { ok: false, raison: err.message }; }
  }
  console.log(`Dépôt formulaire ${devis} : dossier « ${dossier.name} », ${attachments.length} fichier(s), ${ligne}${bdc ? `, BDC : ${bdc.ok ? (bdc.deja ? 'déjà rempli' : bdc.lignes + ' ligne(s)') : bdc.raison}` : ''}`);
  return { dossier: dossier.name, ligne, bdc };
}

module.exports = { actif, deposer };
