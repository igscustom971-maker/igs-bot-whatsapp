// ============================================
// IGS GESTION - FACTURES FOURNISSEURS (module « Factures », profils technique, commercial et admin)
// Un membre de l'équipe a une facture fournisseur : il ouvre le dashboard (ou l'application sur son téléphone),
// prend la facture en photo (ou choisit le PDF), écrit une courte description et envoie.
//  -> la facture arrive directement dans Odoo (factures fournisseurs, en brouillon) comme avec le bouton « Téléverser »,
//     avec la description en note ; la numérisation d'Odoo la lit si elle est activée ;
//  -> si Odoo ne répond pas : repli par mail à comptabilite@ (objet = la description), pour que rien ne se perde.
// Plusieurs photos d'une même facture (plusieurs pages) sont réunies en un seul PDF.
// ============================================

const sharp = require('sharp');
const { supabase } = require('./db');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const COMPTA = (process.env.FACTURES_FOURNISSEURS_EMAIL || process.env.RELANCE_MAILBOX || 'comptabilite@igscustom.fr').toLowerCase();
const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nomFichier = s => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Facture';
const estImage = f => /^image\//i.test(f.mimetype || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.originalname || '');
const estPdf = f => /pdf/i.test(f.mimetype || '') || /\.pdf$/i.test(f.originalname || '');

// Photo redressée (orientation du téléphone), 2400 px max, JPEG
const photo = buf => sharp(buf, { failOn: 'none', limitInputPixels: 60e6 }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();

// Plusieurs photos -> un PDF (une page A4 par photo)
async function photosEnPdf(images) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const parts = [];
  doc.on('data', c => parts.push(c));
  const fin = new Promise(r => doc.on('end', r));
  for (const b of images) {
    const m = await sharp(b, { limitInputPixels: 60e6 }).metadata();
    const W = 595.28, H = 841.89;
    doc.addPage({ size: 'A4', margin: 0 });
    const k = Math.min(W / m.width, H / m.height);
    doc.image(b, (W - m.width * k) / 2, (H - m.height * k) / 2, { width: m.width * k, height: m.height * k });
  }
  doc.end();
  await fin;
  return Buffer.concat(parts);
}

// Fichiers reçus -> un seul document { nom, mimetype, buffer }
async function preparer(fichiers, description) {
  const f = (fichiers || []).filter(x => x && x.buffer && x.buffer.length);
  if (!f.length) throw new Error('Ajoute la photo ou le fichier de la facture');
  const base = nomFichier(description);
  const pdfs = f.filter(estPdf), images = f.filter(estImage);
  if (pdfs.length + images.length !== f.length) throw new Error('Format non pris en charge : photo (JPEG, PNG) ou PDF uniquement');
  if (pdfs.length > 1 || (pdfs.length && images.length)) throw new Error('Une facture à la fois : un PDF, ou une ou plusieurs photos de la même facture');
  if (pdfs.length) return { nom: `${base}.pdf`, mimetype: 'application/pdf', buffer: pdfs[0].buffer };
  let jpgs;
  try { jpgs = await Promise.all(images.map(i => photo(i.buffer))); }
  catch { throw new Error('Photo illisible : reprends-la ou envoie-la en JPEG'); }
  if (jpgs.length === 1) return { nom: `${base}.jpg`, mimetype: 'image/jpeg', buffer: jpgs[0] };
  return { nom: `${base}.pdf`, mimetype: 'application/pdf', buffer: await photosEnPdf(jpgs) };
}

async function journal(user, details, cle = null) {
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'facture_fournisseur', cle: cle || (details.odoo_id ? `move-${details.odoo_id}` : null), details }).then(() => {}, () => {});
}

// extra (facture de prestation d'un collaborateur, depuis Heures) : { ref, noteExtra, cle, details }
async function envoyer({ fichiers, description }, user, extra = {}) {
  const desc = txt(description).slice(0, 150);
  if (desc.length < 3) throw new Error('Écris une courte description (fournisseur et objet, ex. « SEFI – t-shirts commande 12/10 »)');
  const doc = await preparer(fichiers, desc);
  const date = new Date().toLocaleString('fr-FR', { timeZone: 'America/Guadeloupe', dateStyle: 'short', timeStyle: 'short' });
  const odoo = require('./odoo');
  if (odoo.configured()) {
    try {
      const r = await odoo.importerFactureFournisseur({ ...doc, ref: extra.ref || null, note: `📥 Facture fournisseur importée depuis IGS Dashboard par <b>${esc(user)}</b> le ${esc(date)} : « ${esc(desc)} »${extra.noteExtra ? `<br>${extra.noteExtra}` : ''}` });
      await journal(user, { description: desc, canal: 'odoo', odoo_id: r.id, fournisseur: r.fournisseur, montant_ttc: r.montant_ttc, fichier: doc.nom, ...(extra.details || {}) }, extra.cle);
      console.log(`Factures fournisseurs : « ${desc} » importée dans Odoo par ${user} (facture ${r.id})`);
      return { canal: 'odoo', ...r, description: desc };
    } catch (err) {
      console.error(`Factures fournisseurs : Odoo indisponible pour « ${desc} », repli par mail :`, err.message);
    }
  }
  // Repli : mail à la comptabilité (la boîte comptabilite@ transmet à Odoo)
  await require('./graph').sendMail(MAILBOX, {
    to: COMPTA, subject: desc,
    html: `<p>Facture fournisseur envoyée depuis IGS Dashboard par <b>${esc(user)}</b> le ${esc(date)}.</p><p>Description : ${esc(desc)}</p>${extra.noteExtra ? `<p>${extra.noteExtra}</p>` : ''}`,
    attachments: [{ name: doc.nom, contentType: doc.mimetype, buffer: doc.buffer }],
  });
  await journal(user, { description: desc, canal: 'mail', destinataire: COMPTA, fichier: doc.nom, ...(extra.details || {}) }, extra.cle);
  return { canal: 'mail', destinataire: COMPTA, description: desc };
}

// Derniers envois (les siens, ou tous pour l'admin)
async function recents(user, admin) {
  if (!supabase) return [];
  let q = supabase.from('gestion_actions').select('cree_le, utilisateur, details').eq('action', 'facture_fournisseur').order('cree_le', { ascending: false }).limit(admin ? 30 : 15);
  if (!admin) q = q.eq('utilisateur', user);
  const { data } = await q;
  const odoo = require('./odoo');
  return (data || []).map(a => ({ le: a.cree_le, par: a.utilisateur, description: a.details?.description, canal: a.details?.canal, fournisseur: a.details?.fournisseur || null, lien: admin && a.details?.odoo_id ? odoo.lienOdoo('account.move', a.details.odoo_id) : null }));
}

module.exports = { envoyer, recents, _test: { preparer, photosEnPdf } };
