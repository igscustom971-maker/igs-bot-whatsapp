// ============================================
// IGS GESTION - MICROSOFT GRAPH (accès application, permission Sites.Selected)
// Lecture SharePoint : tableaux Excel, dossiers clients, BAT, tailles, visuels.
// ============================================

const cfg = require('./config');

const GRAPH = 'https://graph.microsoft.com/v1.0';
let token = { value: null, exp: 0 };

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

// Bibliothèques du site DOCUMENTS : "IGS CUSTOM BAR" par défaut, ou une autre par son nom
// (nom introuvable -> bibliothèque par défaut du site, "Documents partagés")
const driveIds = new Map();
async function getDriveId(name = cfg.LIBRARY_NAME) {
  if (driveIds.has(name)) return driveIds.get(name);
  if (!cfg.SITE_ID) throw new Error('SP_SITE_ID non configuré sur Render');
  const { value } = await graph(`/sites/${cfg.SITE_ID}/drives?$select=id,name`);
  let found = value.find(d => norm(d.name) === norm(name));
  if (!found) {
    found = await graph(`/sites/${cfg.SITE_ID}/drive?$select=id,name`);
    console.warn(`Gestion : bibliothèque "${name}" introuvable (disponibles : ${value.map(d => d.name).join(', ')}), utilisation de "${found.name}"`);
  }
  driveIds.set(name, found.id);
  return found.id;
}
const D = async o => `/drives/${await getDriveId(o?.drive)}`;

async function itemByPath(path, o) {
  return graph(`${await D(o)}/root:/${encPath(path)}`);
}
async function item(id, o) {
  return graph(`${await D(o)}/items/${encodeURIComponent(id)}?$select=id,name,file,folder,size,parentReference,lastModifiedDateTime,webUrl`);
}

async function children(itemId, o) {
  let url = `${await D(o)}/items/${encodeURIComponent(itemId)}/children?$top=999&$select=id,name,file,folder,size,lastModifiedDateTime,parentReference,webUrl`;
  const out = [];
  while (url) {
    const page = await graph(url);
    out.push(...page.value);
    url = page['@odata.nextLink'] || null;
  }
  return out;
}

// Plage complète d'un tableau Excel (en-tête + données) : valeurs calculées et formules
async function tableRange(itemId, tableName, o) {
  return graph(`${await D(o)}/items/${encodeURIComponent(itemId)}/workbook/tables/${encodeURIComponent(tableName)}/range`);
}

async function thumbnailUrl(itemId, size = 'large', o) {
  try {
    const t = await graph(`${await D(o)}/items/${encodeURIComponent(itemId)}/thumbnails/0/${size}`);
    return t.url || null;
  } catch { return null; }
}

// Écriture d'une plage de cellules (ex. "C7") dans une feuille : values = [[valeur]]
// champ = 'formulas' pour réécrire des formules (les cellules '' sont vidées)
async function patchRange(itemId, sheet, address, values, o, champ = 'values') {
  const url = `${GRAPH}${await D(o)}/items/${encodeURIComponent(itemId)}/workbook/worksheets/${encodeURIComponent(sheet)}/range(address='${address}')`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ [champ]: values }),
  });
  if (!res.ok) throw new Error(`Écriture Excel ${address} refusée : ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Ajout d'une ligne en bas d'un tableau Excel (null = colonne calculée laissée à Excel)
async function addTableRow(itemId, table, values, o) {
  const url = `${GRAPH}${await D(o)}/items/${encodeURIComponent(itemId)}/workbook/tables/${encodeURIComponent(table)}/rows/add`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) throw new Error(`Ajout de ligne Excel refusé : ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Création d'un dossier (échoue s'il existe déjà)
