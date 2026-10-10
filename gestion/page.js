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
<title>IGS Dashboard · ${({ commandes: 'Commandes', planches: 'Planches DTF', stock: 'Stock', caisse: 'Espèces', admin: 'Admin' })[view] || 'Accueil'}</title>
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
.bar{max-width:1800px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px}
.bar img{height:34px}
.bar h1{font-size:17px;margin:0;font-weight:800;letter-spacing:.2px}
.bar nav{display:flex;gap:4px;margin-left:12px}
.bar nav a{padding:6px 10px;border-radius:8px;text-decoration:none;font-weight:600;color:var(--muted)}
.bar nav a.on{background:#fff;color:var(--ink)}
.bar nav a.off{opacity:.45;pointer-events:none}
.who{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.who b{color:var(--ink)}
.who a{font-weight:600}
main{max-width:1800px;margin:0 auto;padding:14px 24px 40px}
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
.tablewrap{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);text-align:left;padding:10px 12px;background:#faf9fd;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:8px 8px;border-bottom:1px solid var(--line);vertical-align:top}
tr.row{cursor:pointer}
tr.row:hover td{background:#fbf9ff}
tr.row:last-child td{border-bottom:none}
.devis{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.client{font-weight:600}
.sub{font-size:12px;color:var(--muted)}
.clip{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
/* Planches */
.tag{display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;background:var(--soft);color:var(--ink);margin-left:6px;vertical-align:middle}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pay{font-size:11px;font-weight:700;white-space:nowrap}
.pay.ok{color:var(--ok)} .pay.no{color:var(--bad)} .pay.cash{color:#0f766e}
.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.file{border:1px solid var(--line);border-radius:10px;overflow:hidden;text-decoration:none;background:#fff;display:block}
.file .th{height:140px;background:repeating-conic-gradient(#f1eef7 0% 25%,#fff 0% 50%) 50%/16px 16px;display:flex;align-items:center;justify-content:center}
.file .th img{max-width:100%;max-height:140px;object-fit:contain}
.file .th .pdf{font-size:34px}
.file .nm{font-size:12px;font-weight:600;padding:6px 8px 0;word-break:break-word}
.file .ds{font-size:11px;color:var(--muted);padding:0 8px 7px}
.plrow{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}
.plrow:last-child{border-bottom:none}
.plrow b{font-variant-numeric:tabular-nums}
/* Actions planche */
.actions{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;align-items:end}
.field label{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px}
.field input,.field select{width:100%;font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:#fff}
.btnrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.btn.pink{background:var(--pink);border-color:var(--pink);color:#fff}
.btn:disabled{opacity:.5;cursor:wait}
.msg{margin-top:10px;font-size:13px;border-radius:8px;padding:8px 10px;display:none}
.msg.ok{display:block;background:#dcfce7;color:#166534}
.msg.err{display:block;background:#fee2e2;color:#991b1b}
.msg.info{display:block;background:#eef2ff;color:#3730a3}
.cand{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)}
.cand:last-child{border-bottom:none}
.autobox{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.switch{position:relative;width:44px;height:24px;border-radius:999px;background:#d4d0e2;border:none;flex:none}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s}
.switch.on{background:var(--ok)} .switch.on::after{left:23px}
/* Stock */
.qty{display:inline-flex;align-items:center;gap:4px}
.qty button{width:28px;height:28px;border-radius:7px;border:1px solid var(--line);background:#fff;font-weight:800;color:var(--ink);padding:0}
.qty b{min-width:34px;text-align:center;font-variant-numeric:tabular-nums;cursor:pointer;border-bottom:1px dashed #cfc8e6}
.zero{color:var(--muted)}
.stk{width:100%;border-collapse:collapse;font-size:13px}
.stk td,.stk th{padding:6px 6px;border-bottom:1px solid var(--line);text-align:left}
.stk th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
.stk tr:last-child td{border-bottom:none}
.mvt{font-size:12px;padding:5px 0;border-bottom:1px solid var(--line);display:flex;gap:8px}
.mvt:last-child{border-bottom:none}
.mvt .d{color:var(--muted);white-space:nowrap}
/* Édition directe dans les listes */
select.inl{font:inherit;font-size:12px;font-weight:700;border:1px solid transparent;border-radius:999px;padding:3px 6px;max-width:140px;cursor:pointer;background:var(--soft);color:var(--ink)}
select.inl:hover{border-color:#cfc8e6}
select.inl.plain{font-weight:600;background:#fff;border-color:var(--line);border-radius:8px}
select.inl:disabled{opacity:.5;cursor:wait}
a.open{color:inherit;text-decoration:none}
a.open:hover{color:var(--pink);text-decoration:underline}
tr.row{cursor:default}
/* La liste tient dans l'écran : colonnes secondaires masquées sur les écrans moyens */
th{padding:10px 8px}
@media (min-width:761px) and (max-width:1500px){ #v-commandes .tablewrap th:nth-child(7), #v-commandes .tablewrap td:nth-child(7){display:none} }
@media (min-width:761px) and (max-width:1300px){ #v-commandes .tablewrap th:nth-child(4), #v-commandes .tablewrap td:nth-child(4){display:none} #v-planches .tablewrap th:nth-child(8), #v-planches .tablewrap td:nth-child(8){display:none} }
/* Espèces */
.big{font-size:40px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
/* Date de livraison modifiable */
.dliv{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px}
.dliv input{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:8px;color:var(--ink)}
.dliv .btn{padding:5px 10px;font-size:12px}
.manual{font-size:11px;font-weight:700;color:var(--pink)}
.xdel{border:0;background:transparent;color:#9ca3af;font-size:18px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:6px}
.xdel:hover{background:#fee2e2;color:#b91c1c}
td.c-x{width:30px;text-align:right;padding-left:0}
.hrform{display:grid;gap:10px}
.hrform .field input,.hrform .field select{width:100%;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff}
.hrl{display:grid;grid-template-columns:1.2fr .8fr 1.4fr auto;gap:6px;align-items:end;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--soft)}
.hrl label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
.hrl input{width:100%;font:inherit;padding:9px;border:1px solid var(--line);border-radius:8px;background:#fff}
#hr-lignes{display:grid;gap:8px}
@media (max-width:640px){.hrl{grid-template-columns:1fr 1fr auto}.hrl .rem{grid-column:1/-1;order:5}}
.hrnav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.hrnav h3{margin:0;flex:1;min-width:200px}
.hrtot{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.hrtot b.m{font-size:18px}
.paid{display:inline-block;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:700;font-size:12px}
.esp.bd{background:#dbeafe;color:#1e40af;text-decoration:none;margin-right:4px}
.esp{display:inline-block;margin-top:3px;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;white-space:nowrap}
.espbox{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 12px;padding:10px 12px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a}
.espbox input[type=text]{width:110px}
@media (max-width:980px){ .cols{grid-template-columns:1fr} .kpis{grid-template-columns:repeat(2,1fr)} .mods{grid-template-columns:repeat(2,1fr)} }
/* Mobile : cartes au lieu du tableau */
@media (max-width:760px){
  .bar{flex-wrap:wrap;row-gap:6px}
  .bar nav{order:3;width:100%;margin:0;overflow-x:auto;scrollbar-width:none}
  .bar nav a{white-space:nowrap}
  .who{margin-left:auto}
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
  <h1>IGS DASHBOARD</h1>
  <nav>
    <a class="${view === 'accueil' ? 'on' : ''}" href="/gestion">Accueil</a>
    <a class="${view === 'commandes' ? 'on' : ''}" href="/gestion/commandes">Commandes</a>
    <a class="${view === 'planches' ? 'on' : ''}" href="/gestion/planches">Planches DTF</a>
    <a class="${view === 'stock' ? 'on' : ''}" href="/gestion/stock">Stock</a>
    <a class="${view === 'caisse' ? 'on' : ''}" href="/gestion/caisse">Espèces</a>
    <a class="${view === 'heures' ? 'on' : ''}" href="/gestion/heures">Heures</a>
    ${user.role === 'admin' ? `<a class="${view === 'admin' ? 'on' : ''}" href="/gestion/admin">Admin</a>` : ''}
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
          <a class="mod" href="/gestion/planches"><div class="i">🎞</div><div class="t">Planches DTF</div><div class="d">Métrages, devis, paiements</div></a>
          <a class="mod" href="/gestion/stock"><div class="i">🗃</div><div class="t">Stock</div><div class="d">T-shirts, consommables, stocks clients</div></a>
          <div class="mod soon"><div class="i">🖨</div><div class="t">Générateur BAT</div><div class="d">Mockup automatique à l'échelle</div></div>
          ${user.role === 'admin' ? '<a class="mod" href="/gestion/admin"><div class="i">⚙️</div><div class="t">Admin</div><div class="d">Collaborateurs, produits, couleurs</div></a>' : ''}
          <a class="mod" href="/gestion/caisse"><div class="i">💵</div><div class="t">Espèces</div><div class="d">Caisse, relevés, totaux mensuels</div></a>
          <a class="mod" href="/gestion/heures"><div class="i">⏱</div><div class="t">Heures</div><div class="d">${user.role === 'admin' ? 'Saisie, totaux par semaine, paiements' : 'Saisir mes heures du jour'}</div></a>
          <div class="mod soon"><div class="i">💬</div><div class="t">Journal</div><div class="d">Messages envoyés aux clients</div></div>
          ${user.role === 'admin' ? '<a class="mod" href="/panel" target="_blank" rel="noopener"><div class="i">🤖</div><div class="t">Leïla</div><div class="d">Panneau du bot WhatsApp</div></a>' : '<div class="mod soon"><div class="i">🤖</div><div class="t">Actions Leïla</div><div class="d">Écrire aux clients</div></div>'}
        </div></div>
      </div>
      <div class="stack">
        <div class="card"><h3>Planches DTF</h3><div id="plhome"><div class="skel"></div></div></div>
        <div class="card"><h3>Commandes par statut</h3><div class="flow" id="flow"></div></div>
        <div class="card"><h3>Charge par personne</h3><div class="flow" id="charge"></div></div>
      </div>
    </div>
  </section>` : view === 'admin' ? `
  <section id="v-admin">
    <div class="tools"><h2 style="margin:0;font-size:20px">Administration</h2><div style="flex:1"></div><button class="btn" id="ad-test-mail">✉️ Tester l'envoi de mail du formulaire</button><span id="sync" class="sync"></span><button id="refresh" class="btn primary">↻ Actualiser</button></div>
    <div class="card" style="margin-bottom:12px"><h3 style="display:flex;justify-content:space-between;align-items:center">Collaborateurs <button class="btn" id="ad-col-add">＋ Collaborateur</button></h3>
      <div class="note" style="margin-bottom:8px">Le <b>nom affiché</b> est celui de la colonne Affectation des commandes. Un collaborateur inactif n'apparaît plus dans les listes mais reste dans l'historique.</div>
      <div style="overflow-x:auto"><table class="stk" id="ad-col"><thead><tr><th>Nom affiché</th><th>Nom complet</th><th>Taux horaire (€)</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody></tbody></table></div>
    </div>
    <div class="cols" style="grid-template-columns:1.5fr 1fr">
      <div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center">Produits du formulaire <button class="btn" id="ad-prod-add">＋ Produit</button></h3>
        <div class="note" style="margin-bottom:8px">Tailles séparées par des virgules (ex. XS, S, M, L, XL, 2XL, 3XL · enfants 2A, 4A… · TU pour taille unique). « Coupe » : le client choisit Unisexe / Femme.</div>
        <div style="overflow-x:auto"><table class="stk" id="ad-prod"><thead><tr><th></th><th>Produit</th><th>Tailles</th><th>Coupe</th><th></th></tr></thead><tbody></tbody></table></div>
      </div>
      <div class="stack">
        <div class="card"><h3>Couleurs <span class="sub" style="text-transform:none;letter-spacing:0">(une par ligne, dans l'ordre d'affichage)</span></h3><textarea id="ad-couleurs" style="width:100%;min-height:320px;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px"></textarea></div>
        <div class="card"><h3>Coupes</h3><input id="ad-coupes" style="width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px" placeholder="Unisexe, Femme"></div>
        <button class="btn pink" id="ad-save-listes" style="padding:12px">💾 Enregistrer les listes</button>
        <div class="msg" id="a-msg"></div>
      </div>
    </div>
  </section>` : view === 'heures' ? `
  <section id="v-heures">
    <div class="tools"><h2 style="margin:0;font-size:20px">⏱ Heures</h2><div style="flex:1"></div><span id="sync" class="sync"></span><button id="refresh" class="btn primary">↻ Actualiser</button></div>
    <div class="cols"${user.role === 'admin' ? ' style="grid-template-columns:minmax(280px,1fr) 2.2fr"' : ' style="grid-template-columns:minmax(0,520px)"'}>
      <div class="stack">
        <div class="card"><h3>${user.role === 'admin' ? 'Saisir des heures' : 'Saisir mes heures'}</h3>
          <div class="hrform">
            <div class="field"><label>Collaborateur</label><select id="hr-collab"></select></div>
            <div id="hr-lignes"></div>
            <button class="btn" id="hr-plus">＋ Ajouter un autre jour</button>
            <button class="btn pink" id="hr-ok" style="padding:12px">Enregistrer</button>
            <div class="note">Une ligne par jour travaillé. Heures au format 04:30, 4h30 ou 4,5. En retard ? Ajoute une ligne par jour oublié. Une erreur ? Supprime la saisie dans « Mes heures » (tant que la semaine n’est pas payée), puis ressaisis.</div>
          </div>
          <div class="msg" id="hr-msg"></div>
        </div>
        <div class="card" id="hr-mes"><h3>Mes heures</h3><div class="note">Choisis ton nom pour voir tes heures.</div></div>
      </div>
      ${user.role === 'admin' ? '<div class="stack" id="hr-admin"><div class="card"><div class="skel"></div><div class="skel"></div></div></div>' : ''}
    </div>
  </section>` : view === 'caisse' ? `
  <section id="v-caisse">
    <div class="tools"><div style="flex:1"></div><button id="cs-enc" class="btn">＋ Encaisser</button><button id="cs-dec" class="btn">－ Décaisser</button>${user.role === 'admin' ? '<button id="cs-rel" class="btn pink">💰 Récupérer les espèces</button>' : ''}<button id="refresh" class="btn primary">↻ Actualiser</button><span id="sync" class="sync"></span></div>
    <div class="cols"${user.role === 'admin' ? '' : ' style="grid-template-columns:1fr"'}>
      <div class="stack">
        <div class="card"><h3>Dans la caisse (théorique)</h3><div id="cs-solde"><div class="skel"></div></div></div>
        <div class="card"><h3>Mouvements depuis le dernier relevé</h3><div id="cs-depuis"></div></div>
        ${user.role === 'admin' ? '<div class="card"><h3>Historique de la caisse</h3><div id="cs-histo"></div></div>' : ''}
      </div>
      ${user.role === 'admin' ? '<div class="stack"><div class="card"><h3>Espèces encaissées par mois</h3><div id="cs-mois"></div></div><div class="card"><h3>Par année</h3><div id="cs-annee"></div></div></div>' : ''}
    </div>
  </section>` : view === 'stock' ? `
  <section id="v-stock">
    <div class="tools">
      <input id="q" class="search" type="search" placeholder="Filtrer les articles (type, couleur, taille, référence)…">
      <button id="refresh" class="btn primary">↻ Actualiser</button>
      <span id="sync" class="sync"></span>
    </div>
    <div class="cols">
      <div class="stack">
        <div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center">Articles vierges <button class="btn" id="add-vierge">＋ Article</button></h3><div id="st-vierges"><div class="skel"></div><div class="skel"></div></div></div>
      </div>
      <div class="stack">
        <div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center">Consommables <button class="btn" id="add-conso">＋ Consommable</button></h3><div id="st-conso"><div class="skel"></div></div></div>
        <div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center">Stocks clients <button class="btn" id="add-client">＋ Nouveau stock client</button></h3><div id="st-clients"><div class="skel"></div></div></div>
        <div class="card"><h3>Derniers mouvements</h3><div id="st-mvt"></div></div>
      </div>
    </div>
  </section>` : view === 'planches' ? `
  <section id="v-planches">
  <div class="tools">
    <input id="q" class="search" type="search" placeholder="Rechercher un client, un devis, une remarque…">
    <button id="nouvelle" class="btn pink">＋ Nouvelle planche</button>
    <button id="refresh" class="btn primary">↻ Actualiser</button>
    <span id="sync" class="sync"></span>
  </div>
  <div class="kpis" id="plkpis"></div>
  ${user.role === 'admin' ? '<div class="card autobox" id="autobox"></div>' : ''}
  <div id="chips" class="chips"></div>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th>Date</th><th>Client</th><th>Statut</th><th>Métrage</th><th>Montant HT</th><th>Paiement</th><th>Devis</th><th>Remarques</th><th></th>
      </tr></thead>
      <tbody id="rows"><tr><td colspan="8"><div class="skel"></div><div class="skel"></div><div class="skel"></div></td></tr></tbody>
    </table>
  </div>
  </section>` : `
  <section id="v-commandes">
  <div class="tools">
    <div class="chips" style="margin:0"><button class="chip on" id="tab-cours">📦 En cours</button><button class="chip" id="tab-histo">🗂 Historique</button></div>
    <input id="q" class="search" type="search" placeholder="Rechercher un client, un devis, une zone…">
    <button id="refresh" class="btn primary">↻ Actualiser</button>
    <span id="sync" class="sync"></span>
  </div>
  <div id="chips" class="chips"></div>
  <div class="tablewrap">
    <table>
      <thead><tr>
        <th>Devis</th><th>Client</th><th>Statut</th><th>Contenu</th><th>Zone</th><th>Affectation</th><th>Commande</th><th>Livraison</th><th>Planche</th><th></th>
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
const ORDRE_TRI = ['A EXPEDIER','EN FLOCAGE','EN PRODUCTION','EN COMMANDE','VALIDÉE','PAYÉE','TERMINÉE','EN DEVIS','LIVRÉE'];
const COULEURS = {
  'EN DEVIS':['#f3f4f6','#4b5563'], 'PAYÉE':['#dbeafe','#1d4ed8'], 'VALIDÉE':['#e0e7ff','#4338ca'],
  'EN COMMANDE':['#fef3c7','#92400e'], 'EN PRODUCTION':['#ffedd5','#c2410c'], 'EN FLOCAGE':['#fce7f3','#be185d'],
  'TERMINÉE':['#dcfce7','#15803d'], 'A EXPEDIER':['#ccfbf1','#0f766e'], 'LIVRÉE':['#d1fae5','#065f46'],
};
const FINIS = ['LIVRÉE'];               // commande finie = livrée (récupérée ou reçue par le client)
const PRETES = ['TERMINÉE','A EXPEDIER']; // prête, pas encore récupérée / expédiée
const PL_STATUTS = ['A PREPARER','A VERIFIER','A IMPRIMER','A RECUPERER','A EXPEDIER','EXPÉDIÉE','LIVRÉE'];
const PL_COULEURS = {
  'A PREPARER':['#ffedd5','#c2410c'], 'A VERIFIER':['#fee2e2','#b91c1c'], 'A IMPRIMER':['#fce7f3','#be185d'],
  'A RECUPERER':['#e0e7ff','#4338ca'], 'A EXPEDIER':['#ccfbf1','#0f766e'], 'EXPÉDIÉE':['#e0f2fe','#0369a1'], 'LIVRÉE':['#d1fae5','#065f46'],
};
let planches = [];
const VIEW = '${view}';
const ADMIN = ${user.role === 'admin' ? 'true' : 'false'};
let data = [], filtre = (new URLSearchParams(location.search).get('filtre') || 'ACTIFS'), recherche = '';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase();
const plKey = s => PL_STATUTS.find(x => norm(x) === norm(s)) || (s || 'SANS STATUT');
const plBadge = s => { const k = plKey(s); const c = PL_COULEURS[k] || ['#f3f4f6','#374151']; return '<span class="badge" style="background:'+c[0]+';color:'+c[1]+'">'+esc(k)+'</span>'; };
const plActive = p => plKey(p.statut) !== 'LIVRÉE';
const eur = n => n == null ? '' : n.toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
const metrage = p => p.format ? p.format : (p.metres != null ? String(p.metres).replace('.',',')+' m' : '');
const payClass = v => { const n = norm(v); return n.includes('NON') ? 'no' : n.includes('PAYEE') ? 'ok' : n ? 'cash' : ''; };
const nonPayee = p => norm(p.paiement).includes('NON');
const statutKey = s => STATUTS.find(x => norm(x) === norm(s)) || (s || 'SANS STATUT');
const badge = s => { const k = statutKey(s); const c = COULEURS[k] || ['#f3f4f6','#374151']; return '<span class="badge" style="background:'+c[0]+';color:'+c[1]+'">'+esc(k)+'</span>'; };
const fdate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : '';
const pad = n => String(n).padStart(2,'0');
const isoLocal = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return isoLocal(d); };
const today = isoLocal(new Date());
const actif = c => !FINIS.includes(statutKey(c.statut));
const enRetard = c => c.date_livraison && c.date_livraison < today && actif(c) && !PRETES.includes(statutKey(c.statut));
const fphone = p => { if(!p) return ''; const m = p.match(/^(59[06])(\\d{3})(\\d{2})(\\d{2})(\\d{2})$/); return m ? '+'+m[1]+' '+m[2]+' '+m[3]+' '+m[4]+' '+m[5] : '+'+p; };

async function api(path, force){
  const r = await fetch(path + (force ? '?actualiser=1' : ''));
  if (r.status === 401) { location.href = '/gestion/auth/login'; throw new Error('401'); }
  return r.json();
}
async function charger(force){
  $('refresh').disabled = true; $('refresh').textContent = '↻ …';
  try{
    if (VIEW === 'admin') { await adCharger(); return; }
    if (VIEW === 'heures') { await hrCharger(); return; }
    if (VIEW === 'caisse') {
      const r = await fetch('/gestion/api/caisse'); if (r.status === 401) return location.href = '/gestion/auth/login';
      const j = await r.json(); if (j.error) throw new Error(j.error);
      caisseData = j; $('sync').className = 'sync'; $('sync').textContent = '';
      return afficher();
    }
    if (VIEW === 'stock') {
      const r = await fetch('/gestion/api/stock'); if (r.status === 401) return location.href = '/gestion/auth/login';
      const j = await r.json(); if (j.error) throw new Error(j.error);
      stockData = j; $('sync').className = 'sync'; $('sync').textContent = 'Lu dans l\\'Excel à ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      return afficher();
    }
    const [jc, jp] = await Promise.all([
      VIEW !== 'planches' ? api('/gestion/api/commandes', force) : null,
      VIEW !== 'commandes' ? api('/gestion/api/planches', force) : null,
    ]);
    if (jc) data = jc.commandes || [];
    if (jp) planches = jp.planches || [];
    const erreur = (jc && jc.erreur) || (jp && jp.erreur);
    const at = (jc || jp).syncedAt;
    const s = $('sync');
    if (erreur){ s.className='sync err'; s.textContent = '⚠️ Synchro en échec : ' + erreur; }
    else { s.className='sync'; s.textContent = at ? 'Synchro Excel : ' + new Date(at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : ''; }
    afficher();
  } catch(e){ $('sync').className='sync err'; $('sync').textContent='⚠️ Serveur injoignable'; }
  finally{ $('refresh').disabled=false; $('refresh').textContent='↻ Actualiser'; }
}

function afficher(){ if (VIEW === 'commandes' && modeHisto) return; if (VIEW === 'accueil') { accueil(); plHome(); } else if (VIEW === 'planches') plListe(); else if (VIEW === 'stock') stRender(); else if (VIEW === 'caisse') csRender(); else liste(); }

// ---------- Planches DTF ----------
function plStats(){
  const act = planches.filter(plActive);
  const sum = arr => arr.reduce((t,p) => t + (p.metres || 0), 0);
  const aPrep = act.filter(p => ['A PREPARER','A IMPRIMER'].includes(plKey(p.statut)));
  return {
    act, aPrep, mPrep: sum(aPrep),
    aVerif: act.filter(p => plKey(p.statut) === 'A VERIFIER'),
    aRecup: act.filter(p => ['A RECUPERER','A EXPEDIER'].includes(plKey(p.statut))),
    nonPay: planches.filter(nonPayee),
    hebdo: planches.filter(p => p.hebdo),
  };
}
function plHome(){
  const st = plStats();
  const montant = st.nonPay.reduce((t,p) => t + (p.montant_ht || 0), 0);
  const row = (l, v, f) => '<a class="plrow" style="text-decoration:none" href="/gestion/planches'+(f?'?filtre='+encodeURIComponent(f):'')+'"><span>'+l+'</span><b>'+v+'</b></a>';
  $('plhome').innerHTML = row('À préparer / imprimer', st.aPrep.length + (st.mPrep ? ' · ' + String(Math.round(st.mPrep*100)/100).replace('.',',') + ' m' : ''), 'A PREPARER')
    + row('À vérifier', st.aVerif.length ? '<span style="color:var(--bad)">'+st.aVerif.length+'</span>' : '0', 'A VERIFIER')
    + row('À récupérer / expédier', st.aRecup.length, 'A RECUPERER')
    + row('Non payées', st.nonPay.length + (montant ? ' · ' + eur(montant) : ''), 'NONPAYEES')
    + row('Clients hebdo', st.hebdo.length, 'HEBDO');
}
function plListe(){
  const st = plStats();
  const montant = st.nonPay.reduce((t,p) => t + (p.montant_ht || 0), 0);
  const k = (l,n,h,col,f) => '<a class="kpi" style="--accent:'+col+'" href="#" data-f="'+f+'"><div class="l">'+l+'</div><div class="n">'+n+'</div><div class="h">'+h+'</div></a>';
  $('plkpis').innerHTML = k('À préparer / imprimer', st.aPrep.length, String(Math.round(st.mPrep*100)/100).replace('.',',')+' m à sortir', '#c2410c', 'A PREPARER')
    + k('À vérifier', st.aVerif.length, st.aVerif.length ? 'doublon ou client introuvable' : 'rien à vérifier 👌', st.aVerif.length ? '#b91c1c' : '#15803d', 'A VERIFIER')
    + k('À récupérer / expédier', st.aRecup.length, 'planches prêtes', '#4338ca', 'A RECUPERER')
    + k('Non payées', st.nonPay.length, eur(montant) + ' HT', '#e91e8c', 'NONPAYEES');

  const counts = {}; planches.forEach(p => { const s = plKey(p.statut); counts[s] = (counts[s]||0)+1; });
  const chips = [['ACTIFS','En cours',st.act.length],['TOUS','Toutes',planches.length],['NONPAYEES','Non payées',st.nonPay.length],['HEBDO','Hebdo',st.hebdo.length]]
    .concat(PL_STATUTS.map(s=>[s,s,counts[s]||0]))
    .concat(Object.keys(counts).filter(s => !PL_STATUTS.includes(s)).map(s=>[s,s,counts[s]]));
  $('chips').innerHTML = chips.map(([k,l,n]) => '<button class="chip'+(filtre===k?' on':'')+'" data-f="'+esc(k)+'">'+esc(l)+' <span class="n">'+n+'</span></button>').join('');

  const q = norm(recherche);
  let rows = planches.filter(p => filtre==='TOUS' || (filtre==='ACTIFS' ? plActive(p) : filtre==='NONPAYEES' ? nonPayee(p) : filtre==='HEBDO' ? p.hebdo
    : filtre==='A RECUPERER' ? ['A RECUPERER','A EXPEDIER'].includes(plKey(p.statut)) : filtre==='A PREPARER' ? ['A PREPARER','A IMPRIMER'].includes(plKey(p.statut)) : plKey(p.statut)===filtre));
  if (q) rows = rows.filter(p => norm([p.n_devis,p.client,p.remarques,p.paiement,p.frequence].join(' ')).includes(q));
  rows.sort((a,b) => (PL_STATUTS.indexOf(plKey(a.statut))+1||0) - (PL_STATUTS.indexOf(plKey(b.statut))+1||0) || String(b.date_commande||'').localeCompare(String(a.date_commande||'')));

  $('rows').innerHTML = rows.length ? rows.map(p => '<tr class="row" data-k="'+esc(p.cle)+'">'
      + '<td class="c-hide num">'+fdate(p.date_commande)+'</td>'
      + '<td><a href="#" class="open client">'+esc(p.client)+'</a>'+(p.hebdo?'<span class="tag">HEBDO</span>':'')+'<div class="sub">'+esc(metrage(p))+(p.montant_ht!=null?' · '+eur(p.montant_ht):'')+'</div></td>'
      + '<td class="c-statut">'+(p.hebdo && !p.statut ? '<span class="sub">—</span>' : inlSel('pl', p.cle, 'statut', PL_STATUTS, p.statut ? plKey(p.statut) : '', PL_COULEURS))+'</td>'
      + '<td class="c-hide num"><b>'+esc(metrage(p))+'</b>'+(p.reduction?' <span class="sub">('+Math.round(p.reduction*100)+' %)</span>':'')+'</td>'
      + '<td class="c-hide num">'+eur(p.montant_ht)+'</td>'
      + '<td class="c-hide">'+inlSel('pl', p.cle, 'paiement', PAIEMENTS, p.paiement || '', null, true)+'</td>'
      + '<td class="c-hide devis"><a href="#" class="open">'+esc(p.n_devis||'—')+'</a></td>'
      + '<td class="c-zone"><div class="sub clip">'+esc(p.remarques||'')+'</div></td>'
      + '<td class="c-x"><button class="xdel" data-del="1" title="Supprimer la ligne">×</button></td>'
      + '</tr>').join('') : '<tr><td colspan="9" class="empty">Aucune planche '+(q?'pour cette recherche':'dans ce filtre')+'</td></tr>';
}

// Sélecteur directement dans la ligne (comme une liste déroulante Excel)
function inlSel(kind, cle, field, options, value, colors, plain){
  const v = value || '';
  const opts = [...new Set((v ? [v] : []).concat(options))];
  const c = colors && colors[v];
  return '<select class="inl'+(plain?' plain':'')+'" data-kind="'+kind+'" data-k="'+esc(cle)+'" data-f="'+field+'" data-old="'+esc(v)+'"'+(c?' style="background:'+c[0]+';color:'+c[1]+'"':'')+'>'
    + (v ? '' : '<option value="">—</option>') + opts.map(o => '<option'+(o===v?' selected':'')+'>'+esc(o)+'</option>').join('') + '</select>';
}
const PAIEMENTS = ['NON PAYÉE','PAYÉE','ESPECE','CB','VIREMENT'];
const ttc = ht => ht == null ? '' : String(Math.round(ht * 1.085 * 100) / 100).replace('.', ',');
async function encaisserEspeces(source, ref, client, defaut){
  const v = prompt('Montant reçu en espèces pour '+client+' (TTC) :', defaut || '');
  if (v === null) return false;
  try { await post('/gestion/api/caisse/encaisser', { montant: v, source, ref, client }); return true; }
  catch(e){ alert('Espèces non enregistrées : ' + e.message); return false; }
}
async function saveInline(sel){
  const kind = sel.dataset.kind, cle = sel.dataset.k, f = sel.dataset.f, v = sel.value, old = sel.dataset.old;
  if (v === old) return;
  if (kind === 'cmd' && f === 'statut' && v === 'LIVRÉE' && !confirm('Passer en LIVRÉE ? La ligne sera retirée de l\\'Excel au nettoyage de minuit.')) { sel.value = old; return; }
  if (kind === 'pl' && f === 'paiement' && norm(v) === 'ESPECE') {
    const p = planches.find(x => x.cle === cle);
    if (!(await encaisserEspeces('planche', p && (p.n_devis || p.cle), p ? p.client : '', p ? ttc(p.montant_ht) : ''))) { sel.value = old; return; }
  }
  sel.disabled = true;
  try {
    await post('/gestion/api/'+(kind === 'cmd' ? 'commandes' : 'planches')+'/'+encodeURIComponent(cle)+'/modifier', { [f]: v });
    await charger(false);
  } catch(e){ alert('Non enregistré : ' + e.message); sel.value = old; sel.disabled = false; }
}
// Panneau "À remettre" : commandes terminées / à expédier + planches à récupérer / à expédier, avec bouton Livré
function remettre(){
  panelCle = '__remettre__';
  const cmds = data.filter(c => ['TERMINÉE','A EXPEDIER'].includes(statutKey(c.statut)));
  const pls = planches.filter(p => ['A RECUPERER','A EXPEDIER'].includes(plKey(p.statut)));
  $('ptitle').textContent = 'À remettre';
  $('psub').textContent = (cmds.length + pls.length) + ' élément(s) prêts';
  const ligne = (kind, cle, client, sous, statutHtml, boutons) => '<div class="cand"><div><b>'+esc(client)+'</b> '+statutHtml+'<div class="sub">'+sous+'</div></div><div style="display:flex;gap:6px">'+boutons+'</div></div>';
  $('pbody').innerHTML = '<div class="card"><h3>Commandes · '+cmds.length+'</h3>'
    + (cmds.length ? cmds.map(c => ligne('cmd', c.cle, c.client, esc([c.n_devis, c.infos].filter(Boolean).join(' · ')) + especesHtml(c) + (c.bordereaux?'<div>'+bordereauxLiens(c)+'</div>':''), badge(c.statut),
        '<button class="btn pink" data-liv="cmd" data-k="'+esc(c.cle)+'">🏁 Livré</button>')).join('') : '<div class="note">Aucune commande prête.</div>')
    + '</div><div class="card"><h3>Planches DTF · '+pls.length+'</h3>'
    + (pls.length ? pls.map(p => ligne('pl', p.cle, p.client, esc([p.n_devis, metrage(p), p.paiement].filter(Boolean).join(' · ')), plBadge(p.statut),
        (plKey(p.statut) === 'A EXPEDIER' ? '<button class="btn" data-liv="pl-exp" data-k="'+esc(p.cle)+'">📦 Expédiée</button>' : '')
        + '<button class="btn pink" data-liv="pl" data-k="'+esc(p.cle)+'">🏁 Livré</button>')).join('') : '<div class="note">Aucune planche prête.</div>')
    + '</div><div class="msg" id="a-msg"></div>';
  $('overlay').classList.add('on'); $('panel').classList.add('on'); $('panel').setAttribute('aria-hidden','false');
  $('pbody').onclick = async e => {
    const b = e.target.closest('[data-liv]'); if (!b) return;
    const kind = b.dataset.liv, cle = b.dataset.k;
    const statut = kind === 'pl-exp' ? 'EXPÉDIÉE' : 'LIVRÉE';
    const cmd = kind === 'cmd' ? data.find(x => x.cle === cle) : null;
    if (cmd && cmd.a_payer_especes) {
      if (!confirm('💵 '+cmd.client+' doit payer en espèces'+(cmd.montant_especes!=null?' ('+montantFr(cmd.montant_especes)+')':'')+'.\\nAs-tu bien encaissé ? (OK = saisir le montant reçu)')) return;
      if (!(await encaisserEspeces('commande', cmd.n_devis || cmd.cle, cmd.client, cmd.montant_especes != null ? montantFr(cmd.montant_especes).replace(' €','') : ''))) return;
      try { await setEspecesCmd(cmd, false); } catch(e){}
    }
    b.disabled = true;
    try {
      await post('/gestion/api/'+(kind === 'cmd' ? 'commandes' : 'planches')+'/'+encodeURIComponent(cle)+'/modifier', { statut });
      await charger(false); remettre(); msg('✅ Passé en '+statut, 'ok');
    } catch(err){ msg('❌ ' + esc(err.message), 'err'); b.disabled = false; }
  };
}
// ---------- Espèces ----------
let caisseData = null;
const MOIS_FR = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function csRender(){
  const d = caisseData; if (!d) return;
  const r = d.dernierReleve;
  $('cs-solde').innerHTML = '<div class="big">'+eur(d.solde)+'</div><div class="sub">'
    + (r ? 'Dernier relevé le '+new Date(r.cree_le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})+' par '+esc(r.utilisateur||'?')+' : '+eur(Number(r.montant))+' récupérés'+(Number(r.ecart)?' · <b style="color:var(--bad)">écart '+(r.ecart>0?'+':'')+eur(Number(r.ecart))+'</b>':' · aucun écart')
       : 'Aucun relevé pour l\\'instant')+'</div>';
  const ligne = l => '<div class="mvt"><span class="d">'+new Date(l.cree_le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</span><span style="flex:1">'
    + (l.type === 'sortie' ? '➖ <b>'+eur(Number(l.montant))+'</b> décaissé' : l.type === 'releve' ? '💰 <b>Relevé</b> : compté '+eur(Number(l.compte))+' (théorique '+eur(Number(l.theorique))+'), récupéré '+eur(Number(l.montant))+(Number(l.ecart)?' · <b style="color:var(--bad)">écart '+eur(Number(l.ecart))+'</b>':'')
       : '💵 <b>'+eur(Number(l.montant))+'</b> · '+esc(l.client||'—')+(l.ref?' · '+esc(l.ref):'')+' <span class="tag">'+esc(l.source||'autre')+'</span>')
    + (l.note?' · '+esc(l.note):'')+' <span class="sub">par '+esc(l.utilisateur||'?')+'</span></span>'
    + (ADMIN && (l.type === 'encaissement' || l.type === 'sortie') ? '<button class="btn" style="padding:2px 7px" data-cs-del="'+l.id+'" title="Supprimer (erreur de saisie)">✕</button>' : '') + '</div>';
  $('cs-depuis').innerHTML = d.depuisReleve.length ? d.depuisReleve.map(ligne).join('') : '<div class="note">Aucun mouvement depuis le dernier relevé.</div>';
  if (!ADMIN) return;
  $('cs-histo').innerHTML = d.historique.length ? d.historique.slice(0,60).map(ligne).join('') : '<div class="note">Aucun mouvement.</div>';
  const mois = Object.entries(d.parMois).sort((a,b) => b[0].localeCompare(a[0])).slice(0, 18);
  const max = Math.max(1, ...mois.map(m => m[1]));
  $('cs-mois').innerHTML = mois.length ? '<div class="flow">' + mois.map(([m,v]) => { const [y,mm] = m.split('-'); return '<div class="frow" style="cursor:default;grid-template-columns:90px 1fr 90px"><span>'+MOIS_FR[Number(mm)-1]+' '+y+'</span><span class="track"><span class="fill" style="display:block;width:'+(v/max*100)+'%;background:#0f766e"></span></span><b>'+eur(v)+'</b></div>'; }).join('') + '</div>' : '<div class="note">Pas encore de données.</div>';
  $('cs-annee').innerHTML = Object.keys(d.parAnnee).length ? Object.entries(d.parAnnee).sort((a,b)=>b[0]-a[0]).map(([y,v]) => '<div class="plrow"><span>'+y+'</span><b>'+eur(v)+'</b></div>').join('') : '<div class="note">Pas encore de données.</div>';
}
// ---------- Heures ----------
let hrLundi = null, hrData = null;
const fhm = m => Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');
const jourFr = s => new Date(s+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit',month:'2-digit'});
function hrMsg(t, k){ $('hr-msg').className = 'msg on ' + k; $('hr-msg').innerHTML = t; }
function hrOptions(){
  const sel = $('hr-collab'); const cur = sel.value;
  sel.innerHTML = '<option value="">— Choisis ton nom —</option>' + EQUIPE.map(n => '<option>'+esc(n)+'</option>').join('');
  let last = cur; try { last = cur || localStorage.getItem('igs_hr_nom'); } catch(e){}
  if (last && EQUIPE.includes(last)) sel.value = last;
}
const hrMax = () => isoLocal(new Date());
function hrLigneHtml(jour){
  return '<div class="hrl"><div><label>Date</label><input type="date" class="hl-jour" value="'+jour+'" max="'+hrMax()+'"></div>'
    + '<div><label>Heures</label><input class="hl-duree" placeholder="04:30" inputmode="decimal" autocomplete="off"></div>'
    + '<div class="rem"><label>Remarque</label><input class="hl-rem" placeholder="facultatif"></div>'
    + '<button class="xdel" data-hl-del="1" title="Retirer cette ligne">×</button></div>';
}
function hrResetLignes(){ $('hr-lignes').innerHTML = hrLigneHtml(hrMax()); }
let hrMesLundi = null;
async function hrMes(){
  const nom = $('hr-collab').value, box = $('hr-mes');
  if (!nom) { box.innerHTML = '<h3>Mes heures</h3><div class="note">Choisis ton nom pour voir tes heures.</div>'; return; }
  try {
    const r = await fetch('/gestion/api/heures/mes?collaborateur='+encodeURIComponent(nom)+(hrMesLundi?'&lundi='+hrMesLundi:''));
    if (r.status === 401) return location.href = '/gestion/auth/login';
    const d = await r.json(); if (d.error) throw new Error(d.error);
    hrMesLundi = d.lundi;
    const auj = hrMax();
    let h = '<h3>Heures de '+esc(d.collaborateur)+'</h3><div class="hrnav"><button class="btn" data-mes-nav="-7">◀</button><b style="flex:1;text-align:center">Semaine '+d.numero+' · '+jourFr(d.lundi)+' → '+jourFr(d.dimanche)+'</b>'
      + '<button class="btn" data-mes-nav="7"'+(d.dimanche >= auj ? ' disabled' : '')+'>▶</button></div>';
    h += d.lignes.length ? '<table class="stk" style="margin-top:8px"><tbody>' + d.lignes.map(l => '<tr><td>'+jourFr(l.jour)+'</td><td><b>'+l.duree+'</b></td><td class="sub">'+esc(l.remarque||'')+'</td><td style="text-align:right">'
        + (l.payee ? '<span class="paid">Payée</span>' : '<button class="xdel" data-mes-del="'+l.id+'" title="Supprimer cette saisie">×</button>') + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="note" style="margin-top:8px">Aucune heure saisie cette semaine.</div>';
    h += '<div class="hrtot"><span>Total de la semaine</span><b class="m">'+d.total+'</b></div>';
    if (d.semaines.length) h += '<div class="k" style="margin-top:14px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase">8 dernières semaines</div>'
      + d.semaines.map(x => '<div class="cand" style="cursor:pointer" data-mes-goto="'+x.lundi+'"><div>Semaine '+x.numero+' <span class="sub">('+jourFr(x.lundi)+')</span><div class="sub">'+x.jours+' jour(s)</div></div><div><b>'+x.duree+'</b> '+(x.payee?'<span class="paid">Payée</span>':'')+'</div></div>').join('');
    box.innerHTML = h;
  } catch(e){ box.innerHTML = '<h3>Mes heures</h3><div class="warnbox">'+esc(e.message)+'</div>'; }
}
async function hrCharger(){
  hrOptions();
  if (!$('hr-lignes').children.length) hrResetLignes();
  hrMes();
  if (!$('hr-admin')) return;
  const r = await fetch('/gestion/api/heures/semaine' + (hrLundi ? '?lundi=' + hrLundi : ''));
  if (r.status === 401) return location.href = '/gestion/auth/login';
  const j = await r.json(); if (j.error) { $('hr-admin').innerHTML = '<div class="card warnbox">'+esc(j.error)+'</div>'; return; }
  hrData = j; hrLundi = j.lundi; hrRender();
}
function hrRender(){
  const d = hrData; if (!d) return;
  const auj = isoLocal(new Date());
  let h = '<div class="card"><div class="hrnav"><button class="btn" data-hr-nav="-7">◀</button><h3>Semaine '+d.numero+' · '+jourFr(d.lundi)+' → '+jourFr(d.dimanche)+'</h3>'
    + (auj < d.lundi || auj > d.dimanche ? '<button class="btn" data-hr-nav="0">Cette semaine</button>' : '')
    + '<button class="btn" data-hr-nav="7">▶</button></div>'
    + '<div class="hrtot"><span>Total semaine : <b>'+fhm(d.total.minutes)+'</b></span><span>À payer : <b class="m">'+eur(d.total.montant)+'</b></span></div>'
    + '<div class="btnrow" style="margin-top:10px"><button class="btn" id="hr-recap">📧 Envoyer le récap de cette semaine</button>'
    + '<label class="note" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="hr-auto"'+(d.recapAuto?' checked':'')+'> Récap automatique le dimanche à 20h ('+esc((d.recapA||[]).join(', '))+')</label>'
    + (d.importFait ? '' : '<button class="btn" id="hr-import" title="Reprend les lignes de l’onglet ⏱ Saisie Heures de l’Excel">⬇ Reprendre les heures de l’Excel</button>')
    + '</div><div class="msg" id="a-msg"></div></div>';
  if (!d.collaborateurs.length) h += '<div class="card note">Aucune heure saisie cette semaine.</div>';
  d.collaborateurs.forEach(c => {
    h += '<div class="card"><h3>'+esc(c.collaborateur)+(c.paiement?' <span class="paid">✅ Payé</span>':'')+'</h3>'
      + (c.lignes.length ? '<div style="overflow-x:auto"><table class="stk"><thead><tr><th>Jour</th><th>Heures</th><th>Remarque</th><th>Saisi</th><th></th></tr></thead><tbody>'
        + c.lignes.map(l => '<tr><td>'+jourFr(l.jour)+'</td><td><b>'+l.duree+'</b></td><td>'+esc(l.remarque||'')+'</td><td class="sub">'+esc(l.saisi_par||'')+' · '+new Date(l.cree_le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</td>'
          + '<td style="white-space:nowrap">'+(l.paiement_id ? '' : '<button class="btn" data-hr-edit="'+l.id+'" title="Modifier">✏️</button> <button class="xdel" data-hr-del="'+l.id+'" title="Supprimer">×</button>')+'</td></tr>').join('')
        + '</tbody></table></div>' : '<div class="note">Aucune heure cette semaine.</div>')
      + '<div class="hrtot"><span>'+c.duree+' × '+(c.taux==null?'<span class="why r">taux à renseigner dans Admin</span>':eur(c.taux)+'/h')+'</span>'
      + '<span>'+(c.montant==null?'':'<b class="m">'+eur(c.montant)+'</b>')+'</span>'
      + (c.paiement ? '<span class="note">Payé le '+new Date(c.paiement.paye_le).toLocaleDateString('fr-FR')+' · '+eur(Number(c.paiement.montant))+(c.nonPayees?' · <b>'+c.nonPayees+' jour(s) ajouté(s) après le paiement</b>':'')+' · <a href="#" data-hr-unpay="'+c.paiement.id+'">annuler</a></span>' : '')
      + (c.nonPayees && c.taux != null ? '<button class="btn pink" data-hr-pay="'+esc(c.collaborateur)+'">💶 Marquer payé</button>' : '')
      + '</div></div>';
  });
  if (d.aPayer.length) h += '<div class="card"><h3>⚠️ Semaines précédentes non payées</h3>' + d.aPayer.map(x =>
    '<div class="cand"><div><b>'+esc(x.collaborateur)+'</b> · semaine '+esc(x.semaine.split('-S')[1])+' ('+jourFr(x.lundi)+')<div class="sub">'+x.duree+(x.montant==null?'':' · '+eur(x.montant))+'</div></div><button class="btn" data-hr-goto="'+x.lundi+'">Voir</button></div>').join('') + '</div>';
  if (d.historique.length) h += '<div class="card"><h3>Derniers paiements</h3><div style="overflow-x:auto"><table class="stk"><thead><tr><th>Payé le</th><th>Collaborateur</th><th>Semaine</th><th>Heures</th><th>Taux</th><th>Montant</th></tr></thead><tbody>'
    + d.historique.map(p => '<tr><td>'+new Date(p.paye_le).toLocaleDateString('fr-FR')+'</td><td>'+esc(p.collaborateur)+'</td><td>'+esc(p.semaine.split('-S')[1])+' <span class="sub">('+jourFr(p.debut)+')</span></td><td>'+fhm(p.minutes)+'</td><td>'+eur(Number(p.taux))+'</td><td><b>'+eur(Number(p.montant))+'</b></td></tr>').join('')
    + '</tbody></table></div></div>';
  $('hr-admin').innerHTML = h;
}
function hrEvents(){
  $('hr-collab').addEventListener('change', () => { hrMesLundi = null; try { localStorage.setItem('igs_hr_nom', $('hr-collab').value); } catch(e){} hrMes(); });
  $('hr-plus').onclick = () => {
    const dates = [...document.querySelectorAll('.hl-jour')].map(i => i.value).filter(Boolean).sort();
    const base = dates.length ? new Date(dates[0]+'T12:00:00') : new Date(); base.setDate(base.getDate() - 1);
    $('hr-lignes').insertAdjacentHTML('beforeend', hrLigneHtml(isoLocal(base)));
    const ins = document.querySelectorAll('.hl-duree'); ins[ins.length-1].focus();
  };
  $('hr-lignes').addEventListener('click', e => {
    const b = e.target.closest('[data-hl-del]'); if (!b) return;
    if ($('hr-lignes').children.length > 1) b.closest('.hrl').remove(); else { b.closest('.hrl').querySelector('.hl-duree').value = ''; }
  });
  $('hr-lignes').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) $('hr-ok').click(); });
  $('hr-ok').onclick = async () => {
    const collaborateur = $('hr-collab').value;
    if (!collaborateur) return hrMsg('Choisis ton nom dans la liste', 'err');
    const lignes = [...document.querySelectorAll('.hrl')].map(r => ({ jour: r.querySelector('.hl-jour').value, duree: r.querySelector('.hl-duree').value.trim(), remarque: r.querySelector('.hl-rem').value.trim() })).filter(l => l.duree);
    if (!lignes.length) return hrMsg('Indique tes heures (ex. 04:30)', 'err');
    $('hr-ok').disabled = true;
    try {
      const j = await post('/gestion/api/heures', { collaborateur, lignes });
      hrMsg('✅ Enregistré pour <b>'+esc(j.collaborateur)+'</b> : '+j.lignes.map(l => jourFr(l.jour)+' <b>'+l.duree+'</b>').join(' · '), 'ok');
      hrResetLignes();
      hrMesLundi = null; hrMes();
      if ($('hr-admin')) hrCharger();
    } catch(e){ hrMsg('❌ ' + esc(e.message), 'err'); }
    finally { $('hr-ok').disabled = false; }
  };
  $('hr-mes').addEventListener('click', async e => {
    const t = e.target.closest('[data-mes-nav],[data-mes-goto],[data-mes-del]'); if (!t) return;
    const ds = t.dataset;
    if (ds.mesNav) { const d0 = new Date(hrMesLundi+'T12:00:00'); d0.setDate(d0.getDate()+Number(ds.mesNav)); hrMesLundi = isoLocal(d0); return hrMes(); }
    if (ds.mesGoto) { hrMesLundi = ds.mesGoto; return hrMes(); }
    if (ds.mesDel) {
      if (!confirm('Supprimer cette saisie ? Tu pourras la ressaisir ensuite.')) return;
      try { await post('/gestion/api/heures/'+ds.mesDel+'/supprimer'); hrMes(); if ($('hr-admin')) hrCharger(); } catch(err){ alert(err.message); }
    }
  });
  if (!$('hr-admin')) return;
  $('hr-admin').addEventListener('change', async e => {
    if (e.target.id !== 'hr-auto') return;
    try { await post('/gestion/api/heures/recap-auto', { active: e.target.checked }); } catch(err){ alert(err.message); e.target.checked = !e.target.checked; }
  });
  $('hr-admin').addEventListener('click', async e => {
    const t = e.target.closest('button,a'); if (!t || !hrData) return;
    const ds = t.dataset;
    if (ds.hrNav !== undefined) { const n = Number(ds.hrNav); if (n === 0) hrLundi = null; else { const d0 = new Date(hrLundi+'T12:00:00'); d0.setDate(d0.getDate()+n); hrLundi = isoLocal(d0); } return hrCharger(); }
    if (ds.hrGoto) { hrLundi = ds.hrGoto; return hrCharger(); }
    try {
      if (t.id === 'hr-recap') { t.disabled = true; const j = await post('/gestion/api/heures/recap', { lundi: hrData.lundi }); msg('✅ Récap envoyé à '+esc(j.a.join(', ')), 'ok'); t.disabled = false; return; }
      if (t.id === 'hr-import') { if (!confirm('Reprendre les heures de l’onglet ⏱ Saisie Heures de l’Excel ? Les jours déjà saisis ici sont ignorés.')) return; const j = await post('/gestion/api/heures/importer'); alert(j.importees+' journée(s) reprise(s) de l’Excel'); return hrCharger(); }
      if (ds.hrDel) { if (!confirm('Supprimer cette saisie ?')) return; await post('/gestion/api/heures/'+ds.hrDel+'/supprimer'); return hrCharger(); }
      if (ds.hrEdit) {
        const l = hrData.collaborateurs.flatMap(c => c.lignes).find(x => String(x.id) === ds.hrEdit); if (!l) return;
        const duree = prompt('Heures travaillées le '+jourFr(l.jour)+' :', l.duree); if (duree === null) return;
        const remarque = prompt('Remarque :', l.remarque || ''); if (remarque === null) return;
        await post('/gestion/api/heures/'+l.id+'/modifier', { duree, remarque }); return hrCharger();
      }
      if (ds.hrPay) {
        const c = hrData.collaborateurs.find(x => x.collaborateur === ds.hrPay);
        if (!confirm('Marquer payée la semaine '+hrData.numero+' de '+ds.hrPay+(c && c.montant != null ? ' ('+eur(c.montant)+')' : '')+' ?')) return;
        await post('/gestion/api/heures/payer', { collaborateur: ds.hrPay, lundi: hrData.lundi }); return hrCharger();
      }
      if (ds.hrUnpay) { e.preventDefault(); if (!confirm('Annuler ce paiement ? Les heures redeviennent « à payer ».')) return; await post('/gestion/api/heures/paiements/'+ds.hrUnpay+'/annuler'); return hrCharger(); }
    } catch(err){ alert(err.message); t.disabled = false; }
  });
}
function csEvents(){
  $('cs-enc').onclick = async () => {
    const client = prompt('Client :'); if (!client) return;
    const montant = prompt('Montant reçu en espèces (TTC) :'); if (!montant) return;
    const ref = prompt('N° de devis / référence (facultatif) :', '') || '';
    const note = prompt('Note (facultatif) :', '') || '';
    try { await post('/gestion/api/caisse/encaisser', { client, montant, ref, note, source: 'autre' }); } catch(e){ alert(e.message); }
    charger(false);
  };
  $('cs-dec').onclick = async () => {
    const montant = prompt('Montant sorti de la caisse :'); if (!montant) return;
    const note = prompt('Motif (obligatoire, ex. achat fournitures, monnaie) :'); if (!note) return;
    try { await post('/gestion/api/caisse/decaisser', { montant, note }); } catch(e){ alert(e.message); }
    charger(false);
  };
  if ($('cs-rel')) $('cs-rel').onclick = async () => {
    const th = caisseData ? caisseData.solde : 0;
    const compte = prompt('Montant compté dans la caisse (théorique : '+eur(th)+') :', String(th).replace('.',',')); if (compte === null) return;
    const recup = prompt('Montant récupéré (par défaut : tout) :', compte); if (recup === null) return;
    const note = prompt('Note (facultatif, ex. remis à Ismaël) :', '') || '';
    try { await post('/gestion/api/caisse/relever', { compte, recupere: recup, note }); } catch(e){ alert(e.message); }
    charger(false);
  };
  $('v-caisse').addEventListener('click', async e => {
    const b = e.target.closest('[data-cs-del]'); if (!b) return;
    if (!confirm('Supprimer cet encaissement (erreur de saisie) ?')) return;
    try { await post('/gestion/api/caisse/'+b.dataset.csDel+'/supprimer'); } catch(err){ alert(err.message); }
    charger(false);
  });
}
// Écart entre la quantité du devis (colonne Contenu) et le tableau des tailles du client
const montantFr = m => m == null ? '' : String(m).replace('.', ',') + ' €';
const especesHtml = c => c && c.a_payer_especes ? '<div><span class="esp" title="Le client paiera en espèces à la remise'+(c.especes_note_par?' (noté par '+esc(c.especes_note_par)+')':'')+'">💵 À payer en espèces'+(c.montant_especes!=null?' · '+montantFr(c.montant_especes):'')+'</span></div>' : '';
async function supprimerCmd(c){
  if (!confirm('Supprimer la commande '+(c.n_devis||'')+' · '+c.client+' ?\\nLa ligne sera vidée dans l\\'Excel (erreur ou test).')) return false;
  const dossier = !!c.n_devis && confirm('Supprimer aussi le dossier SharePoint « '+c.n_devis+' - … » (BAT, visuels, tailles) ?\\n\\nOK = supprimer le dossier (il part dans la corbeille SharePoint, récupérable 93 jours)\\nAnnuler = garder le dossier');
  try {
    const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/supprimer', { dossier });
    if (j.avertissement) alert(j.avertissement);
    await charger(false); return true;
  } catch(e){ alert('Non supprimée : ' + e.message); return false; }
}
async function supprimerPl(p){
  if (!confirm('Supprimer la planche de '+p.client+(p.n_devis?' ('+p.n_devis+')':'')+' ?\\nLa ligne sera vidée dans l\\'Excel (comme au nettoyage de minuit).')) return false;
  let fichiers = [];
  try { const r = await fetch('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/fichiers'); const j = await r.json(); fichiers = j.fichiers || []; } catch(e){}
  let ids = [];
  if (fichiers.length) {
    const autres = planches.filter(x => x.cle !== p.cle && norm(x.client) === norm(p.client)).length;
    if (confirm('Supprimer aussi le(s) fichier(s) de la planche ?\\n\\n'+fichiers.map(f => '• '+f.nom+(f.archive?' (archives)':'')).join('\\n')
      + (autres ? '\\n\\n⚠ '+autres+' autre(s) ligne(s) pour ce client : ces fichiers les concernent peut-être.' : '')
      + '\\n\\nOK = supprimer les fichiers (corbeille SharePoint, récupérables 93 jours)\\nAnnuler = garder les fichiers')) ids = fichiers.map(f => f.id);
  }
  try {
    const j = await post('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/supprimer', { fichiers: ids });
    if (j.avertissement) alert(j.avertissement);
    await charger(false); return true;
  } catch(e){ alert('Non supprimée : ' + e.message); return false; }
}
// ---------- Bordereau d'expédition ----------
const fichierUrl = (id, dl) => '/gestion/api/fichier/'+encodeURIComponent(id)+(dl?'?dl=1':'');
function bordereauxLiens(c){
  return c && c.bordereaux && c.bordereaux.length ? c.bordereaux.map(b => '<a class="esp bd" href="'+fichierUrl(b.id)+'" target="_blank" rel="noopener" title="Ouvrir '+esc(b.nom)+' pour l\\'imprimer">🖨 '+esc(b.nom.replace(/\\.[a-z0-9]+$/i,''))+'</a>').join(' ') : '';
}
function bordereauCard(c, liste){
  return '<div class="card" id="bd-card"><h3>📦 Bordereau d\\'expédition</h3>'
    + (liste.length ? liste.map(b => '<div class="cand"><div><b>'+esc(b.nom)+'</b>'+(b.modifie?'<div class="sub">déposé le '+new Date(b.modifie).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</div>':'')+'</div>'
        + '<div style="display:flex;gap:6px"><a class="btn primary" href="'+fichierUrl(b.id)+'" target="_blank" rel="noopener">🖨 Imprimer</a><a class="btn" href="'+fichierUrl(b.id,1)+'">⬇</a><button class="btn" data-bd-del="'+esc(b.id)+'" title="Supprimer ce bordereau">×</button></div></div>').join('')
      : '<div class="note">Aucun bordereau pour l\\'instant.</div>')
    + '<div class="btnrow" style="margin-top:10px"><label class="btn" style="cursor:pointer">⬆ Déposer un bordereau (PDF, PNG, JPG)<input type="file" id="bd-file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" style="display:none"></label></div>'
    + '<div class="msg" id="bd-msg"></div></div>';
}
function brancherBordereau(c){
  const card = $('bd-card'); if (!card) return;
  const m = (t, k) => { $('bd-msg').className = 'msg on ' + k; $('bd-msg').innerHTML = t; };
  const maj = liste => { c.bordereaux = liste.length ? liste.map(b => ({ id: b.id, nom: b.nom })) : null; card.outerHTML = bordereauCard(c, liste); brancherBordereau(c); afficher(); };
  $('bd-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    m('Dépôt de '+esc(f.name)+' dans le dossier de la commande…', 'info');
    const fd = new FormData(); fd.append('fichier', f);
    try {
      const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/bordereau', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
      maj(j.bordereaux || []); m('✅ Bordereau déposé : l\\'équipe peut l\\'imprimer', 'ok');
    } catch(err){ m('❌ ' + esc(err.message), 'err'); }
  };
  card.onclick = async e => {
    const b = e.target.closest('[data-bd-del]'); if (!b) return;
    if (!confirm('Supprimer ce bordereau ?')) return;
    try { const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/bordereau/'+encodeURIComponent(b.dataset.bdDel)+'/supprimer'); maj(j.bordereaux || []); }
    catch(err){ m('❌ ' + esc(err.message), 'err'); }
  };
}
async function setEspecesCmd(c, actif, montant){
  const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/especes', { actif, montant });
  if (j.commande) Object.assign(c, j.commande);
  return c;
}
const ecartHtml = ct => ct && ct.ecart ? '<div><span class="why r" title="Quantité du devis : '+ct.devis+' · tableau des tailles : '+ct.tableau+'">⚠ Devis '+ct.devis+' / tableau '+ct.tableau+' ('+(ct.ecart>0?'+':'')+ct.ecart+')</span></div>' : '';
// ---------- Listes et collaborateurs (page Admin) ----------
async function chargerListes(){
  try {
    const [l, c] = await Promise.all([fetch('/gestion/api/listes').then(r => r.json()), fetch('/gestion/api/collaborateurs').then(r => r.json())]);
    if (l && l.produits) { T_TYPES = l.produits.map(p => p.nom); T_COULEURS = l.couleurs; T_COUPES = l.coupes || T_COUPES; T_TAILLES = [...new Set(l.produits.flatMap(p => p.tailles))]; }
    if (c && c.collaborateurs && c.collaborateurs.length) EQUIPE = c.collaborateurs.filter(x => x.actif).map(x => x.affichage);
  } catch(e){}
}
let adData = null;
function adProdRow(p){
  return '<tr><td style="white-space:nowrap"><button class="btn ad-up" style="padding:2px 6px">↑</button> <button class="btn ad-down" style="padding:2px 6px">↓</button></td>'
    + '<td><input class="ad-p-nom" value="'+esc(p.nom||'')+'" style="width:100%;min-width:160px;font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px"></td>'
    + '<td><input class="ad-p-tailles" value="'+esc((p.tailles||[]).join(', '))+'" style="width:100%;min-width:200px;font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px"></td>'
    + '<td style="text-align:center"><input type="checkbox" class="ad-p-coupe"'+(p.coupe?' checked':'')+'></td>'
    + '<td><button class="btn ad-p-del" style="padding:2px 8px;color:var(--bad)">✕</button></td></tr>';
}
function adColRow(c){
  const inp = (cls, v, w, type) => '<input class="'+cls+'" '+(type?'type="'+type+'" ':'')+'value="'+esc(v ?? '')+'" style="width:'+w+';font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px">';
  return '<tr data-id="'+(c.id||'')+'"><td>'+inp('ad-c-aff', c.affichage, '130px')+'</td><td>'+inp('ad-c-nom', c.nom, '170px')+'</td><td>'+inp('ad-c-taux', c.taux_horaire, '90px', 'number')+'</td><td>'+inp('ad-c-ordre', c.ordre ?? 99, '60px', 'number')+'</td>'
    + '<td style="text-align:center"><input type="checkbox" class="ad-c-actif"'+(c.actif !== false ? ' checked' : '')+'></td>'
    + '<td style="white-space:nowrap"><button class="btn ad-c-save" style="padding:3px 8px">💾</button> '+(c.id ? '<button class="btn ad-c-del" style="padding:3px 8px;color:var(--bad)">✕</button>' : '')+'</td></tr>';
}
async function adCharger(){
  try {
    const [l, c] = await Promise.all([fetch('/gestion/api/listes').then(r => r.json()), fetch('/gestion/api/collaborateurs?tous=1').then(r => r.json())]);
    if (l.error) throw new Error(l.error); if (c.error) throw new Error(c.error);
    adData = { listes: l, collaborateurs: c.collaborateurs };
    document.querySelector('#ad-prod tbody').innerHTML = l.produits.map(adProdRow).join('');
    $('ad-couleurs').value = l.couleurs.join('\\n');
    $('ad-coupes').value = (l.coupes || []).join(', ');
    document.querySelector('#ad-col tbody').innerHTML = c.collaborateurs.map(adColRow).join('');
    $('sync').className = 'sync'; $('sync').textContent = '';
  } catch(e){ $('sync').className = 'sync err'; $('sync').textContent = '⚠️ ' + e.message; }
}
function adEvents(){
  $('ad-test-mail').onclick = async () => {
    $('ad-test-mail').disabled = true;
    try { const j = await post('/gestion/api/admin/test-mail'); alert('✅ Mail de test envoyé depuis ' + j.boite + ' vers ' + j.destinataires.join(', ') + '. Vérifie la boîte de réception.'); }
    catch(e){ alert('❌ Envoi impossible.\\n\\nMessage de Microsoft 365 :\\n' + e.message); }
    $('ad-test-mail').disabled = false;
  };
  const tb = document.querySelector('#ad-prod tbody');
  $('ad-prod-add').onclick = () => { tb.insertAdjacentHTML('beforeend', adProdRow({ nom: '', tailles: ['XS','S','M','L','XL','2XL','3XL'], coupe: true })); tb.lastElementChild.querySelector('.ad-p-nom').focus(); };
  tb.addEventListener('click', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.closest('.ad-up') && tr.previousElementSibling) tr.parentNode.insertBefore(tr, tr.previousElementSibling);
    if (e.target.closest('.ad-down') && tr.nextElementSibling) tr.parentNode.insertBefore(tr.nextElementSibling, tr);
    if (e.target.closest('.ad-p-del') && confirm('Retirer ce produit de la liste ?')) tr.remove();
  });
  $('ad-save-listes').onclick = async () => {
    const produits = [...tb.rows].map(tr => ({ nom: tr.querySelector('.ad-p-nom').value, tailles: tr.querySelector('.ad-p-tailles').value, coupe: tr.querySelector('.ad-p-coupe').checked }));
    try { await post('/gestion/api/admin/listes', { produits, couleurs: $('ad-couleurs').value, coupes: $('ad-coupes').value }); msg('✅ Listes enregistrées : le formulaire client et le dashboard les utilisent maintenant', 'ok'); adCharger(); }
    catch(err){ msg('❌ ' + esc(err.message), 'err'); }
  };
  const ct = document.querySelector('#ad-col tbody');
  $('ad-col-add').onclick = () => { ct.insertAdjacentHTML('beforeend', adColRow({ actif: true, ordre: 99 })); ct.lastElementChild.querySelector('.ad-c-aff').focus(); };
  ct.addEventListener('click', async e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.closest('.ad-c-save')) {
      const v = c => tr.querySelector(c);
      try { await post('/gestion/api/admin/collaborateurs', { id: tr.dataset.id ? Number(tr.dataset.id) : undefined, affichage: v('.ad-c-aff').value, nom: v('.ad-c-nom').value, taux_horaire: v('.ad-c-taux').value, ordre: v('.ad-c-ordre').value, actif: v('.ad-c-actif').checked }); adCharger(); }
      catch(err){ alert(err.message); }
    }
    if (e.target.closest('.ad-c-del')) {
      if (!confirm('Supprimer définitivement ce collaborateur ? (Pour le garder dans l\\'historique, décoche plutôt « Actif ».)')) return;
      try { await post('/gestion/api/admin/collaborateurs/'+tr.dataset.id+'/supprimer'); adCharger(); } catch(err){ alert(err.message); }
    }
  });
}
let autoEtat = null;
// ---------- Stock ----------
let stockData = null, stClient = null, stZeros = false;
// Type d'article déduit de la colonne COUPE (pas de colonne en plus dans l'Excel) : UNISEXE/FEMME/HOMME -> T-SHIRT
const typeArticle = x => { const c = norm(x.coupe).trim(); return !c || ['UNISEXE','FEMME','HOMME','ENFANT','?','COL V'].includes(c) ? 'T-SHIRT' : c; };
function qtyHtml(kind, attrs, n){
  return '<span class="qty" '+attrs+' data-kind="'+kind+'"><button data-d="-1" aria-label="Retirer">−</button><b class="'+(n?'':'zero')+'" title="Cliquer pour saisir la quantité">'+n+'</b><button data-d="1" aria-label="Ajouter">+</button></span>';
}
function stRender(){
  const d = stockData; if (!d) return;
  const q = norm(recherche);
  const v = d.vierges.filter(x => (stZeros || x.quantite > 0 || q) && (!q || norm([x.reference,x.coupe,x.couleur,x.taille].join(' ')).includes(q)))
    .sort((a,b) => a.couleur.localeCompare(b.couleur,'fr') || a.coupe.localeCompare(b.coupe,'fr') || a.taille.localeCompare(b.taille,'fr'));
  const total = d.vierges.reduce((t,x) => t + x.quantite, 0);
  const nz = d.vierges.filter(x => !x.quantite).length;
  const groupes = {};
  v.forEach(x => (groupes[typeArticle(x)] = groupes[typeArticle(x)] || []).push(x));
  $('st-vierges').innerHTML = '<div class="note" style="margin-bottom:6px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>'+total+' pièce(s) en stock · un stock à 0 est normal (pas d\\'alerte)</span><label style="cursor:pointer"><input type="checkbox" id="st-zeros"'+(stZeros?' checked':'')+'> Afficher les '+nz+' article(s) à 0</label></div><table class="stk"><thead><tr><th>Couleur</th><th>Taille</th><th>Coupe</th><th>Réf.</th><th>Qté</th></tr></thead><tbody>'
    + Object.keys(groupes).sort((a,b) => (a==='T-SHIRT'?-1:b==='T-SHIRT'?1:a.localeCompare(b,'fr'))).map(t => '<tr><td colspan="5" style="background:var(--soft);font-weight:800;font-size:12px;letter-spacing:.4px">'+esc(t)+' · '+groupes[t].reduce((n,x)=>n+x.quantite,0)+'</td></tr>'
      + groupes[t].map(x => '<tr><td><b>'+esc(x.couleur)+'</b></td><td>'+esc(x.taille)+'</td><td>'+esc(x.coupe)+'</td><td class="sub">'+esc(x.reference)+'</td><td>'+qtyHtml('vierges','data-row="'+x.row+'" data-sig="'+esc(x.sig)+'"',x.quantite)+'</td></tr>').join('')).join('')
    + '</tbody></table>';
  $('st-conso').innerHTML = '<table class="stk"><tbody>' + d.consommables.map(x => '<tr><td><b>'+esc(x.nom)+'</b><div class="sub">Seuil : <a href="#" class="seuil" data-row="'+x.row+'" data-sig="'+esc(x.sig)+'" data-v="'+(x.seuil ?? '')+'">'+(x.seuil ?? '—')+'</a></div></td><td>'+(x.alerte?'<span class="why r">⚠️ À commander</span>':'<span class="pay ok">✅ OK</span>')+'</td><td>'+qtyHtml('consommables','data-row="'+x.row+'" data-sig="'+esc(x.sig)+'"',x.stock)+'</td></tr>').join('') + '</tbody></table>';
  const parClient = {}; d.clients.forEach(l => (parClient[l.client] = parClient[l.client] || []).push(l));
  const noms = Object.keys(parClient).sort();
  if (!stClient || !parClient[stClient]) stClient = noms[0] || null;
  let h = '<div class="chips">' + noms.map(n => '<button class="chip'+(n===stClient?' on':'')+'" data-cl="'+esc(n)+'">'+esc(n)+' <span class="n">'+parClient[n].reduce((t,l)=>t+l.quantite,0)+'</span></button>').join('') + '</div>';
  if (stClient) {
    h += '<table class="stk"><tbody>' + parClient[stClient].map(l => '<tr><td><b>'+esc([l.article,l.couleur].filter(Boolean).join(' · ')||'—')+'</b><div class="sub">'+esc([l.taille,l.coupe].filter(Boolean).join(' · '))+(l.note?' · 📝 '+esc(l.note):'')+'</div></td><td>'+(l.article==='Note'?'':qtyHtml('client','data-id="'+l.id+'"',l.quantite))+'</td><td><button class="btn" style="padding:3px 8px" data-del="'+l.id+'" title="Supprimer la ligne">🗑</button></td></tr>').join('') + '</tbody></table>'
      + '<div class="btnrow"><button class="btn" id="add-ligne">＋ Ligne pour '+esc(stClient)+'</button></div>';
  } else h += '<div class="note">Aucun stock client pour l\\'instant.</div>';
  if (!parClient['SANDAE']) h += '<div class="btnrow"><button class="btn" id="imp-sandae">⇩ Importer le stock Sandae depuis l\\'Excel</button></div>';
  $('st-clients').innerHTML = h;
  $('st-mvt').innerHTML = d.mouvements.length ? d.mouvements.slice(0,25).map(m => '<div class="mvt"><span class="d">'+new Date(m.cree_le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</span><span><b>'+esc(m.article)+'</b>'+(m.client?' ('+esc(m.client)+')':'')+' : '+(m.avant ?? '∅')+' → '+(m.apres ?? '∅')+(m.motif?' · '+esc(m.motif):'')+' <span class="sub">par '+esc(m.utilisateur||'?')+'</span></span></div>').join('') : '<div class="note">Aucun mouvement enregistré.</div>';
}
async function stMouvement(el, body){
  const k = el.dataset.kind;
  const url = k === 'client' ? '/gestion/api/stock/clients/'+el.dataset.id+'/mouvement' : '/gestion/api/stock/'+k+'/mouvement';
  if (k !== 'client') Object.assign(body, { row: Number(el.dataset.row), sig: el.dataset.sig });
  el.style.opacity = .5;
  try { await post(url, body); } catch(e){ alert(e.message); }
  await charger(false);
}
function stEvents(){
  const root = $('v-stock');
  root.addEventListener('click', async e => {
    const btn = e.target.closest('.qty button'); if (btn) return stMouvement(btn.parentElement, { delta: Number(btn.dataset.d) });
    const b = e.target.closest('.qty b');
    if (b) { const v = prompt('Nouvelle quantité :', b.textContent); if (v !== null && v.trim() !== '') stMouvement(b.parentElement, { set: v.trim().replace(',','.') }); return; }
    const se = e.target.closest('.seuil');
    if (se) { e.preventDefault(); const v = prompt('Seuil d\\'alerte :', se.dataset.v); if (v !== null && v.trim() !== '') { try { await post('/gestion/api/stock/consommables/mouvement', { row: Number(se.dataset.row), sig: se.dataset.sig, champ: 'seuil', set: v.trim() }); } catch(err){ alert(err.message); } charger(false); } return; }
    if (e.target.id === 'st-zeros') { stZeros = e.target.checked; return stRender(); }
    const cl = e.target.closest('[data-cl]'); if (cl) { stClient = cl.dataset.cl; return stRender(); }
    const del = e.target.closest('[data-del]');
    if (del) { if (confirm('Supprimer cette ligne de stock client ?')) { try { await post('/gestion/api/stock/clients/'+del.dataset.del+'/supprimer'); } catch(err){ alert(err.message); } charger(false); } return; }
    if (e.target.id === 'imp-sandae') { if (confirm('Importer le stock Sandae de l\\'Excel dans les stocks clients ?')) { try { const j = await post('/gestion/api/stock/importer-sandae'); alert(j.importees+' ligne(s) importée(s)'); } catch(err){ alert(err.message); } charger(false); } return; }
    if (e.target.id === 'add-ligne' || e.target.id === 'add-client') {
      const client = e.target.id === 'add-ligne' ? stClient : prompt('Nom du client (ex. SANDAE) :');
      if (!client) return;
      const couleur = prompt('Couleur :') ; if (couleur === null) return;
      const taille = prompt('Taille :') ; if (taille === null) return;
      const coupe = prompt('Coupe (ex. HOMME, FEMME, COL V) :', '') ; if (coupe === null) return;
      const quantite = prompt('Quantité déposée :', '1'); if (quantite === null) return;
      try { await post('/gestion/api/stock/clients/ajouter', { client, couleur, taille, coupe, quantite }); stClient = client.toUpperCase(); } catch(err){ alert(err.message); }
      return charger(false);
    }
    if (e.target.id === 'add-vierge') {
      const type = (prompt('Type d\\'article (T-SHIRT, TABLIER, NAPPE, CASQUETTE, TOTE BAG, POLO…) :', 'T-SHIRT') || '').trim().toUpperCase(); if (!type) return;
      const couleur = prompt('Couleur :'); if (!couleur) return;
      const estTs = type === 'T-SHIRT' || type === 'TSHIRT';
      const taille = prompt('Taille :', estTs ? '' : 'TU'); if (!taille) return;
      const coupe = estTs ? prompt('Coupe (UNISEXE, FEMME, HOMME) :', 'UNISEXE') : type; if (coupe === null) return;
      const reference = prompt('Référence / modèle (facultatif) :', estTs ? 'IMPERIAL' : ''); if (reference === null) return;
      const quantite = prompt('Quantité :', '1'); if (quantite === null) return;
      try { await post('/gestion/api/stock/vierges/ajouter', { couleur, taille, coupe, reference, quantite }); } catch(err){ alert(err.message); }
      return charger(false);
    }
    if (e.target.id === 'add-conso') {
      const nom = prompt('Nom du consommable :'); if (!nom) return;
      const stock = prompt('Stock actuel :', '1'); if (stock === null) return;
      const seuil = prompt('Seuil d\\'alerte :', '0'); if (seuil === null) return;
      try { await post('/gestion/api/stock/consommables/ajouter', { nom, stock, seuil }); } catch(err){ alert(err.message); }
      return charger(false);
    }
  });
}
function nouvellePlanche(){
  panelCle = '__nouvelle__';
  $('pbody').onclick = null;
  $('ptitle').textContent = 'Nouvelle planche';
  $('psub').textContent = 'Ajoutée dans l\\'Excel (ligne vide réutilisée)';
  $('pbody').innerHTML = '<div class="card"><h3>Planche</h3><div class="actions">'
    + '<div class="field" style="grid-column:1/-1"><label>Client Odoo</label><div id="n-choisi"></div><div id="n-pk"></div></div>'
    + '<div class="field"><label>Métrage (m, A3 ou A4)</label><input id="n-metres" placeholder="ex. 2,5"></div>'
    + '<div class="field"><label>Date</label><input id="n-date" type="date" value="'+today+'"></div>'
    + '<div class="field"><label>Statut</label><select id="n-statut">'+PL_STATUTS.filter(s => s !== 'LIVRÉE').map(s => '<option>'+s+'</option>').join('')+'</select></div>'
    + '<div class="field" style="grid-column:1/-1"><label>Remarques</label><input id="n-rem" placeholder="ex. fichier reçu par WhatsApp, 2 exemplaires"></div>'
    + '</div><label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-weight:600"><input type="checkbox" id="n-hebdo"> Client hebdo (ajouter au compteur de la semaine)</label>'
    + '<div class="btnrow"><button class="btn primary" id="n-ok">Ajouter la planche</button></div><div class="msg" id="a-msg"></div></div>';
  $('overlay').classList.add('on'); $('panel').classList.add('on'); $('panel').setAttribute('aria-hidden','false');
  let choisi = null;
  const ouvrirPicker = () => { $('n-choisi').innerHTML = ''; picker($('n-pk'), '', [], (id, c) => {
    choisi = { id, name: c ? c.name : '' };
    $('n-pk').innerHTML = '';
    $('n-choisi').innerHTML = '<div class="cand" style="border:none"><div><b>'+esc(choisi.name)+'</b><div class="sub">Client Odoo sélectionné</div></div><button class="btn" id="n-chg">Changer</button></div>';
    $('n-chg').onclick = ouvrirPicker;
    $('n-hebdo').checked = planches.some(p => p.hebdo && norm(p.client) === norm(choisi.name));
  }); setTimeout(() => { const i = $('n-pk').querySelector('.pk-q'); if (i) i.focus(); }, 50); };
  ouvrirPicker();
  $('n-ok').onclick = async () => {
    if (!choisi) return msg('Choisis le client Odoo (ou crée-le)', 'err');
    const body = { partnerId: choisi.id, client: choisi.name, metres: $('n-metres').value, date: $('n-date').value, statut: $('n-statut').value, remarques: $('n-rem').value, hebdo: $('n-hebdo').checked };
    $('n-ok').disabled = true; msg('Écriture dans l\\'Excel…', 'info');
    try {
      const j = await post('/gestion/api/planches/ajouter', body);
      const texte = j.compteur ? '✅ Compteur hebdo : '+String(j.compteur.avant).replace('.',',')+' + '+String(j.compteur.ajout).replace('.',',')+' = '+String(j.compteur.total).replace('.',',')+' m' : '✅ Planche ajoutée dans l\\'Excel';
      await apresAction(j.planche, texte);
      if (!j.planche) msg(texte, 'ok');
    } catch(e){ msg('❌ ' + esc(e.message), 'err'); $('n-ok').disabled = false; }
  };
}
function plActionsHtml(p){
  const opts = PL_STATUTS.map(s => '<option'+(plKey(p.statut)===s?' selected':'')+'>'+s+'</option>').join('');
  let h = '<div class="card"><h3>Actions</h3><div class="actions">'
    + '<div class="field"><label>Client (nom dans l\\'Excel)</label><input id="a-client" value="'+esc(p.client)+'"></div>'
    + '<div class="field"><label>N° de devis</label><input id="a-devis-num" value="'+esc(p.n_devis||'')+'" placeholder="ex. DE2601064"></div>'
    + '<div class="field"><label>Paiement</label><input id="a-paiement" list="a-pay-list" value="'+esc(p.paiement||'')+'"><datalist id="a-pay-list"><option>NON PAYÉE</option><option>PAYÉE</option><option>ESPECE</option><option>CB</option><option>VIREMENT</option></datalist></div>'
    + '<div class="field"><label>Métrage (m, A3 ou A4)</label><input id="a-metres" value="'+esc(p.format || (p.metres != null ? String(p.metres).replace('.',',') : ''))+'" placeholder="ex. 2,5"></div>'
    + '<div class="field"><label>Statut</label><select id="a-statut"><option value="">—</option>'+opts+'</select></div>'
    + '<div class="field"><label>N° de suivi La Poste</label><input id="a-suivi" value="'+esc(p.numero_suivi||'')+'" placeholder="ex. 8J0231167048"></div>'
    + '<div class="field" style="grid-column:1/-1"><label>Remarques</label><input id="a-rem" value="'+esc(p.remarques||'')+'"></div>'
    + '</div><div class="btnrow"><button class="btn primary" id="a-save">Enregistrer</button>';
  const aVerif = plKey(p.statut) === 'A VERIFIER';
  if (!p.n_devis && !p.hebdo) h += '<button class="btn pink" id="a-devis">'+(aVerif ? '📝 Préparer le devis (sans envoi)' : '📄 Créer et envoyer le devis')+'</button>';
  if (p.n_devis) h += '<a class="btn" href="/gestion/odoo/devis/'+encodeURIComponent(p.n_devis)+'" target="_blank" rel="noopener">↗ Ouvrir le devis dans Odoo</a>';
  h += '<button class="btn" id="a-suppr" style="margin-left:auto;color:var(--bad)">🗑 Supprimer la ligne</button>';
  if (p.hebdo && ADMIN) h += '<button class="btn pink" id="a-facture">🧾 Envoyer la facture maintenant</button>';
  h += '</div>';
  if (p.hebdo && ADMIN) h += '<div class="field" style="margin-top:10px"><label>Titre de la facture</label><input id="a-titre" value="'+esc((autoEtat && autoEtat.titreParDefaut) || 'PLANCHE DTF SEMAINE')+'"></div>'
    + '<div class="note" style="margin-top:4px">Après l\\'envoi, le compteur (Métrage) repart à zéro dans l\\'Excel.</div>';
  return h + '<div class="msg" id="a-msg"></div><div id="a-cands"></div></div>';
}
function msg(t, cls){ const m = $('a-msg'); m.className = 'msg ' + cls; m.innerHTML = t; }
async function post(url, body){
  const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{})});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
  return j;
}
function busy(on){ ['a-save','a-devis','a-facture'].forEach(id => { if ($(id)) $(id).disabled = on; }); }
async function apresAction(planche, texte){
  await charger(false);
  const p = planche && planches.find(x => x.cle === planche.cle);
  if (p) { panelCle = p.cle; await ouvrirPlanche(p.cle); }
  if (texte) msg(texte, 'ok');
}
function brancherActions(p){
  $('a-save').onclick = async () => {
    const body = {};
    const m = $('a-metres').value.trim(), st = $('a-statut').value, su = $('a-suivi').value.trim();
    if (m !== (p.format || (p.metres != null ? String(p.metres).replace('.',',') : ''))) body.metres = m;
    if (st && st !== plKey(p.statut)) body.statut = st;
    if (su !== (p.numero_suivi || '')) body.numero_suivi = su;
    const cl = $('a-client').value.trim(), dv = $('a-devis-num').value.trim(), pa = $('a-paiement').value.trim(), re = $('a-rem').value.trim();
    if (cl && cl !== p.client) body.client = cl;
    if (dv !== (p.n_devis || '')) body.n_devis = dv;
    if (pa !== (p.paiement || '')) body.paiement = pa;
    if (re !== (p.remarques || '')) body.remarques = re;
    if (!Object.keys(body).length) return msg('Aucune modification', 'info');
    busy(true); msg('Écriture dans l\\'Excel…', 'info');
    try { const j = await post('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/modifier', body); await apresAction(j.planche || p, '✅ Enregistré dans l\\'Excel'); }
    catch(e){ msg('❌ ' + esc(e.message), 'err'); } finally { busy(false); }
  };
  const lancer = async (type, extra) => {
    const url = '/gestion/api/planches/'+encodeURIComponent(p.cle)+'/'+(type === 'devis' ? 'devis' : 'facturer');
    const body = Object.assign(type === 'facture' ? { titre: $('a-titre').value } : {}, extra || {});
    busy(true); msg(type === 'devis' ? 'Création du devis dans Odoo…' : 'Création et envoi de la facture…', 'info'); $('a-cands').innerHTML = '';
    try {
      const j = await post(url, body);
      if (j.besoinClient) return choisirClient(p, j.candidats || [], pid => lancer(type, Object.assign({}, extra, { partnerId: pid })));
      if (j.doublon) { if (confirm('Un devis '+j.doublon+' a été créé pour ce client il y a moins de 2 h. Créer quand même un nouveau devis ?')) return lancer(type, Object.assign({}, extra, { force: true })); return msg('Annulé : devis '+esc(j.doublon)+' déjà existant', 'info'); }
      const d = j.devis || j.facture;
      const lien = d.lien ? ' · <a href="'+esc(d.lien)+'" target="_blank" rel="noopener">ouvrir dans Odoo ↗</a>' : '';
      const quoi = j.devis ? (d.envoye === false ? 'Devis ' + esc(d.numero) + ' préparé (non envoyé) : ajuste-le puis envoie-le depuis Odoo' : 'Devis ' + esc(d.numero) + ' envoyé au client') : 'Facture ' + esc(d.numero) + ' envoyée au client';
      await apresAction(j.planche, '✅ ' + quoi + ' · ' + eur(d.montant_ht) + ' HT' + lien);
    } catch(e){ msg('❌ ' + esc(e.message), 'err'); } finally { busy(false); }
  };
  $('a-suppr').onclick = async () => { busy(true); if (await supprimerPl(p)) fermer(); else busy(false); };
  if ($('a-devis')) $('a-devis').onclick = () => { if (confirm(plKey(p.statut) === 'A VERIFIER' ? 'Préparer le devis dans Odoo pour '+p.client+' (sans l\\'envoyer) ?' : 'Créer le devis dans Odoo et l\\'envoyer par mail à '+p.client+' ?')) lancer('devis'); };
  if ($('a-facture')) $('a-facture').onclick = () => {
    const q = p.format || (p.metres ? String(p.metres).replace('.',',')+' m' : '');
    if (!q) return msg('Compteur à zéro : rien à facturer', 'info');
    if (confirm('Créer, valider et envoyer la facture « '+$('a-titre').value+' » ('+q+') à '+p.client+' ?\\nLe compteur sera remis à zéro.')) lancer('facture');
  };
}
// ---------- Sélecteur de client Odoo (recherche + suggestions + création) ----------
// box : élément conteneur ; q : recherche initiale ; list : suggestions initiales ; onChoose(id, client)
function picker(box, q, list, onChoose){
  const item = c => '<div class="cand"><div><b>'+esc(c.name)+'</b>'+(c.score===1?' <span class="tag">identique</span>':c.score>=0.6?' <span class="tag">ressemblant</span>':'')
    + '<div class="sub">'+esc([c.email, [c.zip, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · '))+'</div></div><button class="btn" data-id="'+c.id+'">Choisir</button></div>';
  const draw = (items, query) => {
    box.querySelector('.pk-list').innerHTML = (items.length ? items.map(item).join('') : '<div class="note" style="padding:6px 0">Aucun client Odoo trouvé'+(query?' pour « '+esc(query)+' »':'')+'</div>')
      + (query ? '<div class="cand"><div class="sub">Pas dans la liste ?</div><button class="btn pink pk-new">＋ Créer « '+esc(query)+' » dans Odoo</button></div>' : '');
    box._items = items;
  };
  box.innerHTML = '<div class="field" style="margin-top:8px"><input class="pk-q" placeholder="Rechercher dans Odoo (nom, email)…" value="'+esc(q||'')+'"></div><div class="pk-list"></div><div class="pk-form"></div>';
  draw(list || [], q);
  let t;
  const chercher = async v => {
    if (!v.trim()) return draw([], '');
    try { const r = await fetch('/gestion/api/odoo/clients?q='+encodeURIComponent(v)); const j = await r.json(); if (box.querySelector('.pk-q').value === v) draw(j.clients || [], v); } catch(e){}
  };
  box.querySelector('.pk-q').oninput = e => { clearTimeout(t); t = setTimeout(() => chercher(e.target.value), 300); };
  if (q && !(list && list.length)) chercher(q);
  box.onclick = async e => {
    const b = e.target.closest('button[data-id]');
    if (b) { const c = (box._items||[]).find(x => x.id === Number(b.dataset.id)); return onChoose(Number(b.dataset.id), c); }
    if (e.target.closest('.pk-new')) {
      const name = box.querySelector('.pk-q').value.trim();
      box.querySelector('.pk-form').innerHTML = '<div class="card" style="margin-top:8px;background:#faf9fd"><h3>Nouveau client Odoo (IGS)</h3><div class="actions">'
        + '<div class="field" style="grid-column:1/-1"><label>Nom</label><input class="nf-name" value="'+esc(name)+'"></div>'
        + '<div class="field"><label>Email</label><input class="nf-email" type="email"></div>'
        + '<div class="field"><label>Téléphone</label><input class="nf-phone"></div>'
        + '<div class="field"><label>Code postal</label><input class="nf-zip" placeholder="971xx / 972xx"></div>'
        + '<div class="field"><label>Ville</label><input class="nf-city"></div>'
        + '</div><div class="btnrow"><button class="btn primary nf-ok">Créer le client</button></div></div>';
      box.querySelector('.nf-ok').onclick = async () => {
        const v = c => box.querySelector(c).value;
        if (!confirm('Créer le client « '+v('.nf-name')+' » dans Odoo (société IGS) ?')) return;
        try { const j = await post('/gestion/api/odoo/clients', { name: v('.nf-name'), email: v('.nf-email'), phone: v('.nf-phone'), zip: v('.nf-zip'), city: v('.nf-city') }); onChoose(j.client.id, j.client); }
        catch(err){ alert('Création impossible : ' + err.message); }
      };
    }
  };
}
function choisirClient(p, cands, then){
  msg('Client « '+esc(p.client)+' » non identifié dans Odoo : choisis la bonne fiche ou crée-la. Ce choix sera mémorisé.', 'info');
  picker($('a-cands'), p.client, cands, id => { $('a-cands').innerHTML = ''; then(id); });
}
// Bloc "Client Odoo" de la fiche planche
async function chargerClientOdoo(p){
  const box = $('cliobox'); if (!box) return;
  const affiche = j => {
    if (j.partner) {
      const src = { memorise: 'mémorisé', identique: 'nom identique', auto: 'trouvé automatiquement' }[j.source] || '';
      box.innerHTML = '<div class="cand" style="border:none"><div><b>'+esc(j.partner.name)+'</b> <span class="tag">'+esc(src)+'</span>'+(j.partner.martinique?' <span class="tag">🇲🇶 Martinique</span>':'')
        + '<div class="sub">'+esc([j.partner.email, [j.partner.zip, j.partner.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · '))+'</div></div><button class="btn" id="clio-chg">Changer</button></div><div id="clio-pk"></div>';
      $('clio-chg').onclick = () => picker($('clio-pk'), '', [], choisir);
      if (norm(j.partner.name) !== norm(p.client)) {
        $('clio-pk').insertAdjacentHTML('beforebegin', '<div class="btnrow" style="margin-top:4px"><button class="btn" id="clio-ren">✏️ Renommer « '+esc(p.client)+' » en « '+esc(j.partner.name)+' » dans l\\'Excel</button></div>');
        $('clio-ren').onclick = async () => {
          if (!confirm('Remplacer le nom « '+p.client+' » par « '+j.partner.name+' » dans l\\'Excel ?')) return;
          try { const r = await post('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/modifier', { client: j.partner.name }); await apresAction(r.planche || p, '✅ Client renommé dans l\\'Excel'); }
          catch(e){ alert(e.message); }
        };
      }
    } else {
      box.innerHTML = '<div class="note">Pas de correspondance sûre pour « '+esc(p.client)+' » : choisis la fiche Odoo ou crée-la.</div><div id="clio-pk"></div>';
      picker($('clio-pk'), p.client, j.candidats || [], choisir);
    }
  };
  const choisir = async id => {
    box.innerHTML = '<div class="skel"></div>';
    try { affiche(await post('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/client', { partnerId: id })); }
    catch(e){ box.innerHTML = '<div class="warnbox">'+esc(e.message)+'</div>'; }
  };
  try { const r = await fetch('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/client'); const j = await r.json(); if (panelCle !== p.cle) return; if (j.error) throw new Error(j.error); affiche(j); }
  catch(e){ box.innerHTML = '<div class="note">Odoo indisponible : '+esc(e.message)+'</div>'; }
}
async function chargerAuto(){
  try { const r = await fetch('/gestion/api/planches/facturation-auto'); autoEtat = await r.json(); } catch(e){ autoEtat = null; }
  if (!$('autobox') || !autoEtat) return;
  const b = autoEtat.bilan;
  $('autobox').innerHTML = '<button class="switch'+(autoEtat.active?' on':'')+'" id="auto-sw" aria-label="Activer la facturation automatique"></button>'
    + '<div><b>Factures hebdo automatiques</b> · chaque lundi à 8h · '+(autoEtat.active?'<span style="color:var(--ok);font-weight:700">activées</span>':'<span class="sub">désactivées</span>')
    + (autoEtat.odoo ? '' : ' · <span style="color:var(--bad)">Odoo non configuré</span>')
    + (b ? '<div class="sub">Dernier envoi ('+esc(b.semaine)+') : '+esc((b.lignes||[]).join(' · ') || 'aucune facture')+'</div>' : '<div class="sub">Aucun envoi automatique pour l\\'instant</div>') + '</div>';
  $('auto-sw').onclick = async () => {
    const on = !autoEtat.active;
    if (on && !confirm('Activer l\\'envoi automatique des factures hebdo chaque lundi à 8h ?')) return;
    try { await post('/gestion/api/planches/facturation-auto', { active: on }); chargerAuto(); } catch(e){ alert(e.message); }
  };
}
async function ouvrirPlanche(cle){
  const p = planches.find(x => x.cle === cle); if (!p) return;
  $('pbody').onclick = null;
  $('ptitle').innerHTML = esc(p.client) + ' ' + (p.statut ? plBadge(p.statut) : '');
  $('psub').textContent = p.hebdo ? 'Client hebdomadaire · facturé le lundi' : (p.n_devis || 'Pas encore de devis');
  $('pbody').innerHTML = '<div class="card"><h3>Planche</h3><div class="grid">'
    + kv('Date', fdate(p.date_commande)) + kv('Métrage', esc(metrage(p)))
    + kv('Réduction', p.reduction ? Math.round(p.reduction*100)+' %' : '') + kv('Montant HT', eur(p.montant_ht))
    + kv('Paiement', '<span class="pay '+payClass(p.paiement)+'">'+esc(p.paiement||'—')+'</span>') + kv('Fréquence', esc(p.frequence))
    + kv('N° de suivi', esc(p.numero_suivi))
    + '</div>' + (p.remarques ? '<div class="kv" style="margin-top:10px"><div class="k">Remarques</div><div class="v pre">'+esc(p.remarques)+'</div></div>' : '')
    + '<div class="note" style="margin-top:10px">Mails : accusé/devis '+(p.mail_envoye?'✅':'—')+' · expédition '+(p.mail_expedition_envoye?'✅':'—')+'</div></div>'
    + '<div class="card"><h3>Client Odoo</h3><div id="cliobox"><div class="skel"></div></div></div>'
    + plActionsHtml(p)
    + '<div id="dossier"><div class="card"><h3>Fichiers</h3><div class="skel"></div><div class="skel"></div></div></div>';
  brancherActions(p);
  chargerClientOdoo(p);
  $('overlay').classList.add('on'); $('panel').classList.add('on'); $('panel').setAttribute('aria-hidden','false');
  try{
    const r = await fetch('/gestion/api/planches/'+encodeURIComponent(cle)+'/fichiers');
    const d = await r.json();
    if (cle !== panelCle) return;
    if (d.erreur) throw new Error(d.erreur);
    $('dossier').innerHTML = '<div class="card"><h3>Fichiers · '+d.fichiers.length+'</h3>' + (d.fichiers.length
      ? '<div class="files">' + d.fichiers.map(f => {
          const src = '/gestion/api/planches/fichier/'+encodeURIComponent(f.id);
          const isPdf = /[.]pdf$/i.test(f.nom);
          return '<div><a class="file" href="'+src+'" target="_blank" rel="noopener"><div class="th">'
            + (isPdf && !f.miniature ? '<span class="pdf">📄</span>' : '<img loading="lazy" src="'+esc(f.miniature || src)+'" alt="">')
            + '</div><div class="nm">'+esc(f.nom)+'</div><div class="ds">'+(f.archive?'🗄 Archives':'🖨 '+esc(f.dossier))+' · '+(f.taille?Math.round(f.taille/1024/1024*10)/10+' Mo':'')+'</div></a>'
            + '<a class="btn" style="display:block;text-align:center;margin-top:4px;font-size:12px;padding:5px" href="'+src+'?dl=1">⬇ Télécharger</a></div>';
        }).join('') + '</div>'
      : '<div class="note">Aucun fichier « '+esc(p.client)+' - P… » dans les dossiers Planches (peut-être déjà vidé de l\\'archive mensuelle, ou envoyé par lien).</div>') + '</div>';
  } catch(e){
    if (cle === panelCle) $('dossier').innerHTML = '<div class="card warnbox">Fichiers indisponibles : '+esc(e.message)+'</div>';
  }
}

function accueil(){
  $('today').textContent = new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const actifs = data.filter(actif), retards = actifs.filter(enRetard);
  const semaine = actifs.filter(c => c.date_livraison && c.date_livraison >= today && c.date_livraison <= addDays(7));
  const prets = data.filter(c => ['TERMINÉE','A EXPEDIER'].includes(statutKey(c.statut)));
  const pretsPl = planches.filter(p => ['A RECUPERER','A EXPEDIER'].includes(plKey(p.statut)));
  const k = (l,n,h,col,f) => '<a class="kpi" style="--accent:'+col+'" href="/gestion/commandes?filtre='+f+'"><div class="l">'+l+'</div><div class="n">'+n+'</div><div class="h">'+h+'</div></a>';
  $('kpis').innerHTML = k('En cours', actifs.length, 'commandes actives', '#1e1b4b', 'ACTIFS')
    + k('En retard', retards.length, retards.length ? 'date de livraison dépassée' : 'rien en retard 👌', retards.length ? '#b91c1c' : '#15803d', 'ACTIFS')
    + k('À livrer sous 7 jours', semaine.length, 'd\\'ici le '+fdate(addDays(7)), '#e91e8c', 'ACTIFS')
    + '<a class="kpi" style="--accent:#0f766e" href="#" id="kpi-remettre"><div class="l">Prêtes à remettre</div><div class="n">'+(prets.length + pretsPl.length)+'</div><div class="h">'+prets.length+' commande(s) · '+pretsPl.length+' planche(s) · cliquer</div></a>';
  $('kpi-remettre').onclick = e => { e.preventDefault(); remettre(); };

  const vus = new Set(), prios = [];
  const add = (c, why, cls) => { if (!vus.has(c.cle)) { vus.add(c.cle); prios.push({c, why, cls}); } };
  retards.sort((a,b)=>a.date_livraison.localeCompare(b.date_livraison)).forEach(c => add(c, 'En retard · '+fdate(c.date_livraison), 'r'));
  actifs.filter(c => c.date_livraison === today).forEach(c => add(c, 'Livraison aujourd\\'hui', 'o'));
  actifs.filter(c => c.date_livraison === addDays(1)).forEach(c => add(c, 'Livraison demain', 'o'));
  data.filter(c => statutKey(c.statut) === 'PAYÉE').forEach(c => add(c, 'Attend le formulaire', 'b'));
  actifs.filter(c => c.controle && c.controle.ecart).forEach(c => add(c, 'Écart devis '+c.controle.devis+' / tableau '+c.controle.tableau, 'r'));
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
  if (filtre === 'TOUS') filtre = 'ACTIFS';
  const chips = [['ACTIFS','En cours',actifs]].concat(STATUTS.map(s=>[s,s,counts[s]||0]));
  $('chips').innerHTML = chips.map(([k,l,n]) => '<button class="chip'+(filtre===k?' on':'')+'" data-f="'+esc(k)+'">'+esc(l)+' <span class="n">'+n+'</span></button>').join('')
    + (filtre === 'LIVRÉE' ? '<span class="note" style="align-self:center">Les commandes livrées sont retirées de l\\'Excel à minuit : retrouve les plus anciennes dans l\\'onglet Historique.</span>' : '');

  const q = norm(recherche);
  let rows = data.filter(c => filtre==='TOUS' || (filtre==='ACTIFS' ? !FINIS.includes(statutKey(c.statut)) : statutKey(c.statut)===filtre));
  if (q) rows = rows.filter(c => norm([c.n_devis,c.client,c.zone_flocage,c.affectation,c.infos,c.remarque,c.email].join(' ')).includes(q));
  // Priorité : à expédier, en flocage, production, commande, validée, payée, terminée, devis ; puis livraison la plus urgente
  const rang = c => { const i = ORDRE_TRI.indexOf(statutKey(c.statut)); return i < 0 ? ORDRE_TRI.length : i; };
  rows.sort((a,b) => rang(a) - rang(b) || String(a.date_livraison||'9999').localeCompare(String(b.date_livraison||'9999')) || String(a.date_commande||'').localeCompare(String(b.date_commande||'')));

  $('rows').innerHTML = rows.length ? rows.map(c => {
    const late = enRetard(c);
    return '<tr class="row" data-k="'+esc(c.cle)+'">'
      + '<td class="devis"><a href="#" class="open">'+esc(c.n_devis || '—')+'</a></td>'
      + '<td><a href="#" class="open client">'+esc(c.client)+'</a>'+especesHtml(c)+(c.bordereaux?'<div>'+bordereauxLiens(c)+'</div>':'')+ecartHtml(c.controle)+(c.remarque?'<div class="sub clip">'+esc(c.remarque)+'</div>':'')+'</td>'
      + '<td class="c-statut">'+inlSel('cmd', c.cle, 'statut', STATUTS, statutKey(c.statut), COULEURS)+'</td>'
      + '<td class="c-hide"><div class="clip">'+esc(c.infos||'')+'</div></td>'
      + '<td class="c-zone"><span class="sub">'+esc(c.zone_flocage||'')+'</span></td>'
      + '<td class="c-hide">'+inlSel('cmd', c.cle, 'affectation', EQUIPE, c.affectation || '', null, true)+'</td>'
      + '<td class="c-hide">'+fdate(c.date_commande)+(c.date_dynamique?' <span class="dyn" title="La cellule Excel contient =TODAY() : la date change chaque jour">⚠ date auto</span>':'')+'</td>'
      + '<td class="c-hide'+(late?' late':'')+'">'+fdate(c.date_livraison)+(late?' ⏰':'')+(c.date_livraison_manuelle?' <span class="manual" title="Date modifiée manuellement">✏️</span>':'')+'</td>'
      + '<td class="c-hide">'+inlSel('cmd', c.cle, 'planche', PLANCHE_ETATS, c.planche || '', null, true)+'</td>'
      + '<td class="c-x"><button class="xdel" data-del="1" title="Supprimer la ligne">×</button></td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="10" class="empty">Aucune commande '+(q?'pour cette recherche':'dans ce filtre')+'</td></tr>';
}

function kv(k,v){ return v ? '<div class="kv"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>' : ''; }

async function ouvrir(cle){
  const c = data.find(x => x.cle === cle) || histo.find(x => x.cle === cle); if(!c) return;
  $('pbody').onclick = null;
  dernierDossier = null;
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
    + cmdActionsHtml(c)
    + '<div id="dossier"><div class="card"><h3>Dossier client</h3><div class="skel"></div><div class="skel"></div></div></div>';
  brancherCmd(c);
  $('overlay').classList.add('on'); $('panel').classList.add('on'); $('panel').setAttribute('aria-hidden','false');
  if (!c.n_devis) { $('dossier').innerHTML = '<div class="card note">Pas de N° de devis : impossible de retrouver le dossier SharePoint.</div>'; return; }

  try{
    const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(c.n_devis)+'/dossier');
    const d = await r.json();
    if (cle !== panelCle) return;
    if (d.erreur) throw new Error(d.erreur);
    if (!d.trouve) { $('dossier').innerHTML = '<div class="card note">Aucun dossier « '+esc(c.n_devis)+' - … » trouvé dans Clients/Commandes.</div>'; return; }
    let h = '';
    if (statutKey(c.statut) === 'A EXPEDIER' || (d.bordereaux && d.bordereaux.length)) h += bordereauCard(c, d.bordereaux || []);
    if (d.controle) h += d.controle.ecart
      ? '<div class="warnbox">⚠️ <b>Incohérence devis / tableau</b> : le devis indique <b>'+d.controle.devis+' pièce(s)</b>, le tableau des tailles du client en contient <b>'+d.controle.tableau+'</b> ('+(d.controle.ecart>0?'+':'')+d.controle.ecart+'). Vérifie avec le client avant de commander les t-shirts.</div>'
      : '<div class="note" style="color:var(--ok);font-weight:600">✅ Tableau des tailles cohérent avec le devis ('+d.controle.devis+' pièces)</div>';
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
    brancherBordereau(c);
    if (d.bordereaux) { const avant = JSON.stringify(c.bordereaux||null); c.bordereaux = d.bordereaux.length ? d.bordereaux.map(b => ({ id: b.id, nom: b.nom })) : null; if (avant !== JSON.stringify(c.bordereaux)) afficher(); }
    dernierDossier = d;
  } catch(e){
    if (cle === panelCle) $('dossier').innerHTML = '<div class="card warnbox">Dossier indisponible : '+esc(e.message)+'</div>';
  }
}
// ---------- Historique et duplication ----------
let histo = [], modeHisto = false, dernierDossier = null;
let T_TYPES = ['T-Shirt','T-Shirt Col V','T-Shirt Polyester','T-Shirt Longue Manche','Polo','Débardeur','Tote Bag','Casquette','T-Shirt Enfant','T-shirt fourni','Autre : (saisie manuelle)'];
let T_COULEURS = ['Noir profond','Gris foncé','Gris clair','Blanc','Rose bonbon','Fuchsia','Bordeaux','Rouge','Hibiscus','Orange','Jaune Citron','Jaune Gold','Vert pomme','Vert prairie','Vert bouteille','Kaki foncé','Terre','Chocolat','Violet foncé','Marine','French marine','Royal','Aqua','Bleu atoll','Ciel','Sable'];
let T_TAILLES = ['XS','S','M','L','XL','2XL','3XL','2A','4A','6A','8A','10A','12A'];
let T_COUPES = ['Unisexe','Femme'];
async function chargerHisto(){
  $('rows').innerHTML = '<tr><td colspan="9"><div class="skel"></div><div class="skel"></div></td></tr>';
  try { const r = await fetch('/gestion/api/commandes-historique?q='+encodeURIComponent(recherche)); const j = await r.json(); if (j.error) throw new Error(j.error); histo = j.commandes || []; }
  catch(e){ $('rows').innerHTML = '<tr><td colspan="9" class="empty">Historique indisponible : '+esc(e.message)+'</td></tr>'; return; }
  $('chips').innerHTML = '<span class="note">'+histo.length+' commande(s)'+' livrée(s)'+(recherche?' pour « '+esc(recherche)+' »':' (les 300 plus récentes)')+' · clique pour voir le dossier et dupliquer</span>';
  $('rows').innerHTML = histo.length ? histo.map(c => '<tr class="row" data-k="'+esc(c.cle)+'">'
    + '<td class="devis"><a href="#" class="open">'+esc(c.n_devis||'—')+'</a></td>'
    + '<td><a href="#" class="open client">'+esc(c.client)+'</a>'+(c.archive_seule?'<div class="sub">dossier ARCHIVES</div>':c.present===false?'<div class="sub">archivée</div>':'')+'</td>'
    + '<td class="c-statut">'+badge(c.statut)+'</td>'
    + '<td class="c-hide"><div class="clip">'+esc(c.infos||'')+'</div></td>'
    + '<td class="c-zone"><span class="sub">'+esc(c.zone_flocage||'')+'</span></td>'
    + '<td class="c-hide">'+esc(c.affectation||'')+'</td>'
    + '<td class="c-hide">'+fdate(c.date_commande)+'</td><td class="c-hide">'+fdate(c.date_livraison)+'</td><td class="c-hide">'+esc(c.planche||'')+'</td></tr>').join('')
    : '<tr><td colspan="10" class="empty">Aucune commande livrée trouvée</td></tr>';
}
function ligneDupHtml(l){
  const sel = (list, v, cls) => '<select class="'+cls+'">'+[...new Set((v?[v]:[]).concat(list))].map(x => '<option'+(x===v?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
  return '<tr>'
    + '<td>'+sel(T_TYPES, l.type || 'T-Shirt', 'd-type')+'</td>'
    + '<td>'+sel(T_COULEURS, l.couleur || '', 'd-couleur')+'</td>'
    + '<td>'+sel(T_TAILLES, l.taille || 'M', 'd-taille')+'</td>'
    + '<td>'+sel(T_COUPES, l.coupe || 'Unisexe', 'd-coupe')+'</td>'
    + '<td><input class="d-qte" type="number" min="0" value="'+(l.quantite||1)+'" style="width:64px"></td>'
    + '<td><input class="d-visuel" list="d-visuels" value="'+esc(l.visuel||'')+'"></td>'
    + '<td><input class="d-rem" value="'+esc(l.remarques||'')+'"></td>'
    + '<td><button class="btn d-del" style="padding:3px 8px" title="Supprimer la ligne">✕</button></td></tr>';
}
function dupliquerUI(c){
  $('pbody').onclick = null;
  const lignes = dernierDossier && dernierDossier.tailles ? dernierDossier.tailles.groupes.flatMap(g => g.lignes) : [];
  const visuels = dernierDossier ? dernierDossier.visuels.map(v => v.nom.replace(/_/g,' ')) : [];
  $('ptitle').textContent = 'Dupliquer ' + (c.n_devis || c.client);
  $('psub').textContent = c.client;
  $('pbody').innerHTML = '<div class="card"><h3>1. Quel type de duplication ?</h3>'
    + '<div class="actions" style="grid-template-columns:1fr 1fr">'
    + '<label class="mod" style="cursor:pointer"><input type="radio" name="d-mode" value="refaire"> <b>🔁 Refaire la commande</b><div class="d">Erreur à corriger : même devis suffixé « -R1 », pas de nouveau devis, BAT recopié. Statut VALIDÉE.</div></label>'
    + '<label class="mod" style="cursor:pointer"><input type="radio" name="d-mode" value="nouveau"> <b>🆕 Nouvelle commande</b><div class="d">Le client recommande : copie du devis Odoo d\\'origine (brouillon, à ajuster et envoyer), nouveau BAT à faire. Statut EN DEVIS.</div></label>'
    + '</div></div>'
    + '<div class="card"><h3>2. Articles (repris de Tailles.xlsx'+(lignes.length?'':' : introuvable, saisis-les')+')</h3>'
    + '<div style="overflow-x:auto"><table class="stk" id="d-table"><thead><tr><th>Produit</th><th>Couleur</th><th>Taille</th><th>Coupe</th><th>Qté</th><th>Visuel</th><th>Remarque</th><th></th></tr></thead><tbody>'
    + (lignes.length ? lignes : [{}]).map(ligneDupHtml).join('') + '</tbody></table></div>'
    + '<datalist id="d-visuels">'+visuels.map(v => '<option>'+esc(v)+'</option>').join('')+'</datalist>'
    + '<div class="btnrow"><button class="btn" id="d-add">＋ Ligne</button><span class="note" id="d-total"></span></div></div>'
    + '<div class="card"><h3>3. Détails</h3><div class="actions">'
    + '<div class="field"><label>Zone de flocage</label><input id="d-zone" value="'+esc(c.zone_flocage||'')+'"></div>'
    + '<div class="field" style="grid-column:span 2"><label>Remarque</label><input id="d-rem-g" placeholder="ex. refaire 3 t-shirts mal floqués"></div>'
    + '</div><div class="btnrow"><button class="btn primary" id="d-go">⧉ Créer la commande</button><button class="btn" id="d-cancel">Annuler</button></div><div class="msg" id="a-msg"></div></div>';
  const tb = $('d-table').querySelector('tbody');
  const total = () => { const n = [...tb.querySelectorAll('.d-qte')].reduce((t,i) => t + (Number(i.value)||0), 0); $('d-total').textContent = n + ' pièce(s)'; };
  total();
  tb.addEventListener('input', total);
  tb.addEventListener('click', e => { if (e.target.closest('.d-del')) { e.target.closest('tr').remove(); total(); } });
  $('d-add').onclick = () => { const last = tb.querySelector('tr:last-child'); tb.insertAdjacentHTML('beforeend', ligneDupHtml(last ? { type: last.querySelector('.d-type').value, couleur: last.querySelector('.d-couleur').value, coupe: last.querySelector('.d-coupe').value, visuel: last.querySelector('.d-visuel').value } : {})); total(); };
  $('d-cancel').onclick = () => ouvrir(c.cle);
  $('d-go').onclick = async () => {
    const mode = (document.querySelector('input[name="d-mode"]:checked') || {}).value;
    if (!mode) return msg('Choisis d\\'abord : refaire ou nouvelle commande', 'err');
    const lignesOut = [...tb.querySelectorAll('tr')].map(tr => ({ type: tr.querySelector('.d-type').value, couleur: tr.querySelector('.d-couleur').value, taille: tr.querySelector('.d-taille').value, coupe: tr.querySelector('.d-coupe').value, quantite: tr.querySelector('.d-qte').value, visuel: tr.querySelector('.d-visuel').value, remarques: tr.querySelector('.d-rem').value }));
    const modif = JSON.stringify(lignesOut.map(l => [l.type,l.couleur,l.taille,l.coupe,Number(l.quantite)])) !== JSON.stringify(lignes.map(l => [l.type,l.couleur,l.taille,l.coupe,l.quantite]));
    if (!confirm(mode === 'refaire' ? 'Créer la reprise de '+c.n_devis+' (sans nouveau devis) ?' : 'Créer une nouvelle commande pour '+c.client+' avec une copie du devis '+c.n_devis+' dans Odoo ?')) return;
    $('d-go').disabled = true; msg('Création en cours (dossier, visuels, tailles, Excel)… cela peut prendre 30 secondes', 'info');
    try {
      const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/dupliquer', { mode, lignes: lignesOut, lignesModifiees: modif, zone_flocage: $('d-zone').value, remarque: $('d-rem-g').value });
      msg('✅ Commande <b>'+esc(j.numero)+'</b> créée<br>'+j.etapes.map(esc).join('<br>')
        + (j.devis ? '<br><a href="'+esc(j.devis.lien)+'" target="_blank" rel="noopener">↗ Ouvrir le devis '+esc(j.devis.numero)+' dans Odoo</a> (brouillon : ajuste les quantités puis envoie-le)' : '')
        + (j.dossier ? '<br><a href="'+esc(j.dossier)+'" target="_blank" rel="noopener">📁 Ouvrir le dossier SharePoint</a>' : ''), 'ok');
      await charger(false);
    } catch(e){ msg('❌ ' + esc(e.message), 'err'); $('d-go').disabled = false; }
  };
}

// ---------- Actions commande (écrites dans l'Excel) ----------
let EQUIPE = ['Ismaël G.', 'Maureen G.', 'Kelhyan V.', 'Ilona C.'];
const PLANCHE_ETATS = ['A FAIRE', 'A IMPRIMER', 'OK'];
function cmdActionsHtml(c){
  const st = statutKey(c.statut);
  const pers = [...new Set(EQUIPE.concat(data.map(x => x.affectation).filter(Boolean)))];
  return '<div class="card"><h3>Actions</h3>'
    + '<div class="btnrow" style="margin:0 0 12px">'
    + (st !== 'EN PRODUCTION' ? '<button class="btn" data-st="EN PRODUCTION">🏭 En production</button>' : '')
    + (st !== 'EN FLOCAGE' ? '<button class="btn" data-st="EN FLOCAGE">🔥 En flocage</button>' : '')
    + (st !== 'TERMINÉE' ? '<button class="btn" data-st="TERMINÉE">✅ Terminée</button>' : '')
    + (st !== 'A EXPEDIER' ? '<button class="btn" data-st="A EXPEDIER">📦 À expédier</button>' : '')
    + (st !== 'LIVRÉE' ? '<button class="btn pink" data-st="LIVRÉE">🏁 Livrée</button>' : '')
    + '</div><div class="actions">'
    + '<div class="field"><label>Statut</label><select id="c-statut">'+STATUTS.map(x => '<option'+(x===st?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'
    + '<div class="field"><label>Affectation</label><select id="c-aff"><option value="">— Non affectée —</option>'+pers.map(x => '<option'+(x===c.affectation?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div>'
    + '<div class="field"><label>Planche</label><select id="c-planche"><option value="">—</option>'+[...new Set(PLANCHE_ETATS.concat(c.planche ? [c.planche] : []))].map(x => '<option'+(x===c.planche?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div>'
    + '<div class="field"><label>Zone de flocage</label><input id="c-zone" value="'+esc(c.zone_flocage||'')+'"></div>'
    + '<div class="field"><label>N° de suivi La Poste</label><input id="c-suivi" value="'+esc(c.numero_suivi||'')+'" placeholder="ex. 8J0231167048"></div>'
    + '<div class="field" style="grid-column:1/-1"><label>Remarque</label><input id="c-rem" value="'+esc(c.remarque||'')+'" placeholder="ex. client passe jeudi après-midi"></div>'
    + '</div><div class="espbox"><b>💵 Paiement en espèces à la remise</b>'
    + (c.a_payer_especes
        ? '<span class="esp">Noté'+(c.montant_especes!=null?' · '+montantFr(c.montant_especes):'')+(c.especes_note_par?' par '+esc(c.especes_note_par):'')+'</span><button class="btn" id="esp-off">Retirer</button>'
        : '<input type="text" id="esp-montant" placeholder="Montant (facultatif)" inputmode="decimal"><button class="btn" id="esp-on">Le client paiera en espèces</button>')
    + '</div><div class="btnrow"><button class="btn primary" id="c-save">Enregistrer</button><button class="btn" id="cash-btn">💵 Payé en espèces</button><button class="btn pink" id="dup-btn">⧉ Dupliquer la commande…</button><button class="btn" id="c-suppr" style="margin-left:auto;color:#b91c1c">🗑 Supprimer</button></div><div class="msg" id="a-msg"></div></div>';
}
function brancherCmd(c){
  const envoyer = async body => {
    if (body.statut === 'LIVRÉE' && !confirm('Passer la commande '+(c.n_devis||c.client)+' en LIVRÉE ?\\nElle sera retirée de l\\'Excel au nettoyage de minuit (elle reste consultable ici).')) return;
    document.querySelectorAll('#pbody .btn').forEach(b => b.disabled = true);
    msg('Écriture dans l\\'Excel…', 'info');
    try {
      const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/modifier', body);
      if (j.commande) Object.assign(c, j.commande);
      afficher();
      await ouvrir(c.cle);
      msg('✅ Enregistré dans l\\'Excel' + (j.commande && j.commande.dossier_info ? '<br>' + esc(j.commande.dossier_info) : ''), 'ok');
    } catch(e){ msg('❌ ' + esc(e.message), 'err'); document.querySelectorAll('#pbody .btn').forEach(b => b.disabled = false); }
  };
  document.querySelectorAll('#pbody [data-st]').forEach(b => b.onclick = () => envoyer({ statut: b.dataset.st }));
  $('dup-btn').onclick = () => dupliquerUI(c);
  $('c-suppr').onclick = async () => { if (await supprimerCmd(c)) fermer(); };
  const espMaj = async (actif, montant) => {
    try { await setEspecesCmd(c, actif, montant); afficher(); await ouvrir(c.cle); msg(actif ? '✅ Noté : paiement en espèces à la remise' : '✅ Mention espèces retirée', 'ok'); }
    catch(e){ msg('❌ ' + esc(e.message), 'err'); }
  };
  if ($('esp-on')) $('esp-on').onclick = () => espMaj(true, $('esp-montant').value);
  if ($('esp-off')) $('esp-off').onclick = () => espMaj(false);
  $('cash-btn').onclick = async () => {
    if (!(await encaisserEspeces('commande', c.n_devis || c.cle, c.client, c.montant_especes != null ? montantFr(c.montant_especes).replace(' €','') : ''))) return;
    if (c.a_payer_especes) { try { await setEspecesCmd(c, false); afficher(); } catch(e){} }
    const rem = /ESP[EÈ]CE/i.test(c.remarque || '') ? null : [c.remarque, 'PAIEMENT EN ESPECE'].filter(Boolean).join(' - ');
    if (rem) await envoyer({ remarque: rem }); else msg('✅ Espèces enregistrées dans la caisse', 'ok');
  };
  $('c-save').onclick = () => {
    const body = {};
    const v = (id, f, cur) => { const x = $(id).value.trim(); if (x !== (cur || '')) body[f] = x; };
    if ($('c-statut').value !== statutKey(c.statut)) body.statut = $('c-statut').value;
    v('c-aff', 'affectation', c.affectation); v('c-planche', 'planche', c.planche); v('c-zone', 'zone_flocage', c.zone_flocage);
    v('c-suivi', 'numero_suivi', c.numero_suivi); v('c-rem', 'remarque', c.remarque);
    if (!Object.keys(body).length) return msg('Aucune modification', 'info');
    envoyer(body);
  };
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
  $('rows').addEventListener('click', e => {
    const x = e.target.closest('[data-del]');
    if (x) { const c = data.find(z => z.cle === x.closest('tr.row').dataset.k); if (c) { x.disabled = true; supprimerCmd(c).finally(() => { x.disabled = false; }); } return; }
    const a = e.target.closest('a.open'); if (a){ e.preventDefault(); panelCle = a.closest('tr.row').dataset.k; ouvrir(panelCle); } });
  $('rows').addEventListener('change', e => { if (e.target.matches('select.inl')) saveInline(e.target); });
  $('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b){ filtre = b.dataset.f; afficher(); } });
  let th; $('q').addEventListener('input', e => { recherche = e.target.value; if (modeHisto) { clearTimeout(th); th = setTimeout(chargerHisto, 350); } else afficher(); });
  const onglet = h => { modeHisto = h; $('tab-cours').classList.toggle('on', !h); $('tab-histo').classList.toggle('on', h); if (h) chargerHisto(); else afficher(); };
  $('tab-cours').onclick = () => onglet(false); $('tab-histo').onclick = () => onglet(true);
  if (location.hash === '#historique') onglet(true);
} else if (VIEW === 'admin') {
  adEvents();
} else if (VIEW === 'caisse') {
  csEvents();
} else if (VIEW === 'heures') {
  hrEvents();
} else if (VIEW === 'stock') {
  $('q').addEventListener('input', e => { recherche = e.target.value; afficher(); });
  stEvents();
} else if (VIEW === 'planches') {
  $('rows').addEventListener('click', e => {
    const x = e.target.closest('[data-del]');
    if (x) { const p = planches.find(z => z.cle === x.closest('tr.row').dataset.k); if (p) { x.disabled = true; supprimerPl(p).finally(() => { x.disabled = false; }); } return; }
    const a = e.target.closest('a.open'); if (a){ e.preventDefault(); panelCle = a.closest('tr.row').dataset.k; ouvrirPlanche(panelCle); } });
  $('rows').addEventListener('change', e => { if (e.target.matches('select.inl')) saveInline(e.target); });
  $('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b){ filtre = b.dataset.f; afficher(); } });
  $('plkpis').addEventListener('click', e => { const a = e.target.closest('.kpi'); if (a){ e.preventDefault(); filtre = a.dataset.f; afficher(); } });
  $('q').addEventListener('input', e => { recherche = e.target.value; afficher(); });
  chargerAuto();
  $('nouvelle').addEventListener('click', nouvellePlanche);
} else {
  $('prios').addEventListener('click', e => { const p = e.target.closest('.prio'); if (p){ panelCle = p.dataset.k; ouvrir(panelCle); } });
}
$('refresh').addEventListener('click', () => charger(true));
$('overlay').addEventListener('click', fermer); $('pclose').addEventListener('click', fermer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
chargerListes().finally(() => charger(false));
setInterval(() => { if (!document.hidden) charger(false); }, 120000);
</script>
</body>
</html>`;
}

module.exports = { render };
