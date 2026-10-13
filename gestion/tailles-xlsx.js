// ============================================
// IGS GESTION - Écriture du tableau « LignesCommande » d'un Tailles.xlsx directement dans le fichier (XML),
// sans passer par Excel Online : utilisé quand Graph refuse d'ouvrir le classeur (« MetroFileFormatMismatch »,
// « unsupportedWorkbook » : fonctionnalités non prises en charge par Excel pour le web).
// ============================================
const JSZip = require('jszip');

const escXml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colI = l => l.split('').reduce((t, ch) => t * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colL = n => { let s = ''; n++; while (n) { const q = (n - 1) % 26; s = String.fromCharCode(65 + q) + s; n = Math.floor((n - 1) / 26); } return s; };
const key = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// lignes : [{ type, couleur, quantite, taille, coupe, visuel, remarques }]
async function ecrireLignes(buf, lignes, nomTable = 'LignesCommande') {
  const zip = await JSZip.loadAsync(buf);
  // 1. Le tableau et ses colonnes
  const tables = Object.keys(zip.files).filter(f => /^xl\/tables\/table\d+\.xml$/.test(f));
  let tablePath = null, tableXml = null;
  for (const t of tables) {
    const x = await zip.file(t).async('string');
    if (new RegExp(`(?:name|displayName)="${nomTable}"`, 'i').test(x)) { tablePath = t; tableXml = x; break; }
  }
  if (!tableXml) throw new Error(`tableau ${nomTable} introuvable dans le modèle`);
  const [, ref] = tableXml.match(/\sref="([A-Z]+\d+:[A-Z]+\d+)"/) || [];
  if (!ref) throw new Error('plage du tableau introuvable');
  const [, c0, r0, , r1] = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  const noms = [...tableXml.matchAll(/<tableColumn\b[^>]*\sname="([^"]*)"/g)].map(m => m[1]);
  const idx = {}; noms.forEach((n, i) => { idx[key(n)] = colI(c0) + i; });
  const ordre = [['typedeproduit', 'type'], ['couleur', 'couleur'], ['qte', 'quantite'], ['taille', 'taille'], ['coupe', 'coupe'], ['nomduvisueltexte', 'visuel'], ['remarques', 'remarques']];
  const cols = ordre.map(([h]) => idx[h]);
  if (cols.some(c => c === undefined)) throw new Error(`colonnes inattendues (${noms.join(' | ')})`);
  const premiere = Number(r0) + 1, derniere = Number(r1);
  if (lignes.length > derniere - premiere + 1) throw new Error(`trop de lignes (${lignes.length}) pour le modèle (${derniere - premiere + 1} max)`);
  // 2. La feuille qui contient ce tableau
  const tableFichier = tablePath.split('/').pop();
  let feuillePath = null;
  for (const f of Object.keys(zip.files).filter(f => /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(f))) {
    if ((await zip.file(f).async('string')).includes(tableFichier)) { feuillePath = f.replace('_rels/', '').replace(/\.rels$/, ''); break; }
  }
  if (!feuillePath || !zip.file(feuillePath)) throw new Error('feuille du tableau introuvable');
  let xml = await zip.file(feuillePath).async('string');
  // 3. Cellules écrites (texte en ligne, quantité en nombre) ; cellules existantes remplacées, style conservé
  const cellule = (ref, v, style) => {
    const s = style ? ` s="${style}"` : '';
    if (v === '' || v == null) return `<c r="${ref}"${s}/>`;
    if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
  };
  for (let r = premiere; r <= derniere; r++) {
    const l = lignes[r - premiere];
    const valeurs = {};
    ordre.forEach(([, f], j) => { const v = l ? l[f] : ''; valeurs[cols[j]] = f === 'quantite' && l ? Number(v) || 0 : (v ?? ''); });
    const reRow = new RegExp(`<row\\b[^>]*\\br="${r}"[^>]*?(?:/>|>([\\s\\S]*?)</row>)`);
    const m = xml.match(reRow);
    if (!m) {
      if (!l) continue;
      const cells = Object.keys(valeurs).map(Number).sort((a, b) => a - b).map(c => cellule(colL(c) + r, valeurs[c])).join('');
      // insérée à sa place (lignes triées)
      const apres = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].find(x => Number(x[1]) > r);
      const nouvelle = `<row r="${r}">${cells}</row>`;
      xml = apres ? xml.slice(0, apres.index) + nouvelle + xml.slice(apres.index) : xml.replace('</sheetData>', nouvelle + '</sheetData>');
      continue;
    }
    let contenu = m[1] || '';
    for (const c of Object.keys(valeurs).map(Number)) {
      const refC = colL(c) + r;
      const reC = new RegExp(`<c\\b[^>]*\\br="${refC}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      const ex = contenu.match(reC);
      const style = ex ? (ex[0].match(/\ss="(\d+)"/) || [])[1] : null;
      const neuve = cellule(refC, valeurs[c], style);
      if (ex) contenu = contenu.replace(reC, neuve);
      else {
        // insertion dans l'ordre des colonnes
        const suivante = [...contenu.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)].find(x => colI(x[1]) > c);
        contenu = suivante ? contenu.slice(0, suivante.index) + neuve + contenu.slice(suivante.index) : contenu + neuve;
      }
    }
    const ouverture = m[0].match(/^<row\b[^>]*?(?=\/?>)/)[0];
    xml = xml.replace(m[0], `${ouverture}>${contenu}</row>`);
  }
  zip.file(feuillePath, xml);
  // Formules recalculées à l'ouverture (récapitulatifs du modèle)
  const wbPath = 'xl/workbook.xml';
  if (zip.file(wbPath)) {
    let wb = await zip.file(wbPath).async('string');
    if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)\/>/, (t, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
    else wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    zip.file(wbPath, wb);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Lecture locale d'un tableau (en-tête + lignes, valeurs calculées en cache) : bien plus rapide qu'Excel Online
async function lireTableau(buf, nomTable = 'LignesCommande') {
  const zip = await JSZip.loadAsync(buf);
  const tables = Object.keys(zip.files).filter(f => /^xl\/tables\/table\d+\.xml$/.test(f));
  let tablePath = null, tableXml = null;
  for (const t of tables) {
    const x = await zip.file(t).async('string');
    if (new RegExp(`(?:name|displayName)="${nomTable}"`, 'i').test(x)) { tablePath = t; tableXml = x; break; }
  }
  if (!tableXml) throw new Error(`tableau ${nomTable} introuvable`);
  const [, c0, r0, c1, r1] = (tableXml.match(/\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/) || []);
  if (!c0) throw new Error('plage du tableau introuvable');
  const tableFichier = tablePath.split('/').pop();
  let feuillePath = null;
  for (const f of Object.keys(zip.files).filter(f => /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(f))) {
    if ((await zip.file(f).async('string')).includes(tableFichier)) { feuillePath = f.replace('_rels/', '').replace(/\.rels$/, ''); break; }
  }
  if (!feuillePath || !zip.file(feuillePath)) throw new Error('feuille du tableau introuvable');
  const dec = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (t, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
  const textes = x => [...String(x).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => dec(m[1])).join('');
  const ss = zip.file('xl/sharedStrings.xml') ? [...(await zip.file('xl/sharedStrings.xml').async('string')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textes(m[1])) : [];
  const xml = await zip.file(feuillePath).async('string');
  const a = colI(c0), b = colI(c1), debut = Number(r0), fin = Number(r1);
  const lignes = [];
  for (let r = debut; r <= fin; r++) lignes.push(new Array(b - a + 1).fill(''));
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = (m[1].match(/\br="([A-Z]+)(\d+)"/) || []);
    if (!ref[1]) continue;
    const c = colI(ref[1]), r = Number(ref[2]);
    if (r < debut || r > fin || c < a || c > b) continue;
    const t = (m[1].match(/\bt="(\w+)"/) || [])[1];
    const corps = m[2] || '';
    const v = (corps.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    let val = '';
    if (t === 's') val = ss[Number(v)] ?? '';
    else if (t === 'inlineStr') val = textes(corps);
    else if (t === 'str' || t === 'e') val = v != null ? dec(v) : '';
    else if (t === 'b') val = v === '1';
    else if (v != null && v !== '') val = Number(v);
    lignes[r - debut][c - a] = val;
  }
  return lignes;
}

module.exports = { ecrireLignes, lireTableau };
