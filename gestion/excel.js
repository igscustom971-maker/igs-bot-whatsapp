// ============================================
// IGS GESTION - LECTURE / ÉCRITURE GÉNÉRIQUE D'UN TABLEAU EXCEL (classeur IGS - Gestion - Commandes)
// Écriture cellule par cellule : les formules des autres colonnes restent intactes.
// ============================================

const cfg = require('./config');
const g = require('./graph');

const key = s => g.norm(s).replace(/[^a-z0-9]/g, '');
const colLetter = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colIndex = l => l.split('').reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0) - 1;

let itemId = null;
async function classeur() {
  if (!itemId) itemId = (await g.itemByPath(cfg.EXCEL_PATH)).id;
  return itemId;
}

// { header, idx (en-tête normalisé -> colonne), rows: [{ _row, values }], sheet, startCol, startRow }
async function readTable(table) {
  const id = await classeur();
  let range;
  try { range = await g.tableRange(id, table); }
  catch (err) { if (err.status === 404) itemId = null; throw err; }
  const [header, ...vals] = range.values;
  const idx = {};
  header.forEach((h, i) => { const k = key(h); if (k && idx[k] === undefined) idx[k] = i; });
  const m = String(range.address || '').match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)/);
  if (!m) throw new Error(`Adresse du tableau ${table} illisible : ${range.address}`);
  return { table, header, idx, rows: vals.map((values, _row) => ({ _row, values })), sheet: m[1], startCol: m[2], startRow: Number(m[3]) };
}

function col(t, ...names) {
  for (const n of names) if (t.idx[key(n)] !== undefined) return t.idx[key(n)];
  throw new Error(`Colonne « ${names[0]} » absente du tableau ${t.table}`);
}

async function setCell(t, rowIndex, colName, value) {
  const c = typeof colName === 'number' ? colName : col(t, colName);
  const address = colLetter(colIndex(t.startCol) + c) + (t.startRow + 1 + rowIndex);
  await g.patchRange(await classeur(), t.sheet, address, [[value]]);
}

// Ajoute une ligne : réutilise la première ligne vide (colonne témoin vide), sinon ajoute en bas du tableau
// Nom de champ : "Nom|Autre nom" (premier trouvé) ; préfixe "?" = colonne facultative (ignorée si absente du tableau)
function colSouple(t, f) {
  const facultatif = f.startsWith('?'), noms = f.replace(/^\?/, '').split('|');
  for (const n of noms) if (t.idx[key(n)] !== undefined) return t.idx[key(n)];
  if (facultatif) return null;
  throw new Error(`Colonne « ${noms[0]} » absente du tableau ${t.table} (colonnes : ${t.header.filter(Boolean).join(', ')})`);
}
async function addRow(t, fields, colTemoin) {
  const ct = colSouple(t, colTemoin);
  const cols = Object.entries(fields).map(([f, v]) => [colSouple(t, f), v]).filter(([c]) => c !== null);
  const vide = t.rows.find(r => !String(r.values[ct] ?? '').trim());
  if (vide) {
    for (const [c, v] of cols) await setCell(t, vide._row, c, v);
    return vide._row;
  }
  const ligne = t.header.map(() => null); // null : colonnes calculées laissées à Excel
  for (const [c, v] of cols) ligne[c] = v;
  await g.addTableRow(await classeur(), t.table, ligne);
  return t.rows.length;
}

// Supprime des lignes (index _row), du bas vers le haut. Un tableau garde au moins une ligne :
// si tout part, la 1re ligne est vidée (formules conservées).
async function supprimerLignes(t, indices) {
  if (!indices.length) return 0;
  const tout = indices.length === t.rows.length;
  for (const i of [...indices].sort((a, b) => b - a)) {
    if (tout && i === 0) {
      const r = await g.tableRange(await classeur(), t.table);
      const formules = (r.formulas || [])[1] || [];
      const ligne = formules.map(f => (typeof f === 'string' && f.startsWith('=') ? f : ''));
      const adr = `${t.startCol}${t.startRow + 1}:${colLetter(colIndex(t.startCol) + ligne.length - 1)}${t.startRow + 1}`;
      await g.patchRange(await classeur(), t.sheet, adr, [ligne], undefined, 'formulas');
    } else await g.deleteTableRow(await classeur(), t.table, i);
  }
  return indices.length;
}

module.exports = { readTable, setCell, addRow, col, key, supprimerLignes };
