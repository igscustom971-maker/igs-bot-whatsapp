// IGS Dashboard - modifier le tableau des tailles (Tailles.xlsx) d'une commande depuis sa fiche.
// Pour chaque ligne : pièces disponibles dans le stock de vierges (prises en priorité) et pièces commandées chez SEFI.
(function () {
  if (window.__igsTaillesEdit) return; window.__igsTaillesEdit = true;
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // Listes de la page (globales du script principal), sinon valeurs par défaut
  var arr = function (v, def) { return Array.isArray(v) && v.length ? v : def; };
  var uniq = function (a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); };
  var TYPES = function () { return uniq(arr(typeof T_TYPES !== 'undefined' ? T_TYPES : null, ['T-Shirt', 'Polo', 'Débardeur', 'Tote Bag', 'Casquette']).concat(['Tablier', 'T-shirt vierge'])); };
  var COULEURS = function () { return arr(typeof T_COULEURS !== 'undefined' ? T_COULEURS : null, ['Blanc', 'Noir profond']); };
  var TAILLES = function () { return uniq(['TU'].concat(arr(typeof T_TAILLES !== 'undefined' ? T_TAILLES : null, ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']), ['4XL', '5XL'])); };
  var COUPES = function () { return arr(typeof T_COUPES !== 'undefined' ? T_COUPES : null, ['Unisexe', 'Femme']); };
  var postJ = async function (url, body) {
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
    return j;
  };
  var st = document.createElement('style');
  st.textContent = '.te-t{width:100%;border-collapse:collapse;font-size:13px}.te-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8a8aa3;padding:6px 4px}.te-t td{padding:4px;border-top:1px solid #f0e6d8;vertical-align:middle}'
    + '.te-t input,.te-t select{width:100%;box-sizing:border-box;padding:6px 7px;border:1px solid #e6dccd;border-radius:8px;font:inherit;background:#fff}.te-t input.q{width:64px}'
    + '.te-s{font-size:12px;white-space:nowrap}.te-s .ok{color:#15803d;font-weight:700}.te-s .se{color:#b45309;font-weight:700}.te-s .na{color:#8a8aa3}'
    + '.te-x{border:0;background:none;color:#b91c1c;font-size:18px;cursor:pointer;padding:2px 6px}.te-wrap{overflow-x:auto}';
  document.head.appendChild(st);

  function opts(arr, v) {
    var a = arr.slice(); if (v && a.indexOf(v) < 0) a.unshift(v);
    return a.map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + E(x) + '</option>'; }).join('');
  }
  function ligneHtml(l, i) {
    return '<tr data-i="' + i + '">'
      + '<td><select data-f="type"><option value="">—</option>' + opts(TYPES(), l.type) + '</select></td>'
      + '<td><select data-f="couleur"><option value="">—</option>' + opts(COULEURS(), l.couleur) + '</select></td>'
      + '<td><select data-f="coupe"><option value="">—</option>' + opts(COUPES(), l.coupe) + '</select></td>'
      + '<td><select data-f="taille"><option value="">—</option>' + opts(TAILLES(), l.taille) + '</select></td>'
      + '<td><input class="q" data-f="quantite" type="number" min="0" step="1" value="' + E(l.quantite || '') + '"></td>'
      + '<td><input data-f="visuel" value="' + E(l.visuel) + '" placeholder="Visuel"></td>'
      + '<td><input data-f="remarques" value="' + E(l.remarques) + '" placeholder="Remarque"></td>'
      + '<td class="te-s" data-s="' + i + '"></td>'
      + '<td><button class="te-x" data-del="' + i + '" title="Retirer la ligne">×</button></td></tr>';
  }
  function stockHtml(a) {
    if (!a) return '';
    if (!a.sefi_article) return '<span class="na">hors SEFI</span>';
    var h = [];
    if (a.pris) h.push('<span class="ok">📦 ' + a.pris + ' en stock</span>');
    if (a.sefi) h.push('<span class="se">🛒 ' + a.sefi + ' SEFI</span>');
    if (a.inconnu) h.push('<span class="se" title="Couleur sans code SEFI pour ce modèle">⚠️ code ?</span>');
    return h.join('<br>');
  }

  async function ouvrirEditeur(cle, card) {
    card.innerHTML = '<h3>Tailles · modification</h3><div class="skel"></div><div class="skel"></div>';
    var d;
    try { var r = await fetch('/gestion/api/commandes/' + encodeURIComponent(cle) + '/tailles'); d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); }
    catch (e) { card.innerHTML = '<h3>Tailles</h3><div class="warnbox">❌ ' + E(e.message) + '</div>'; return; }
    if (!d.fichier) { card.innerHTML = '<h3>Tailles</h3><div class="note">Pas de Tailles.xlsx dans le dossier.</div>'; return; }
    var lignes = d.lignes.map(function (l) { return Object.assign({}, l); });
    var bdcTxt = { avant_paiement: 'Commande pas encore payée : le BDC SEFI sera rempli au paiement avec ce tableau (stock pris en priorité).', dans_bdc: 'La commande est dans le BDC SEFI en cours (pas encore envoyé) : à l’enregistrement, il est remis à jour d’après ce tableau (stock pris en priorité).', deja_commande: '⚠️ Déjà envoyée chez SEFI : le BDC ne sera pas modifié (pièces en plus : « Ajouter des articles » ; en moins : prévenir SEFI).', pas_dans_bdc: 'La commande n’est pas dans le BDC SEFI en cours : seul le tableau est modifié.' }[d.bdc && d.bdc.etat] || '';
    var minuteur = null;
    function lire() {
      card.querySelectorAll('tr[data-i]').forEach(function (tr) {
        var l = lignes[Number(tr.dataset.i)]; if (!l) return;
        tr.querySelectorAll('[data-f]').forEach(function (x) { l[x.dataset.f] = x.value; });
      });
    }
    function totalPieces() { return lignes.reduce(function (t, l) { return t + (Number(l.quantite) || 0); }, 0); }
    async function majStock() {
      lire();
      try {
        var j = await postJ('/gestion/api/commandes/' + encodeURIComponent(cle) + '/tailles/apercu', { lignes: lignes });
        var ok = lignes.filter(function (l) { return l.type && Number(l.quantite) > 0; });
        var k = 0;
        lignes.forEach(function (l, i) {
          var cell = card.querySelector('[data-s="' + i + '"]'); if (!cell) return;
          cell.innerHTML = (l.type && Number(l.quantite) > 0) ? stockHtml(j.apercu[k++]) : '';
        });
        var pris = j.apercu.reduce(function (t, a) { return t + (a.pris || 0); }, 0), sefi = j.apercu.reduce(function (t, a) { return t + (a.sefi || 0); }, 0);
        card.querySelector('#te-tot').innerHTML = '<b>' + totalPieces() + ' pièce(s)</b>' + (pris || sefi ? ' · 📦 ' + pris + ' prise(s) dans le stock · 🛒 ' + sefi + ' à commander chez SEFI' : '');
      } catch (e) { /* aperçu indisponible : sans gravité */ }
    }
    function planifier() { clearTimeout(minuteur); minuteur = setTimeout(majStock, 350); }
    function rendre() {
      card.innerHTML = '<h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px">Tailles · modification <span class="note" style="text-transform:none;letter-spacing:0">' + E(d.devis) + '</span></h3>'
        + (bdcTxt ? '<div class="note" style="margin-bottom:8px">' + bdcTxt + '</div>' : '')
        + '<div class="te-wrap"><table class="te-t"><thead><tr><th>Produit</th><th>Couleur</th><th>Coupe</th><th>Taille</th><th>Qté</th><th>Visuel</th><th>Remarque</th><th>Stock / SEFI</th><th></th></tr></thead><tbody>'
        + lignes.map(ligneHtml).join('') + '</tbody></table></div>'
        + '<div class="note" id="te-tot" style="margin-top:8px"></div>'
        + (d.bdc && d.bdc.etat === 'dans_bdc' ? '<label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="te-bdc" checked> Mettre à jour le bon de commande SEFI (stock d’abord)</label>' : '')
        + '<div class="btnrow" style="margin-top:10px"><button class="btn" id="te-add">➕ Ajouter une ligne</button><button class="btn primary" id="te-save">💾 Enregistrer le tableau</button><button class="btn" id="te-cancel">Annuler</button></div>'
        + '<div class="msg" id="te-msg"></div>';
      card.querySelector('#te-add').onclick = function () { lire(); var der = lignes[lignes.length - 1] || {}; lignes.push({ type: der.type || 'T-Shirt', couleur: der.couleur || '', coupe: der.coupe || 'Unisexe', taille: '', quantite: 1, visuel: der.visuel || '', remarques: '' }); rendre(); };
      card.querySelector('#te-cancel').onclick = function () { if (typeof ouvrir === 'function') ouvrir(cle); };
      card.querySelector('#te-save').onclick = enregistrer;
      card.querySelector('tbody').addEventListener('input', planifier);
      card.querySelector('tbody').addEventListener('change', planifier);
      card.querySelector('tbody').addEventListener('click', function (e) { var b = e.target.closest('[data-del]'); if (!b) return; lire(); lignes.splice(Number(b.dataset.del), 1); rendre(); });
      majStock();
    }
    async function enregistrer() {
      lire();
      var m = card.querySelector('#te-msg');
      var valides = lignes.filter(function (l) { return l.type && Number(l.quantite) > 0; });
      if (!valides.length) { m.className = 'msg on err'; m.textContent = '❌ Garde au moins une ligne (produit + quantité).'; return; }
      var incompletes = valides.filter(function (l) { return !l.taille || !l.couleur; }).length;
      if (incompletes && !confirm(incompletes + ' ligne(s) sans taille ou sans couleur : elles ne seront pas commandées chez SEFI. Enregistrer quand même ?')) return;
      if (!confirm('Enregistrer le tableau (' + totalPieces() + ' pièce(s)) dans Tailles.xlsx ?')) return;
      card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      m.className = 'msg on info'; m.textContent = 'Enregistrement…';
      try {
        var bdcBox = card.querySelector('#te-bdc');
        var j = await postJ('/gestion/api/commandes/' + encodeURIComponent(cle) + '/tailles', { lignes: lignes, bdc: bdcBox ? bdcBox.checked : true });
        alert(j.etapes.join('\n'));
        if (typeof ouvrir === 'function') ouvrir(cle);
      } catch (e) {
        m.className = 'msg on err'; m.textContent = '❌ ' + e.message;
        card.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      }
    }
    rendre();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-tailles-edit]');
    if (!b) return;
    e.preventDefault();
    var card = b.closest('.card');
    if (card) ouvrirEditeur(b.dataset.taillesEdit, card);
  });
})();
