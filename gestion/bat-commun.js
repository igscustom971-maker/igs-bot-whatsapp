// ============================================
// IGS GESTION - BAT : RÈGLES COMMUNES (générateur dans le navigateur ET BAT automatique sur le serveur)
// Produits (gabarits, mesures fournisseur), zones de flocage, nuancier, construction des pages,
// calcul de la position et de la taille des logos. Aucune dépendance (ni DOM, ni Node).
// ============================================
(function (racine) {
  'use strict';
  // œ / æ ne se décomposent pas en NFD : remplacés à la main ("Cœur" -> "coeur")
  const norm = s => String(s || '').replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  // A = longueur, B = largeur à plat (taille M, fournisseur SOL'S) ; zones en cm :
  // x depuis le centre du corps (positif = côté cœur, à droite à l'écran), y depuis le haut du vêtement
  const PRODUITS_BASE = {
    tshirt:    { nom: 'T-shirt', avant: 'tshirt-avant', dos: 'tshirt-dos', A: 72, B: 53, femme: [63, 44], enfant: [49, 38],
                 zones: { coeur: { x: 12.5, y: 15 }, poitrine: { x: 0, y: 13 }, dos: { x: 0, y: 10 }, bas: { x: 0, yBas: 7 }, manche: { fx: 0.12, fy: 0.27, rot: -35 } } },
    polo:      { nom: 'Polo', avant: 'polo-avant', dos: 'polo-dos', A: 72, B: 53, femme: [63, 46], echelle: 1.12,
                 zones: { coeur: { x: 14.5, y: 17 }, poitrine: { x: 0, y: 18 }, dos: { x: 0, y: 11 }, bas: { x: 0, yBas: 7 }, manche: { fx: 0.12, fy: 0.27, rot: -35 } } },
    debardeur: { nom: 'Débardeur', avant: 'debardeur-avant', dos: 'debardeur-dos', A: 68, B: 47, femme: [66, 43],
                 zones: { coeur: { x: 10, y: 13 }, poitrine: { x: 0, y: 14 }, dos: { x: 0, y: 12 }, bas: { x: 0, yBas: 7 } } },
    tote:      { nom: 'Tote bag', avant: 'tote', dos: 'tote', A: 42, B: 38, tote: true, echelle: 0.9,
                 zones: { centre: { x: 0, yCentre: 21 } } },
  };
  // Mesures fournisseur par taille (A longueur / B largeur à plat, cm) : sert aux alertes "visuel trop grand"
  const TAILLES = {
    tshirt: {
      homme: { XS: [64, 48], S: [70, 50], M: [72, 53], L: [74, 56], XL: [76, 59], XXL: [78, 62], '3XL': [80, 65], '4XL': [82, 68], '5XL': [84, 71] },
      femme: { S: [61, 41], M: [63, 44], L: [65, 47], XL: [67, 50], XXL: [69, 53], '3XL': [71, 56] },
      enfant: { '2A': [40, 29], '4A': [43, 32], '6A': [46, 35], '8A': [49, 38], '10A': [52, 41], '12A': [55, 44] } },
    polo: {
      homme: { S: [70, 50], M: [72, 53], L: [74, 56], XL: [76, 59], XXL: [79, 62], '3XL': [83, 66], '4XL': [87, 70], '5XL': [91, 74] },
      femme: { S: [61, 43], M: [63, 46], L: [65, 49], XL: [67, 52], XXL: [69, 55], '3XL': [71, 58] } },
    debardeur: {
      homme: { S: [66, 44], M: [68, 47], L: [70, 50], XL: [71, 53], XXL: [73, 56], '3XL': [74, 59], '4XL': [76, 62], '5XL': [77, 65] },
      femme: { XS: [62, 39], S: [64, 41], M: [66, 43], L: [68, 45], XL: [69, 47], XXL: [70, 49] } },
    tote: { homme: { TU: [42, 38] } },
  };
  const ORDRE_TAILLES = ['2A', '4A', '6A', '8A', '10A', '12A', '14A', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'TU'];
  function normTaille(t) {
    const s = String(t || '').toUpperCase().replace(/\s+/g, '').replace(/ANS?$/, 'A');
    if (s === '2XL') return 'XXL';
    if (s === 'XXXL') return '3XL';
    return s;
  }
  function dimsTaille(produit, coupe, taille) {
    const T = TAILLES[produit]; if (!T) return null;
    const t = normTaille(taille);
    return (T[coupe === 'femme' ? 'femme' : coupe === 'enfant' ? 'enfant' : 'homme'] || {})[t] || (T.enfant || {})[t] || (T.homme || {})[t] || null;
  }

  const ZONES = {
    coeur: { lib: 'Cœur (poitrine gauche)', court: 'Cœur', face: 'avant', l: 9 },
    poitrine: { lib: 'Poitrine centrée', court: 'Poitrine', face: 'avant', l: 25 },
    dos: { lib: 'Dos', court: 'Dos', face: 'dos', l: 27 },
    manche: { lib: 'Manche', court: 'Manche', face: 'avant', l: 7 },
    bas: { lib: 'Bas de tee-shirt', court: 'Bas de tee-shirt', face: 'avant', l: 10 },
    centre: { lib: 'Face (tote bag)', court: 'Face', face: 'avant', l: 27 },
  };
  const COULEURS = {
    'noir profond':'#1b1b1d','noir':'#1b1b1d','gris fonce':'#4b4e56','gris clair':'#b8b9bd','gris':'#8d8f94','blanc':'#ffffff',
    'rose bonbon':'#f6a9c8','rose':'#f6a9c8','fuchsia':'#d6197a','bordeaux':'#6b1e30','rouge':'#c8102e','hibiscus':'#e83e5f',
    'orange':'#f26a21','jaune citron':'#f3e04f','jaune gold':'#f2b705','jaune':'#f3d34a','vert pomme':'#69bd47','vert prairie':'#2c9a46',
    'vert bouteille':'#0f4a2c','vert':'#2c9a46','kaki fonce':'#4d4a2d','kaki':'#6b6a3d','terre':'#8b5a3c','chocolat':'#4a2e23',
    'violet fonce':'#4a2a6b','violet':'#5b2d8a','marine':'#1b2440','french marine':'#23305d','royal':'#1f4ea3','bleu royal':'#1f4ea3',
    'aqua':'#19b4c8','bleu atoll':'#0e7fb4','ciel':'#8fcaec','bleu ciel':'#8fcaec','bleu':'#1f4ea3','sable':'#d9c49d','beige':'#d9c49d',
  };
  const NUANCIER_DEFAUT = ['Noir profond','Gris foncé','Gris clair','Blanc','Rose bonbon','Fuchsia','Bordeaux','Rouge','Hibiscus','Orange','Jaune Citron','Jaune Gold','Vert pomme','Vert prairie','Vert bouteille','Kaki foncé','Terre','Chocolat','Violet foncé','Marine','French marine','Royal','Aqua','Bleu atoll','Ciel','Sable'];

  function produitDe(type) {
    const t = norm(type);
    if (/tote|sac/.test(t)) return 'tote';
    if (/polo/.test(t)) return 'polo';
    if (/debardeur|marcel|tank/.test(t)) return 'debardeur';
    if (/t-?shirt|tee|tshirt|col v|longue/.test(t)) return 'tshirt';
    return null;
  }
  function hexCouleur(nom) {
    const n = norm(nom);
    if (COULEURS[n]) return COULEURS[n];
    const k = Object.keys(COULEURS).sort((a, b) => b.length - a.length).find(k => n.includes(k));
    return k ? COULEURS[k] : '#9ca3af';
  }
  function zoneDe(lib) {
    const n = norm(lib);
    if (/coeur|poitrine gauche/.test(n)) return 'coeur';
    if (/dos|arriere/.test(n)) return 'dos';
    if (/manche/.test(n)) return 'manche';
    if (/bas/.test(n)) return 'bas';
    return 'poitrine';
  }
  // "Cœur (9cm) + Dos (27cm)"
  function parserZones(txt) {
    return String(txt || '').split('+').map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.match(/\(?\s*(\d+(?:[.,]\d+)?)\s*cm/i);
      const z = zoneDe(s);
      return { zone: z, libelle: s.replace(/\s+/g, ' '), largeur: m ? Number(m[1].replace(',', '.')) : ZONES[z].l, sansTaille: !m };
    });
  }

  // Un jeu de règles (copie des produits : positions par défaut enregistrées, échelle d'affichage)
  function creer(opts = {}) {
    const PRODUITS = JSON.parse(JSON.stringify(PRODUITS_BASE));
    const etat = { echelle: 1.3 };

    function appliquerPositions(positions) {
      if (!positions) return;
      if (positions._echelle) etat.echelle = Number(positions._echelle) || etat.echelle;
      for (const [prod, zs] of Object.entries(positions)) {
        const P = PRODUITS[prod]; if (!P || !zs || typeof zs !== 'object') continue;
        for (const [z, o] of Object.entries(zs)) {
          const cible = P.tote ? P.zones.centre : P.zones[z]; if (!cible || !o) continue;
          cible.ddx = Number(o.dx) || 0; cible.ddy = Number(o.dy) || 0; if (o.rot != null) cible.drot = Number(o.rot);
          if (o.largeur) (P.largeurs = P.largeurs || {})[z] = Number(o.largeur);
        }
      }
    }
    if (opts.positions) appliquerPositions(opts.positions);

    // Une page par visuel ; couleurs, produits et tailles tirés du tableau des tailles du client
    function construirePages(C, D, o = {}) {
      const visuels = (D && D.visuels) || [];
      const groupes = (D && D.tailles && D.tailles.groupes) || [];
      const zonesCmd = parserZones(C.zone_flocage);
      const imagesDe = v => (v ? v.images : visuels.flatMap(x => x.images));
      let sources = groupes.length ? groupes.map(g => ({ g, v: visuels.find(v => v.nom === g.dossierVisuel) || (groupes.length === 1 && visuels.length === 1 ? visuels[0] : null) }))
                                   : (visuels.length ? visuels.map(v => ({ g: null, v })) : []);
      if (!sources.length) sources = [{ g: null, v: { nom: o.vierge ? 'BAT' : 'Visuel', images: [] } }];
      return sources.map(({ g, v }, i) => {
        const imgs = imagesDe(v).slice();
        const avant = imgs.find(x => x.face === 'avant') || imgs.find(x => x.face === 'autre') || imgs[0];
        const arriere = imgs.find(x => x.face === 'arriere');
        const lignes = g ? g.lignes : [];
        const articles = [];
        for (const l of lignes) {
          const produit = produitDe(l.type) || 'tshirt';
          const coupe = /femme/i.test(l.coupe || '') ? 'femme' : (/enfant|\b\d+\s*a(ns)?\b/i.test((l.type || '') + ' ' + (l.taille || '')) ? 'enfant' : '');
          const k = produit + '|' + norm(l.couleur) + '|' + coupe;
          let a = articles.find(x => x.k === k);
          if (!a) articles.push(a = { k, produit, type: l.type || PRODUITS[produit].nom, couleur: l.couleur || 'Blanc', hex: hexCouleur(l.couleur || 'Blanc'), coupe, qte: 0, actif: true, tailles: [] });
          a.qte += l.quantite || 0;
          if (l.taille && !a.tailles.includes(l.taille)) a.tailles.push(l.taille);
        }
        if (!articles.length) articles.push({ k: 'tshirt|blanc|', produit: 'tshirt', type: 'T-shirt', couleur: 'Blanc', hex: '#ffffff', coupe: '', qte: 0, actif: true });
        // Placements : zones de la commande, logo Avant sur les zones de face, Arrière sur le dos
        const zones = zonesCmd.length ? zonesCmd : [...(avant ? [{ zone: 'coeur', libelle: 'Cœur (9cm)', largeur: 9 }] : []), ...(arriere ? [{ zone: 'dos', libelle: 'Dos (27cm)', largeur: 27 }] : [])];
        const placements = zones.map(z => {
          const img = ZONES[z.zone].face === 'dos' ? (arriere || null) : (avant || null);
          const lDefaut = ((PRODUITS[articles[0].produit] || {}).largeurs || {})[z.zone];
          return img ? { zone: z.zone, libelle: z.libelle, largeur: z.sansTaille && lDefaut ? lDefaut : z.largeur, image: img.id, dx: 0, dy: 0, rot: null, sansBlanc: 'auto' } : null;
        }).filter(Boolean);
        // Tailles par couleur : "Noir profond : 10 S / 20 M" (type précisé s'il y a plusieurs produits)
        const parCouleur = {};
        const plusieursTypes = new Set(lignes.map(l => norm(l.type))).size > 1;
        for (const l of lignes) {
          const k = (plusieursTypes ? (l.type || '') + ' ' : '') + (l.couleur || '—') + (/femme/i.test(l.coupe || '') ? ' (femme)' : '');
          const t = normTaille(l.taille) || '?';
          (parCouleur[k] = parCouleur[k] || {})[t] = (parCouleur[k][t] || 0) + (Number(l.quantite) || 0);
        }
        const rang = t => { const i = ORDRE_TAILLES.indexOf(t); return i < 0 ? 99 : i; };
        for (const k of Object.keys(parCouleur)) parCouleur[k] = Object.entries(parCouleur[k]).sort((a, b) => rang(a[0]) - rang(b[0])).map(([t, q]) => q + ' ' + t);
        const total = lignes.reduce((t, l) => t + (l.quantite || 0), 0);
        const page = {
          titre: (v && v.nom) || (g && g.visuel) || ('Visuel ' + (i + 1)), images: imgs, articles, placements,
          modele: [...new Set(articles.map(a => a.type))].join(' & '),
          couleur: [...new Set(articles.map(a => a.couleur))].join(' & '),
          quantite: total ? String(total) : '', tailles: Object.entries(parCouleur).map(([c, t]) => c + ' : ' + t.join(' / ')).join('\n'),
          legende: '',
        };
        majTextes(page);
        if (!page.zone) page.zone = C.zone_flocage || '';
        // Commande uniquement en tote bags : une face, 27 cm
        if (articles.every(a => a.produit === 'tote') && placements.length) Object.assign(page, { face: 'Face (27cm)', dos: '', autres: '', zone: 'Face (27cm)' });
        return page;
      });
    }
    // Colonnes Face / Dos / Autres et ligne de zone d'après les logos placés
    function majTextes(p) {
      p.face = p.placements.filter(z => ZONES[z.zone].face === 'avant' && z.zone !== 'manche').map(z => z.libelle).join(' + ');
      p.dos = p.placements.filter(z => z.zone === 'dos').map(z => z.libelle).join(' + ');
      p.autres = p.placements.filter(z => z.zone === 'manche').map(z => z.libelle).join(' + ');
      p.zone = p.placements.map(z => z.libelle).join(' + ');
    }

    function dims(a) {
      const p = PRODUITS[a.produit];
      if (a.coupe === 'femme' && p.femme) return { A: p.femme[0], B: p.femme[1] };
      if (a.coupe === 'enfant' && p.enfant) return { A: p.enfant[0], B: p.enfant[1] };
      return { A: p.A, B: p.B };
    }
    // m = mesures du gabarit : { w, h, corps, cx, hautCorps, centres[] }
    function centreA(m, y) {
      const k = Math.max(0, Math.min(100, Math.round(y / m.h * 100))), r = m.centres && m.centres[k];
      return r && r.w <= m.corps * 1.15 ? r.c : m.cx;
    }
    // Rectangle du logo (px du gabarit) ; iw/ih = taille du logo rogné
    function rectLogo(pl, a, face, m, iw, ih) {
      const p = PRODUITS[a.produit], { A, B } = dims(a);
      const pxW = m.corps / B, pxH = p.tote ? pxW : m.h / A;
      const zd = p.tote ? p.zones.centre : (p.zones[pl.zone] || p.zones.poitrine);
      const w = pl.largeur * pxW * etat.echelle * (p.echelle || 1), h = w * (ih / iw);
      const dx = pl.dx + (zd.ddx || 0), dy = pl.dy + (zd.ddy || 0);
      let cx, top;
      if (p.tote) { cx = m.cx + (zd.x + dx) * pxW; top = m.hautCorps + (zd.yCentre + dy) * pxH - h / 2; }
      else if (zd.fx != null) { cx = m.w * zd.fx + dx * pxW; top = m.h * zd.fy + dy * pxH - h / 2; }
      else if (zd.yBas != null) { top = m.h - (zd.yBas - dy) * pxH - h; cx = centreA(m, top + h / 2) + (zd.x + dx) * pxW; }
      else { top = (zd.y + dy) * pxH; cx = centreA(m, top + h / 2) + (zd.x + dx) * pxW; }
      return { x: cx - w / 2, y: top, w, h, rot: pl.rot != null ? pl.rot : (zd.drot != null ? zd.drot : (zd.rot || 0)), pxW, pxH };
    }
    function totePlacement(page) {
      if (!page.totePl) {
        const base = page.placements.find(pl => pl.zone === 'dos') || page.placements[0];
        if (!base) return null;
        page.totePl = { zone: 'centre', libelle: 'Face (27cm)', largeur: 27, image: base.image, dx: 0, dy: 0, rot: null, sansBlanc: base.sansBlanc, tote: true };
      }
      return page.totePl;
    }
    // Tote bag : une seule face avec le visuel principal ; zone non prévue sur un produit : placée comme une poitrine
    function placementsDe(page, face, a) {
      if (PRODUITS[a.produit].tote) return face === 'avant' ? [totePlacement(page)].filter(Boolean) : [];
      return page.placements.filter(pl => ZONES[pl.zone].face === face);
    }
    // Vignettes de la page : devant puis dos pour chaque couleur
    function vignettesDe(page) {
      const out = [];
      for (const a of page.articles.filter(a => a.actif)) {
        const faces = ['avant', 'dos'].filter(f => placementsDe(page, f, a).length || (f === 'avant' && !page.placements.length));
        for (const f of faces) out.push({ a, f, gabarit: f === 'dos' ? PRODUITS[a.produit].dos : PRODUITS[a.produit].avant });
      }
      return out;
    }
    // Grille des vignettes dans le cadre (W x H en px CSS) : 1 rang jusqu'à 4 vignettes, sinon 2
    function grille(n, W, H, tailles) {
      const rangs = n <= 4 ? 1 : 2, cols = Math.ceil(Math.max(1, n) / rangs);
      const cw = Math.min(W / cols, 260 * (rangs === 1 ? 1.35 : 1)), ch = H / rangs, x0 = (W - cw * cols) / 2;
      return tailles.map((t, k) => {
        const col = k % cols, row = Math.floor(k / cols), s = Math.min((cw - 10) / t.w, (ch - 12) / t.h);
        const w = t.w * s, h = t.h * s;
        return { px: x0 + col * cw + (cw - w) / 2, py: row * ch + (ch - h) / 2, s, w, h };
      });
    }
    // Visuel trop grand pour la plus petite taille commandée (ratios : id image -> hauteur / largeur du dessin)
    function alertes(page, ratios) {
      const out = [], vus = new Set();
      for (const a of page.articles.filter(x => x.actif)) {
        const P = PRODUITS[a.produit];
        const tailles = (a.tailles && a.tailles.length ? a.tailles : ['M']).map(t => ({ t, d: dimsTaille(a.produit, a.coupe, t) })).filter(x => x.d);
        if (!tailles.length) continue;
        const petite = tailles.sort((x, y) => x.d[0] - y.d[0])[0];
        const [A, B] = petite.d;
        for (const face of ['avant', 'dos']) for (const pl of placementsDe(page, face, a)) {
          const ratio = ratios && ratios.get(pl.image); if (!ratio) continue;
          const w = pl.largeur, h = Math.round(pl.largeur * ratio * 2) / 2;
          let maxW, maxH;
          if (P.tote) { maxW = B - 4; maxH = A - 4; }
          else if (pl.zone === 'coeur') { maxW = 12; maxH = 14; }
          else if (pl.zone === 'manche') { maxW = 10; maxH = 12; }
          else if (pl.zone === 'bas') { maxW = B - 10; maxH = 15; }
          else { const zd = P.zones[pl.zone] || P.zones.poitrine; const haut = (zd.y || 10) + (zd.ddy || 0) + (pl.dy || 0); maxW = B - 10; maxH = A - haut - 8; }
          if (w > maxW + 0.01 || h > maxH + 0.01) {
            const k = pl.image + '|' + pl.zone + '|' + petite.t + '|' + a.produit;
            if (vus.has(k)) continue; vus.add(k);
            const f = n => String(n).replace('.', ',');
            out.push({ placement: pl, message: `${ZONES[pl.zone].court} : ${f(w)} × ${f(h)} cm, trop grand pour ${P.nom.toLowerCase()} ${petite.t}${a.coupe === 'femme' ? ' femme' : ''} (zone max ≈ ${Math.round(maxW)} × ${Math.round(maxH)} cm)` });
          }
        }
      }
      return out;
    }
    return { alertes, PRODUITS, ZONES, etat, appliquerPositions, construirePages, majTextes, dims, centreA, rectLogo, totePlacement, placementsDe, vignettesDe, grille };
  }

  // Mesures d'un gabarit à partir de son canal alpha (alpha(x, y) -> 0..255)
  function mesurer(nom, w, h, alpha) {
    const ligne = fr => { const y = Math.min(h - 1, Math.round(h * fr)); let a = -1, b = -1; for (let i = 0; i < w; i++) if (alpha(i, y) > 40) { if (a < 0) a = i; b = i; } return [a, b]; };
    const [l, r] = ligne(nom === 'tote' ? 0.75 : 0.6);
    let hautCorps = 0;
    if (nom === 'tote') { for (let fr = 0.2; fr < 0.8; fr += 0.01) { const [a, b] = ligne(fr); if (b - a > (r - l) * 0.9) { hautCorps = Math.round(h * fr); break; } } }
    const centres = [];
    for (let k = 0; k <= 100; k++) { const [a, b] = ligne(Math.min(0.995, k / 100)); centres.push(a < 0 ? null : { c: (a + b) / 2, w: b - a }); }
    return { w, h, corps: r - l, cx: (l + r) / 2, hautCorps, centres };
  }

  const api = { TAILLES, dimsTaille, norm, ZONES, COULEURS, NUANCIER_DEFAUT, PRODUITS_BASE, produitDe, hexCouleur, zoneDe, parserZones, creer, mesurer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.BATCOMMUN = api;
})(typeof window !== 'undefined' ? window : globalThis);
