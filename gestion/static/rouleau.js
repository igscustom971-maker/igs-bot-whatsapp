// IGS Dashboard - carte « Rouleau de film DTF » (Stock et Planches) : mètres restants, rouleau neuf, correction.
(function () {
  var box = document.getElementById('rl-card');
  if (!box || box.dataset.ok) return; box.dataset.ok = '1';
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var m = function (n) { return String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',') + ' m'; };
  var post = async function (url, body) {
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
    return j;
  };
  var COUL = { ok: '#15803d', commander: '#c2410c', critique: '#b91c1c', inconnu: '#8a8aa3' };
  function rendre(d) {
    var c = COUL[d.niveau] || COUL.ok;
    var h = '<div class="card" style="margin-bottom:14px"><h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">🧻 Rouleau de film DTF'
      + '<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-rl="nouveau">🆕 Rouleau neuf posé</button>' + (d.actif ? '<button class="btn" data-rl="corriger">✏️ Corriger</button><button class="btn" data-rl="perte">➖ Perte / réglage</button>' : '') + '</span></h3>';
    if (!d.actif) h += '<div class="note">Pas encore de rouleau suivi. Clique « Rouleau neuf posé » quand tu mets un rouleau (100 m) : les planches imprimées seront décomptées et Leïla te préviendra à ' + m(d.seuil) + '.</div>';
    else {
      h += '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><b style="font-size:28px;color:' + c + '">' + m(d.restant) + '</b><span class="note">restants sur ' + m(d.longueur) + ' · ' + m(d.consomme) + ' utilisés depuis le ' + new Date(d.pose_le).toLocaleDateString('fr-FR') + '</span></div>'
        + '<div style="height:10px;background:#f1ece4;border-radius:6px;overflow:hidden;margin:8px 0"><div style="height:100%;width:' + d.pct + '%;background:' + c + '"></div></div>'
        + (d.niveau === 'critique' ? '<div class="warnbox">🚨 Rouleau presque fini : commande un nouveau rouleau tout de suite si ce n’est pas fait.</div>' : d.niveau === 'commander' ? '<div class="warnbox">🛒 Moins de ' + m(d.seuil) + ' : pense à commander un nouveau rouleau.</div>' : '<div class="note">Alerte Leïla à ' + m(d.seuil) + ' restants, puis à ' + m(d.seuil_critique) + '.</div>');
      if (d.journal && d.journal.length) h += '<details style="margin-top:8px"><summary class="note" style="cursor:pointer">Derniers mouvements</summary><div class="note" style="margin-top:6px">'
        + d.journal.slice(0, 15).map(function (j) {
          var quand = new Date(j.le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          var quoi = j.type === 'planche' ? '−' + m(j.metres) + ' · ' + E(j.client) : j.type === 'nouveau' ? '🆕 rouleau neuf ' + m(j.metres) + (j.par ? ' (' + E(j.par) + ')' : '') : j.type === 'perte' ? '−' + m(j.metres) + ' perte' + (j.note ? ' · ' + E(j.note) : '') : '✏️ corrigé (' + (j.metres > 0 ? '+' : '') + m(j.metres) + ')' + (j.note ? ' · ' + E(j.note) : '');
          return quand + ' · ' + quoi + ' → ' + m(j.restant);
        }).join('<br>') + '</div></details>';
    }
    box.innerHTML = h + '</div>';
  }
  async function charger() {
    try { var r = await fetch('/gestion/api/rouleau'); if (!r.ok) { box.innerHTML = ''; return; } rendre(await r.json()); } catch (e) { box.innerHTML = ''; }
  }
  box.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-rl]'); if (!b) return;
    try {
      if (b.dataset.rl === 'nouveau') {
        var L = prompt('Rouleau neuf posé : longueur (m)', '100'); if (L === null) return;
        rendre(await post('/gestion/api/rouleau/nouveau', { longueur: L }));
      } else if (b.dataset.rl === 'corriger') {
        var r = prompt('Combien reste-t-il vraiment sur le rouleau (m) ?'); if (r === null || !r.trim()) return;
        rendre(await post('/gestion/api/rouleau/corriger', { restant: r, note: 'mesuré' }));
      } else if (b.dataset.rl === 'perte') {
        var p = prompt('Mètres perdus (réglages, impression ratée, test) :'); if (p === null || !p.trim()) return;
        var n = prompt('Raison (facultatif) :', '') || '';
        rendre(await post('/gestion/api/rouleau/corriger', { perte: p, note: n }));
      }
    } catch (err) { alert('❌ ' + err.message); }
  });
  charger();
  setInterval(function () { if (!document.hidden) charger(); }, 120000);
})();
