// IGS Dashboard - « Mes tâches » (Ismaël) : liste perso, aussi alimentée par Leïla sur WhatsApp.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var st = document.createElement('style');
  st.textContent = '.td-form{display:flex;gap:10px;flex-wrap:wrap}.td-form input,.td-form select{width:100%;box-sizing:border-box}'
    + '.td-item{display:flex;gap:12px;align-items:flex-start;padding:10px 4px;border-top:1px solid var(--line,#eee)}.td-item:first-of-type{border-top:0}'
    + '.td-item input[type=checkbox]{width:20px;height:20px;margin-top:2px;cursor:pointer;flex:0 0 auto}'
    + '.td-t{flex:1;min-width:0}.td-t b{font-weight:600}.td-fait .td-t b{text-decoration:line-through;color:#8a8aa3;font-weight:500}'
    + '.td-meta{font-size:12px;color:#8a8aa3;margin-top:2px}.td-retard{color:#b91c1c;font-weight:700}.td-auj{color:#c2410c;font-weight:700}'
    + '.td-act{display:flex;gap:4px}.td-act button{border:0;background:none;cursor:pointer;font-size:15px;padding:2px 6px;color:#8a8aa3}.td-act button:hover{color:#1E1E4B}'
    + '.td-src{display:inline-block;font-size:11px;background:#eef2ff;color:#4338ca;border-radius:6px;padding:0 6px;margin-left:6px}';
  document.head.appendChild(st);
  var donnees = [];
  var fdate = function (s) { return new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }); };
  var postJ = async function (url, body) {
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
    return j;
  };
  function item(t) {
    var quand = t.echeance ? (t.en_retard ? '<span class="td-retard">⏰ en retard (' + fdate(t.echeance) + ')</span>' : t.aujourdhui ? '<span class="td-auj">📌 aujourd’hui</span>' : '📅 ' + fdate(t.echeance)) : '';
    var meta = [quand, t.priorite === 'haute' ? '🔥 priorité haute' : t.priorite === 'basse' ? 'priorité basse' : '', t.fait && t.fait_le ? '✅ faite le ' + new Date(t.fait_le).toLocaleDateString('fr-FR') : ''].filter(Boolean).join(' · ');
    return '<div class="td-item' + (t.fait ? ' td-fait' : '') + '" data-id="' + E(t.id) + '"><input type="checkbox" data-fait' + (t.fait ? ' checked' : '') + ' title="' + (t.fait ? 'Remettre à faire' : 'Marquer comme faite') + '">'
      + '<div class="td-t"><b>' + E(t.texte) + '</b>' + (/Leïla/.test(t.par || '') ? '<span class="td-src" title="Ajoutée par Leïla sur WhatsApp">via Leïla</span>' : '')
      + (t.note ? '<div class="td-meta" style="color:#555">' + E(t.note) + '</div>' : '') + (meta ? '<div class="td-meta">' + meta + '</div>' : '') + '</div>'
      + '<div class="td-act">' + (t.fait ? '' : '<button data-date title="Changer la date">📅</button><button data-prio title="Priorité haute / normale">🔥</button><button data-edit title="Modifier le texte">✏️</button>') + '<button data-suppr title="Supprimer">🗑</button></div></div>';
  }
  function rendre() {
    var enCours = donnees.filter(function (t) { return !t.fait; }), faites = donnees.filter(function (t) { return t.fait; });
    var groupes = [
      ['⏰ En retard', enCours.filter(function (t) { return t.en_retard; })],
      ['📌 Aujourd’hui', enCours.filter(function (t) { return t.aujourdhui; })],
      ['📅 À venir', enCours.filter(function (t) { return t.echeance && !t.en_retard && !t.aujourdhui; })],
      ['🗂 Sans date', enCours.filter(function (t) { return !t.echeance; })],
    ].filter(function (g) { return g[1].length; });
    var h = groupes.length ? groupes.map(function (g) { return '<div class="card" style="margin-bottom:12px"><h3>' + g[0] + ' · ' + g[1].length + '</h3>' + g[1].map(item).join('') + '</div>'; }).join('')
      : '<div class="card"><div class="note">Rien à faire pour l’instant 🎉 Ajoute une tâche ci-dessus ou demande à Leïla sur WhatsApp.</div></div>';
    if (faites.length) h += '<details class="card" style="margin-top:12px"><summary class="note" style="cursor:pointer">✅ Faites (30 derniers jours) · ' + faites.length + '</summary>' + faites.map(item).join('') + '</details>';
    $('td-liste').innerHTML = h;
    if (window.navTodo) window.navTodo();
  }
  async function charger() {
    try { var r = await fetch('/gestion/api/todo'); var j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); donnees = j.taches || []; rendre(); }
    catch (e) { $('td-liste').innerHTML = '<div class="card"><div class="warnbox">❌ ' + E(e.message) + '</div></div>'; }
  }
  async function maj(id, champs) {
    try { await postJ('/gestion/api/todo/' + encodeURIComponent(id), champs); await charger(); } catch (e) { alert('❌ ' + e.message); }
  }
  function brancher() {
    var msg = function (t, k) { $('td-msg').className = 'msg on ' + k; $('td-msg').textContent = t; };
    var ajouter = async function () {
      var texte = $('td-texte').value.trim(); if (!texte) { $('td-texte').focus(); return; }
      $('td-ajouter').disabled = true;
      try { await postJ('/gestion/api/todo', { texte: texte, echeance: $('td-date').value || null, priorite: $('td-prio').value }); $('td-texte').value = ''; $('td-date').value = ''; $('td-prio').value = 'normale'; msg('✅ Tâche ajoutée', 'ok'); setTimeout(function () { $('td-msg').className = 'msg'; }, 1500); await charger(); $('td-texte').focus(); }
      catch (e) { msg('❌ ' + e.message, 'err'); }
      finally { $('td-ajouter').disabled = false; }
    };
    $('td-ajouter').onclick = ajouter;
    $('td-texte').addEventListener('keydown', function (e) { if (e.key === 'Enter') ajouter(); });
    $('td-liste').addEventListener('change', function (e) {
      if (!e.target.matches('[data-fait]')) return;
      var id = e.target.closest('[data-id]').dataset.id; maj(id, { fait: e.target.checked });
    });
    $('td-liste').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var id = b.closest('[data-id]').dataset.id, t = donnees.find(function (x) { return x.id === id; }); if (!t) return;
      if (b.hasAttribute('data-suppr')) { if (confirm('Supprimer « ' + t.texte + ' » ?')) postJ('/gestion/api/todo/' + encodeURIComponent(id) + '/supprimer').then(charger).catch(function (er) { alert(er.message); }); }
      else if (b.hasAttribute('data-edit')) { var v = prompt('Tâche :', t.texte); if (v && v.trim() && v.trim() !== t.texte) maj(id, { texte: v.trim() }); }
      else if (b.hasAttribute('data-prio')) maj(id, { priorite: t.priorite === 'haute' ? 'normale' : 'haute' });
      else if (b.hasAttribute('data-date')) { var d = prompt('Pour quand ? (jj/mm, AAAA-MM-JJ, « demain », vide = sans date)', t.echeance ? t.echeance.split('-').reverse().slice(0, 2).join('/') : ''); if (d !== null) maj(id, { echeance: d.trim() }); }
    });
  }
  function go() { if (!$('td-liste')) return; brancher(); charger(); setInterval(function () { if (!document.hidden) charger(); }, 60000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
