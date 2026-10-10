// ============================================
// IGS GESTION - PAGE COMMANDES (HTML + JS sans dépendance)
// ============================================

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(user, view = 'accueil') {
  const prenom = user.role === 'admin' ? (user.name || '').split(' ')[0] : 'l\'équipe';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>IGS Gestion · ${view === 'commandes' ? 'Commandes' : 'Accueil'}</title>
<link rel="icon" href="https://igscustom.fr/wp-content/uploads/2026/05/IGS-CUSTOM-BAR-LOGO.png">
<style>
:root{
  --ink:#1e1b4b; --pink:#e91e8c; --bg:#f6f4fb; --card:#fff; --line:#e7e3f1; --muted:#6b6880;
  --soft:#f1edf9; --ok:#15803d; --warn:#b45309; --bad:#b91c1c; --radius:12px;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
button{font:inherit;cursor:pointer}
a{color:inherit}
header{position:sticky;top:0;z-index:5;background:linear-gradient(135deg,#ffd6ec,#e8d5f5);border-bottom:1px solid var(--line)}
.bar{max-width:1280px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
.bar img{height:34px}
.bar h1{font-size:17px;margin:0;font-weight:800;letter-spacing:.2px}
.bar nav{display:flex;gap:4px;margin-left:12px}
.bar nav a{padding:6px 10px;border-radius:8px;text-decoration:none;font-weight:600;color:var(--muted)}
.bar nav a.on{background:#fff;color:var(--ink)}
.bar nav a.off{opacity:.45;pointer-events:none}
.who{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.who b{color:var(--ink)}
.who a{font-weight:600}
main{max-width:1280px;margin:0 auto;padding:14px 16px 40px}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.search{flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font:inherit;color:var(--ink)}
.btn{border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 12px;font-weight:600;color:var(--ink)}
.btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.sync{font-size:12px;color:var(--muted)}
.sync.err{color:var(--bad);font-weight:600}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;color:var(--muted);display:flex;gap:6px;align-items:center}
.chip .n{background:var(--soft);border-radius:999px;padding:0 7px;color:var(--ink)}
.chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.chip.on .n{background:rgba(255,255,255,.2);color:#fff}
.tablewrap{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
table{width:100%;border-collapse:collapse}
th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);text-align:left;padding:10px 12px;background:#faf9fd;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
tr.row{cursor:pointer}
tr.row:hover td{background:#fbf9ff}
tr.row:last-child td{border-bottom:none}
.devis{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.client{font-weight:600}
.sub{font-size:12px;color:var(--muted)}
.clip{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid transparent}
.c-zone{min-width:130px}
.late{color:var(--bad);font-weight:700}
.dyn{color:var(--warn);font-size:11px;font-weight:600}
.empty{padding:40px;text-align:center;color:var(--muted)}
/* Panneau détail */
.overlay{position:fixed;inset:0;background:rgba(30,27,75,.35);opacity:0;pointer-events:none;transition:.2s;z-index:10}
.overlay.on{opacity:1;pointer-events:auto}
.panel{position:fixed;top:0;right:0;height:100%;width:min(760px,100%);background:var(--bg);z-index:11;transform:translateX(100%);transition:.25s;display:flex;flex-direction:column;box-shadow:-10px 0 30px rgba(30,27,75,.15)}
.panel.on{transform:none}
.phead{background:#fff;border-bottom:1px solid var(--line);padding:14px 18px;display:flex;gap:12px;align-items:flex-start}
.phead h2{margin:0;font-size:18px}
.phead .x{margin-left:auto;border:none;background:var(--soft);border-radius:8px;width:34px;height:34px;font-size:18px;color:var(--ink)}
.pbody{overflow:auto;padding:14px 18px 40px;display:flex;flex-direction:column;gap:12px}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.card h3{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px 16px}
.kv .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
.kv .v{font-weight:600;white-space:pre-wrap;word-break:break-word}
.pre{white-space:pre-wrap}
.bat{width:100%;height:520px;border:1px solid var(--line);border-radius:8px;background:#fafafa}
.visuels{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.visuel{border:1px solid var(--line);border-radius:10px;padding:10px}
.visuel .t{font-weight:700;margin-bottom:8px}
.imgs{display:flex;gap:8px}
.imgs a{flex:1;display:block;background:#f3f1f8;border-radius:8px;overflow:hidden;text-align:center;text-decoration:none}
.imgs img{width:100%;height:120px;object-fit:contain;display:block}
.imgs span{display:block;font-size:11px;color:var(--muted);padding:3px}
.tgroup{margin-bottom:14px}
.tgroup:last-child{margin-bottom:0}
.tgroup .t{display:flex;justify-content:space-between;font-weight:700;margin-bottom:6px}
.sizes{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.size{background:var(--soft);border-radius:8px;padding:4px 9px;font-weight:700;font-variant-numeric:tabular-nums}
.size small{color:var(--muted);font-weight:600;margin-right:4px}
.lines{width:100%;font-size:12px}
.lines td,.lines th{padding:5px 8px}
.note{font-size:12px;color:var(--muted)}
.warnbox{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:10px 12px;font-size:13px}
.skel{height:14px;background:linear-gradient(90deg,#eee,#f6f6f6,#eee);background-size:200% 100%;animation:sk 1.2s infinite;border-radius:6px;margin:6px 0}
@keyframes sk{to{background-position:-200% 0}}
/* Accueil */
.hello{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:6px 0 14px}
.hello h2{margin:0;font-size:24px;font-weight:800}
.hello .sub{font-size:13px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;text-decoration:none;display:block;position:relative;overflow:hidden}
.kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--accent,var(--ink))}
.kpi .l{font-size:12px;color:var(--muted);font-weight:600}
.kpi .n{font-size:32px;font-weight:800;line-height:1.1;margin-top:4px;font-variant-numeric:tabular-nums}
.kpi .h{font-size:12px;color:var(--muted)}
.kpi:hover{border-color:#cfc8e6}
.cols{display:grid;grid-template-columns:1.4fr 1fr;gap:12px;align-items:start}
.stack{display:flex;flex-direction:column;gap:12px}
.prio{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer}
.prio:last-child{border-bottom:none}
.prio:hover .client{color:var(--pink)}
.prio .why{margin-left:auto;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;white-space:nowrap}
.why.r{background:#fee2e2;color:var(--bad)} .why.o{background:#ffedd5;color:#c2410c} .why.b{background:#dbeafe;color:#1d4ed8} .why.y{background:#fef3c7;color:#92400e}
.flow{display:flex;flex-direction:column;gap:7px}
.frow{display:grid;grid-template-columns:120px 1fr 28px;gap:10px;align-items:center;font-size:12px;cursor:pointer}
.frow .track{height:10px;background:var(--soft);border-radius:999px;overflow:hidden}
.frow .fill{height:100%;border-radius:999px}
.frow b{text-align:right;font-variant-numeric:tabular-nums}
.mods{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.mod{border:1px solid var(--line);border-radius:10px;padding:12px;text-decoration:none;display:block;background:#fff}
.mod .i{font-size:20px}
.mod .t{font-weight:700;margin-top:4px}
.mod .d{font-size:12px;color:var(--muted)}
.mod.soon{opacity:.55;pointer-events:none}
.mod.soon .t::after{content:" · bientôt";font-weight:500;color:var(--muted);font-size:11px}
a.mod:hover{border-color:var(--pink)}
.ok-empty{color:var(--ok);font-weight:600;padding:8px 0}
/* Date de livraison modifiable */
.dliv{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px}
.dliv input{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:8px;color:var(--ink)}
.dliv .btn{padding:5px 10px;font-size:12px}
.manual{font-size:11px;font-weight:700;color:var(--pink)}
@media (max-width:980px){ .cols{grid-template-columns:1fr} .kpis{grid-template-columns:repeat(2,1fr)} .mods{grid-template-columns:repeat(2,1fr)} }
/* Mobile : cartes au lieu du tableau */
@media (max-width:760px){
  .bar nav{display:none}
  .who span{display:none}
  .tablewrap thead{display:none}
  .tablewrap table,.tablewrap tbody,.tablewrap tr,.tablewrap td{display:block;width:100%}
  tr.row{border-bottom:1px solid var(--line);padding:10px 12px;display:grid;grid-template-columns:1fr auto;gap:2px 10px}
  tr.row td{border:none;padding:0;background:none!important}
  td.c-statut{grid-column:2;grid-row:1;text-align:right}
  td.c-hide{display:none}
  td.c-zone{min-width:0;grid-column:1/-1}
  .tablewrap{overflow:visible}
  .clip{max-width:100%}
  .bat{height:420px}
  .lines th:nth-child(3),.lines td:nth-child(3),.lines th:nth-child(6),.lines td:nth-child(6){display:none}
}
</style>
</head>
<body>
<header><div class="bar">
  <img src="https://igscustom.fr/wp-content/uploads/2026/05/IGS-CUSTOM-BAR-LOGO.png" alt="" onerror="this.style.display='none'">
  <h1>IGS Gestion</h1>
  <nav>
    <a class="${view === 'accueil' ? 'on' : ''}" href="/gestion">Accueil</a>
    <a class="${view === 'commandes' ? 'on' : ''}" href="/gestion/commandes">Commandes</a>
    <a class="off" title="Bientôt">Planches DTF</a>
    <a class="off" title="Bientôt">Stock</a>
    <a class="off" title="Bientôt">Journal</a>
  </nav>
  <div class="who"><span><b>${esc(user.name)}</b> · ${user.role === 'admin' ? 'Admin' : 'Équipe'}</span><a href="/gestion/auth/logout">Déconnexion</a></div>
</div></header>

<main>
${view === 'accueil' ? `
  <section id="v-accueil">
    <div class="hello">
      <div><h2>Bonjour ${esc(prenom)} 👋</h2><div class="sub" id="today"></div></div>
      <div class="tools" style="margin:0"><span id="sync" class="sync"></span><button id="refresh" class="btn primary">↻ Actualiser</button></div>
    </div>
    <div class="kpis" id="kpis"></div>
    <div class="cols">
      <div class="stack">
        <div class="card"><h3>À traiter en priorité</h3><div id="prios"><div class="skel"></div><div class="skel"></div></div></div>
        <div class="card"><h3>Modules</h3><div class="mods">
          <a class="mod" href="/gestion/commandes"><div class="i">📦</div><div class="t">Commandes</div><div class="d">Suivi, BAT, tailles, visuels</div></a>
          <div class="mod soon"><div class="i">🎞</div><div class="t">Planches DTF</div><div class="d">Métrages, devis, paiements</div></div>
          <div class="mod soon"><div class="i">🗃</div><div class="t">Stock</div><div class="d">T-shirts, consommables, stocks clients</div></div>
          <div class="mod soon"><div class="i">🖨</div><div class="t">Générateur BAT</div><div class="d">Mockup automatique à l'échelle</div></div>
          <div class="mod soon"><div class="i">💬</div><div class="t">Journal</div><div class="d">Messages envoyés aux clients</div></div>
          ${user.role === 'admin' ? '<a class="mod" href="/panel" target="_blank" rel="noopener"><div class="i">🤖</div><div class="t">Leïla</div><div class="d">Panneau du bot WhatsApp</div></a>' : '<div class="mod soon"><div class="i">🤖</div><div class="t">Actions Leïla</div><div class="d">Écrire aux clients</div></div>'}
        </div></div>
      </div>
      <div class="stack">
        <div class="card"><h3>Commandes par statut</h3><div class="flow" id="flow"></div></div>
        <div class="card"><h3>Charge par personne</h3><div class="flow" id="charge"></div></div>
      </div>
    </div>
  </section>` : `
  <section id="v-commandes">
  <div class="tools">
    <input id="q" class="search" type="search" placeholder="Rechercher un client, un devis, une zone…">
    <button id="refresh" class="btn primary">↻ Actualiser</button>
    <span id="sync" class="sync"></span>
  </div>
  <div id="chips" class="chips"></div>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th>Devis</th><th>Client</th><th>Statut</th><th>Contenu</th><th>Zone</th><th>Affectation</th><th>Commande</th><th>Livraison</th><th>Planche</th>
      </tr></thead>
      <tbody id="rows"><tr><td colspan="9"><div class="skel"></div><div class="skel"></div><div class="skel"></div></td></tr></tbody>
    </table>
  </div>
  </section>`}
</main>

<div id="overlay" class="overlay"></div>
<aside id="panel" class="panel" aria-hidden="true">
  <div class="phead"><div><h2 id="ptitle"></h2><div id="psub" class="sub"></div></div><button class="x" id="pclose" aria-label="Fermer">×</button></div>
  <div class="pbody" id="pbody"></div>
</aside>

<script>
const STATUTS = ['EN DEVIS','PAYÉE','VALIDÉE','EN COMMANDE','EN PRODUCTION','EN FLOCAGE','TERMINÉE','A EXPEDIER','LIVRÉE'];
const COULEURS = {
  'EN DEVIS':['#f3f4f6','#4b5563'], 'PAYÉE':['#dbeafe','#1d4ed8'], 'VALIDÉE':['#e0e7ff','#4338ca'],
  'EN COMMANDE':['#fef3c7','#92400e'], 'EN PRODUCTION':['#ffedd5','#c2410c'], 'EN FLOCAGE':['#fce7f3','#be185d'],
  'TERMINÉE':['#dcfce7','#15803d'], 'A EXPEDIER':['#ccfbf1','#0f766e'], 'LIVRÉE':['#d1fae5','#065f46'],
};
const FINIS = ['TERMINÉE','A EXPEDIER','LIVRÉE'];
const VIEW = '${view}';
let data = [], filtre = (new URLSearchParams(location.search).get('filtre') || 'ACTIFS'), recherche = '';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase();
const statutKey = s => STATUTS.find(x => norm(x) === norm(s)) || (s || 'SANS STATUT');
const badge = s => { const k = statutKey(s); const c = COULEURS[k] || ['#f3f4f6','#374151']; return '<span class="badge" style="background:'+c[0]+';color:'+c[1]+'">'+esc(k)+'</span>'; };
const fdate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : '';
const pad = n => String(n).padStart(2,'0');
const isoLocal = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return isoLocal(d); };
const today = isoLocal(new Date());
const actif = c => !FINIS.includes(statutKey(c.statut));
const enRetard = c => c.date_livraison && c.date_livraison < today && actif(c);
const fphone = p => { if(!p) return ''; const m = p.match(/^(59[06])(\\d{3})(\\d{2})(\\d{2})(\\d{2})$/); return m ? '+'+m[1]+' '+m[2]+' '+m[3]+' '+m[4]+' '+m[5] : '+'+p; };

async function charger(force){
  $('refresh').disabled = true; $('refresh').textContent = '↻ …';
  try{
    const r = await fetch('/gestion/api/commandes' + (force ? '?actualiser=1' : ''));
    if (r.status === 401) return location.href = '/gestion/auth/login';
    const j = await r.json();
    data = j.commandes || [];
    const s = $('sync');
    if (j.erreur){ s.className='sync err'; s.textContent = '⚠️ Synchro en échec : ' + j.erreur; }
    else { s.className='sync'; s.textContent = j.syncedAt ? 'Synchro Excel : ' + new Date(j.syncedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : ''; }
    afficher();
  } catch(e){ $('sync').className='sync err'; $('sync').textContent='⚠️ Serveur injoignable'; }
  finally{ $('refresh').disabled=false; $('refresh').textContent='↻ Actualiser'; }
}

function afficher(){ if (VIEW === 'accueil') accueil(); else liste(); }

function accueil(){
  $('today').textContent = new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const actifs = data.filter(actif), retards = actifs.filter(enRetard);
  const semaine = actifs.filter(c => c.date_livraison && c.date_livraison >= today && c.date_livraison <= addDays(7));
  const prets = data.filter(c => ['TERMINÉE','A EXPEDIER'].includes(statutKey(c.statut)));
  const k = (l,n,h,col,f) => '<a class="kpi" style="--accent:'+col+'" href="/gestion/commandes?filtre='+f+'"><div class="l">'+l+'</div><div class="n">'+n+'</div><div class="h">'+h+'</div></a>';
  $('kpis').innerHTML = k('En cours', actifs.length, 'commandes actives', '#1e1b4b', 'ACTIFS')
    + k('En retard', retards.length, retards.length ? 'date de livraison dépassée' : 'rien en retard 👌', retards.length ? '#b91c1c' : '#15803d', 'ACTIFS')
    + k('À livrer sous 7 jours', semaine.length, 'd\\'ici le '+fdate(addDays(7)), '#e91e8c', 'ACTIFS')
    + k('Prêtes à remettre', prets.length, 'terminées ou à expédier', '#0f766e', 'TERMINÉE');

  const vus = new Set(), prios = [];
  const add = (c, why, cls) => { if (!vus.has(c.cle)) { vus.add(c.cle); prios.push({c, why, cls}); } };
  retards.sort((a,b)=>a.date_livraison.localeCompare(b.date_livraison)).forEach(c => add(c, 'En retard · '+fdate(c.date_livraison), 'r'));
  actifs.filter(c => c.date_livraison === today).forEach(c => add(c, 'Livraison aujourd\\'hui', 'o'));
  actifs.filter(c => c.date_livraison === addDays(1)).forEach(c => add(c, 'Livraison demain', 'o'));
  data.filter(c => statutKey(c.statut) === 'PAYÉE').forEach(c => add(c, 'Attend le formulaire', 'b'));
  actifs.filter(c => c.date_dynamique && !c.date_livraison_manuelle).forEach(c => add(c, 'Date auto (=TODAY)', 'y'));
  $('prios').innerHTML = prios.length ? prios.slice(0,10).map(p =>
    '<div class="prio" data-k="'+esc(p.c.cle)+'"><div><div class="client">'+esc(p.c.client)+'</div><div class="sub">'+esc(p.c.n_devis||'')+(p.c.affectation?' · '+esc(p.c.affectation):'')+'</div></div>'
    + badge(p.c.statut)+'<span class="why '+p.cls+'">'+esc(p.why)+'</span></div>').join('')
    + (prios.length > 10 ? '<div class="note" style="margin-top:8px">+ '+(prios.length-10)+' autres</div>' : '')
    : '<div class="ok-empty">✅ Rien d\\'urgent pour le moment</div>';

  const counts = {}; data.forEach(c => { const s = statutKey(c.statut); counts[s] = (counts[s]||0)+1; });
  const max = Math.max(1, ...Object.values(counts));
  $('flow').innerHTML = STATUTS.map(s => { const n = counts[s]||0, col = (COULEURS[s]||[])[1]||'#999';
    return '<a class="frow" href="/gestion/commandes?filtre='+encodeURIComponent(s)+'" style="text-decoration:none"><span>'+esc(s)+'</span><span class="track"><span class="fill" style="display:block;width:'+(n/max*100)+'%;background:'+col+'"></span></span><b>'+n+'</b></a>'; }).join('');

  const parP = {}; actifs.forEach(c => { const p = c.affectation || 'Non affectée'; parP[p] = (parP[p]||0)+1; });
  const pm = Math.max(1, ...Object.values(parP));
  $('charge').innerHTML = Object.keys(parP).length ? Object.entries(parP).sort((a,b)=>b[1]-a[1]).map(([p,n]) =>
    '<div class="frow" style="cursor:default"><span>'+esc(p)+'</span><span class="track"><span class="fill" style="display:block;width:'+(n/pm*100)+'%;background:var(--ink)"></span></span><b>'+n+'</b></div>').join('')
    : '<div class="note">Aucune commande active</div>';
}

function liste(){
  const counts = {}; data.forEach(c => { const k = statutKey(c.statut); counts[k] = (counts[k]||0)+1; });
  const actifs = data.filter(c => !FINIS.includes(statutKey(c.statut))).length;
  const chips = [['ACTIFS','En cours',actifs],['TOUS','Toutes',data.length]].concat(STATUTS.filter(s=>counts[s]).map(s=>[s,s,counts[s]]));
  $('chips').innerHTML = chips.map(([k,l,n]) => '<button class="chip'+(filtre===k?' on':'')+'" data-f="'+esc(k)+'">'+esc(l)+' <span class="n">'+n+'</span></button>').join('');

  const q = norm(recherche);
  let rows = data.filter(c => filtre==='TOUS' || (filtre==='ACTIFS' ? !FINIS.includes(statutKey(c.statut)) : statutKey(c.statut)===filtre));
  if (q) rows = rows.filter(c => norm([c.n_devis,c.client,c.zone_flocage,c.affectation,c.infos,c.remarque,c.email].join(' ')).includes(q));
  rows.sort((a,b) => STATUTS.indexOf(statutKey(a.statut)) - STATUTS.indexOf(statutKey(b.statut)) || String(a.date_commande||'').localeCompare(String(b.date_commande||'')));

  $('rows').innerHTML = rows.length ? rows.map(c => {
    const late = enRetard(c);
    return '<tr class="row" data-k="'+esc(c.cle)+'">'
      + '<td class="devis">'+esc(c.n_devis || '—')+'</td>'
      + '<td><div class="client">'+esc(c.client)+'</div>'+(c.remarque?'<div class="sub clip">'+esc(c.remarque)+'</div>':'')+'</td>'
      + '<td class="c-statut">'+badge(c.statut)+'</td>'
      + '<td class="c-hide"><div class="clip">'+esc(c.infos||'')+'</div></td>'
      + '<td class="c-zone"><span class="sub">'+esc(c.zone_flocage||'')+'</span></td>'
      + '<td class="c-hide">'+esc(c.affectation||'')+'</td>'
      + '<td class="c-hide">'+fdate(c.date_commande)+(c.date_dynamique?' <span class="dyn" title="La cellule Excel contient =TODAY() : la date change chaque jour">⚠ date auto</span>':'')+'</td>'
      + '<td class="c-hide'+(late?' late':'')+'">'+fdate(c.date_livraison)+(late?' ⏰':'')+(c.date_livraison_manuelle?' <span class="manual" title="Date modifiée manuellement">✏️</span>':'')+'</td>'
      + '<td class="c-hide">'+esc(c.planche||'')+'</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="9" class="empty">Aucune commande '+(q?'pour cette recherche':'dans ce filtre')+'</td></tr>';
}

function kv(k,v){ return v ? '<div class="kv"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>' : ''; }

async function ouvrir(cle){
  const c = data.find(x => x.cle === cle); if(!c) return;
  $('ptitle').innerHTML = esc(c.client) + ' ' + badge(c.statut);
  $('psub').textContent = (c.n_devis || 'Sans devis') + (c.affectation ? ' · ' + c.affectation : '');
  const contact = [
    c.email ? '<a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>' : '',
    c.telephone ? '<a href="https://wa.me/'+esc(c.telephone)+'" target="_blank" rel="noopener">'+esc(fphone(c.telephone))+'</a>' : '',
  ].filter(Boolean).join('<br>');
  $('pbody').innerHTML =
    (c.date_dynamique ? '<div class="warnbox">⚠️ La date de commande de cette ligne est une formule <b>=TODAY()</b> dans l\\'Excel : elle change chaque jour, et la date de livraison avec.</div>' : '')
    + '<div class="card"><h3>Commande</h3><div class="grid">'
    + kv('Contenu', esc(c.infos)) + kv('Zone de flocage', esc(c.zone_flocage)) + kv('Planche', esc(c.planche))
    + kv('Date commande', fdate(c.date_commande)) + '<div class="kv" id="livbox">'+livBox(c)+'</div>'
    + kv('Contact', contact) + kv('N° de suivi', esc(c.numero_suivi))
    + '</div>' + (c.instructions ? '<div class="kv" style="margin-top:10px"><div class="k">Instructions client</div><div class="v pre">'+esc(c.instructions)+'</div></div>' : '')
    + (c.remarque ? '<div class="kv" style="margin-top:10px"><div class="k">Remarque</div><div class="v pre">'+esc(c.remarque)+'</div></div>' : '')
    + '<div class="note" style="margin-top:10px">Mails : prête '+(c.mail_envoye?'✅':'—')+' · expédition '+(c.mail_expedition_envoye?'✅':'—')+' · avis '+(c.mail_avis_envoye?'✅':'—')+'</div></div>'
    + '<div id="dossier"><div class="card"><h3>Dossier client</h3><div class="skel"></div><div class="skel"></div></div></div>';
  $('overlay').classList.add('on'); $('panel').classList.add('on'); $('panel').setAttribute('aria-hidden','false');
  if (!c.n_devis) { $('dossier').innerHTML = '<div class="card note">Pas de N° de devis : impossible de retrouver le dossier SharePoint.</div>'; return; }

  try{
    const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(c.n_devis)+'/dossier');
    const d = await r.json();
    if (cle !== panelCle) return;
    if (d.erreur) throw new Error(d.erreur);
    if (!d.trouve) { $('dossier').innerHTML = '<div class="card note">Aucun dossier « '+esc(c.n_devis)+' - … » trouvé dans Clients/Commandes.</div>'; return; }
    let h = '';
    // Tailles
    h += '<div class="card"><h3>Tailles'+(d.tailles.total?' · '+d.tailles.total+' pièces':'')+'</h3>';
    if (d.tailles.erreur) h += '<div class="warnbox">Tailles.xlsx illisible : '+esc(d.tailles.erreur)+'</div>';
    else if (!d.tailles.fichierTrouve) h += '<div class="note">Aucun fichier Tailles.xlsx dans le dossier.</div>';
    else if (!d.tailles.groupes.length) h += '<div class="note">Tailles.xlsx est vide.</div>';
    d.tailles.groupes.forEach(gr => {
      h += '<div class="tgroup"><div class="t"><span>'+esc(gr.visuel)+'</span><span>'+gr.total+' pcs</span></div>'
        + '<div class="sizes">'+gr.tailles.map(([t,n]) => '<span class="size"><small>'+esc(t)+'</small>'+n+'</span>').join('')+'</div>'
        + '<table class="lines"><thead><tr><th>Produit</th><th>Couleur</th><th>Coupe</th><th>Taille</th><th>Qté</th><th>Remarque</th></tr></thead><tbody>'
        + gr.lignes.map(l => '<tr><td>'+esc(l.type)+'</td><td>'+esc(l.couleur)+'</td><td>'+esc(l.coupe)+'</td><td>'+esc(l.taille)+'</td><td><b>'+l.quantite+'</b></td><td>'+esc(l.remarques||'')+'</td></tr>').join('')
        + '</tbody></table></div>';
    });
    h += '</div>';
    // Visuels
    if (d.visuels.length) {
      h += '<div class="card"><h3>Visuels</h3><div class="visuels">' + d.visuels.map(v =>
        '<div class="visuel"><div class="t">'+esc(v.nom)+'</div><div class="imgs">'
        + (v.images.length ? v.images.map(i => '<a href="/gestion/api/fichier/'+encodeURIComponent(i.id)+'" target="_blank" rel="noopener">'
          + (i.miniature ? '<img loading="lazy" src="'+esc(i.miniature)+'" alt="">' : '<img loading="lazy" src="/gestion/api/fichier/'+encodeURIComponent(i.id)+'" alt="">')
          + '<span>'+(i.face==='avant'?'Avant':i.face==='arriere'?'Arrière':esc(i.nom))+'</span></a>').join('') : '<span class="note">Aucune image</span>')
        + '</div></div>').join('') + '</div></div>';
    }
    // BAT
    h += '<div class="card"><h3>Bon à tirer</h3>' + (d.bat
      ? '<iframe class="bat" src="/gestion/api/fichier/'+encodeURIComponent(d.bat.id)+'#view=FitH" title="BAT"></iframe><div class="note" style="margin-top:6px"><a href="/gestion/api/fichier/'+encodeURIComponent(d.bat.id)+'" target="_blank" rel="noopener">Ouvrir le BAT en grand</a> · modifié le '+new Date(d.bat.modifie).toLocaleDateString('fr-FR')+'</div>'
      : '<div class="note">Pas encore de « BON A TIRER.pdf » dans le dossier.</div>') + '</div>';
    if (d.dossier.lien) h += '<div class="note"><a href="'+esc(d.dossier.lien)+'" target="_blank" rel="noopener">📁 Ouvrir le dossier dans SharePoint</a></div>';
    $('dossier').innerHTML = h;
  } catch(e){
    if (cle === panelCle) $('dossier').innerHTML = '<div class="card warnbox">Dossier indisponible : '+esc(e.message)+'</div>';
  }
}
function livBox(c){
  return '<div class="k">Livraison prévue '+(c.date_livraison_manuelle?'<span class="manual">✏️ manuelle</span>':'')+'</div>'
    + '<div class="dliv"><input type="date" id="dliv" value="'+esc(c.date_livraison||'')+'"><button class="btn" onclick="saveLiv(\\''+esc(c.cle)+'\\')">Enregistrer</button>'
    + (c.date_livraison_manuelle ? '<button class="btn" onclick="saveLiv(\\''+esc(c.cle)+'\\',true)" title="Revenir à la date calculée dans l\\'Excel">↺ Date Excel</button>' : '') + '</div>'
    + (c.date_livraison_manuelle ? '<div class="note">Par '+esc(c.date_livraison_modifiee_par||'?')+(c.date_livraison_modifiee_le?' le '+new Date(c.date_livraison_modifiee_le).toLocaleDateString('fr-FR'):'')+' · Excel : '+(fdate(c.date_livraison_excel)||'—')+'</div>' : '');
}
async function saveLiv(cle, reset){
  const c = data.find(x => x.cle === cle); if (!c) return;
  const v = reset ? null : $('dliv').value;
  if (!reset && !v) return alert('Choisis une date');
  try{
    const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(cle)+'/livraison', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({date: v})});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Erreur');
    Object.assign(c, j.commande);
    $('livbox').innerHTML = livBox(c);
    afficher();
  } catch(e){ alert('Impossible d\\'enregistrer : ' + e.message); }
}
let panelCle = null;
function fermer(){ panelCle=null; $('overlay').classList.remove('on'); $('panel').classList.remove('on'); $('panel').setAttribute('aria-hidden','true'); }

if (VIEW === 'commandes') {
  $('rows').addEventListener('click', e => { const tr = e.target.closest('tr.row'); if (tr){ panelCle = tr.dataset.k; ouvrir(panelCle); } });
  $('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b){ filtre = b.dataset.f; afficher(); } });
  $('q').addEventListener('input', e => { recherche = e.target.value; afficher(); });
} else {
  $('prios').addEventListener('click', e => { const p = e.target.closest('.prio'); if (p){ panelCle = p.dataset.k; ouvrir(panelCle); } });
}
$('refresh').addEventListener('click', () => charger(true));
$('overlay').addEventListener('click', fermer); $('pclose').addEventListener('click', fermer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
charger(false);
setInterval(() => { if (!document.hidden) charger(false); }, 120000);
</script>
</body>
</html>`;
}

module.exports = { render };
