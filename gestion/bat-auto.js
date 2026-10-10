// ============================================
// IGS GESTION - BAT AUTOMATIQUE (serveur)
// Dès que le formulaire client est dans le dossier d'une commande PAYÉE (tailles + visuels) et qu'il n'y a pas
// encore de BAT, le serveur crée un brouillon « BON A TIRER.pdf » avec les mêmes règles que le générateur
// (bat-commun.js) et les positions par défaut de l'atelier. L'équipe le vérifie, le retouche si besoin, puis l'envoie.
// Images : sharp ; PDF : pdfkit (A4 paysage, même mise en page que le générateur).
// ============================================

const path = require('path');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const BATCOMMUN = require('./bat-commun');
const g = require('./graph');
const { supabase } = require('./db');

const DOSSIER = path.join(__dirname, 'bat-gabarits');
const R = 2; // résolution des mockups (x2, comme le générateur)

// ---------- Gabarits : pixels + mesures ----------
const cacheGabarit = new Map();
async function gabarit(nom) {
  if (!cacheGabarit.has(nom)) cacheGabarit.set(nom, (async () => {
    const { data, info } = await sharp(path.join(DOSSIER, `${nom}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const m = BATCOMMUN.mesurer(nom, info.width, info.height, (x, y) => data[(y * info.width + x) * 4 + 3]);
    return { data, m };
  })());
  return cacheGabarit.get(nom);
}
// Vêtement recoloré : gabarit blanc x couleur (ombres conservées), même transparence
const cacheTeinte = new Map();
async function teinte(nom, hex) {
  const k = `${nom}|${hex}`;
  if (!cacheTeinte.has(k)) {
    const { data, m } = await gabarit(nom);
    const c = String(hex).replace('#', ''), rgb = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) || 0);
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 4) {
      out[i] = data[i] * rgb[0] / 255; out[i + 1] = data[i + 1] * rgb[1] / 255; out[i + 2] = data[i + 2] * rgb[2] / 255; out[i + 3] = data[i + 3];
    }
    cacheTeinte.set(k, out);
    if (cacheTeinte.size > 60) cacheTeinte.delete(cacheTeinte.keys().next().value);
  }
  return cacheTeinte.get(k);
}

// ---------- Logos : fond blanc retiré (JPG) et marges rognées, comme dans le générateur ----------
async function logo(id, sansBlanc) {
  const r = await g.content(id);
  const { data: p, info } = await sharp(Buffer.from(await r.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const coins = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + W - 1) * 4];
  const opaque = !coins.some(i => p[i + 3] < 16);
  const blanc = sansBlanc === true || (sansBlanc === 'auto' && opaque);
  if (blanc) for (let i = 0; i < p.length; i += 4) { const m = Math.min(p[i], p[i + 1], p[i + 2]); if (m > 235) p[i + 3] = 0; else if (m > 215) p[i + 3] = Math.min(p[i + 3], (235 - m) * 12); }
  const transparente = blanc || !opaque;
  const plein = i => transparente ? p[i + 3] > 16 : (p[i + 3] > 16 && Math.min(p[i], p[i + 1], p[i + 2]) < 242);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (plein((y * W + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  let img = sharp(p, { raw: { width: W, height: H, channels: 4 } });
  let w = W, h = H;
  if (x1 >= 0) {
    const left = Math.max(0, x0 - 2), top = Math.max(0, y0 - 2);
    w = Math.min(W - left, x1 - x0 + 5); h = Math.min(H - top, y1 - y0 + 5);
    img = img.extract({ left, top, width: w, height: h });
  }
  return { buf: await img.png().toBuffer(), w, h };
}

// Superpose une image sur une base en la découpant si elle déborde (sharp refuse les débordements)
async function poser(buf, bw, bh, left, top) {
  const meta = await sharp(buf).metadata();
  let x = Math.round(left), y = Math.round(top), ex = 0, ey = 0, w = meta.width, h = meta.height;
  if (x < 0) { ex = -x; w += x; x = 0; }
  if (y < 0) { ey = -y; h += y; y = 0; }
  w = Math.min(w, bw - x); h = Math.min(h, bh - y);
  if (w <= 0 || h <= 0) return null;
  const input = (ex || ey || w !== meta.width || h !== meta.height) ? await sharp(buf).extract({ left: ex, top: ey, width: w, height: h }).toBuffer() : buf;
  return { input, left: x, top: y };
}

async function vignette(BC, page, a, face, logos) {
  const P = BC.PRODUITS[a.produit], nom = face === 'dos' ? P.dos : P.avant;
  const { m } = await gabarit(nom);
  const base = await teinte(nom, a.hex);
  const calques = [];
  for (const pl of BC.placementsDe(page, face, a)) {
    const k = `${pl.image}|${pl.sansBlanc}`;
    if (!logos.has(k)) logos.set(k, await logo(pl.image, pl.sansBlanc).catch(() => null));
    const lg = logos.get(k); if (!lg) continue;
    const r = BC.rectLogo(pl, a, face, m, lg.w, lg.h);
    let buf = await sharp(lg.buf).resize(Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)), { fit: 'fill' }).png().toBuffer();
    if (r.rot) buf = await sharp(buf).rotate(r.rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const md = await sharp(buf).metadata();
    const c = await poser(buf, m.w, m.h, r.x + r.w / 2 - md.width / 2, r.y + r.h / 2 - md.height / 2);
    if (c) calques.push(c);
  }
  const png = await sharp(base, { raw: { width: m.w, height: m.h, channels: 4 } }).composite(calques).png().toBuffer();
  return { buf: png, w: m.w, h: m.h };
}

// Cadre des mockups (1059 x 412 px CSS, en x2) : devant puis dos pour chaque couleur
async function cadre(BC, page, logos) {
  const W = 1059, H = page.legende && page.legende.trim() ? 330 : 412;
  const items = [];
  for (const v of BC.vignettesDe(page)) items.push(await vignette(BC, page, v.a, v.f, logos));
  const cells = BC.grille(items.length, W, H, items.map(it => ({ w: it.w, h: it.h })));
  const calques = [];
  for (let k = 0; k < items.length; k++) {
    const c = cells[k];
    const buf = await sharp(items[k].buf).resize(Math.max(1, Math.round(c.w * R)), Math.max(1, Math.round(c.h * R)), { fit: 'fill' }).png().toBuffer();
    const pz = await poser(buf, W * R, H * R, c.px * R, c.py * R);
    if (pz) calques.push(pz);
  }
  const buf = await sharp({ create: { width: W * R, height: H * R, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(calques).png().toBuffer();
  return { buf, W, H };
}

// ---------- PDF (même mise en page que le générateur : page de 1123 x 794 px CSS) ----------
let logoIgs = { buf: null, at: 0 };
async function chargerLogoIgs() {
  if (logoIgs.buf && Date.now() - logoIgs.at < 24 * 3600e3) return logoIgs.buf;
  try {
    const r = await fetch(process.env.BAT_LOGO_URL || 'https://igscustom.fr/wp-content/uploads/2026/05/IGS-CUSTOM-BAR-LOGO.png');
    if (r.ok) { const buf = await sharp(Buffer.from(await r.arrayBuffer())).png().toBuffer(); const md = await sharp(buf).metadata(); logoIgs = { buf, ratio: md.width / md.height, at: Date.now() }; }
  } catch {}
  return logoIgs.buf ? logoIgs : null;
}

function textePage(doc, p, C, i, n, cadreImg, logoBuf) {
  const NAVY = '#1e1b4b';
  const t = (txt, x, y, o = {}) => doc.font(o.gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.taille || 11).fillColor(o.couleur || NAVY).text(String(txt ?? ''), x, y, { lineBreak: o.largeur != null, width: o.largeur, align: o.align || 'left', lineGap: o.lineGap || 1 });
  // En-tête
  const gh = doc.linearGradient(30, 22, 1093, 22); gh.stop(0, '#fbd5ea').stop(1, '#e9d5ff');
  doc.roundedRect(30, 22, 1063, 68, 6).fill(gh);
  let tx = 48;
  if (logoBuf) { try { doc.image(logoBuf.buf, 48, 35, { height: 42 }); tx = 48 + 42 * (logoBuf.ratio || 1) + 12; } catch {} }
  t('BON A TIRER', tx, 43, { gras: true, taille: 25 });
  const d = new Date().toLocaleDateString('fr-FR', { timeZone: 'America/Guadeloupe' });
  doc.font('Helvetica').fontSize(12);
  const l1 = [['Ref devis : ', C.n_devis || ''], ['   Date du BAT : ', d]], l2 = [['Client : ', C.client || ''], ['   Email : ', C.email || '']];
  for (const [ligne, y] of [[l1, 38], [l2, 59]]) {
    const largeur = ligne.reduce((s, [a, b]) => s + doc.font('Helvetica-Bold').widthOfString(a) + doc.font('Helvetica').widthOfString(b), 0);
    let x = 1075 - largeur;
    for (const [a, b] of ligne) {
      t(a, x, y, { gras: true, taille: 12 }); x += doc.font('Helvetica-Bold').fontSize(12).widthOfString(a);
      t(b, x, y, { taille: 12 }); x += doc.font('Helvetica').fontSize(12).widthOfString(b);
    }
  }
  // Cadre des mockups (fond dégradé sur toute la largeur, bordure verte)
  const gf = doc.linearGradient(30, 102, 1093, 522); gf.stop(0, '#c7b8f0').stop(0.55, '#f6c6df').stop(1, '#f3a6c8');
  doc.roundedRect(30, 102, 1063, 420, 8).fill(gf);
  doc.image(cadreImg.buf, 32, 104 + (416 - cadreImg.H) / 2, { width: cadreImg.W, height: cadreImg.H });
  if (p.legende && p.legende.trim()) t(p.legende, 30, 522 - 70, { gras: true, taille: 24, largeur: 1063, align: 'center', couleur: '#111111' });
  doc.lineWidth(2).roundedRect(30, 102, 1063, 420, 8).stroke('#4c9a2a');
  // Modèle / Couleur / Quantité
  const bw = (1063 - 20) / 3;
  [['MODÈLE', p.modele], ['COULEUR', p.couleur], ['QUANTITÉ', p.quantite]].forEach(([lib, val], k) => {
    const x = 30 + k * (bw + 10);
    doc.roundedRect(x, 532, bw, 44, 6).fill('#f3f3f5');
    t(lib, x + 10, 539, { taille: 9, couleur: '#666666' });
    t(val, x + 10, 552, { gras: true, taille: 13, largeur: bw - 20 });
    doc.lineWidth(1).dash(3, { space: 2 }).moveTo(x + 10, 570).lineTo(x + bw - 10, 570).stroke('#bbbbbb').undash();
  });
  // Tableau
  const cols = [233.9, 233.9, 198.4, 198.4, 198.4], x0 = 30, y0 = 586;
  const hTailles = doc.font('Helvetica').fontSize(11).heightOfString(p.tailles || ' ', { width: cols[1] - 20 });
  const hCorps = Math.max(42, hTailles + 18), hZone = 26, hT = 25 + hCorps + hZone;
  doc.save(); doc.roundedRect(x0, y0, 1063, hT, 6).clip();
  doc.rect(x0, y0, 1063, 25).fill('#1f1b4d');
  let x = x0;
  ['DESCRIPTION', 'TAILLES', 'FACE', 'DOS', 'AUTRES'].forEach((h, k) => { t(h, x + 10, y0 + 8, { gras: true, taille: 10, couleur: '#ffffff' }); x += cols[k]; });
  doc.restore();
  doc.lineWidth(1).roundedRect(x0, y0, 1063, hT, 6).stroke('#dddddd');
  x = x0;
  const yC = y0 + 25 + 9;
  t('ZONE DE FLOCAGE', x + 10, yC, { taille: 11 });
  if (n > 1) t('Visuel : ' + p.titre, x + 10, yC + 14, { gras: true, taille: 11, largeur: cols[0] - 20 });
  x += cols[0];
  [p.tailles, p.face, p.dos, p.autres].forEach((v, k) => { t(v || '', x + 10, yC, { taille: 11, largeur: cols[k + 1] - 20 }); x += cols[k + 1]; });
  t(p.zone || '', x0 + 10, y0 + 25 + hCorps + 6, { gras: true, taille: 11, largeur: 1040 });
  // Pied de page + signature
  t('En validant ce document, le client autorise la mise en production. IGS Custom Bar ne pourra être tenu responsable d\'un résultat insuffisant dû à des visuels de basse résolution ou à des informations incorrectes.', 30, 750, { taille: 8.5, couleur: '#555555', largeur: 800 });
  t('IGS CUSTOM BAR - 62 Rue Louis Vatable, 97110 Pointe-à-Pitre - contact@igscustom.fr - 0690 69 18 63 - SIRET : 99175789900026' + (n > 1 ? ` · Page ${i + 1}/${n}` : ''), 30, 772, { taille: 8.5, couleur: '#555555', largeur: 800 });
  doc.lineWidth(1).roundedRect(873, 748, 220, 34, 4).stroke('#bbbbbb');
  t('Signature client (bon pour accord) :', 879, 752, { taille: 8.5, couleur: '#555555' });
}

async function pdfDepuisPages(BC, pages, C) {
  const logos = new Map(), logoBuf = await chargerLogoIgs();
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false, info: { Title: `BON A TIRER ${C.n_devis || ''}`, Author: 'IGS CUSTOM BAR' } });
  const morceaux = []; doc.on('data', b => morceaux.push(b));
  const fini = new Promise(res => doc.on('end', res));
  for (let i = 0; i < pages.length; i++) {
    const img = await cadre(BC, pages[i], logos);
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
    // Dessin en px CSS mis à l'échelle : on neutralise le saut de page automatique de pdfkit
    doc.page.margins = { top: 0, left: 0, right: 0, bottom: -100000 };
    doc.save(); doc.scale(841.89 / 1123);
    textePage(doc, pages[i], C, i, pages.length, img, logoBuf);
    doc.restore();
  }
  doc.end(); await fini;
  return Buffer.concat(morceaux);
}

async function lirePositions() {
  if (!supabase) return {};
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'bat_positions').maybeSingle();
  try { return data ? JSON.parse(data.valeur) : {}; } catch { return {}; }
}

// ---------- Génération pour une commande ----------
// force = remplacer un BAT existant (bouton manuel) ; sinon jamais d'écrasement
async function generer(cle, { force = false, user = 'BAT automatique' } = {}) {
  const commandes = require('./commandes');
  const { rows } = await commandes.listCommandes();
  const C = rows.find(r => r.cle === cle);
  if (!C) throw new Error('Commande introuvable');
  if (!C.n_devis) throw new Error('Pas de N° de devis');
  const D = await commandes.getDossier(C.n_devis);
  if (!D.trouve) throw new Error('Dossier de la commande introuvable');
  if (!(D.visuels || []).some(v => v.images.length)) throw new Error('Aucun visuel dans le dossier');
  if (D.bat && !force) return { ok: false, raison: 'Un BAT existe déjà' };
  const BC = BATCOMMUN.creer({ positions: await lirePositions() });
  const pages = BC.construirePages(C, D);
  const pdf = await pdfDepuisPages(BC, pages, C);
  try {
    await g.uploadFile(D.dossier.id, 'BON A TIRER.pdf', pdf, 'application/pdf', undefined, force ? 'replace' : 'fail');
  } catch (err) {
    if (/ 409 /.test(err.message) || /nameAlreadyExists/.test(err.message)) return { ok: false, raison: 'Un BAT existe déjà' };
    throw err;
  }
  await commandes.marquerBatAuto(cle, null, user, pages.length);
  console.log(`Gestion BAT auto : ${C.n_devis} (${C.client}) ${pages.length} page(s), ${(pdf.length / 1024).toFixed(0)} Ko`);
  return { ok: true, pages: pages.length };
}

module.exports = { generer, pdfDepuisPages, _test: { logo, vignette, cadre } };
