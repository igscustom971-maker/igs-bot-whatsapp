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

const { supabase } = require('./db');
const DOSSIER = path.join(__dirname, 'bat-gabarits');
async function lirePositions() {
  if (!supabase) return {};
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'bat_positions').maybeSingle();
  try { return data ? JSON.parse(data.valeur) : {}; } catch { return {}; }
}
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

  // Positions par défaut des logos (décalages en cm par produit et zone), réglées depuis le générateur
  app.get('/gestion/api/bat/positions', auth.requireUser, async (req, res) => {
    res.json({ admin: req.user.role === 'admin', positions: await lirePositions() });
  });
  app.post('/gestion/api/bat/positions', auth.requireUser, auth.requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const produit = String(b.produit || ''), zone = String(b.zone || '');
      if (!/^(tshirt|polo|debardeur|tote)$/.test(produit) || !/^(coeur|poitrine|dos|manche|bas|centre)$/.test(zone)) throw new Error('Produit ou zone inconnu');
      const n = v => { const x = Number(v); if (!isFinite(x) || Math.abs(x) > 80) throw new Error('Valeur invalide'); return Math.round(x * 2) / 2; };
      const pos = await lirePositions();
      pos[produit] = pos[produit] || {};
      pos[produit][zone] = { dx: n(b.dx || 0), dy: n(b.dy || 0), rot: b.rot == null || b.rot === '' ? null : n(b.rot), largeur: b.largeur ? n(b.largeur) : null, par: req.user.name || req.user.email, le: new Date().toISOString() };
      if (!supabase) throw new Error('Supabase non configuré');
      const { error } = await supabase.from('gestion_reglages').upsert({ cle: 'bat_positions', valeur: JSON.stringify(pos), updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      console.log(`Gestion BAT : position par défaut ${produit}/${zone}`, pos[produit][zone]);
      res.json({ ok: true, positions: pos });
    } catch (err) { res.status(400).json({ error: err.message }); }
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
