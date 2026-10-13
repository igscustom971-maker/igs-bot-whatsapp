// IGS Dashboard - onglet « BDC SEFI » : contenu du bon de commande en direct, ajout manuel (conversion en réf. SEFI),
// ajustement des quantités, envoi manuel. Accessible à toute l'équipe.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var TAILLES = ['TU', '2A', '4A', '6A', '8A', '10A', '12A', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
  var data = null, chargeLe = 0, occupe = 0, conv = null;

  var st = document.createElement('style');
  st.textContent = '.sf-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}.sf-form .field{margin:0}'
    + '#sf-apercu.ok{color:#166534;font-weight:600}#sf-apercu.err{color:#b91c1c}'
    + '.sf-l{background:#fff;border:1px solid #EFE6D6;border-radius:14px;padding:12px 14px;margin-bottom:10px}'
    + '.sf-l .hd{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.sf-l .rf{font-weight:800;color:#1E1E4B}.sf-l .tt{font-size:12px;color:#6b6880}'
    + '.sf-ch{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.sf-c{display:inline-flex;align-items:center;border:1px solid #E3D8C4;border-radius:10px;overflow:hidden;background:#FBF8F2}'
    + '.sf-c b{padding:4px 8px;font-size:12px;color:#1E1E4B;min-width:30px;text-align:center}.sf-c button{border:0;background:#fff;width:28px;height:30px;font-size:16px;cursor:pointer;color:#1E1E4B}.sf-c button:hover{background:#F4EEE2}'
    + '.sf-c input{width:44px;border:0;border-left:1px solid #E3D8C4;border-right:1px solid #E3D8C4;height:30px;text-align:center;font:inherit;font-weight:700}'
    + '.sf-l select{font-size:12px;padding:4px 6px;border:1px dashed #d8cdb8;border-radius:8px;background:#fff}.sf-del{border:0;background:none;color:#b91c1c;cursor:pointer;font-size:13px}'
    + '.sf-cmd{font-size:13px;margin:4px 0}.sf-cmd b{color:#1E1E4B}.sf-vide{text-align:center;padding:26px;color:#6b6880}';
  document.head.appendChild(st);

  async function api(chemin, corps) {
    var r = await fetch('/gestion/api/sefi/' + chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : {});
    if (r.status === 401) { location.href = '/gestion/auth/login'; throw new Error('Session expirée'); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
    return j;
  }
  function sync() { var s = $('sf-sync'); if (!s || !chargeLe) return; var n = Math.round((Date.now() - chargeLe) / 1000); s.textContent = n < 5 ? '● à jour' : '● il y a ' + n + ' s'; }

  async function charger(force) {
    if (occupe) return;
    try { data = await api('bdc' + (force ? '?force=1' : '')); chargeLe = Date.now(); afficher(); }
    catch (e) { $('sf-lignes').innerHTML = '<div class="card warnbox">BDC indisponible : ' + esc(e.message) + '</div>'; }
    sync();
  }

  function afficher() {
    var d = data; if (!d) return;
    var et = '';
    if (d.verrou) et += '<div class="card warnbox" style="margin-bottom:12px">⚠️ Envoi bloqué : ' + esc(d.verrou) + '</div>';
    if (d.dernier) et += '<div class="note" style="margin-bottom:10px">Dernier envoi : ' + new Date(d.dernier.le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' · lot ' + esc(d.dernier.lot || '') + (d.dernier.par ? ' · par ' + esc(d.dernier.par) : '') + '</div>';
    $('sf-etat').innerHTML = et;
    // Le champ qu'on est en train de taper n'est pas écrasé par l'actualisation
    var focus = document.activeElement && document.activeElement.closest && document.activeElement.closest('#sf-lignes') ? document.activeElement : null;
    if (focus) return;
    if (!d.lignes.length) { $('sf-lignes').innerHTML = '<div class="card sf-vide">Bon de commande vide : rien ne partira au prochain envoi.</div>'; }
    else {
      $('sf-lignes').innerHTML = '<div class="note" style="margin:0 0 8px"><b>' + d.total + '</b> pièce(s) · ' + d.lignes.length + ' référence(s) · ' + d.libres + ' ligne(s) libre(s)</div>' + d.lignes.map(function (l) {
        var tailles = TAILLES.filter(function (t) { return l.qtes[t]; });
        var autres = TAILLES.filter(function (t) { return !l.qtes[t]; });
        return '<div class="sf-l" data-ref="' + esc(l.ref) + '"><div class="hd"><div><span class="rf">' + esc(l.ref) + '</span> <span class="tt">· ' + l.total + ' pièce(s)</span></div><div>'
          + '<select class="sf-plus"><option value="">＋ taille</option>' + autres.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select> '
          + '<button class="sf-del" title="Retirer toute la ligne">🗑 Retirer</button></div></div>'
          + '<div class="sf-ch">' + tailles.map(function (t) { return '<span class="sf-c" data-t="' + t + '"><b>' + t + '</b><button data-d="-1">−</button><input type="number" min="0" max="999" value="' + l.qtes[t] + '"><button data-d="1">＋</button></span>'; }).join('') + '</div></div>';
      }).join('');
    }
    $('sf-commandes').innerHTML = (d.commandes && d.commandes.length) ? '<div class="card"><h3>Par commande (récap envoyé avec le BDC)</h3>' + d.commandes.map(function (c) {
      return '<div class="sf-cmd"><b>' + esc(c.devis) + '</b> ' + esc(c.client) + (c.ajout ? ' <span class="esp">ajout</span>' : '') + ' : ' + (c.articles.length ? esc(c.articles.join(', ')) : '—') + (c.stock ? ' <span class="note">(+' + c.stock + ' pris en stock)</span>' : '') + '</div>';
    }).join('') + '<div class="note" style="margin-top:6px">Une quantité modifiée à la main apparaît dans le récap SEFI en « ajout manuel » ou en « écart ».</div></div>' : '';
  }

  // ---------- Quantités ----------
  var minuteurs = {};
  function planifier(ref, t, q) {
    var k = ref + '|' + t;
    clearTimeout(minuteurs[k]);
    minuteurs[k] = setTimeout(async function () {
      occupe++;
      try { await api('quantite', { ref: ref, taille: t, qte: q }); }
      catch (e) { alert('❌ ' + e.message); }
      finally { occupe--; document.activeElement && document.activeElement.blur && document.activeElement.closest && document.activeElement.closest('#sf-lignes') && document.activeElement.blur(); charger(true); }
    }, 700);
  }
  document.addEventListener('click', async function (e) {
    var c = e.target.closest && e.target.closest('.sf-c button');
    if (c) {
      var ch = c.closest('.sf-c'), inp = ch.querySelector('input'), ref = c.closest('.sf-l').dataset.ref;
      var q = Math.max(0, (Number(inp.value) || 0) + Number(c.dataset.d)); inp.value = q;
      planifier(ref, ch.dataset.t, q); return;
    }
    var del = e.target.closest && e.target.closest('.sf-del');
    if (del) {
      var r = del.closest('.sf-l').dataset.ref;
      if (!confirm('Retirer toute la ligne « ' + r + ' » du bon de commande ?')) return;
      occupe++;
      try { await api('supprimer-ligne', { ref: r }); } catch (err) { alert('❌ ' + err.message); }
      finally { occupe--; charger(true); }
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches && e.target.matches('.sf-c input')) { var ch = e.target.closest('.sf-c'); planifier(e.target.closest('.sf-l').dataset.ref, ch.dataset.t, Math.max(0, Number(e.target.value) || 0)); }
    if (e.target.matches && e.target.matches('.sf-plus') && e.target.value) {
      var t = e.target.value, ref = e.target.closest('.sf-l').dataset.ref;
      var q = prompt('Quantité en ' + t + ' pour ' + ref + ' ?', '1'); e.target.value = '';
      if (q && Number(q) > 0) planifier(ref, t, Math.round(Number(q)));
    }
  });

  // ---------- Ajout manuel (conversion en direct) ----------
  var tc;
  function apercu() {
    clearTimeout(tc);
    var texte = $('sf-texte').value.trim(), taille = $('sf-taille').value;
    var a = $('sf-apercu');
    if (!texte) { a.className = 'note'; a.innerHTML = '&nbsp;'; $('sf-ajouter').disabled = true; conv = null; return; }
    tc = setTimeout(async function () {
      try {
        var r = await api('convertir?texte=' + encodeURIComponent(texte) + '&taille=' + encodeURIComponent(taille));
        if ($('sf-texte').value.trim() !== texte) return;
        conv = r.ok ? r : null;
        if (r.ok) { a.className = 'ok'; a.textContent = '→ ' + r.ref + (r.taille ? ' · ' + r.taille : '') + (r.prix != null ? ' · ' + r.prix.toFixed(2).replace('.', ',') + ' € HT' : ''); }
        else { a.className = 'err'; a.textContent = r.erreur + (r.couleurs ? ' · couleurs possibles : ' + r.couleurs.slice(0, 14).join(', ') + (r.couleurs.length > 14 ? '…' : '') : ''); }
        $('sf-ajouter').disabled = !r.ok;
      } catch (e) { a.className = 'err'; a.textContent = e.message; }
    }, 250);
  }
  async function ajouter() {
    var b = $('sf-ajouter'); b.disabled = true; occupe++;
    try {
      var r = await api('ajouter', { texte: $('sf-texte').value, taille: $('sf-taille').value, qte: $('sf-qte').value, pour: $('sf-pour').value });
      $('sf-apercu').className = 'ok'; $('sf-apercu').textContent = '✅ ' + r.ajoute + ' × ' + r.ref + ' ' + r.taille + ' ajouté(s) (total ' + r.qte + ' en ' + r.taille + ')';
      $('sf-texte').value = ''; $('sf-qte').value = '1'; conv = null; $('sf-texte').focus();
    } catch (e) { $('sf-apercu').className = 'err'; $('sf-apercu').textContent = '❌ ' + e.message; b.disabled = false; }
    finally { occupe--; charger(true); }
  }

  async function envoyer() {
    if (!data || !data.lignes.length) { alert('Le bon de commande est vide.'); return; }
    if (!confirm('Envoyer maintenant le bon de commande à SEFI (' + data.total + ' pièce(s)) ?\nLe récap arrive par mail à contact@ et le BDC est vidé.')) return;
    var b = $('sf-envoyer'); b.disabled = true;
    try { var r = await fetch('/gestion/api/sefi/envoyer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); var j = await r.json().catch(function () { return {}; }); alert((j.ok ? '✅ ' : '⚠️ ') + (j.message || j.error || '')); }
    catch (e) { alert('❌ ' + e.message); }
    setTimeout(function () { b.disabled = false; charger(true); }, 15000);
  }

  function init() {
    if (!$('v-sefi')) return;
    $('sf-taille').innerHTML = TAILLES.map(function (t) { return '<option' + (t === 'M' ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    $('sf-texte').addEventListener('input', apercu); $('sf-taille').addEventListener('change', apercu);
    [$('sf-texte'), $('sf-qte'), $('sf-pour')].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter' && conv) ajouter(); }); });
    $('sf-ajouter').addEventListener('click', ajouter);
    $('sf-envoyer').addEventListener('click', envoyer);
    charger(false);
    // Temps réel : relu toutes les 10 s quand l'onglet est visible (et tout de suite au retour sur l'onglet)
    setInterval(function () { if (!document.hidden) charger(false); }, 10000);
    setInterval(sync, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) charger(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
