// IGS Dashboard - onglet Produits : catalogue Odoo par catégorie, prix TTC (modifiables par admin / commercial)
(function () {
  var data = null, peutModifier = false, recherche = '', onglet = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { return n == null ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; };
  var nomPropre = function (n) { return String(n || '').replace(/^\s*\[[^\]]*\]\s*/, ''); };
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };

  var style = document.createElement('style');
  style.textContent = '#pr-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}'
    + '#pr-tabs button{border:1px solid #E3D8C4;background:#fff;border-radius:999px;padding:8px 14px;font:600 13px Poppins,sans-serif;color:#1E1E4B;cursor:pointer;display:flex;gap:6px;align-items:center}'
    + '#pr-tabs button span{background:#F4EEE2;border-radius:999px;padding:1px 8px;font-size:11px;color:#6b6880}'
    + '#pr-tabs button.on{background:#1E1E4B;color:#fff;border-color:#1E1E4B}#pr-tabs button.on span{background:rgba(255,255,255,.18);color:#fff}'
    + '#pr-liste .pr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}'
    + '#pr-liste .pr-c{background:#fff;border:1px solid #EFE6D6;border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-height:118px}'
    + '#pr-liste .pr-c .nm{font-weight:700;font-size:14px;line-height:1.3;color:#1E1E4B}'
    + '#pr-liste .pr-c .ref{display:inline-block;font-size:11px;color:#6b6880;background:#F4EEE2;border-radius:6px;padding:1px 7px;align-self:flex-start}'
    + '#pr-liste .pr-c .desc{color:#8a87a0;font-size:12px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
    + '#pr-liste .pr-c .bas{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:8px;padding-top:6px}'
    + '#pr-liste .pr-c .ttc{font-size:20px;font-weight:800;color:#1E1E4B}#pr-liste .pr-c .ttc small{font-size:11px;font-weight:600;color:#8a87a0;margin-left:3px}'
    + '#pr-liste .pr-c .ht{font-size:11px;color:#8a87a0;text-align:right}'
    + '#pr-liste .pr-c .cat{font-size:11px;color:#FF1E8E;font-weight:700;text-transform:uppercase;letter-spacing:.04em}'
    + '#pr-liste button.pr-px{border:1px dashed #d8cdb8;background:#fff;border-radius:10px;padding:2px 10px;font:inherit;cursor:pointer}#pr-liste button.pr-px:hover{border-color:#FF1E8E;color:#FF1E8E}'
    + '#pr-liste .pr-ed{display:flex;gap:6px;align-items:center}#pr-liste .pr-ed input{width:80px;padding:6px 8px;border:1px solid #d8cdb8;border-radius:8px;font:inherit;text-align:right}';
  document.head.appendChild(style);

  function info(t, err) { var m = $('pr-info'); if (m) { m.textContent = t || ''; m.style.color = err ? '#b91c1c' : ''; } }

  async function charger(force) {
    info('Chargement…');
    try {
      var r = await fetch('/gestion/api/produits' + (force ? '?force=1' : ''));
      if (r.status === 401) { location.href = '/gestion/auth/login'; return; }
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
      data = j; peutModifier = !!j.peut_modifier;
      info(j.total + ' produit(s) · mis à jour à ' + new Date(j.le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      afficher();
    } catch (e) {
      info('');
      $('pr-liste').innerHTML = '<div class="card warnbox">Produits indisponibles : ' + esc(e.message) + '</div>';
    }
  }

  function carte(p, cat) {
    var prix = '<span class="ttc">' + eur(p.prix_ttc) + '<small>TTC</small></span>';
    if (peutModifier) prix = '<button class="pr-px" data-id="' + p.id + '" title="Modifier le prix TTC">' + prix + '</button>';
    return '<div class="pr-c" data-id="' + p.id + '">' + (cat ? '<div class="cat">' + esc(cat) + '</div>' : '')
      + '<div class="nm">' + esc(nomPropre(p.nom)) + '</div>' + (p.ref ? '<span class="ref">' + esc(p.ref) + '</span>' : '')
      + (p.description ? '<div class="desc">' + esc(String(p.description).replace(/^[\s\-–•]+/, '')) + '</div>' : '')
      + '<div class="bas"><div class="pxz">' + prix + '</div><div class="ht">' + eur(p.prix_ht) + ' HT' + (p.taux_tva ? '<br>TVA ' + String(p.taux_tva).replace('.', ',') + ' %' : '') + '</div></div></div>';
  }
  function afficher() {
    if (!data) return;
    var q = norm(recherche);
    if (!onglet || !data.categories.some(function (c) { return c.nom === onglet; })) onglet = data.categories.length ? data.categories[0].nom : null;
    // Onglets par catégorie (avec le nombre de produits)
    $('pr-tabs').innerHTML = data.categories.map(function (c) {
      var n = c.produits.filter(function (p) { return !q || norm(p.nom + ' ' + (p.ref || '') + ' ' + c.nom + ' ' + (p.description || '')).indexOf(q) >= 0; }).length;
      return '<button data-tab="' + esc(c.nom) + '" class="' + (!q && c.nom === onglet ? 'on' : '') + '"' + (q && !n ? ' style="opacity:.45"' : '') + '>' + esc(c.nom) + '<span>' + n + '</span></button>';
    }).join('');
    var html;
    if (q) {
      // Recherche : résultats de toutes les catégories
      var res = [];
      data.categories.forEach(function (c) { c.produits.forEach(function (p) { if (norm(p.nom + ' ' + (p.ref || '') + ' ' + c.nom + ' ' + (p.description || '')).indexOf(q) >= 0) res.push(carte(p, c.nom)); }); });
      html = res.length ? '<div class="pr-grid">' + res.join('') + '</div>' : '<div class="card note">Aucun produit pour cette recherche.</div>';
    } else {
      var c = data.categories.find(function (x) { return x.nom === onglet; });
      html = c ? '<div class="pr-grid">' + c.produits.map(function (p) { return carte(p); }).join('') + '</div>' : '<div class="card note">Aucun produit.</div>';
    }
    $('pr-liste').innerHTML = html;
  }

  function trouver(id) {
    for (var i = 0; i < data.categories.length; i++) for (var k = 0; k < data.categories[i].produits.length; k++) if (data.categories[i].produits[k].id === id) return data.categories[i].produits[k];
    return null;
  }

  document.addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('#pr-liste button.pr-px');
    if (b) {
      var p = trouver(Number(b.dataset.id)); if (!p) return;
      var td = b.parentNode;
      td.innerHTML = '<div class="pr-ed"><input type="text" inputmode="decimal" value="' + String(p.prix_ttc).replace('.', ',') + '"> € <button class="btn primary pr-ok">OK</button><button class="btn pr-no">✕</button></div>';
      var inp = td.querySelector('input'); inp.focus(); inp.select();
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') td.querySelector('.pr-ok').click(); if (ev.key === 'Escape') afficher(); });
      return;
    }
    var tab = e.target.closest && e.target.closest('#pr-tabs button');
    if (tab) { onglet = tab.dataset.tab; recherche = ''; $('pr-q').value = ''; afficher(); return; }
    if (e.target.closest && e.target.closest('#pr-liste .pr-no')) { afficher(); return; }
    var ok = e.target.closest && e.target.closest('#pr-liste .pr-ok');
    if (ok) {
      var tr = ok.closest('.pr-c'), id = Number(tr.dataset.id), prod = trouver(id);
      var v = tr.querySelector('.pr-ed input').value.trim().replace(/\s|€/g, '').replace(',', '.');
      if (!(Number(v) >= 0) || v === '') { alert('Prix invalide'); return; }
      if (!confirm('Nouveau prix de « ' + nomPropre(prod.nom) + ' » : ' + eur(Number(v)) + ' TTC (au lieu de ' + eur(prod.prix_ttc) + ').\nLe prix est changé dans Odoo pour les prochains devis.')) return;
      ok.disabled = true;
      try {
        var r = await fetch('/gestion/api/produits/' + id + '/prix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prix_ttc: Number(v) }) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
        prod.prix_ttc = j.prix_ttc; prod.prix_ht = j.prix_ht;
        afficher(); info('✅ Prix de « ' + nomPropre(prod.nom) + ' » : ' + eur(j.prix_ttc) + ' TTC');
      } catch (err) { ok.disabled = false; alert('❌ ' + err.message); }
    }
  });

  function init() {
    if (!$('pr-liste')) return;
    $('pr-q').addEventListener('input', function (e) { recherche = e.target.value; afficher(); });
    $('pr-refresh').addEventListener('click', function () { charger(true); });
    charger(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
