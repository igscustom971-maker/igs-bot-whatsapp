// ============================================
// IGS GESTION - RÉCEPTION DU FORMULAIRE CLIENT (remplace l'envoi par WordPress)
// Le formulaire igscustom.fr/formulaire/ envoie ici ; le serveur envoie le mail "Nouvelle commande - …"
// à contact@igscustom.fr depuis la boîte contact@ via Microsoft 365 (plus de spam),
// avec EXACTEMENT la même forme qu'avant : le flux Power Automate continue de déposer les fichiers dans SharePoint.
// ============================================

const multer = require('multer');
const g = require('./graph');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const DEST = (process.env.FORM_DESTINATAIRE || MAILBOX).split(',').map(s => s.trim()).filter(Boolean);
const ORIGINS = (process.env.FORM_ORIGINS || 'https://igscustom.fr,https://www.igscustom.fr').split(',').map(s => s.trim());
const MAX_FICHIER = 25 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FICHIER, files: 12, fields: 60, fieldSize: 20000 } });

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txt = v => String(v ?? '').trim();
const ext = name => { const m = String(name || '').match(/\.[A-Za-z0-9]{1,5}$/); return m ? m[0].toLowerCase() : ''; };
const nomFichier = s => txt(s).replace(/[\\/:*?"<>|#%{}~&]/g, '').replace(/\s+/g, '_').slice(0, 60);

// Anti-abus simple : 8 envois par heure et par adresse IP
const envois = new Map();
function tropDEnvois(ip) {
  const now = Date.now();
  const liste = (envois.get(ip) || []).filter(t => now - t < 3600e3);
  liste.push(now); envois.set(ip, liste);
  return liste.length > 8;
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.set('Access-Control-Allow-Origin', o);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
  }
}

// "Cœur (9cm) + Dos (27cm)" — même format que l'ancien mail
function zoneFlocage(b, aAvant, aArriere) {
  const parts = [];
  const pos = txt(b.position_face) === 'Autre' ? txt(b.position_face_autre) || 'Autre' : txt(b.position_face);
  if (pos) parts.push(`${pos}${txt(b.dim_face) ? ` (${txt(b.dim_face)}cm)` : ''}`);
  if (aArriere || (!aAvant && txt(b.dim_dos) && b.sans_visuel === 'oui')) parts.push(`Dos${txt(b.dim_dos) ? ` (${txt(b.dim_dos)}cm)` : ''}`);
  if (txt(b.zone_extra_nom)) parts.push(`${txt(b.zone_extra_nom)}${txt(b.dim_extra) ? ` (${txt(b.dim_extra)}cm)` : ''}`);
  return parts.join(' + ') || '—';
}

function mount(app) {
  app.options('/formulaire/commande', (req, res) => { cors(req, res); res.sendStatus(204); });

  app.post('/formulaire/commande', (req, res, next) => { cors(req, res); next(); }, upload.any(), async (req, res) => {
    try {
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      if (tropDEnvois(ip)) return res.status(429).json({ error: 'Trop d\'envois, réessayez plus tard' });
      const b = req.body || {};
      if (txt(b.site_web)) return res.json({ ok: true }); // champ piège anti-robot
      const devis = txt(b.devis).toUpperCase().slice(0, 30), client = txt(b.client).slice(0, 100);
      const email = txt(b.email).slice(0, 120), tel = txt(b.tel).slice(0, 40);
      if (!devis || !client || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !tel) return res.status(400).json({ error: 'Champs obligatoires manquants' });

      const files = req.files || [];
      const total = files.reduce((t, f) => t + f.size, 0);
      if (total > MAX_TOTAL) return res.status(413).json({ error: 'Fichiers trop lourds (30 Mo max au total)' });
      const fichier = champ => files.find(f => f.fieldname === champ);

      // Visuels : nom_visuel_1..4 + file-avant-N / file-arriere-N
      const visuels = [];
      const attachments = [];
      let aAvant = false, aArriere = false;
      for (let n = 1; n <= 4; n++) {
        const nom = txt(b[`nom_visuel_${n}`]);
        const av = fichier(`file-avant-${n}`), ar = fichier(`file-arriere-${n}`);
        if (!nom && !av && !ar) continue;
        const nomVisuel = nom || `Visuel ${n}`;
        const base = nomFichier(nomVisuel) || `Visuel_${n}`;
        if (av) { aAvant = true; attachments.push({ name: `${base}_Avant${ext(av.originalname)}`, contentType: av.mimetype, buffer: av.buffer }); }
        if (ar) { aArriere = true; attachments.push({ name: `${base}_Arriere${ext(ar.originalname)}`, contentType: ar.mimetype, buffer: ar.buffer }); }
        visuels.push({ nom: nomVisuel, av: !!av, ar: !!ar });
      }
      const zip = fichier('file-zip');
      if (zip) attachments.push({ name: zip.originalname || 'Visuels.zip', contentType: zip.mimetype, buffer: zip.buffer });
      const excel = fichier('file-excel');
      if (excel) attachments.push({ name: 'Tailles.xlsx', contentType: excel.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel.buffer });

      const instructions = txt(b.instructions);
      const lignesVisuels = visuels.length
        ? visuels.map(v => `<tr><td><b>${esc(v.nom)}</b></td><td>${[v.av ? '✓ Avant' : '', v.ar ? '✓ Arrière' : ''].filter(Boolean).join(' ') || (b.sans_visuel === 'oui' ? 'WeTransfer / sans visuel' : '—')}</td></tr>`).join('')
        : `<tr><td><b>—</b></td><td>${b.sans_visuel === 'oui' ? 'WeTransfer / sans visuel' : (zip ? 'Archive ZIP jointe' : '—')}</td></tr>`;

      // Même structure HTML que le mail WordPress (lu par le flux Power Automate)
      const html = `<h2>Nouvelle fiche de personnalisation</h2>
<table cellpadding="8" style="border-collapse:collapse">
<tr><td><b>Numéro de devis</b></td><td>${esc(devis)}</td></tr>
<tr><td><b>Client</b></td><td>${esc(client)}</td></tr>
<tr><td><b>Email</b></td><td>${esc(email)}</td></tr>
<tr><td><b>Téléphone</b></td><td>${esc(tel)}</td></tr>
<tr><td><b>Zone de flocage</b></td><td>${esc(zoneFlocage(b, aAvant, aArriere))}</td></tr>
<tr><td><b>Instructions</b></td><td>${instructions ? esc(instructions).replace(/\n/g, '<br>') : '—'}</td></tr>
</table>
<h3>Visuels joints</h3>
<table cellpadding="8" style="border-collapse:collapse">${lignesVisuels}</table>`;

      await g.sendMail(MAILBOX, { to: DEST, subject: `Nouvelle commande - ${devis} - ${client}`, html, replyTo: email, attachments });
      console.log(`Formulaire : commande ${devis} (${client}) envoyée, ${attachments.length} pièce(s) jointe(s), ${(total / 1048576).toFixed(1)} Mo`);
      res.json({ ok: true });
    } catch (err) {
      console.error('Formulaire : erreur', err.message);
      res.status(500).json({ error: 'Envoi impossible pour le moment' });
    }
  });

  // Erreurs de multer (fichier trop lourd, trop de fichiers)
  app.use('/formulaire', (err, req, res, next) => {
    cors(req, res);
    if (err && err.code && String(err.code).startsWith('LIMIT_')) return res.status(413).json({ error: 'Fichier trop lourd (20 Mo max par fichier)' });
    next(err);
  });
}

module.exports = { mount };
