// IGS Dashboard - onglet Leïla : message d'absence (soir, week-end, congés) et modèle de reprise du lundi.
(function () {
  var box = document.getElementById('abs-card');
  if (!box) return;
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function rendre(d) {
    box.innerHTML = '<h3>🌙 Message d’absence</h3>'
      + '<div class="note" style="margin-bottom:8px">Envoyé par Leïla quand l’atelier est fermé (soir, nuit, week-end), une fois par client et par fermeture. Il remplace le message d’absence de WhatsApp Business (à désactiver dans l’appli).</div>'
      + '<label style="display:flex;gap:8px;align-items:center;margin-bottom:8px;cursor:pointer"><input type="checkbox" id="abs-on"' + (d.active ? ' checked' : '') + '> Activé</label>'
      + '<div class="field"><label>Message (soir, nuit, week-end) · {retour} = « dès lundi », « dès demain » ou « dès ce matin » selon le moment</label><textarea id="abs-t" rows="4" style="width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px">' + E(d.texte) + '</textarea></div>'
      + '<div class="field" style="margin-top:8px"><label>Message pendant les congés ({date} = date de retour)</label><textarea id="abs-c" rows="3" style="width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px">' + E(d.texte_conges) + '</textarea></div>'
      + '<div class="btnrow" style="margin-top:8px"><button class="btn primary" id="abs-ok">Enregistrer</button></div><div class="msg" id="abs-msg"></div>'
      + '<div class="note" style="margin-top:10px">📋 <b>Chaque matin de semaine à 8 h</b>, Leïla t’envoie la liste des clients qui ont écrit pendant la fermeture et dont la fenêtre WhatsApp de 24 h est dépassée : à reprendre à la main depuis l’application. Les autres sont traités par Leïla à l’ouverture.</div>';
    document.getElementById('abs-ok').onclick = async function () {
      var m = document.getElementById('abs-msg');
      try {
        var r = await fetch('/gestion/api/leila-absence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: document.getElementById('abs-on').checked, texte: document.getElementById('abs-t').value, texte_conges: document.getElementById('abs-c').value }) });
        var j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
        m.className = 'msg on ok'; m.textContent = '✅ Enregistré';
      } catch (e) { m.className = 'msg on err'; m.textContent = '❌ ' + e.message; }
    };
  }
  fetch('/gestion/api/leila-absence').then(function (r) { return r.json(); }).then(function (d) { if (!d.error) rendre(d); }).catch(function () {});
})();
