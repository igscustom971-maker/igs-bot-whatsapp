// IGS Dashboard - Leïla > Apprentissage : mode, note de ressemblance, leçons (valider / modifier / refuser / supprimer)
(function () {
  var data = null, filtre = 'proposee';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var NOMS = { proposee: 'À valider', validee: 'Validées', auto: 'Apprises seule', refusee: 'Refusées' };

  var style = document.createElement('style');
  style.textContent = '#ap-zone .ap-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px}'
    + '#ap-zone .ap-mode{display:inline-flex;border:1px solid #E3D8C4;border-radius:999px;overflow:hidden}'
    + '#ap-zone .ap-mode button{border:0;background:#fff;padding:7px 12px;font:600 12px Poppins,sans-serif;color:#1E1E4B;cursor:pointer}'
    + '#ap-zone .ap-mode button.on{background:#1E1E4B;color:#fff}'
    + '#ap-zone .ap-score{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 10px}'
    + '#ap-zone .ap-k{background:#F8F4EC;border-radius:12px;padding:8px 12px;min-width:120px}'
    + '#ap-zone .ap-k b{display:block;font-size:20px;color:#1E1E4B}#ap-zone .ap-k span{font-size:11px;color:#6b6880}'
    + '#ap-zone .ap-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}'
    + '#ap-zone .ap-tabs button{border:1px solid #E3D8C4;background:#fff;border-radius:999px;padding:5px 11px;font:600 12px Poppins,sans-serif;cursor:pointer;color:#1E1E4B}'
    + '#ap-zone .ap-tabs button.on{background:#FF1E8E;border-color:#FF1E8E;color:#fff}'
    + '#ap-zone .ap-l{border:1px solid #EFE6D6;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#fff}'
    + '#ap-zone .ap-l .s{font-size:11px;color:#FF1E8E;font-weight:700;text-transform:uppercase;letter-spacing:.03em}'
    + '#ap-zone .ap-l .r{font-weight:600;color:#1E1E4B;margin:2px 0}#ap-zone .ap-l .e{font-size:12px;color:#8a87a0;font-style:italic}'
    + '#ap-zone .ap-l .a{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}#ap-zone .ap-l .a button{padding:4px 10px;font-size:12px}'
    + '#ap-zone .ap-l textarea{width:100%;min-height:60px;margin-top:6px;border:1px solid #d8cdb8;border-radius:8px;padding:6px;font:inherit}'
    + '#ap-zone .ap-ecarts{background:#FFF6E5;border-radius:10px;padding:8px 12px;font-size:12px;margin-bottom:8px}';
  document.head.appendChild(style);

  async function api(chemin, corps) {
    var r = await fetch('/gestion/api/apprentissage' + chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : {});
    if (r.status === 401) { location.href = '/gestion/auth/login'; throw new Error('Session expirée'); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
    return j;
  }
  function sortie(t) { var o = $('lei-out'); if (o) o.textContent = t; }

  async function charger() {
    try { data = await api(''); afficher(); }
    catch (e) { $('ap-zone').innerHTML = '<div class="warnbox">Apprentissage indisponible : ' + esc(e.message) + '</div>'; }
  }

  function afficher() {
    var d = data, sem = d.semaine, prec = d.semaine_precedente;
    var tendance = sem && prec ? (sem.moy > prec.moy + 0.05 ? ' 📈' : sem.moy < prec.moy - 0.05 ? ' 📉' : ' ➡️') : '';
    var compte = {}; d.lecons.forEach(function (l) { compte[l.statut] = (compte[l.statut] || 0) + 1; });
    var liste = d.lecons.filter(function (l) { return l.statut === filtre; });
    var h = '<div class="ap-top"><div class="ap-mode"><button data-ap-mode="validation" class="' + (d.mode !== 'autonome' ? 'on' : '') + '">Avec ma validation</button><button data-ap-mode="autonome" class="' + (d.mode === 'autonome' ? 'on' : '') + '">Autonome</button></div>'
      + '<span class="note" style="font-size:12px">' + (d.mode === 'autonome' ? 'Les leçons sûres sont appliquées tout de suite (tu peux les retirer).' : 'Rien n’est appliqué sans ton accord.') + '</span></div>'
      + '<div class="ap-score"><div class="ap-k"><b>' + (sem ? sem.moy.toFixed(1) + '/5' : '—') + tendance + '</b><span>Ressemblance (7 jours' + (sem ? ', ' + sem.n + ' échange' + (sem.n > 1 ? 's' : '') : '') + ')</span></div>'
      + '<div class="ap-k"><b>' + (prec ? prec.moy.toFixed(1) + '/5' : '—') + '</b><span>Semaine d’avant</span></div>'
      + '<div class="ap-k"><b>' + ((compte.validee || 0) + (compte.auto || 0)) + '</b><span>Leçons appliquées</span></div></div>';
    if (d.derniers_ecarts && d.derniers_ecarts.length) h += '<div class="ap-ecarts"><b>Où elle se trompe encore :</b><br>' + d.derniers_ecarts.slice(0, 3).map(function (x) { return '• ' + esc(x.ecart); }).join('<br>') + '</div>';
    h += '<div class="ap-tabs">' + Object.keys(NOMS).map(function (k) { return '<button data-ap-f="' + k + '" class="' + (k === filtre ? 'on' : '') + '">' + NOMS[k] + ' (' + (compte[k] || 0) + ')</button>'; }).join('') + '</div>';
    h += liste.length ? liste.slice(0, 60).map(function (l) {
      var act = l.statut === 'proposee' ? '<button class="btn primary" data-ap="valider">✅ Valider</button><button class="btn" data-ap="editer">✏️ Modifier</button><button class="btn" data-ap="refuser">❌ Refuser</button>'
        : l.statut === 'refusee' ? '<button class="btn" data-ap="valider">✅ Valider quand même</button><button class="btn" data-ap="supprimer">🗑 Supprimer</button>'
        : '<button class="btn" data-ap="editer">✏️ Modifier</button><button class="btn" data-ap="refuser">⏸ Ne plus appliquer</button><button class="btn" data-ap="supprimer">🗑 Supprimer</button>';
      return '<div class="ap-l" data-id="' + esc(l.id) + '">' + (l.situation ? '<div class="s">' + esc(l.situation) + '</div>' : '')
        + '<div class="r">' + esc(l.regle) + '</div>' + (l.exemple ? '<div class="e">« ' + esc(l.exemple) + ' »</div>' : '')
        + '<div class="e" style="font-style:normal">' + (l.source === 'ismael' ? 'Apprise de toi' : 'Observée') + ' · ' + new Date(l.cree_le).toLocaleDateString('fr-FR') + (l.categorie ? ' · ' + esc(l.categorie) : '') + '</div>'
        + '<div class="a">' + act + '</div></div>';
    }).join('') : '<div class="note">Aucune leçon ici.</div>';
    h += '<div class="field" style="margin-top:10px"><label>Lui apprendre une règle directement</label>'
      + '<input id="ap-sit" placeholder="Quand… (ex. un client remercie après la livraison)"><textarea id="ap-regle" class="lei-ta" style="min-height:60px;margin-top:6px" placeholder="Comment répondre (ex. réponse courte et chaleureuse, un seul emoji 🙏)"></textarea></div>'
      + '<div class="btnrow"><button class="btn primary" data-ap="apprendre">🎓 Apprendre</button><button class="btn" data-ap="analyser">Analyser maintenant</button><button class="btn" data-ap="bilan-voir">Voir le bilan</button><button class="btn" data-ap="bilan">📲 Envoyer le bilan</button></div>';
    $('ap-zone').innerHTML = h;
  }

  document.addEventListener('click', async function (e) {
    if (!e.target.closest || !e.target.closest('#ap-zone')) return;
    var m = e.target.closest('[data-ap-mode]');
    if (m) {
      var mode = m.dataset.apMode; if (mode === data.mode) return;
      if (mode === 'autonome' && !confirm('Mode autonome : Leïla appliquera toute seule les leçons dont elle est sûre (tu pourras les retirer). Continuer ?')) return;
      try { await api('/mode', { mode: mode }); await charger(); } catch (err) { alert('❌ ' + err.message); }
      return;
    }
    var f = e.target.closest('[data-ap-f]');
    if (f) { filtre = f.dataset.apF; afficher(); return; }
    var b = e.target.closest('[data-ap]'); if (!b) return;
    var act = b.dataset.ap, carte = b.closest('.ap-l'), id = carte && carte.dataset.id;
    try {
      if (act === 'editer') {
        var l = data.lecons.find(function (x) { return x.id === id; });
        carte.querySelector('.a').innerHTML = '<textarea>' + esc(l.regle) + '</textarea><button class="btn primary" data-ap="modifier">Enregistrer et appliquer</button><button class="btn" data-ap="annuler">Annuler</button>';
        return;
      }
      if (act === 'annuler') { afficher(); return; }
      if (act === 'modifier') { var t = carte.querySelector('textarea').value.trim(); if (!t) return; await api('/lecons/modifier', { ids: [id], texte: t }); }
      else if (['valider', 'refuser', 'supprimer'].indexOf(act) >= 0) {
        if (act === 'supprimer' && !confirm('Supprimer définitivement cette leçon ?')) return;
        await api('/lecons/' + act, { ids: [id] });
      } else if (act === 'apprendre') {
        var regle = $('ap-regle').value.trim(); if (!regle) { alert('Écris la règle à apprendre'); return; }
        await api('/apprendre', { situation: $('ap-sit').value.trim(), regle: regle });
        filtre = 'validee'; sortie('✅ Règle apprise : appliquée dès le prochain message.');
      } else if (act === 'analyser') {
        b.disabled = true; sortie('Analyse en cours (1 à 2 min)…');
        var r = await api('/analyser', {}); sortie('🎓 ' + r.resultat); filtre = data.mode === 'autonome' ? 'auto' : 'proposee';
      } else if (act === 'bilan-voir' || act === 'bilan') {
        var j = await api('/bilan', { envoyer: act === 'bilan' });
        sortie((act === 'bilan' ? '📲 Envoyé sur ton WhatsApp :\n\n' : '') + j.texte);
      }
      await charger();
    } catch (err) { b.disabled = false; alert('❌ ' + err.message); }
  });

  function init() { if ($('ap-zone')) charger(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
