// IGS Dashboard - onglet Produits : catalogue Odoo par catégorie, prix TTC (modifiables par admin / commercial)
(function () {
  var data = null, peutModifier = false, recherche = '';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { return n == null ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; };
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };

  var style = document.createElement('style');
  style.textContent = '#pr-liste .pr-cat{margin-bottom:14px}#pr-liste .pr-cat h3{display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;user-select:none}'
    + '#pr-liste table{width:100%;border-collapse:collapse}#pr-liste td,#pr-liste th{padding:9px 8px;border-bottom:1px solid #EFE6D6;text-align:left;vertical-align:middle;font-size:14px}'
    + '#pr-liste th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8a87a0;font-weight:700}#pr-liste td.px{text-align:right;white-space:nowrap;font-weight:800}'
    + '#pr-liste th.px{text-align:right}#pr-liste .ref{color:#8a87a0;font-size:12px}#pr-liste .ht{color:#8a87a0;font-size:12px;font-weight:500;text-align:right;white-space:nowrap}'
    + '#pr-liste button.pr-px{border:1px dashed #d8cdb8;background:#fff;border-radius:8px;padding:4px 10px;font:inherit;font-weight:800;cursor:pointer}#pr-liste button.pr-px:hover{border-color:#FF1E8E;color:#FF1E8E}'
    + '#pr-liste .pr-ed{display:flex;gap:6px;justify-content:flex-end;align-items:center}#pr-liste .pr-ed input{width:90px;padding:5px 8px;border:1px solid #d8cdb8;border-radius:8px;font:inherit;text-align:right}'
    + '#pr-liste .desc{color:#8a87a0;font-size:12px;margin-top:2px}#pr-liste .nb{font-size:12px;color:#8a87a0;font-weight:600}'
    + '@media(max-width:700px){#pr-liste .c-ref,#pr-liste .ht{display:none}}';
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

  function afficher() {
    if (!data) return;
    var q = norm(recherche);
    var html = data.categories.map(function (c) {
      var ps = c.produits.filter(function (p) { return !q || norm(p.nom + ' ' + (p.ref || '') + ' ' + c.nom + ' ' + (p.description || '')).indexOf(q) >= 0; });
      if (!ps.length) return '';
      return '<div class="card pr-cat"><h3>' + esc(c.nom) + ' <span class="nb">' + ps.length + ' produit(s)</span></h3>'
        + '<table><thead><tr><th>Produit</th><th class="c-ref">Réf.</th><th class="ht">HT</th><th class="px">Prix TTC</th></tr></thead><tbody>'
        + ps.map(function (p) {
          var prix = peutModifier ? '<button class="pr-px" data-id="' + p.id + '" title="Modifier le prix TTC">' + eur(p.prix_ttc) + '</button>' : eur(p.prix_ttc);
          return '<tr data-id="' + p.id + '"><td><b>' + esc(p.nom) + '</b>' + (p.description ? '<div class="desc">' + esc(String(p.description).slice(0, 140)) + '</div>' : '') + '</td>'
            + '<td class="c-ref ref">' + esc(p.ref || '') + '</td><td class="ht">' + eur(p.prix_ht) + (p.taux_tva ? '<br>TVA ' + String(p.taux_tva).replace('.', ',') + ' %' : '') + '</td><td class="px">' + prix + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
    $('pr-liste').innerHTML = html || '<div class="card note">Aucun produit pour cette recherche.</div>';
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
    if (e.target.closest && e.target.closest('#pr-liste .pr-no')) { afficher(); return; }
    var ok = e.target.closest && e.target.closest('#pr-liste .pr-ok');
    if (ok) {
      var tr = ok.closest('tr'), id = Number(tr.dataset.id), prod = trouver(id);
      var v = tr.querySelector('.pr-ed input').value.trim().replace(/\s|€/g, '').replace(',', '.');
      if (!(Number(v) >= 0) || v === '') { alert('Prix invalide'); return; }
      if (!confirm('Nouveau prix de « ' + prod.nom + ' » : ' + eur(Number(v)) + ' TTC (au lieu de ' + eur(prod.prix_ttc) + ').\nLe prix est changé dans Odoo pour les prochains devis.')) return;
      ok.disabled = true;
      try {
        var r = await fetch('/gestion/api/produits/' + id + '/prix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prix_ttc: Number(v) }) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
        prod.prix_ttc = j.prix_ttc; prod.prix_ht = j.prix_ht;
        afficher(); info('✅ Prix de « ' + prod.nom + ' » : ' + eur(j.prix_ttc) + ' TTC');
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
