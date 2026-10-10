// ============================================
// IGS GESTION - GÉNÉRATEUR DE BAT (page /gestion/bat/:cle)
// La composition (gabarits recolorés + logos à l'échelle) et le PDF sont faits dans le navigateur ;
// le serveur fournit les gabarits, le logo IGS, et dépose le PDF dans le dossier de la commande.
// ============================================

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const auth = require('./auth');
const commandes = require('./commandes');

const DOSSIER = path.join(__dirname, 'bat-gabarits');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single('pdf');
let logoIgs = { buf: null, type: 'image/png', at: 0 };

function mount(app) {
  app.get('/gestion/bat/:cle', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'bat-generateur.html'));
  });

  // Gabarits produits (PNG blancs sur fond transparent) et logo IGS (relayé depuis igscustom.fr)
  app.get('/gestion/gabarits/:nom', auth.requireUser, async (req, res) => {
    const nom = String(req.params.nom);
    try {
      if (nom === 'logo-igs.png') {
        if (!logoIgs.buf || Date.now() - logoIgs.at > 24 * 3600e3) {
          const r = await fetch(process.env.BAT_LOGO_URL || 'https://igscustom.fr/wp-content/uploads/2026/05/IGS-CUSTOM-BAR-LOGO.png');
          if (!r.ok) throw new Error(`logo ${r.status}`);
          logoIgs = { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/png', at: Date.now() };
        }
        return res.set({ 'Content-Type': logoIgs.type, 'Cache-Control': 'private, max-age=86400' }).send(logoIgs.buf);
      }
      if (!/^[a-z-]+\.png$/.test(nom) || !fs.existsSync(path.join(DOSSIER, nom))) return res.status(404).send('Gabarit inconnu');
      res.set('Cache-Control', 'private, max-age=86400').sendFile(path.join(DOSSIER, nom));
    } catch (err) {
      console.error('Gestion gabarit :', err.message);
      res.status(502).send('Indisponible');
    }
  });

  app.post('/gestion/api/commandes/:cle/bat-pdf', auth.requireUser, (req, res, next) => upload(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'PDF trop lourd (25 Mo max)' : err.message });
    next();
  }), async (req, res) => {
    try { res.json(await commandes.deposerBat(req.params.cle, req.file && req.file.buffer, req.user.name || req.user.email)); }
    catch (err) { console.error('Gestion dépôt BAT :', err.message); res.status(400).json({ error: err.message }); }
  });
}

module.exports = { mount };