async function createFolder(parentId, name, o) {
  const res = await fetch(`${GRAPH}${await D(o)}/items/${encodeURIComponent(parentId)}/children`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });
  if (!res.ok) throw new Error(`Création du dossier « ${name} » refusée : ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Copie d'un fichier/dossier (asynchrone côté SharePoint). attendre=true : attend la fin et renvoie l'id de la copie
async function copyItem(itemId, parentId, name, { attendre = false, o } = {}) {
  const d = await getDriveId(o?.drive);
  const res = await fetch(`${GRAPH}/drives/${d}/items/${encodeURIComponent(itemId)}/copy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentReference: { driveId: d, id: parentId }, ...(name ? { name } : {}) }),
  });
  if (res.status !== 202) throw new Error(`Copie refusée : ${res.status} ${(await res.text()).slice(0, 200)}`);
  const monitor = res.headers.get('location');
  if (!attendre || !monitor) return null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const m = await (await fetch(monitor)).json().catch(() => ({}));
    if (m.status === 'completed') return m.resourceId;
    if (m.status === 'failed') throw new Error('Copie SharePoint échouée');
  }
  throw new Error('Copie SharePoint trop longue');
}

// ---------- Envoi de mail (permission Mail.Send de l'app) ----------
async function gPost(path, body, method = 'POST') {
  const res = await fetch(GRAPH + path, {
    method,
    headers: { Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Graph ${res.status} ${path.slice(0, 80)} : ${(await res.text()).slice(0, 300)}`);
  return res.status === 202 || res.status === 204 ? null : res.json();
}

// Mail avec pièces jointes de toute taille : brouillon -> pièces jointes (session d'envoi si > 3 Mo) -> envoi
// attachments : [{ name, contentType, buffer }]
async function sendMail(mailbox, { to, subject, html, replyTo, attachments = [] }) {
  const box = `/users/${encodeURIComponent(mailbox)}`;
  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: (Array.isArray(to) ? to : [to]).map(a => ({ emailAddress: { address: a } })),
    ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {}),
  };
  // Petits envois (< 3 Mo de pièces jointes) : envoi direct, seule la permission Mail.Send suffit
  const total = attachments.reduce((t, a) => t + a.buffer.length, 0);
  if (total < 3 * 1024 * 1024) {
    message.attachments = attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.buffer.toString('base64'),
    }));
    await gPost(`${box}/sendMail`, { message, saveToSentItems: true });
    return;
  }
  // Gros fichiers : brouillon + session d'envoi (nécessite la permission Mail.ReadWrite)
  let draft;
  try { draft = await gPost(`${box}/messages`, message); }
  catch (err) {
    if (/403/.test(err.message)) throw new Error(`Pièces jointes de plus de 3 Mo : la permission Mail.ReadWrite (application) manque sur l'app Azure. ${err.message}`);
    throw err;
  }
  for (const a of attachments) {
    if (a.buffer.length < 3 * 1024 * 1024) {
      await gPost(`${box}/messages/${draft.id}/attachments`, {
        '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType || 'application/octet-stream',
        contentBytes: a.buffer.toString('base64'),
      });
    } else {
      const session = await gPost(`${box}/messages/${draft.id}/attachments/createUploadSession`, {
        AttachmentItem: { attachmentType: 'file', name: a.name, size: a.buffer.length, contentType: a.contentType || 'application/octet-stream' },
      });
      const CHUNK = 3 * 1024 * 1024; // multiple de 320 Ko
      for (let start = 0; start < a.buffer.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, a.buffer.length);
        const res = await fetch(session.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${a.buffer.length}`, 'Content-Type': 'application/octet-stream' },
          body: a.buffer.subarray(start, end),
        });
        if (!res.ok) throw new Error(`Pièce jointe « ${a.name} » refusée : ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    }
  }
  await gPost(`${box}/messages/${draft.id}/send`, undefined);
}

// Contenu brut d'un fichier (Response fetch, à streamer vers le navigateur)
async function content(itemId, o) {
  return graph(`${await D(o)}/items/${encodeURIComponent(itemId)}/content`, { raw: true });
}

module.exports = { sendMail, graph, patchRange, addTableRow, createFolder, copyItem, itemByPath, item, children, tableRange, thumbnailUrl, content, norm };
