// IGS Dashboard - glisser-déposer des fichiers partout où il y a un bouton d'import.
// On lâche un fichier sur une carte / zone : le champ « fichier » le plus proche le reçoit, exactement comme si on
// l'avait choisi avec le bouton (mêmes contrôles, même envoi). Rien à brancher page par page.
// + IGSPDF.enImage(fichier) : première page d'un PDF convertie en PNG (fond transparent), pour les logos / visuels.
(function () {
  if (window.__igsDepot) return; window.__igsDepot = true;
  var st = document.createElement('style');
  st.textContent = '.igs-depot{outline:3px dashed #FF1E8E !important;outline-offset:-3px;background-color:rgba(255,30,142,.06) !important;transition:background-color .1s}'
    + '#igs-depot-bulle{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1E1E4B;color:#fff;padding:10px 16px;border-radius:12px;font:600 14px Poppins,sans-serif;z-index:99999;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.25);display:none}';
  document.head.appendChild(st);
  var bulle = document.createElement('div'); bulle.id = 'igs-depot-bulle';
  var dansBody = function () { if (!bulle.parentNode && document.body) document.body.appendChild(bulle); };

  var aDesFichiers = function (e) { var t = e.dataTransfer && e.dataTransfer.types; return t && Array.prototype.indexOf.call(t, 'Files') >= 0; };
  var visible = function (i) { return !i.disabled && !(i.parentElement && i.parentElement.closest && i.parentElement.closest('[hidden]')); };
  // Champ choisi : le plus proche du point de dépôt ; un champ « photo » (capture) ou « remplacer » seulement s'il est seul ici
  function cible(el) {
    for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (!n.querySelectorAll) continue;
      var c = Array.prototype.filter.call(n.querySelectorAll('input[type=file]'), visible);
      if (!c.length) continue;
      var bons = c.filter(function (i) { return !i.hasAttribute('capture') && !i.hasAttribute('data-remplace'); });
      if (n === document.body) return bons.length === 1 ? { input: bons[0], zone: null } : null; // page entière : seulement s'il n'y a pas d'ambiguïté
      var i = bons[0] || c.filter(function (x) { return !x.hasAttribute('capture'); })[0] || c[0];
      var zone = n.closest('.card, .pl, label, .field, section') || n;
      return { input: i, zone: zone };
    }
    return null;
  }
  function accepte(input, f) {
    var a = (input.getAttribute('accept') || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    if (!a.length) return true;
    var nom = (f.name || '').toLowerCase(), type = (f.type || '').toLowerCase();
    return a.some(function (x) { return x.charAt(0) === '.' ? nom.slice(-x.length) === x : x.slice(-2) === '/*' ? type.indexOf(x.slice(0, -1)) === 0 : type === x; });
  }
  var zoneActive = null, minuteur = null;
  function marquer(z) { if (zoneActive === z) return; if (zoneActive) zoneActive.classList.remove('igs-depot'); zoneActive = z; if (z) z.classList.add('igs-depot'); }
  function dire(t, ms) { dansBody(); bulle.textContent = t; bulle.style.display = 'block'; clearTimeout(minuteur); minuteur = setTimeout(function () { bulle.style.display = 'none'; }, ms || 1200); }

  document.addEventListener('dragover', function (e) {
    if (!aDesFichiers(e)) return;
    e.preventDefault(); // sinon le navigateur ouvre le fichier à la place de la page
    var c = cible(e.target);
    e.dataTransfer.dropEffect = c ? 'copy' : 'none';
    marquer(c ? (c.zone || document.body) : null);
    if (c) dire('Lâche pour importer ici', 600);
  });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) marquer(null); });
  document.addEventListener('drop', function (e) {
    if (!aDesFichiers(e)) return;
    e.preventDefault(); marquer(null);
    var c = cible(e.target);
    if (!c) { dire('Pas d\'import possible à cet endroit', 1800); return; }
    var fs = Array.prototype.slice.call(e.dataTransfer.files || []);
    var ok = fs.filter(function (f) { return accepte(c.input, f); });
    if (!ok.length) { dire('Format non accepté ici' + (c.input.getAttribute('accept') ? ' (' + c.input.getAttribute('accept').replace(/application\/|image\/|text\//g, '').split(',').slice(0, 5).join(', ') + ')' : ''), 2600); return; }
    if (!c.input.multiple) ok = ok.slice(0, 1);
    try {
      var dt = new DataTransfer(); ok.forEach(function (f) { dt.items.add(f); });
      c.input.files = dt.files;
    } catch (err) { dire('Ton navigateur ne permet pas le glisser-déposer ici : utilise le bouton', 2600); return; }
    c.input.dispatchEvent(new Event('change', { bubbles: true }));
    dire(ok.length > 1 ? ok.length + ' fichiers importés' : '« ' + ok[0].name + ' » importé', 1600);
  });

  // ---------- PDF -> image (logos, visuels) ----------
  var pdfjs = null;
  async function charger() {
    if (pdfjs) return pdfjs;
    pdfjs = await import('/gestion/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/gestion/pdfjs/pdf.worker.min.mjs';
    return pdfjs;
  }
  window.IGSPDF = {
    estPdf: function (f) { return f && (/pdf$/i.test(f.type || '') || /\.pdf$/i.test(f.name || '')); },
    // 1re page en PNG, ~3000 px de large, fond transparent (un logo vectoriel garde sa netteté)
    enImage: async function (f, largeur) {
      var lib = await charger();
      var doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      var page = await doc.getPage(1);
      var v1 = page.getViewport({ scale: 1 });
      var echelle = Math.min(12, (largeur || 3000) / v1.width);
      var vp = page.getViewport({ scale: echelle });
      var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
      var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
      var nom = (f.name || 'logo.pdf').replace(/\.pdf$/i, '') + '.png';
      try { return new File([blob], nom, { type: 'image/png' }); } catch (e) { blob.name = nom; return blob; }
    },
  };
})();
