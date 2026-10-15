// IGS Dashboard - Chiffre d'affaires > Objectifs de vente par article (admin)
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { return n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'; };
  var nb = function (n) { return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 }); };
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var data = null, edition = false, moisCourant = null;

  var st = document.createElement('style');
  st.textContent = '.ob-l{display:grid;grid-template-columns:minmax(150px,1.4fr) 1fr 120px 110px;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #F1EADC}'
    + '.ob-l .nm{font-weight:700;color:#1E1E4B}.ob-l .sb{font-size:11px;color:#8a87a0}.ob-bar{height:9px;background:#F4EEE2;border-radius:99px;overflow:hidden}.ob-bar i{display:block;height:100%;border-radius:99px}'
    + '.ob-l .v{text-align:right;font-weight:700}.ob-l .v small{display:block;font-weight:500;color:#8a87a0;font-size:11px}.ob-l.off{opacity:.5}'
    + '.ob-k{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 12px}.ob-k div{background:#F8F4EC;border-radius:12px;padding:8px 12px;min-width:130px}.ob-k b{display:block;font-size:18px;color:#1E1E4B}.ob-k span{font-size:11px;color:#6b6880}'
    + '.ob-ed td{padding:4px}.ob-ed input,.ob-ed select{width:100%;padding:6px 8px;border:1px solid #d8cdb8;border-radius:8px;font:inherit}.ob-sug{background:#EEF6FF;border-radius:12px;padding:10px 12px;margin:10px 0}'
    + '@media(max-width:700px){.ob-l{grid-template-columns:1fr 90px}.ob-l .bar{grid-column:1/-1;order:3}.ob-l .ca{display:none}}';
  document.head.appendChild(st);

  async function api(corps) {
    var r = await fetch('/gestion/api/finances/objectifs' + (corps ? '' : '?mois=' + moisCourant), corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : {});
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
    return j;
  }
  async function charger(mois) {
    moisCourant = mois; var z = $('fin-objectifs'); if (!z) return;
    if (!data || data.mois !== mois) z.innerHTML = '<div class="card" style="box-shadow:none"><h3>🎯 Objectifs de vente</h3><div class="skel"></div></div>';
    try { data = await api(); if (moisCourant === mois) afficher(); }
    catch (e) { z.innerHTML = '<div class="card" style="box-shadow:none"><h3>🎯 Objectifs de vente</h3><div class="note">Indisponible : ' + esc(e.message) + '</div></div>'; }
  }
  window.finObjectifs = charger;

  function couleur(p) { return p == null ? '#C9C3B5' : p >= 100 ? '#22A06B' : p >= 70 ? '#F5A524' : '#E5484D'; }
  function afficher() {
    var d = data, z = $('fin-objectifs'); if (!z) return;
    var mm = Number(d.mois.slice(5)) - 1, lib = MOIS[mm] + ' ' + d.mois.slice(0, 4);
    if (edition) return editer();
    var pctCible = d.cible ? Math.round(d.total_ht / d.cible * 100) : null;
    var h = '<div class="card" style="box-shadow:none"><h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">🎯 Objectifs de vente · ' + esc(lib) + ' <button class="btn" id="ob-edit">✏️ Modifier les objectifs</button></h3>';
    h += '<div class="ob-k"><div><b>' + eur(d.total_ht) + '</b><span>CA facturé HT' + (d.cible ? ' · ' + pctCible + ' % de ' + eur(d.cible) : '') + '</span></div>'
      + '<div><b>' + eur(d.objectif_ca) + '</b><span>total des objectifs' + (d.cible ? (d.objectif_ca >= d.cible ? ' ✅ ≥ cible' : ' · manque ' + eur(d.cible - d.objectif_ca) + ' pour la cible') : '') + '</span></div>'
      + '<div><b>' + (d.commandes || 0) + '</b><span>factures · panier moyen ' + eur(d.panier_moyen) + ' HT</span></div>'
      + (d.top_client ? '<div><b style="font-size:14px">' + esc(d.top_client.nom) + '</b><span>top client · ' + eur(d.top_client.ht) + ' HT</span></div>' : '') + '</div>';
    h += d.lignes.map(function (l) {
      var p = l.pct, w = Math.min(100, p || 0);
      return '<div class="ob-l' + (l.active ? '' : ' off') + '"><div><div class="nm">' + esc(l.nom) + '</div><div class="sb">' + (l.active ? (l.objectif ? 'objectif ' + nb(l.objectif) + ' ' + l.unite + ' × ' + nb(l.prix) + ' € = ' + eur(l.objectif_ca) : 'pas d’objectif') : 'à partir de ' + esc(l.depuis)) + '</div></div>'
        + '<div class="bar"><div class="ob-bar"><i style="width:' + w + '%;background:' + couleur(p) + '"></i></div>' + (l.objectif && l.reste ? '<div class="sb" style="margin-top:3px">reste ' + nb(l.reste) + ' ' + l.unite + '</div>' : (l.objectif && l.qte >= l.objectif ? '<div class="sb" style="margin-top:3px;color:#166534">objectif atteint ✅</div>' : '')) + '</div>'
        + '<div class="v">' + nb(l.qte) + ' ' + l.unite + (p != null ? '<small>' + p + ' %</small>' : '') + '</div>'
        + '<div class="v ca">' + eur(l.ca) + '<small>CA HT</small></div></div>';
    }).join('');
    if (d.autres && d.autres.length) h += '<details style="margin-top:8px"><summary class="note">Autres ventes non rattachées à un objectif : ' + eur(d.autres_ca) + ' HT (' + d.autres.length + ' article(s))</summary><div class="note" style="margin-top:6px">' + d.autres.map(function (a) { return esc(a.produit) + ' : ' + nb(a.qte) + ' · ' + eur(a.ca); }).join('<br>') + '<br><i>Pour les rattacher, ajoute un mot de leur nom (ou « ref:CODE ») dans le filtre d’une ligne.</i></div></details>';
    if (d.suggestion && d.suggestion.length) h += '<div class="ob-sug"><b>Pour atteindre la cible de ' + eur(d.cible) + '</b>, tes objectifs devraient passer à : ' + d.suggestion.map(function (s) { return esc(s.nom) + ' ' + nb(s.objectif) + ' → <b>' + nb(s.propose) + '</b>'; }).join(' · ') + ' <button class="btn primary" id="ob-appliquer" style="margin-left:6px">Appliquer</button><div class="note">Répartition au prorata de tes objectifs actuels ; tu peux ensuite ajuster ligne par ligne.</div></div>';
    h += '<div class="msg" id="ob-msg"></div></div>';
    z.innerHTML = h;
    $('ob-edit').onclick = function () { edition = true; editer(); };
    if ($('ob-appliquer')) $('ob-appliquer').onclick = appliquer;
  }

  function ligneEd(l) {
    return '<tr><td><input class="o-nom" value="' + esc(l.nom || '') + '"></td><td><input class="o-filtre" value="' + esc(l.filtre || '') + '" placeholder="mots, ref:ENT, -exclu"></td>'
      + '<td><select class="o-u"><option value="u"' + (l.unite !== 'm' ? ' selected' : '') + '>u</option><option value="m"' + (l.unite === 'm' ? ' selected' : '') + '>m</option></select></td>'
      + '<td><input class="o-obj" inputmode="decimal" value="' + esc(l.objectif != null ? String(l.objectif).replace('.', ',') : '') + '"></td><td><input class="o-prix" inputmode="decimal" value="' + esc(l.prix != null ? String(l.prix).replace('.', ',') : '') + '"></td>'
      + '<td><input class="o-depuis" type="month" value="' + esc(l.depuis || '') + '"></td><td><button class="btn o-del" title="Supprimer">✕</button></td></tr>';
  }
  function editer() {
    var d = data, z = $('fin-objectifs');
    var h = '<div class="card" style="box-shadow:none"><h3>✏️ Objectifs de vente (par mois)</h3>'
      + '<div class="note" style="margin-bottom:8px">Objectif mensuel en quantité et prix moyen HT. Filtre : mots du nom de l’article ou de sa référence (« ref:ENT » = référence qui commence par ENT, « -mot » exclut) ; une vente va à la première ligne qui correspond. « À partir de » : la ligne ne compte qu’à partir de ce mois.</div>'
      + '<div style="overflow-x:auto"><table class="ob-ed" style="width:100%;min-width:720px"><thead><tr><th>Ligne</th><th>Filtre (articles Odoo)</th><th>Unité</th><th>Objectif / mois</th><th>Prix moyen HT</th><th>À partir de</th><th></th></tr></thead><tbody id="ob-tb">'
      + d.lignes.map(ligneEd).join('') + '</tbody></table></div><button class="btn" id="ob-add" style="margin-top:6px">＋ Ajouter une ligne</button>'
      + '<div class="field" style="margin-top:12px;max-width:340px"><label>Cible de CA pour ' + esc(d.mois) + ' (vide = cible de la phase)</label><input id="ob-cible" inputmode="decimal" value="' + esc(d.cibles_mois && d.cibles_mois[d.mois] ? d.cibles_mois[d.mois] : '') + '"></div>'
      + '<div class="btnrow"><button class="btn primary" id="ob-save">Enregistrer</button><button class="btn" id="ob-cancel">Annuler</button></div><div class="msg" id="ob-msg"></div></div>';
    z.innerHTML = h;
    $('ob-add').onclick = function () { $('ob-tb').insertAdjacentHTML('beforeend', ligneEd({ unite: 'u', objectif: 0, prix: 0 })); };
    $('ob-tb').onclick = function (e) { var b = e.target.closest('.o-del'); if (b) b.closest('tr').remove(); };
    $('ob-cancel').onclick = function () { edition = false; afficher(); };
    $('ob-save').onclick = sauver;
  }
  async function sauver() {
    var num = function (v) { return Number(String(v || '').replace(/\s|€/g, '').replace(',', '.')) || 0; };
    var lignes = Array.prototype.map.call($('ob-tb').rows, function (tr) {
      return { nom: tr.querySelector('.o-nom').value, filtre: tr.querySelector('.o-filtre').value, unite: tr.querySelector('.o-u').value, objectif: num(tr.querySelector('.o-obj').value), prix: num(tr.querySelector('.o-prix').value), depuis: tr.querySelector('.o-depuis').value };
    });
    var cibles = Object.assign({}, data.cibles_mois || {}); var c = num($('ob-cible').value);
    if (c > 0) cibles[data.mois] = c; else delete cibles[data.mois];
    $('ob-save').disabled = true;
    try { await api({ lignes: lignes, cibles_mois: cibles }); edition = false; await charger(moisCourant); }
    catch (e) { $('ob-msg').className = 'msg on err'; $('ob-msg').textContent = '❌ ' + e.message; $('ob-save').disabled = false; }
  }
  async function appliquer() {
    if (!confirm('Mettre à jour les objectifs avec les quantités proposées ?')) return;
    var lignes = data.lignes.map(function (l) { var s = (data.suggestion || []).find(function (x) { return x.i === l.i; }); return { nom: l.nom, filtre: l.filtre, unite: l.unite, objectif: s ? s.propose : l.objectif, prix: l.prix, depuis: l.depuis || '' }; });
    try { await api({ lignes: lignes, cibles_mois: data.cibles_mois || {} }); await charger(moisCourant); }
    catch (e) { alert('❌ ' + e.message); }
  }
  if (window.__finObjMois) charger(window.__finObjMois);
})();
