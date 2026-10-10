// ============================================
// IGS GESTION - MICROSOFT GRAPH (accès application, permission Sites.Selected)
// Lecture SharePoint : tableaux Excel, dossiers clients, BAT, tailles, visuels.
// ============================================

const cfg = require('./config');

const GRAPH = 'https://graph.microsoft.com/v1.0';
let token = { value: null, exp: 0 };
let driveId = null;

async function appToken() {
  if (token.value && Date.now() < token.exp - 60e3) return token.value;
  const res = await fetch(`https://login.microsoftonline.com/${cfg.TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.CLIENT_ID,
      client_secret: cfg.CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Jeton Graph refusé : ${data.error_description || data.error}`);
  token = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function graph(path, { raw = false } = {}) {
  const url = path.startsWith('http') ? path : GRAPH + path;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await appToken()}` } });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Graph ${res.status} sur ${path.slice(0, 160)} : ${txt.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}

const encPath = p => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Bibliothèque "IGS CUSTOM BAR" du site DOCUMENTS
async function getDriveId() {
  if (driveId) return driveId;
  if (!cfg.SITE_ID) throw new Error('SP_SITE_ID non configuré sur Render');
  const { value } = await graph(`/sites/${cfg.SITE_ID}/drives?$select=id,name`);
  const found = value.find(d => norm(d.name) === norm(cfg.LIBRARY_NAME));
  if (!found) throw new Error(`Bibliothèque "${cfg.LIBRARY_NAME}" introuvable. Disponibles : ${value.map(d => d.name).join(', ')}`);
  driveId = found.id;
  return driveId;
}

async function itemByPath(path) {
  return graph(`/drives/${await getDriveId()}/root:/${encPath(path)}`);
}
async function item(id) {
  return graph(`/drives/${await getDriveId()}/items/${encodeURIComponent(id)}?$select=id,name,file,folder,size,parentReference,lastModifiedDateTime,webUrl`);
}

async function children(itemId) {
  let url = `/drives/${await getDriveId()}/items/${encodeURIComponent(itemId)}/children?$top=999&$select=id,name,file,folder,size,lastModifiedDateTime,parentReference,webUrl`;
  const out = [];
  while (url) {
    const page = await graph(url);
    out.push(...page.value);
    url = page['@odata.nextLink'] || null;
  }
  return out;
}

// Plage complète d'un tableau Excel (en-tête + données) : valeurs calculées et formules
async function tableRange(itemId, tableName) {
  const d = await getDriveId();
  return graph(`/drives/${d}/items/${encodeURIComponent(itemId)}/workbook/tables/${encodeURIComponent(tableName)}/range`);
}

async function thumbnailUrl(itemId, size = 'large') {
  try {
    const t = await graph(`/drives/${await getDriveId()}/items/${encodeURIComponent(itemId)}/thumbnails/0/${size}`);
    return t.url || null;
  } catch { return null; }
}

// Contenu brut d'un fichier (Response fetch, à streamer vers le navigateur)
async function content(itemId) {
  return graph(`/drives/${await getDriveId()}/items/${encodeURIComponent(itemId)}/content`, { raw: true });
}

module.exports = { graph, itemByPath, item, children, tableRange, thumbnailUrl, content, norm };
