// ============================================
// IGS GESTION - PLANCHES DTF REÇUES PAR MAIL (remplace le flux Power Automate « IGS - Planche DTF MAIL »)
// Dossier « Planches DTF » de la boîte contact@ :
//  1. analyse du mail par Claude (type, vrai client, format, quantité, confiance) ;
//  2. client retrouvé dans Odoo par son e-mail (sinon l'adresse sert de nom) ;
//  3. pièces jointes PNG / PDF déposées dans Technique/Planches/PLANCHES A IMPRIMER (« Client - P1.png ») ;
//  4. ligne planche créée (ou compteur hebdo augmenté) ; complément : métrage ajouté à la planche en cours du client ;
//  5. nouvelle commande : réponse « Votre planche DTF a bien été reçue ».
// Le devis part ensuite avec la tâche « Devis planche auto ».
// ============================================

const g = require('./graph');
const { supabase } = require('./db');
const planches = require('./planches');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const DOSSIER_MAIL = process.env.PLANCHES_DOSSIER_MAIL || 'Planches DTF';
const MODELE = process.env.PLANCHES_MODELE || 'claude-haiku-4-5';
const statutKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
const texte = html => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim();

// Consigne d'analyse reprise telle quelle du flux Power Automate
const SYSTEME = `Tu analyses des mails recus par un imprimeur DTF textile. Reponds uniquement avec un objet JSON, sans texte autour. Champs: type (nouvelle_commande, complement, question, autre), email_client (le vrai client; si l'expediteur est wetransfer ou un service similaire, prends l'email cite dans le texte), format (metre, A3 ou A4), quantite (nombre), lien_sans_pj (true ou false), confiance (haute, moyenne, basse), resume (une phrase). Regles de quantite: 1) si un metrage est ecrit dans le mail (objet ou texte), prends-le; 56x100 cm ou 100 cm = 1 metre. 2) sinon, si un nombre d'exemplaires est ecrit, quantite = exemplaires, 1 metre chacun. 3) sinon, 1 par fichier joint, ou 1 si seulement un lien. 4) si A3 ou A4 est mentionne, format A3 ou A4 et quantite en nombre de planches. Un mail qui contient au moins une piece jointe image ou PDF (ou un lien de telechargement) est une nouvelle_commande, meme si l'objet et le texte sont vides: une piece jointe seule signifie imprimer 1 exemplaire par fichier. Un mail sans piece jointe, sans lien et sans demande d'impression est de type autre. Un mail qui demande une nouvelle planche sans fichier ni lien est nouvelle_commande avec confiance basse. Les champs format et quantite ne doivent jamais etre null: par defaut format = metre et quantite = nombre de fichiers joints (1 minimum).`;

async function analyser({ expediteur, sujet, nbPj, corps }) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY non configurée');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELE, max_tokens: 600, system: SYSTEME,
      messages: [{ role: 'user', content: `Expediteur: ${expediteur}\nObjet: ${sujet}\nNombre de pieces jointes: ${nbPj}\nTexte:\n${String(corps).slice(0, 3000)}` }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Claude : ${j.error?.message || res.status}`);
  const t = (j.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
  const a = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  a.format = /^a[34]$/i.test(a.format || '') ? String(a.format).toUpperCase() : 'metre';
  a.quantite = Number(a.quantite) > 0 ? Number(a.quantite) : Math.max(1, nbPj);
  return a;
}

// Dossier mail « Planches DTF » (sous la boîte de réception ou à la racine)
let dossierId = null;
async function dossierMail() {
  if (dossierId) return dossierId;
  const u = `/users/${encodeURIComponent(MAILBOX)}`;
  const chercher = async chemin => ((await g.graph(`${u}/${chemin}?$top=200&$select=id,displayName`)).value || []).find(f => f.displayName.trim().toLowerCase() === DOSSIER_MAIL.toLowerCase());
  const f = await chercher('mailFolders/inbox/childFolders') || await chercher('mailFolders');
  if (!f) throw new Error(`Dossier mail « ${DOSSIER_MAIL} » introuvable dans ${MAILBOX}`);
  return (dossierId = f.id);
}

async function reglage(cle, defaut = null) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (supabase) await supabase.from('gestion_reglages').upsert({ cle, valeur, updated_at: new Date().toISOString() });
}

// Dépôt des PJ : « Client - P<n>.ext », n = fichiers du client déjà présents + 1
async function deposer(client, pjs) {
  const { root, D } = await planches.dossierPlanches();
  const dossier = (await g.children(root.id, D)).find(i => i.folder && i.name.trim().toUpperCase() === 'PLANCHES A IMPRIMER');
  if (!dossier) throw new Error('Dossier PLANCHES A IMPRIMER introuvable');
  const noms = [];
  const nomSur = String(client).replace(/[\\/:*?"<>|#%]/g, '').trim();
  for (const pj of pjs) {
    const existants = (await g.children(dossier.id, D)).filter(i => i.file && i.name.includes(nomSur)).length;
    const ext = (pj.name.match(/\.[A-Za-z0-9]+$/) || ['.png'])[0].toLowerCase();
    const it = await g.uploadFile(dossier.id, `${nomSur} - P${existants + 1}${ext}`, Buffer.from(pj.contentBytes, 'base64'), pj.contentType, D);
    noms.push(it.name);
  }
  return noms;
}

// Traitement d'un mail ; renvoie un résumé
async function traiter(m) {
  const u = `/users/${encodeURIComponent(MAILBOX)}/messages/${encodeURIComponent(m.id)}`;
  const expediteur = m.from?.emailAddress?.address || '';
  const att = (await g.graph(`${u}/attachments?$top=50`)).value || [];
  const pjs = att.filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline && /\.(png|pdf)$/i.test(a.name || ''));
  const a = await analyser({ expediteur, sujet: m.subject || '', nbPj: pjs.length, corps: texte(m.body?.content || m.bodyPreview) });
  if (a.type !== 'nouvelle_commande' && a.type !== 'complement') return `ignoré (${a.type}) : ${m.subject || '(sans objet)'}`;

  const emailClient = a.email_client || expediteur;
  let client = emailClient;
  try { const p = await require('./odoo').partnerParEmail(emailClient); if (p) client = p.name; } catch (err) { console.error('Planche mail (Odoo) :', err.message); }

  const fichiers = pjs.length ? await deposer(client, pjs) : [];
  const metres = a.format === 'metre' ? String(a.quantite) : a.format;
  const aAjuster = a.format !== 'metre' && a.quantite > 1;
  const remarque = `${a.lien_sans_pj ? 'LIEN - fichier à télécharger. ' : ''}${aAjuster ? `${a.format} x${a.quantite} - A AJUSTER. ` : ''}${a.resume || ''}`.trim();

  const statut = a.confiance === 'basse' || aAjuster ? 'A VERIFIER' : 'A PREPARER';
  // Complément : fusion dans la dernière planche du client sans devis (A PREPARER / A VERIFIER), comme le script Excel
  if (a.type === 'complement') {
    const { rows } = await planches.listPlanches({ force: true });
    const enCours = rows.filter(p => String(p.client || '').trim().toUpperCase() === String(client).trim().toUpperCase() && !p.n_devis && ['APREPARER', 'AVERIFIER'].includes(statutKey(p.statut))).pop();
    if (enCours) {
      const champs = { remarques: [`⚠ COMPLEMENT : ${metres} - ${remarque}`, enCours.remarques].filter(Boolean).join(' | ').slice(0, 500) };
      if (a.format === 'metre' && !enCours.format && enCours.metres > 0) champs.metres = Math.round((enCours.metres + a.quantite) * 100) / 100;
      else champs.statut = 'A VERIFIER'; // formats mélangés ou A3 + A3 : on ne devine pas
      if (statut === 'A VERIFIER') champs.statut = 'A VERIFIER';
      await planches.modifier(enCours.cle, champs, 'Mail planche');
      return `complément fusionné dans la planche de ${client}${champs.metres ? ` (${champs.metres} m)` : ''}${champs.statut ? ' (A VERIFIER)' : ''}, ${fichiers.length} fichier(s)`;
    }
  }
  const r = await planches.ajouter({ client, metres, statut, remarques: remarque || `Reçue par mail (${fichiers.length} fichier(s))` }, 'Mail planche');

  if (a.type === 'nouvelle_commande') {
    try {
      await g.gPost(`${u}/reply`, {
        message: { toRecipients: [{ emailAddress: { address: emailClient } }] },
        comment: '<p>Bonjour,<br><br>Votre commande est prise en compte, vous recevrez sous peu le devis correspondant.<br><br>Nous revenons vers vous lorsque celle-ci est prête.<br><br>Bien Cordialement,</p><p>IGS CUSTOM BAR</p>',
      });
    } catch (err) { console.error('Planche mail (réponse) :', err.message); }
  }
  return `${r.compteur ? `compteur hebdo de ${client} : ${r.compteur.total} m` : `planche ${client} : ${metres}${a.format === 'metre' ? ' m' : ''} (${statut})`}, ${fichiers.length} fichier(s)`;
}

// Mails du dossier arrivés depuis l'activation de la tâche, pas encore traités
async function relever() {
  const debut = await reglage('planches_mail_depuis', null);
  if (!debut) { await setReglage('planches_mail_depuis', new Date().toISOString()); return 'démarrage : seuls les mails reçus à partir de maintenant seront traités'; }
  const id = await dossierMail();
  const { value = [] } = await g.graph(`/users/${encodeURIComponent(MAILBOX)}/mailFolders/${encodeURIComponent(id)}/messages?$filter=receivedDateTime ge ${new Date(debut).toISOString()}&$orderby=receivedDateTime asc&$top=30&$select=id,subject,from,receivedDateTime,body,bodyPreview,hasAttachments`);
  let l = []; try { l = JSON.parse((await reglage('planches_mails_lus', '[]')) || '[]'); } catch {}
  const lus = new Set(Array.isArray(l) ? l : []);
  let essais = {}; try { essais = JSON.parse((await reglage('planches_mails_essais', '{}')) || '{}') || {}; } catch {}
  const res = [];
  for (const m of value) {
    if (lus.has(m.id)) continue;
    if ((m.from?.emailAddress?.address || '').toLowerCase() === MAILBOX) { lus.add(m.id); continue; }
    try { res.push(await traiter(m)); lus.add(m.id); }
    catch (err) {
      console.error(`Planche mail « ${m.subject} » :`, err.message);
      essais[m.id] = (essais[m.id] || 0) + 1;
      // Après 3 échecs : on arrête (évite de redéposer les fichiers en boucle) et on prévient
      if (essais[m.id] >= 3) {
        lus.add(m.id); delete essais[m.id];
        await g.sendMail(MAILBOX, { to: MAILBOX, subject: `⚠️ Planche DTF non traitée : ${m.subject || '(sans objet)'}`, html: `<p>Le mail de planche de <b>${String(m.from?.emailAddress?.address || '').replace(/</g, '&lt;')}</b> n'a pas pu être traité automatiquement après 3 essais :</p><p>${String(err.message).replace(/</g, '&lt;')}</p><p>À traiter à la main (ligne planche et fichiers).</p>` }).catch(() => {});
      }
      await setReglage('planches_mails_essais', JSON.stringify(essais));
      res.push(`erreur « ${m.subject || ''} » : ${err.message}`);
    }
    await setReglage('planches_mails_lus', JSON.stringify([...lus].slice(-500)));
  }
  return res.length ? res.join(' ; ') : 'aucun nouveau mail';
}

module.exports = { relever, _test: { analyser, traiter, SYSTEME } };
