// ============================================
// IGS GESTION - PAGE COMMANDES (HTML + JS sans dépendance)
// ============================================

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(user, view = 'accueil') {
  const batSeul = view === 'bat';
  if (batSeul) view = 'commandes';
  // Compte perso (collaborateur ou admin) : son prénom ; compte d'équipe contact@ : « l'équipe »
  const prenom = user.collab ? String(user.collab).split(' ')[0]
    : (user.role === 'admin' || String(user.email || '').startsWith('local:')) ? (user.name || '').split(' ')[0] || 'l\'équipe'
    : 'l\'équipe';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>IGS Dashboard · ${({ commandes: 'Commandes', planches: 'Planches DTF', stock: 'Stock', caisse: 'Espèces', heures: 'Heures', admin: 'Admin' })[view] || 'Accueil'}</title>
<link rel="icon" href="/gestion/logo-igs.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
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
.jr-list{display:flex;flex-direction:column;gap:6px}.jr-l{font-size:13px;padding:6px 8px;background:#f9fafb;border-radius:8px}.jr-conv{max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:8px;background:#f3f4f6;border-radius:8px;margin-top:6px}.jr-b{max-width:85%;padding:6px 10px;border-radius:10px;font-size:13px}.jr-b small{display:block;color:#6b7280;font-size:11px;margin-top:2px}.jr-b.cl{background:#fff;align-self:flex-start}.jr-b.igs{background:#dcfce7;align-self:flex-end}.jr-q{font-size:13px;padding:8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px}.jr-r{margin-top:4px;color:#5b21b6}
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
.hrhome{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px}.hrhome span b{margin-left:4px}
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

/* ===== Nouvelle interface : menu latéral, couleurs de l'afficheur (Bebas Neue + Poppins) ===== */
:root{--ink:#1E1E4B;--pink:#FF1E8E;--orange:#FF8A3D;--green:#5BBE72;--blue:#3E63F0;--bg:#F7F0E4;--line:#EADFCC;--muted:#68677D;--soft:#FBF6EC;--radius:18px;--side:248px}
html,body{background:var(--bg);color:#191936;font:14px/1.5 'Poppins',system-ui,-apple-system,'Segoe UI',sans-serif}
.hello h2,.kpi .n,.bar h1,.titre-page,.phead h2{font-family:'Bebas Neue','Poppins',sans-serif;font-weight:400;letter-spacing:.8px}
header{position:fixed;top:0;left:0;bottom:0;width:var(--side);background:#1E1E4B;border:none;z-index:6;overflow-y:auto}
.bar{max-width:none;height:100%;flex-direction:column;align-items:stretch;gap:4px;padding:22px 14px 16px}
.bar .brand{display:flex;align-items:center;gap:10px;padding:2px 8px 20px}
.bar .brand .logo img{display:block;width:100%;height:100%;object-fit:contain}
.bar .brand .logo{overflow:visible;width:52px;height:46px;border-radius:0;background:none;padding:0;box-sizing:border-box;color:#FF1E8E;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex:none}
.bar h1{color:#fff;font-size:22px;line-height:1;white-space:nowrap}
.bar .brand small{display:block;color:#8D8BB8;font-size:12px;font-weight:600}

.bar nav{flex-direction:column;gap:3px;margin:0}
.bar nav a{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;color:#C9C8E3;font-weight:600;font-size:14px}
.bar nav a svg{flex:none;opacity:.9}
.bar nav a:hover{background:rgba(255,255,255,.07);color:#fff}
.bar nav a.on{background:#FF1E8E;color:#fff}
.bar nav a .nn{margin-left:auto;background:rgba(255,255,255,.18);color:#fff;border-radius:999px;padding:0 8px;font-size:12px;font-weight:800}
.bar nav a .nn.o{background:#FF8A3D;color:#1E1E4B}
.bar nav a .nn:empty{display:none}
.bar nav a.off{display:none}
.who{margin:auto 0 0;flex-direction:column;align-items:stretch;gap:6px;background:rgba(255,255,255,.06);border-radius:14px;padding:12px;color:#8D8BB8}
.who .me{display:flex;align-items:center;gap:10px}
.who .nm{display:flex;flex-direction:column;line-height:1.25}.who .nm small{color:#8D8BB8;font-size:12px}
a.btn{text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.who b{color:#fff}
.who .av{width:32px;height:32px;border-radius:50%;background:#3A3A78;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex:none}
.who a{color:#C9C8E3;text-decoration:none;font-size:12px;padding:2px 0}
.who a:hover{color:#fff}
main{max-width:1680px;margin:0 0 0 var(--side);padding:26px 34px 48px}
.hello h2{font-size:40px;line-height:1.05}
.btn{border-radius:12px;padding:9px 14px;font-weight:700;border-color:#E3E1EE;min-height:40px}
.btn.primary{background:#1E1E4B;border-color:#1E1E4B}
.search{border-radius:12px;padding:10px 14px;border-color:#E3E1EE;min-height:42px}
.chip{padding:7px 13px;font-size:13px;border-color:#E3E1EE;color:#3B3A5C}
.chip.on{background:#1E1E4B;border-color:#1E1E4B}
.card,.tablewrap,.kpi,.mod{border-radius:var(--radius);border-color:var(--line)}
.card{padding:18px 20px}
.card h3{font-size:12px;font-weight:800;letter-spacing:.7px;color:#8D8BA8}
th{background:#fff;color:#8D8BA8;font-weight:800;letter-spacing:.6px;padding:14px 8px 10px}
td{border-bottom-color:#F3ECDF;padding:11px 8px}
td.c-x,.tablewrap th:last-child{position:sticky;right:0;background:#fff;z-index:1;width:34px;min-width:34px;padding-right:10px;text-align:center}
tr.row:hover td.c-x{background:#FFFBF4}
tr.row:hover td{background:#FFFBF4}
.kpi{padding:18px 20px}
.kpi::before{display:none}
.kpi .l{display:flex;align-items:center;gap:8px;font-weight:700;color:#5B5A7E}
.kpi .l::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--accent,var(--ink));flex:none}
.kpi .n{font-size:44px;line-height:1}
.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;font-size:12px}
.badge::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.esp{border-radius:999px;font-size:11.5px}
.panel{width:min(820px,100%)}
.phead{padding:18px 22px}
.phead h2{font-size:28px}
.pbody{padding:18px 22px 48px;gap:14px}
.steps{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.steps .st{display:flex;flex-direction:column;gap:6px;min-width:0}
.steps .st i{display:block;height:6px;border-radius:99px;background:#E6E4EF}
.steps .st.d i{background:#FF1E8E}.steps .st.c i{background:#1E1E4B}
.steps .st span{font-size:11.5px;font-weight:800;color:#A7A5BF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.steps .st.d span,.steps .st.c span{color:#1E1E4B}
@media (min-width:761px) and (max-width:1240px){ .cols{grid-template-columns:1fr} .kpis{grid-template-columns:repeat(2,1fr)} main{padding:22px 22px 40px} }
@media (min-width:761px) and (max-width:1000px){ :root{--side:200px} .bar nav a{font-size:13px;padding:9px 10px} }
@media (max-width:760px){
  header{position:static;width:auto;bottom:auto;overflow:visible}
  .bar{flex-direction:row;height:auto;padding:12px 16px;align-items:center}
  .bar .brand{padding:0}
  .bar nav{position:fixed;left:0;right:0;bottom:0;flex-direction:row;justify-content:space-around;background:#fff;border-top:1px solid var(--line);padding:6px 4px calc(8px + env(safe-area-inset-bottom));z-index:9;overflow-x:auto;width:auto;order:0}
  .bar nav a{flex:1 1 0;min-width:0;flex-direction:column;gap:2px;padding:6px 2px;font-size:10px;color:#8D8BA8;border-radius:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
  .bar nav{justify-content:stretch;overflow-x:hidden}
  .bar nav a .lb{font-size:0;line-height:1}.bar nav a .lb::after{content:attr(data-m);font-size:10px}
  .cols{grid-template-columns:1fr!important}
  .bar nav a.on{background:none;color:#FF1E8E}
  .bar nav a .nn{display:none}
  .who{margin:0 0 0 auto;flex-direction:row;background:none;padding:0}
  .who .me{display:none}
  main{margin:0;padding:16px 14px 90px}
  .steps .st span{font-size:10px}
  td.c-x{position:static;width:auto;min-width:0;background:none}
  .titre-page{font-size:32px}
}

a.brand{text-decoration:none;color:inherit}
a.brand:hover h1{color:#FF1E8E}
.bar .brand small{color:#FF8A3D;letter-spacing:1.2px;font-size:11px;font-weight:700}
.filtre{display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--muted);font-size:13px}
.filtre select{appearance:none;-webkit-appearance:none;border:1px solid #E3D8C4;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%231E1E4B' stroke-width='2'/%3E%3C/svg%3E") no-repeat right 12px center;border-radius:12px;padding:9px 34px 9px 12px;font:600 14px 'Poppins',sans-serif;color:#1E1E4B;min-height:40px;cursor:pointer}
.filtre select:focus{outline:2px solid #FF1E8E;outline-offset:1px}
.titre-page{font-size:40px;margin:0 0 14px;color:#1E1E4B;line-height:1}
.lei-statut{display:flex;align-items:flex-start;gap:12px;flex-wrap:nowrap;font-weight:700;margin-bottom:12px}
.lei-j input{margin:0}
.lei-pt{margin-top:5px;width:12px;height:12px;border-radius:50%;background:#C9C3B5;flex:none}
.lei-pt.on{background:#5BBE72;box-shadow:0 0 0 4px rgba(91,190,114,.2)}
.lei-pt.off{background:#FF1E8E;box-shadow:0 0 0 4px rgba(255,30,142,.15)}
.lei-pt.auto{background:#3E63F0;box-shadow:0 0 0 4px rgba(62,99,240,.15)}
.lei-jours{display:flex;gap:6px;flex-wrap:wrap}
.field .lei-j,.lei-j{flex-direction:row;text-transform:none;letter-spacing:0;margin:0;color:#1E1E4B;display:inline-flex;align-items:center;gap:5px;border:1px solid #E3D8C4;border-radius:10px;padding:6px 10px;font-weight:600;font-size:13px;cursor:pointer;background:#fff}
.lei-j:has(input:checked){border-color:#FF1E8E;background:#FFF0F7;color:#1E1E4B}
.lei-ta{width:100%;box-sizing:border-box;min-height:90px;border:1px solid #E3D8C4;border-radius:12px;padding:10px 12px;font:13px/1.45 'Poppins',sans-serif;resize:vertical;background:#fff}
#lei-out{white-space:pre-wrap;font:12.5px/1.45 ui-monospace,Menlo,monospace;background:#FBF6EC;border-radius:12px;padding:12px;max-height:420px;overflow:auto;margin:0}
.btn.pink:hover{background:#E6127C}
</style>
</head>
<body>
<header><div class="bar">
  <a class="brand" href="/gestion" title="Retour à l’accueil"><div class="logo"><img src="/gestion/logo-igs.png" alt="IGS" onerror="this.replaceWith(document.createTextNode('IGS'))"></div><div><h1>IGS DASHBOARD</h1><small>IGS CUSTOM BAR</small></div></a>
  <nav>
    <a class="${view === 'accueil' ? 'on' : ''}" href="/gestion"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg><span class="lb" data-m="Accueil">Aujourd'hui</span></a>
    <a class="${view === 'commandes' && !batSeul ? 'on' : ''}" href="/gestion/commandes"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7l-8-4-8 4 8 4 8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg><span class="lb" data-m="Cmdes">Commandes</span><span class="nn" id="nav-n-cmd"></span></a>
    <a class="${batSeul ? 'on' : ''}" href="/gestion/bat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg><span class="lb" data-m="BAT">BAT</span><span class="nn o" id="nav-n-bat"></span></a>
    <a class="${view === 'planches' ? 'on' : ''}" href="/gestion/planches"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg><span class="lb" data-m="Planches">Planches DTF</span></a>
    <a class="${view === 'stock' ? 'on' : ''}" href="/gestion/stock"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13"/><path d="M8 21v-7h8v7"/></svg><span class="lb" data-m="Stock">Stock</span></a>
    <a class="${view === 'caisse' ? 'on' : ''}" href="/gestion/caisse"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg><span class="lb" data-m="Espèces">Espèces</span></a>
    <a class="${view === 'heures' ? 'on' : ''}" href="/gestion/heures"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span class="lb" data-m="Heures">Heures</span></a>
    <a class="${view === 'leila' ? 'on' : ''}" href="/gestion/leila"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg><span class="lb" data-m="Leïla">Leïla</span><span class="nn" id="nav-leila"></span></a>
    ${user.role === 'admin' ? `<a class="${view === 'admin' ? 'on' : ''}" href="/gestion/admin"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg><span class="lb" data-m="Admin">Admin</span></a>` : ''}
    <a class="off" title="Bientôt">Journal</a>
  </nav>
  <div class="who"><span class="me"><span class="av">${esc((prenom === 'l\'équipe' ? 'IGS' : prenom).slice(0, 2).toUpperCase())}</span><span class="nm"><b>${esc(prenom === 'l\'équipe' ? 'Équipe IGS' : prenom)}</b><small>${user.role === 'admin' ? 'Admin' : 'Équipe'}</small></span></span>${String(user.email || '').startsWith('local:') ? '<a href="/gestion/auth/mot-de-passe">Mot de passe</a>' : ''}<a href="/gestion/auth/logout">Déconnexion</a></div>
</div></header>

<main>
${view === 'accueil' ? `
  <section id="v-accueil">
    <div class="hello">
      <div><h2><span id="salut">Bonjour</span> ${esc(prenom)} 👋</h2><div class="sub" id="today"></div></div>
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
          <a class="mod" href="/gestion/commandes#bat"><div class="i">🖨</div><div class="t">BAT</div><div class="d">À faire, à envoyer, générateur à l'échelle</div></a>
          ${user.role === 'admin' ? '<a class="mod" href="/gestion/admin"><div class="i">⚙️</div><div class="t">Admin</div><div class="d">Collaborateurs, produits, couleurs</div></a>' : ''}
          <a class="mod" href="/gestion/caisse"><div class="i">💵</div><div class="t">Espèces</div><div class="d">Caisse, relevés, totaux mensuels</div></a>
          <a class="mod" href="/gestion/heures"><div class="i">⏱</div><div class="t">Heures</div><div class="d">${user.role === 'admin' ? 'Saisie, totaux par semaine, paiements' : 'Saisir mes heures du jour'}</div></a>
          <div class="mod soon"><div class="i">💬</div><div class="t">Journal</div><div class="d">Messages envoyés aux clients</div></div>
          ${user.role === 'admin' ? '<a class="mod" href="/gestion/leila"><div class="i">🤖</div><div class="t">Leïla</div><div class="d">Planning, catalogue, contexte</div></a>' : '<div class="mod soon"><div class="i">🤖</div><div class="t">Actions Leïla</div><div class="d">Écrire aux clients</div></div>'}
        </div></div>
      </div>
      <div class="stack">
        <div class="card"><h3>Planches DTF</h3><div id="plhome"><div class="skel"></div></div></div>
        <div class="card"><h3>Commandes par statut</h3><div class="flow" id="flow"></div></div>
        <div class="card"><h3>Charge par personne</h3><div class="flow" id="charge"></div></div>
        ${user.role === 'admin' || user.collab ? `<a class="card" href="/gestion/heures" style="text-decoration:none;color:inherit;display:block"><h3>⏱ ${user.role === 'admin' ? 'Heures de la semaine' : 'Mes heures de la semaine'}</h3><div id="hrhome" class="hrhome"><div class="skel"></div></div></a>` : ''}
      </div>
    </div>
  </section>` : view === 'admin' ? `
  <section id="v-admin">
    <div class="tools"><h2 style="margin:0;font-size:20px">Administration</h2><div style="flex:1"></div><button class="btn" id="ad-test-mail">✉️ Tester l'envoi de mail du formulaire</button><span id="sync" class="sync"></span><button id="refresh" class="btn primary">↻ Actualiser</button></div>
    <div class="card" style="margin-bottom:12px" id="ad-source"><h3>🗄️ Données</h3><div class="skel"></div></div>
    <div class="card" style="margin-bottom:12px" id="ad-tel"><h3>📞 Numéros clients dans Odoo</h3><div class="skel"></div></div>
    <div class="card" style="margin-bottom:12px" id="ad-taches"><h3>⚙️ Tâches automatiques</h3><div class="skel"></div></div>
    <div class="card" style="margin-bottom:12px" id="ad-notif"><h3>📣 Messages automatiques aux clients</h3><div class="skel"></div></div>
    <div class="card" style="margin-bottom:12px"><h3 style="display:flex;justify-content:space-between;align-items:center">Collaborateurs <span style="display:flex;gap:6px"><button class="btn" id="ad-col-inviter">✉️ Envoyer les invitations</button><button class="btn" id="ad-col-add">＋ Collaborateur</button></span></h3>
      <div class="note" style="margin-bottom:8px">Le <b>nom affiché</b> est celui de la colonne Affectation des commandes. Un collaborateur inactif n'apparaît plus dans les listes mais reste dans l'historique.</div>
      <div style="overflow-x:auto"><table class="stk" id="ad-col"><thead><tr><th>Nom affiché</th><th>Nom complet</th><th>Taux horaire (€)</th><th>Ordre</th><th>Actif</th><th>Connexion à distance</th><th></th></tr></thead><tbody></tbody></table></div>
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
  </section>` : view === 'leila' ? `
  <section id="v-leila">
    <div class="hello"><div><h2>Leïla</h2><div class="sub">L’assistante WhatsApp d’IGS : planning, activation, contexte et outils.</div></div>
      <div class="tools" style="margin:0"><span id="sync" class="sync"></span><button id="refresh" class="btn primary">↻ Actualiser</button></div></div>
    <div class="cols" style="grid-template-columns:minmax(280px,1fr) 1.4fr">
      <div class="stack">
        <div class="card"><h3>Statut</h3>
          <div id="lei-statut" class="lei-statut">…</div>
          <div class="btnrow"><button class="btn pink" data-lei="activer">▶ Activer</button><button class="btn" data-lei="desactiver">⏸ Désactiver</button><button class="btn" data-lei="auto">🔄 Planning automatique</button></div>
          <div class="note" style="margin-top:8px">Automatique : Leïla répond selon son planning. Activer / Désactiver force son état jusqu’au retour en automatique. Les messages reçus quand elle est éteinte sont toujours enregistrés : elle a tout le contexte à son retour.</div>
        </div>
        ${user.role === 'admin' ? `<div class="card"><h3>Fermeture</h3>
          <div class="field"><label>Fermée jusqu’au (inclus)</label><input type="date" id="lei-date"></div>
          <div class="btnrow"><button class="btn" data-lei="fermer">🔒 Fermer</button><button class="btn" data-lei="lever-fermeture">Lever la fermeture</button></div></div>
        <div class="card"><h3>Planning</h3>
          <div class="field"><label>Jours où Leïla répond</label><div class="lei-jours" id="lei-jours"></div></div>
          <div class="hrrow" style="display:flex;gap:10px;flex-wrap:wrap"><div class="field"><label>Ouverture</label><input type="time" id="lei-ouv"></div><div class="field"><label>Fermeture</label><input type="time" id="lei-ferm"></div></div>
          <div class="field"><label>Arrêt l’après-midi (l’équipe prend le relais) : ces jours-là</label><div class="lei-jours" id="lei-cjours"></div></div>
          <div class="field"><label>… à partir de (heure, vide = pas d’arrêt)</label><input type="number" id="lei-ch" min="0" max="23" style="max-width:120px"></div>
          <div class="btnrow"><button class="btn primary" data-lei="planning">Enregistrer le planning</button></div></div>
        <div class="card"><h3>Tests</h3><div class="btnrow" style="margin-top:0"><button class="btn" data-lei="test-recap">Récap de test</button><button class="btn" data-lei="backlog">Messages en attente</button><button class="btn" data-lei="test-horaires-on">Simuler heures d’ouverture</button><button class="btn" data-lei="test-horaires-off">Fin de simulation</button></div></div>` : ''}
        <div class="card"><h3>Réponse</h3><div id="lei-out" class="note pre" style="min-height:40px">—</div></div>
      </div>
      ${user.role === 'admin' ? `<div class="stack">
        <div class="card"><h3>Catalogue et tarifs</h3><div class="note" style="margin-bottom:6px">Ce que Leïla sait des produits, prix, planches et livraison. Modifie le texte puis enregistre : c’est pris en compte dès le message suivant.</div>
          <textarea id="lei-cat" class="lei-ta" style="min-height:320px" placeholder="Chargement…"></textarea>
          <div class="btnrow"><button class="btn primary" data-lei="catalogue">Enregistrer le catalogue</button><button class="btn" data-lei="catalogue-defaut">Remettre le texte d’origine</button></div></div>
        <div class="card"><h3>Contexte du moment</h3><div class="note" style="margin-bottom:6px">Ex. rupture de stock sur les polos noirs cette semaine. Leïla en tient compte dans ses réponses.</div>
          <textarea id="lei-ctx" class="lei-ta" placeholder="Contexte général…"></textarea>
          <div class="btnrow"><button class="btn primary" data-lei="contexte">Remplacer</button><button class="btn" data-lei="contexte-ajouter">Ajouter</button><button class="btn" data-lei="contexte-voir">Voir l’actuel</button></div></div>
        <div class="card"><h3>Note sur un client</h3>
          <div class="field"><label>Numéro WhatsApp</label><input id="lei-note-num" placeholder="590690XXXXXX"></div>
          <textarea id="lei-note" class="lei-ta" placeholder="Ex. cliente régulière, tutoiement ok…"></textarea>
          <div class="btnrow"><button class="btn primary" data-lei="note-client">Enregistrer</button><button class="btn" data-lei="note-client-voir">Voir la note</button></div></div>
        <div class="card"><h3>Message programmé</h3>
          <div class="field"><label>Numéro WhatsApp</label><input id="lei-prog-num" placeholder="590690XXXXXX"></div>
          <textarea id="lei-prog" class="lei-ta" placeholder="Message exact à envoyer une seule fois"></textarea>
          <div class="btnrow"><button class="btn primary" data-lei="message-programme">Programmer</button><button class="btn" data-lei="messages-programmes">Voir les messages programmés</button><button class="btn" data-lei="message-programme-annuler">Annuler pour ce numéro</button></div></div>
        <div class="card"><h3>Tester une réponse (rien n’est envoyé)</h3>
          <div class="field"><label>Numéro WhatsApp</label><input id="lei-sim-num" placeholder="590690XXXXXX"></div>
          <textarea id="lei-sim" class="lei-ta" placeholder="Message fictif du client"></textarea>
          <div class="btnrow"><button class="btn primary" data-lei="simuler">Simuler</button></div></div>
        <div class="card"><h3>Importer un historique WhatsApp</h3>
          <div class="field"><label>Numéro WhatsApp</label><input id="lei-imp-num" placeholder="590690XXXXXX"></div>
          <div class="field"><label>Ton nom dans l’export</label><input id="lei-imp-nom" value="Igs Custom bar"></div>
          <input type="file" id="lei-imp-fichier" accept=".txt" style="margin:8px 0">
          <textarea id="lei-imp" class="lei-ta" placeholder="…ou colle ici le contenu du fichier .txt exporté depuis WhatsApp"></textarea>
          <div class="btnrow"><button class="btn primary" data-lei="importer-historique">Importer</button></div></div>
      </div>` : '<div class="card"><h3>Accès</h3><div class="note">Tu peux activer ou désactiver Leïla. Le reste des réglages est réservé à l’administrateur.</div></div>'}
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
    <div class="chips" style="margin:0"><button class="chip on" id="tab-cours">📦 En cours</button><button class="chip" id="tab-histo">🗂 Historique</button><button class="chip" id="tab-bat">🖨 BAT <span class="n" id="bat-n"></span></button></div>
    <input id="q" class="search" type="search" placeholder="Rechercher un client, un devis, une zone…">
    <button id="nv-cmd" class="btn pink">＋ Nouvelle commande</button>
    <a class="btn" href="https://igscustom.fr/formulaire/" target="_blank" rel="noopener" title="Ouvrir le formulaire client vide">📝 Formulaire vierge</a>
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
  <div id="batbox" style="display:none"></div>
  </section>`}
</main>

<div id="overlay" class="overlay"></div>
<aside id="panel" class="panel" aria-hidden="true">
  <div class="phead"><div><h2 id="ptitle"></h2><div id="psub" class="sub"></div></div><button class="x" id="pclose" aria-label="Fermer">×</button></div>
  <div class="pbody" id="pbody"></div>
</aside>

<script>
const STATUTS = ['EN DEVIS','PAYÉE','VALIDÉE','EN COMMANDE','EN PRODUCTION','EN FLOCAGE','TERMINÉE','A EXPEDIER','EXPÉDIÉE','LIVRÉE'];
const ORDRE_TRI = ['A EXPEDIER','EN FLOCAGE','EN PRODUCTION','EN COMMANDE','VALIDÉE','PAYÉE','TERMINÉE','EXPÉDIÉE','EN DEVIS','LIVRÉE'];
const COULEURS = {
  'EN DEVIS':['#f3f4f6','#4b5563'], 'PAYÉE':['#dbeafe','#1d4ed8'], 'VALIDÉE':['#e0e7ff','#4338ca'],
  'EN COMMANDE':['#fef3c7','#92400e'], 'EN PRODUCTION':['#ffedd5','#c2410c'], 'EN FLOCAGE':['#fce7f3','#be185d'],
  'TERMINÉE':['#dcfce7','#15803d'], 'A EXPEDIER':['#ccfbf1','#0f766e'], 'EXPÉDIÉE':['#e0f2fe','#0369a1'], 'LIVRÉE':['#d1fae5','#065f46'],
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
const BAT_SEUL = ${batSeul ? 'true' : 'false'};
// Bonjour / Bonsoir selon l'heure (à partir de 18 h : bonsoir)
(() => { const el = document.getElementById('salut'); if (el) { const h = new Date().getHours(); el.textContent = (h >= 18 || h < 5) ? 'Bonsoir' : 'Bonjour'; } })();
const MOI = ${JSON.stringify(user.collab || null).replace(/</g, '\\u003c')};
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
// BAT : PAYÉE, ou EN DEVIS / sans statut / statut inconnu dès que le formulaire est reçu (commandes sans contenu, saisies à la main)
const AVANT_BAT = c => {
  const k = statutKey(c.statut);
  if (['EN PRODUCTION','EN FLOCAGE','TERMINÉE','A EXPEDIER','EXPÉDIÉE','LIVRÉE'].includes(k)) return false;
  const e = batEtape(c);
  if (e === 'valide') return false;
  // VALIDÉE sans fichier BAT dans le dossier : le BAT reste à faire
  if (k === 'VALIDÉE') return e === 'faire' || e === 'modif' || (e === 'envoyer' && !!c.bat_auto_le);
  // EN COMMANDE (t-shirts commandés en avance) : la mention reste tant que le BAT n'est pas fait / envoyé / validé
  if (k === 'EN COMMANDE') return e === 'faire' || e === 'client' || e === 'modif' || (e === 'envoyer' && !!c.bat_auto_le);
  if (k === 'PAYÉE') return true;
  return !!(c.bat_envoye_le || (c.bat_info && c.bat_info.formulaire));
};
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
// Met à jour la commande affichée ET sa version dans la liste (rechargée entre-temps par l'actualisation auto)
function majLocale(c, obj){ if (!obj) return c; Object.assign(c, obj); const d = Array.isArray(data) ? data.find(x => x.cle === c.cle) : null; if (d && d !== c) Object.assign(d, obj); return c; }
let chargeNo = 0;
async function charger(force, auto){
  // Actualisation automatique : jamais pendant une saisie (liste déroulante ouverte, champ en cours)
  if (auto) { const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.id !== 'q') return; }
  const no = ++chargeNo;
  $('refresh').disabled = true; $('refresh').textContent = '↻ …';
  try{
    if (VIEW === 'admin') { await adCharger(); return; }
    if (VIEW === 'leila') { await leiStatut(); await leiReglages(); return; }
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
      stockData = j; $('sync').className = 'sync'; $('sync').textContent = 'Actualisé à ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      return afficher();
    }
    const [jc, jp] = await Promise.all([
      api('/gestion/api/commandes', force),
      VIEW !== 'commandes' ? api('/gestion/api/planches', force) : null,
    ]);
    if (no !== chargeNo) return; // une actualisation plus récente est passée entre-temps
    if (jc) data = jc.commandes || [];
    if (jp) planches = jp.planches || [];
    const erreur = (jc && jc.erreur) || (jp && jp.erreur);
    const at = (jc || jp).syncedAt;
    const s = $('sync');
    if (erreur){ s.className='sync err'; s.textContent = '⚠️ Actualisation en échec : ' + erreur; }
    else { s.className='sync'; s.textContent = at ? 'Actualisé à ' + new Date(at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : ''; }
    try { afficher(); } catch(err){ console.error('Affichage :', err); s.className='sync err'; s.textContent = '⚠️ Erreur d’affichage : ' + err.message; }
  } catch(e){ $('sync').className='sync err'; $('sync').textContent='⚠️ Serveur injoignable'; }
  finally{ $('refresh').disabled=false; $('refresh').textContent='↻ Actualiser'; }
}

// Accueil : petit récap des heures de la semaine (admin : par personne ; compte individuel : les siennes)
let hrHomeAt = 0;
async function hrHome(){
  const box = $('hrhome'); if (!box || Date.now() - hrHomeAt < 60000) return;
  hrHomeAt = Date.now();
  try {
    if (MOI) {
      const d = await (await fetch('/gestion/api/heures/mes?collaborateur='+encodeURIComponent(MOI))).json(); if (d.error) throw new Error(d.error);
      box.innerHTML = '<span>Semaine '+d.numero+'<b>'+d.total+'</b></span><span class="sub">'+d.lignes.length+' jour(s) saisi(s)</span>';
    } else {
      const d = await (await fetch('/gestion/api/heures/semaine')).json(); if (d.error) throw new Error(d.error);
      const l = d.collaborateurs.filter(c => c.minutes > 0);
      box.innerHTML = l.length ? l.map(c => '<span>'+esc(c.collaborateur)+'<b>'+c.duree+'</b></span>').join('') + '<span class="sub">Total <b>'+fhm(d.total.minutes)+'</b></span>' : '<span class="sub">Aucune heure saisie cette semaine</span>';
    }
  } catch(e){ box.innerHTML = '<span class="sub">Heures indisponibles</span>'; }
}
// ---------- Leïla ----------
async function leiAppel(action, corps){
  const r = await fetch('/gestion/api/leila/'+action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
  return j.texte || '';
}
async function leiStatut(){
  try {
    const t = await leiAppel('statut');
    const lignes = t.split('\\n'), tete = lignes[0] || '';
    const actif = /FORCÉ ACTIF/.test(tete), inactif = /FORCÉ INACTIF|FERMETURE/.test(tete);
    $('lei-statut').innerHTML = '<span class="lei-pt '+(actif ? 'on' : inactif ? 'off' : 'auto')+'"></span><div><b>'+(actif ? 'Activée' : inactif ? (/FERMETURE/.test(tete) ? esc(tete.replace(/^🔒 /, '')) : 'Désactivée') : 'Planning automatique')+'</b>'+lignes.slice(1).map(l => '<div class="note">'+esc(l)+'</div>').join('')+'</div>';
    $('sync').className = 'sync'; $('sync').textContent = 'Actualisé à ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  } catch(e){ $('lei-statut').textContent = '⚠️ ' + e.message; }
}
const LEI_JOURS = [['Mon','Lun'],['Tue','Mar'],['Wed','Mer'],['Thu','Jeu'],['Fri','Ven'],['Sat','Sam'],['Sun','Dim']];
let leiReglagesCharges = false;
async function leiReglages(){
  if (!$('lei-jours') || leiReglagesCharges) return;
  try {
    const pl = JSON.parse(await leiAppel('planning-voir'));
    const cases = (id, sel) => { $(id).innerHTML = LEI_JOURS.map(([k, l]) => '<label class="lei-j"><input type="checkbox" value="'+k+'"'+((sel || []).includes(k) ? ' checked' : '')+'> '+l+'</label>').join(''); };
    cases('lei-jours', pl.jours); cases('lei-cjours', pl.coupureJours);
    $('lei-ouv').value = pl.ouverture || '08:30'; $('lei-ferm').value = pl.fermeture || '17:30';
    $('lei-ch').value = pl.coupureHeure == null ? '' : pl.coupureHeure;
    const cat = JSON.parse(await leiAppel('catalogue-voir'));
    $('lei-cat').value = cat.texte || '';
    leiReglagesCharges = true;
  } catch(e){ $('lei-out').textContent = '⚠️ Réglages : ' + e.message; }
}
function leiEvents(){
  const v = id => ($(id) ? $(id).value.trim() : '');
  const corpsDe = a => ({
    fermer: { date: v('lei-date') }, contexte: { texte: v('lei-ctx') }, 'contexte-ajouter': { texte: v('lei-ctx') },
    'note-client': { numero: v('lei-note-num'), texte: v('lei-note') }, 'note-client-voir': { numero: v('lei-note-num') },
    'message-programme': { numero: v('lei-prog-num'), texte: v('lei-prog') }, 'message-programme-annuler': { numero: v('lei-prog-num') },
    simuler: { numero: v('lei-sim-num'), message: v('lei-sim') },
    planning: { jours: [...document.querySelectorAll('#lei-jours input:checked')].map(i => i.value), coupureJours: [...document.querySelectorAll('#lei-cjours input:checked')].map(i => i.value), ouverture: v('lei-ouv'), fermeture: v('lei-ferm'), coupureHeure: v('lei-ch') },
    catalogue: { texte: $('lei-cat') ? $('lei-cat').value : '' }, 'catalogue-defaut': { defaut: true },
    'importer-historique': { numero: v('lei-imp-num'), nomEquipe: v('lei-imp-nom'), texte: v('lei-imp') },
  })[a] || {};
  if ($('lei-imp-fichier')) $('lei-imp-fichier').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { $('lei-imp').value = rd.result; }; rd.readAsText(f); };
  document.getElementById('v-leila').addEventListener('click', async e => {
    const b = e.target.closest('[data-lei]'); if (!b) return;
    const a = b.dataset.lei;
    if (a === 'contexte' && !confirm('Remplacer tout le contexte actuel ?')) return;
    if (a === 'catalogue-defaut' && !confirm('Remettre le catalogue d’origine ? Tes modifications seront perdues.')) return;
    b.disabled = true;
    try {
      const t = await leiAppel(a === 'catalogue-defaut' ? 'catalogue' : a, corpsDe(a));
      $('lei-out').textContent = t || '✅ Fait';
      if (a === 'catalogue-defaut') { leiReglagesCharges = false; await leiReglages(); }
      if (['activer','desactiver','auto','fermer','lever-fermeture','planning','test-horaires-on','test-horaires-off'].includes(a)) await leiStatut();
    }
    catch(err){ $('lei-out').textContent = '❌ ' + err.message; }
    finally { b.disabled = false; }
  });
}
function navCompteurs(){
  try {
    if (!Array.isArray(data) || !data.length) return;
    const enCours = data.filter(c => statutKey(c.statut) !== 'LIVRÉE').length;
    // BAT : à faire, à envoyer (dont BAT auto à vérifier), modification demandée, en attente de validation du client
    const bat = data.filter(c => AVANT_BAT(c) && ['modif','faire','envoyer','client'].includes(batEtape(c))).length;
    if ($('nav-n-cmd')) $('nav-n-cmd').textContent = enCours || '';
    if ($('nav-n-bat')) $('nav-n-bat').textContent = bat || '';
  } catch(e){}
}
function afficher(){ navCompteurs(); if (VIEW === 'commandes' && modeBat) return batRender(); if (VIEW === 'commandes' && modeHisto) return; if (VIEW === 'accueil') { accueil(); plHome(); hrHome(); } else if (VIEW === 'planches') plListe(); else if (VIEW === 'stock') stRender(); else if (VIEW === 'caisse') csRender(); else liste(); }

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
  $('chips').innerHTML = '<label class="filtre">Afficher <select id="f-sel">'+chips.map(([k,l,n]) => '<option value="'+esc(k)+'"'+(filtre===k?' selected':'')+'>'+esc(l.charAt(0)+l.slice(1).toLowerCase())+' ('+n+')</option>').join('')+'</select></label>';

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
  if (kind === 'cmd' && f === 'statut' && v === 'LIVRÉE' && !confirm('Passer en LIVRÉE ? Elle passera dans l\\'historique cette nuit.')) { sel.value = old; return; }
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
        (statutKey(c.statut) === 'A EXPEDIER' ? '<button class="btn" data-liv="cmd-exp" data-k="'+esc(c.cle)+'">🚚 Expédiée</button>' : '')
        + '<button class="btn pink" data-liv="cmd" data-k="'+esc(c.cle)+'">🏁 Livré</button>')).join('') : '<div class="note">Aucune commande prête.</div>')
    + '</div><div class="card"><h3>Planches DTF · '+pls.length+'</h3>'
    + (pls.length ? pls.map(p => ligne('pl', p.cle, p.client, esc([p.n_devis, metrage(p), p.paiement].filter(Boolean).join(' · ')), plBadge(p.statut),
        (plKey(p.statut) === 'A EXPEDIER' ? '<button class="btn" data-liv="pl-exp" data-k="'+esc(p.cle)+'">📦 Expédiée</button>' : '')
        + '<button class="btn pink" data-liv="pl" data-k="'+esc(p.cle)+'">🏁 Livré</button>')).join('') : '<div class="note">Aucune planche prête.</div>')
    + '</div><div class="msg" id="a-msg"></div>';
  $('overlay').classList.add('on'); $('panel').classList.add('on'); $('panel').setAttribute('aria-hidden','false');
  $('pbody').onclick = async e => {
    const b = e.target.closest('[data-liv]'); if (!b) return;
    const kind = b.dataset.liv, cle = b.dataset.k;
    const statut = kind === 'pl-exp' || kind === 'cmd-exp' ? 'EXPÉDIÉE' : 'LIVRÉE';
    const cmd = kind === 'cmd' ? data.find(x => x.cle === cle) : null;
    if (cmd && cmd.a_payer_especes) {
      if (!confirm('💵 '+cmd.client+' doit payer en espèces'+(cmd.montant_especes!=null?' ('+montantFr(cmd.montant_especes)+')':'')+'.\\nAs-tu bien encaissé ? (OK = saisir le montant reçu)')) return;
      if (!(await encaisserEspeces('commande', cmd.n_devis || cmd.cle, cmd.client, cmd.montant_especes != null ? montantFr(cmd.montant_especes).replace(' €','') : ''))) return;
      try { await setEspecesCmd(cmd, false); } catch(e){}
    }
    const corps = { statut };
    if (kind === 'cmd-exp') { const su = prompt('N° de suivi La Poste (facultatif, le client reçoit le lien de suivi) :', ''); if (su === null) return; if (su.trim()) corps.numero_suivi = su.trim(); }
    b.disabled = true;
    try {
      await post('/gestion/api/'+(kind === 'cmd' || kind === 'cmd-exp' ? 'commandes' : 'planches')+'/'+encodeURIComponent(cle)+'/modifier', corps);
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
  if (MOI) { sel.innerHTML = '<option>'+esc(MOI)+'</option>'; sel.value = MOI; sel.disabled = true; return; }
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
  // Une seule confirmation : ligne + dossier SharePoint + devis Odoo
  const quoi = ['la ligne de commande'];
  if (c.n_devis) quoi.push('le dossier SharePoint « '+c.n_devis+' - … » (corbeille, récupérable 93 jours)', 'le devis '+c.n_devis+' dans Odoo (sauf s\\'il est déjà facturé)');
  if (!confirm('Supprimer la commande '+(c.n_devis||'')+' · '+c.client+' ?\\n\\nSera supprimé :\\n• '+quoi.join('\\n• '))) return false;
  try {
    const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/supprimer', { dossier: !!c.n_devis, devis: true });
    if (j.avertissement) alert(j.avertissement);
    await charger(false); return true;
  } catch(e){ alert('Non supprimée : ' + e.message); return false; }
}
async function supprimerPl(p){
  let fichiers = [];
  try { const r = await fetch('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/fichiers'); const j = await r.json(); fichiers = j.fichiers || []; } catch(e){}
  const autres = planches.filter(x => x.cle !== p.cle && norm(x.client) === norm(p.client)).length;
  const quoi = ['la ligne de la planche'];
  if (fichiers.length) quoi.push(fichiers.length+' fichier(s) : '+fichiers.map(f => f.nom).join(', ')+' (corbeille, récupérables 93 jours)');
  if (p.n_devis) quoi.push('le devis '+p.n_devis+' dans Odoo (sauf s\\'il est déjà facturé)');
  if (!confirm('Supprimer la planche de '+p.client+(p.n_devis?' ('+p.n_devis+')':'')+' ?\\n\\nSera supprimé :\\n• '+quoi.join('\\n• ')
    + (fichiers.length && autres ? '\\n\\n⚠ '+autres+' autre(s) ligne(s) pour ce client : ces fichiers les concernent peut-être.' : ''))) return false;
  try {
    const j = await post('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/supprimer', { fichiers: fichiers.map(f => f.id), devis: true });
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
  if (j.commande) majLocale(c, j.commande);
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
  return '<tr data-id="'+(c.id||'')+'" data-ident="'+esc(c.identifiant||'')+'" data-email="'+esc(c.email_perso||'')+'" data-acces="'+(c.acces?1:'')+'"><td>'+inp('ad-c-aff', c.affichage, '130px')+'</td><td>'+inp('ad-c-nom', c.nom, '170px')+'</td><td>'+inp('ad-c-taux', c.taux_horaire, '90px', 'number')+'</td><td>'+inp('ad-c-ordre', c.ordre ?? 99, '60px', 'number')+'</td>'
    + '<td style="text-align:center"><input type="checkbox" class="ad-c-actif"'+(c.actif !== false ? ' checked' : '')+'></td>'
    + '<td style="min-width:210px">'+(!c.id ? '<span class="sub">Enregistre d’abord</span>' : (c.acces || c.identifiant)
        ? '<b>'+esc(c.identifiant)+'</b>'+(c.acces ? (c.mdp_provisoire?' <span class="esp">provisoire</span>':'') : ' <span class="esp" style="background:#fef3c7;color:#92400e">'+(c.invitation ? '✉️ invitation envoyée' : 'mot de passe pas encore choisi')+'</span>')
          + '<div class="sub">'+esc(c.email_perso||'pas d’e-mail perso')+(c.derniere_connexion?' · vu le '+new Date(c.derniere_connexion).toLocaleDateString('fr-FR'):'')+'</div>'
          + '<button class="btn ad-c-acces" style="padding:3px 8px;margin-top:4px">🔑 Modifier</button> '+(c.email_perso ? '<button class="btn ad-c-inviter" style="padding:3px 8px;margin-top:4px">✉️ '+(c.acces ? 'Lien mot de passe' : (c.invitation ? 'Renvoyer' : 'Inviter'))+'</button> ' : '')+'<button class="btn ad-c-retirer" style="padding:3px 8px;margin-top:4px">Retirer</button>'
        : '<button class="btn ad-c-acces" style="padding:3px 8px">🔑 Créer l’accès</button>')+'</td>'
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
    adNotif(); adTaches(); adSource(); adTel();
  } catch(e){ $('sync').className = 'sync err'; $('sync').textContent = '⚠️ ' + e.message; }
}
// Messages automatiques (prête / expédiée / avis, commandes et planches) : remplacent Power Automate
const NOTIF_LIB = { prete: 'Commande prête', expedition: 'Commande expédiée', avis: 'Avis Google', planche_prete: 'Planche prête', planche_expedition: 'Planche expédiée' };
async function adNotif(){
  const box = $('ad-notif'); if (!box) return;
  let e;
  try { const r = await fetch('/gestion/api/notifications'); e = await r.json(); if (e.error) throw new Error(e.error); }
  catch(err){ box.innerHTML = '<h3>📣 Messages automatiques aux clients</h3><div class="note">Indisponible : '+esc(err.message)+'</div>'; return; }
  const n = e.enAttente.length;
  let h = '<h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px">📣 Messages automatiques aux clients <span class="esp" style="background:'+(e.actives ? '#dcfce7;color:#065f46' : '#f3f4f6;color:#374151')+'">'+(e.actives ? '● Activés' : '○ Désactivés')+'</span></h3>';
  h += '<div class="note" style="margin-bottom:8px">Vérification toutes les 3 minutes : <b>prête</b> (TERMINÉE / planche A RECUPERER), <b>expédiée</b> (dès que le N° de suivi est saisi), <b>avis</b> le lendemain à 10 h du passage en LIVRÉE. <b>Colis livré</b> : le mail Colissimo « Confirmation de la livraison » reçu sur contact@ passe la commande ou la planche en LIVRÉE et envoie au client le mail « livrée + avis ». Mail générique + WhatsApp personnalisé si le client a écrit dans les dernières 24 h (sinon mail seulement). Ne dépend pas de l’Excel : ce qui a déjà été envoyé est suivi par le dashboard (journal dans chaque fiche). <b>Coupe les flux Power Automate correspondants avant d’activer.</b></div>';
  h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><label style="font-size:13px;font-weight:600">Lien avis Google</label><input id="nt-lien" value="'+esc(e.lienAvis || '')+'" placeholder="https://g.page/r/…/review" style="flex:1;min-width:220px;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px"><button class="btn" id="nt-lien-ok">Enregistrer</button></div>';
  if (!e.lienAvis) h += '<div class="note" style="margin:-4px 0 10px">Sans lien, la demande d’avis n’est pas envoyée.</div>';
  h += '<div style="font-size:13px;font-weight:600;margin-bottom:4px">'+(n ? n+' message(s) '+(e.actives ? 'en cours d’envoi' : 'en attente') : 'Rien en attente')+'</div>';
  if (n) h += '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;margin-bottom:10px">' + e.enAttente.map(i => '<div style="padding:6px 10px;border-bottom:1px solid var(--line);font-size:13px"><b>'+esc(NOTIF_LIB[i.type] || i.type)+'</b> · '+esc(i.nom || '')+(i.devis ? ' · '+esc(i.devis) : '')+' <span class="note">'+esc([i.email, i.tel ? fphone(i.tel) : ''].filter(Boolean).join(' · ') || '⚠️ aucun contact')+'</span></div>').join('') + '</div>';
  h += '<div class="btnrow">' + (e.actives
    ? '<button class="btn" id="nt-off">⏸ Désactiver</button>'
    : (n ? '<button class="btn pink" id="nt-on-ign">▶ Activer (ignorer les '+n+' en attente, déjà prévenus)</button><button class="btn" id="nt-on">▶ Activer et envoyer les '+n+'</button>' : '<button class="btn pink" id="nt-on">▶ Activer</button>')) + '</div><div class="msg" id="nt-msg"></div>';
  box.innerHTML = h;
  const nm = (t, k) => { $('nt-msg').className = 'msg on ' + k; $('nt-msg').innerHTML = t; };
  const act = async (actif, ignorerAttente) => {
    if (actif && !ignorerAttente && n && !confirm(n + ' message(s) vont partir aux clients maintenant. Continuer ?')) return;
    try { await post('/gestion/api/notifications/activer', { actif, ignorerAttente }); await adNotif(); }
    catch(err){ nm('❌ ' + esc(err.message), 'err'); }
  };
  if ($('nt-off')) $('nt-off').onclick = () => act(false, false);
  if ($('nt-on')) $('nt-on').onclick = () => act(true, false);
  if ($('nt-on-ign')) $('nt-on-ign').onclick = () => act(true, true);
  $('nt-lien-ok').onclick = async () => {
    try { await post('/gestion/api/notifications/lien-avis', { lien: $('nt-lien').value }); await adNotif(); nm('✅ Lien enregistré', 'ok'); }
    catch(err){ nm('❌ ' + esc(err.message), 'err'); }
  };
}
// Numéros clients dans Odoo : lus dans les BAT (dossiers de commande + ARCHIVES) et les formulaires
let adTelTimer = null;
async function adTel(){
  const box = $('ad-tel'); if (!box) return;
  let e; try { const r = await fetch('/gestion/api/admin/telephones'); e = await r.json(); if (!r.ok) throw new Error(e.error || 'Erreur'); } catch(err){ box.innerHTML = '<h3>📞 Numéros clients dans Odoo</h3><div class="note">Indisponible : '+esc(err.message)+'</div>'; return; }
  const r = e.rapport, lib = { a_ajouter: ['À ajouter', '#dcfce7;color:#065f46'], plusieurs: ['Plusieurs numéros', '#fef3c7;color:#92400e'], different: ['Différent dans Odoo', '#fee2e2;color:#991b1b'], deja_ok: ['Déjà bon', '#eef2ff;color:#3730a3'], ajoute: ['Ajouté ✓', '#dcfce7;color:#065f46'] };
  let h = '<h3>📞 Numéros clients dans Odoo</h3><div class="note">Lit les BAT et PDF des dossiers de commande (y compris ARCHIVES), les mails de la boîte contact@ (formulaires « Nouvelle commande », mails des clients avec un N° de devis) et les formulaires reçus, puis les compare aux fiches clients Odoo. L’analyse ne modifie rien. Ensuite, seuls les numéros <b>manquants</b> sont ajoutés : un numéro déjà présent dans Odoo n’est jamais remplacé.</div>';
  if (e.enCours) {
    const p = e.progression || {};
    h += '<div class="msg on">⏳ Analyse en cours : '+(p.dossiers||0)+' / '+(p.total||'?')+' dossiers, '+(p.pdf||0)+' PDF lus'+(p.mails ? ', '+p.mails+' mails parcourus' : '')+'…</div>';
    clearTimeout(adTelTimer); adTelTimer = setTimeout(adTel, 4000);
  } else if (r && r.erreur) {
    h += '<div class="msg on err">❌ Dernière analyse en erreur : '+esc(r.erreur)+'</div>';
  } else if (r && r.lignes) {
    const res = r.resume || {};
    h += '<div class="note" style="margin:8px 0">Analyse du '+new Date(r.le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' : '+r.dossiers+' dossiers, '+r.pdf+' PDF lus, '+(r.mails||0)+' mails parcourus, '+r.lignes.length+' fiches clients.</div>';
    h += '<div class="btnrow" style="margin:0 0 10px">'+Object.keys(lib).filter(k => res[k]).map(k => '<span class="esp" style="background:'+lib[k][1]+'">'+lib[k][0]+' : '+res[k]+'</span>').join('')+'</div>';
    const aVoir = r.lignes.filter(l => l.statut !== 'deja_ok');
    if (aVoir.length) {
      h += '<div style="overflow-x:auto;max-height:460px;overflow-y:auto"><table class="stk"><thead><tr><th></th><th>Client Odoo</th><th>Numéro trouvé</th><th>Dans Odoo</th><th>Trouvé dans</th></tr></thead><tbody>'
        + aVoir.map(l => {
          const choix = l.statut === 'a_ajouter' ? '<input type="checkbox" class="tel-c" data-p="'+l.partnerId+'" data-n="'+l.numeros[0].numero+'" checked>'
            : l.statut === 'plusieurs' ? '<select class="tel-s" data-p="'+l.partnerId+'"><option value="">— choisir —</option>'+l.numeros.map(n => '<option value="'+n.numero+'">'+esc(n.affiche)+'</option>').join('')+'</select>' : '';
          return '<tr><td>'+choix+'</td><td><b>'+esc(l.client)+'</b><div><span class="esp" style="background:'+lib[l.statut][1]+'">'+lib[l.statut][0]+'</span></div></td><td>'+(l.statut === 'a_ajouter' ? '<b>'+esc(l.numeros[0].affiche)+'</b>'+(l.numeros.length > 1 ? '<div class="note">aussi vu : '+l.numeros.slice(1).map(n => esc(n.affiche)).join(', ')+'</div>' : '') : l.numeros.map(n => esc(n.affiche)).join('<br>'))+'</td><td>'+esc(l.telephoneOdoo || '—')+'</td><td class="note" style="max-width:340px">'+l.numeros.flatMap(n => n.sources).slice(0, 3).map(esc).join('<br>')+'</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    const autres = (r.sansNumero || []).length + (r.introuvables || []).length + (r.illisibles || []).length;
    if (autres) h += '<details style="margin-top:8px"><summary class="note">Non traités : '+(r.sansNumero||[]).length+' dossier(s) sans numéro lisible, '+(r.introuvables||[]).length+' devis introuvable(s) dans Odoo, '+(r.illisibles||[]).length+' fichier(s) illisible(s)</summary><div class="note pre" style="max-height:260px;overflow:auto">'+[...(r.sansNumero||[]).map(x => '• '+x.dossier+' : '+x.raison), ...(r.introuvables||[]).map(x => '• '+x.devis+' ('+(x.client||'?')+') : '+x.raison), ...(r.illisibles||[]).map(x => '• '+x.dossier+(x.fichier?'/'+x.fichier:'')+' : '+x.raison)].map(esc).join('<br>')+'</div></details>';
  }
  h += '<div class="btnrow" style="margin-top:10px"><button class="btn" id="tel-analyser"'+(e.enCours?' disabled':'')+'>🔎 '+(r && r.lignes ? 'Relancer l’analyse' : 'Lancer l’analyse')+'</button>'
    + (r && r.lignes && !e.enCours ? '<button class="btn pink" id="tel-appliquer">Ajouter les numéros cochés dans Odoo</button>' : '') + '</div><div class="msg" id="tel-msg"></div>';
  box.innerHTML = h;
  const tm = (t, k) => { $('tel-msg').className = 'msg on ' + k; $('tel-msg').innerHTML = t; };
  if ($('tel-analyser')) $('tel-analyser').onclick = async () => { try { await post('/gestion/api/admin/telephones/analyser'); setTimeout(adTel, 800); } catch(err){ tm('❌ ' + esc(err.message), 'err'); } };
  if ($('tel-appliquer')) $('tel-appliquer').onclick = async () => {
    const choix = [...box.querySelectorAll('.tel-c:checked')].map(c => ({ partnerId: Number(c.dataset.p), numero: c.dataset.n }))
      .concat([...box.querySelectorAll('.tel-s')].filter(s => s.value).map(s => ({ partnerId: Number(s.dataset.p), numero: s.value })));
    if (!choix.length) { tm('Coche au moins un numéro', 'err'); return; }
    if (!confirm('Ajouter ' + choix.length + ' numéro(s) dans Odoo ? (seulement sur les fiches qui n’en ont pas)')) return;
    $('tel-appliquer').disabled = true;
    try { const o = await post('/gestion/api/admin/telephones/appliquer', { choix }); await adTel(); tm('✅ ' + o.ajoutes + ' numéro(s) ajouté(s)' + (o.ignores ? ', ' + o.ignores + ' ignoré(s)' : '') + (o.details && o.details.length ? '<br>' + o.details.map(esc).join('<br>') : ''), 'ok'); }
    catch(err){ tm('❌ ' + esc(err.message), 'err'); $('tel-appliquer').disabled = false; }
  };
}
// Source des données : l'Excel ou la base du dashboard (bascule définitive)
async function adSource(){
  const box = $('ad-source'); if (!box) return;
  let e; try { const r = await fetch('/gestion/api/admin/source'); e = await r.json(); if (!r.ok || !['base','excel'].includes(e.source)) throw new Error(e.error || 'réponse invalide'); } catch(err){ box.innerHTML = '<h3>🗄️ Données</h3><div class="note">Indisponible : '+esc(err.message)+'</div>'; return; }
  const base = e.source === 'base';
  box.innerHTML = '<h3 style="display:flex;justify-content:space-between;align-items:center">🗄️ Données <span class="esp" style="background:'+(base?'#dcfce7;color:#065f46':'#fef3c7;color:#92400e')+'">'+(base?'Base du dashboard':'Excel « IGS - Gestion - Commandes »')+'</span></h3>'
    + (base
      ? '<div class="note">Commandes, planches et stock sont lus et enregistrés dans la base du dashboard. L’Excel n’est plus utilisé (il reste en archive, il n’est plus mis à jour). Le bon de commande SEFI reste un classeur Excel.</div><div class="btnrow" style="margin-top:8px"><button class="btn" id="src-excel">↩ Revenir à l’Excel (urgence)</button></div>'
      : '<div class="note">Le dashboard lit encore l’Excel. La bascule fait une dernière lecture complète (commandes, planches, stock), puis tout se passe dans le dashboard : <b>plus personne ne doit modifier l’Excel ensuite</b>.</div><div class="btnrow" style="margin-top:8px"><button class="btn pink" id="src-base">Basculer sur la base du dashboard</button></div>')
    + '<div class="msg" id="src-msg"></div>';
  const sm = (t, k) => { $('src-msg').className = 'msg on ' + k; $('src-msg').innerHTML = t; };
  if ($('src-base')) $('src-base').onclick = async () => {
    if (!confirm('Basculer définitivement sur la base du dashboard ? L’Excel ne sera plus lu ni mis à jour.')) return;
    $('src-base').disabled = true; $('src-base').textContent = 'Bascule en cours…';
    try { const r = await post('/gestion/api/admin/source/basculer'); sm('✅ Bascule faite : ' + r.commandes + ' commande(s), ' + r.planches + ' planche(s), stock ' + esc(JSON.stringify(r.stock)), 'ok'); setTimeout(adSource, 1500); }
    catch(err){ sm('❌ ' + esc(err.message), 'err'); $('src-base').disabled = false; $('src-base').textContent = 'Basculer sur la base du dashboard'; }
  };
  if ($('src-excel')) $('src-excel').onclick = async () => {
    if (!confirm('Revenir à l’Excel ? Tout ce qui a été saisi dans le dashboard depuis la bascule n’est PAS dans l’Excel.')) return;
    try { await post('/gestion/api/admin/source/excel'); adSource(); } catch(err){ sm('❌ ' + esc(err.message), 'err'); }
  };
}
// Tâches automatiques : chacune remplace un flux Power Automate (couper le flux, puis activer)
async function adTaches(){
  const box = $('ad-taches'); if (!box) return;
  let e;
  try { const r = await fetch('/gestion/api/taches'); e = await r.json(); if (e.error || !Array.isArray(e.taches)) throw new Error(e.error || 'réponse invalide'); }
  catch(err){ box.innerHTML = '<h3>⚙️ Tâches automatiques</h3><div class="note">Indisponible : '+esc(err.message)+'</div>'; return; }
  let h = '<h3>⚙️ Tâches automatiques</h3><div class="note" style="margin-bottom:8px">Chaque tâche remplace un flux Power Automate. <b>Coupe d’abord le flux indiqué</b>, puis active la tâche. « Lancer » l’exécute tout de suite, même désactivée.</div>';
  h += '<div style="overflow-x:auto"><table class="stk"><thead><tr><th>Tâche</th><th>Remplace le flux</th><th>Rythme</th><th>Dernier passage</th><th></th></tr></thead><tbody>';
  h += e.taches.map(t => {
    const d = t.dernier;
    return '<tr><td><b>'+esc(t.nom)+'</b></td><td class="note">'+esc(t.flux)+'</td><td class="note">'+esc(t.rythme)+'</td>'
      + '<td class="note">'+(d ? (d.ok ? '✅ ' : '⚠️ ')+new Date(d.le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'<br>'+esc(d.resultat || '') : '—')+'</td>'
      + '<td style="white-space:nowrap"><label style="display:inline-flex;gap:6px;align-items:center;font-size:13px;margin-right:6px"><input type="checkbox" data-tache-on="'+esc(t.id)+'"'+(t.active?' checked':'')+'> Activée</label>'+(t.evenement ? '' : '<button class="btn" data-tache-run="'+esc(t.id)+'">▶ Lancer</button>')+'</td></tr>';
  }).join('');
  h += '</tbody></table></div>';
  if (e.sefi) {
    h += '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      + (e.sefi.verrou ? '<span class="esp" style="background:#fee2e2;color:#991b1b">⚠️ Envoi SEFI bloqué : '+esc(e.sefi.verrou)+'</span><button class="btn" id="sefi-debloquer">Débloquer (BDC vérifié)</button>' : '')
      + '<button class="btn pink" id="sefi-go">📨 Envoyer le BDC SEFI maintenant</button>'
      + (e.sefi.dernier ? '<span class="note">Dernier envoi : '+new Date(e.sefi.dernier.le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' · lot '+esc(e.sefi.dernier.lot || '')+' · '+esc((e.sefi.dernier.devis || []).join(', '))+'</span>' : '')
      + '</div>';
  }
  h += '<div class="msg" id="tc-msg"></div>';
  box.innerHTML = h;
  if ($('sefi-go')) $('sefi-go').onclick = async () => {
    if (!confirm('Envoyer maintenant le bon de commande à SEFI ?')) return;
    $('sefi-go').disabled = true;
    try { const r = await post('/gestion/api/sefi/envoyer'); $('tc-msg').className = 'msg on ' + (r.ok ? 'ok' : 'err'); $('tc-msg').innerHTML = esc(r.message || ''); }
    catch(err){ $('tc-msg').className = 'msg on err'; $('tc-msg').innerHTML = '❌ ' + esc(err.message); $('sefi-go').disabled = false; }
  };
  if ($('sefi-debloquer')) $('sefi-debloquer').onclick = async () => { try { await post('/gestion/api/sefi/debloquer'); adTaches(); } catch(err){ alert(err.message); } };
  const tm = (t, k) => { $('tc-msg').className = 'msg on ' + k; $('tc-msg').innerHTML = t; };
  box.onchange = async ev => {
    const id = ev.target.dataset && ev.target.dataset.tacheOn; if (!id) return;
    if (ev.target.checked && !confirm('Le flux Power Automate correspondant est bien coupé ?')) { ev.target.checked = false; return; }
    try { await post('/gestion/api/taches/'+encodeURIComponent(id)+'/activer', { actif: ev.target.checked }); await adTaches(); }
    catch(err){ ev.target.checked = !ev.target.checked; tm('❌ ' + esc(err.message), 'err'); }
  };
  box.onclick = async ev => {
    const b = ev.target.closest('[data-tache-run]'); if (!b) return;
    b.disabled = true; b.textContent = '…';
    try { const r = await post('/gestion/api/taches/'+encodeURIComponent(b.dataset.tacheRun)+'/lancer'); tm((r.ok ? '✅ ' : '⚠️ ') + esc(r.resultat || ''), r.ok ? 'ok' : 'err'); await adTaches(); }
    catch(err){ tm('❌ ' + esc(err.message), 'err'); b.disabled = false; b.textContent = '▶ Lancer'; }
  };
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
  $('ad-col-inviter').onclick = async () => {
    if (!confirm('Envoyer un mail « Choisis ton mot de passe » à tous les collaborateurs actifs qui ont un identifiant et un e-mail perso, et qui n’ont pas encore choisi leur mot de passe ?')) return;
    try { const k = await post('/gestion/api/admin/collaborateurs/inviter-tous'); alert('✅ Invitations envoyées : '+(k.envoyes.join(', ') || 'aucune')+(k.ignores.length ? '\\n\\nNon envoyées :\\n• '+k.ignores.join('\\n• ') : '')); adCharger(); }
    catch(err){ alert(err.message); }
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
    if (e.target.closest('.ad-c-acces')) {
      const v = c => tr.querySelector(c);
      const prenom = (v('.ad-c-nom').value || v('.ad-c-aff').value).trim().split(/\\s+/)[0] || '';
      const sugg = tr.dataset.ident || prenom.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
      const identifiant = prompt('Identifiant de connexion (prénom sans accent) :', sugg); if (identifiant === null) return;
      const email_perso = prompt('E-mail perso (pour réinitialiser son mot de passe) :', tr.dataset.email || ''); if (email_perso === null) return;
      const mot_de_passe = prompt(tr.dataset.acces ? 'Nouveau mot de passe provisoire (laisser vide pour garder l’actuel) :' : 'Mot de passe provisoire (8 caractères minimum)\\n\\nOu laisse VIDE : il recevra un mail sur son e-mail perso pour choisir lui-même son mot de passe.', ''); if (mot_de_passe === null) return;
      try {
        const j = await post('/gestion/api/admin/collaborateurs/'+tr.dataset.id+'/acces', { identifiant, email_perso, mot_de_passe });
        if (!mot_de_passe && !tr.dataset.acces && email_perso.trim()) {
          const k = await post('/gestion/api/admin/collaborateurs/'+tr.dataset.id+'/inviter');
          alert('Accès créé et invitation envoyée à '+k.email+'.\\n\\nIdentifiant : '+j.identifiant+'\\nIl choisit son mot de passe depuis le mail (lien valable 72 h).');
        } else alert('Accès enregistré.\\n\\nIdentifiant : '+j.identifiant+(mot_de_passe ? '\\nMot de passe provisoire : celui que tu viens de saisir' : '')+'\\nAdresse : '+location.origin+'/gestion');
        adCharger();
      } catch(err){ alert(err.message); }
    }
    if (e.target.closest('.ad-c-inviter')) {
      if (!confirm('Envoyer à '+(tr.dataset.email||'son e-mail perso')+' un lien pour choisir son mot de passe ?')) return;
      try { const k = await post('/gestion/api/admin/collaborateurs/'+tr.dataset.id+'/inviter'); alert('✅ Mail envoyé à '+k.email+' (lien valable 72 h).'); adCharger(); } catch(err){ alert(err.message); }
    }
    if (e.target.closest('.ad-c-retirer')) {
      if (!confirm('Retirer l’accès à distance de ce collaborateur ? Il sera déconnecté (le compte contact@ reste utilisable au bureau).')) return;
      try { await post('/gestion/api/admin/collaborateurs/'+tr.dataset.id+'/acces/retirer'); adCharger(); } catch(err){ alert(err.message); }
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
  $('psub').textContent = 'Planche ajoutée';
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
    $('n-ok').disabled = true; msg('Enregistrement…', 'info');
    try {
      const j = await post('/gestion/api/planches/ajouter', body);
      const texte = j.compteur ? '✅ Compteur hebdo : '+String(j.compteur.avant).replace('.',',')+' + '+String(j.compteur.ajout).replace('.',',')+' = '+String(j.compteur.total).replace('.',',')+' m' : '✅ Planche ajoutée';
      await apresAction(j.planche, texte);
      if (!j.planche) msg(texte, 'ok');
    } catch(e){ msg('❌ ' + esc(e.message), 'err'); $('n-ok').disabled = false; }
  };
}
function plActionsHtml(p){
  const opts = PL_STATUTS.map(s => '<option'+(plKey(p.statut)===s?' selected':'')+'>'+s+'</option>').join('');
  let h = '<div class="card"><h3>Actions</h3><div class="actions">'
    + '<div class="field"><label>Client</label><input id="a-client" value="'+esc(p.client)+'"></div>'
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
    + '<div class="note" style="margin-top:4px">Après l\\'envoi, le compteur (Métrage) repart à zéro.</div>';
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
    busy(true); msg('Enregistrement…', 'info');
    try { const j = await post('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/modifier', body); await apresAction(j.planche || p, '✅ Enregistré'); }
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
        $('clio-pk').insertAdjacentHTML('beforebegin', '<div class="btnrow" style="margin-top:4px"><button class="btn" id="clio-ren">✏️ Renommer « '+esc(p.client)+' » en « '+esc(j.partner.name)+' »</button></div>');
        $('clio-ren').onclick = async () => {
          if (!confirm('Remplacer le nom « '+p.client+' » par « '+j.partner.name+' » ?')) return;
          try { const r = await post('/gestion/api/planches/'+encodeURIComponent(p.cle)+'/modifier', { client: j.partner.name }); await apresAction(r.planche || p, '✅ Client renommé'); }
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
  data.filter(AVANT_BAT).forEach(c => { const e = batEtape(c); if (e === 'faire') add(c, 'BAT à faire', 'o'); else if (e === 'envoyer') add(c, 'BAT à envoyer', 'o'); else if (e === 'formulaire') add(c, 'Attend le formulaire', 'b'); });
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
  if ($('bat-n')) $('bat-n').textContent = data.filter(c => AVANT_BAT(c) && ['modif','faire','envoyer'].includes(batEtape(c))).length || '';
  const counts = {}; data.forEach(c => { const k = statutKey(c.statut); counts[k] = (counts[k]||0)+1; });
  const actifs = data.filter(c => !FINIS.includes(statutKey(c.statut))).length;
  if (filtre === 'TOUS') filtre = 'ACTIFS';
  const chips = [['ACTIFS','En cours',actifs]].concat(STATUTS.map(s=>[s,s,counts[s]||0]));
  $('chips').innerHTML = '<label class="filtre">Afficher <select id="f-sel">'+chips.map(([k,l,n]) => '<option value="'+esc(k)+'"'+(filtre===k?' selected':'')+'>'+esc(l.charAt(0)+l.slice(1).toLowerCase())+' ('+n+')</option>').join('')+'</select></label>'
    + (filtre === 'LIVRÉE' ? '<span class="note" style="align-self:center">Les commandes livrées passent dans l\\'historique chaque nuit : retrouve les plus anciennes dans l\\'onglet Historique.</span>' : '');

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
      + '<td><a href="#" class="open client">'+esc(c.client)+'</a>'+batBadge(c)+especesHtml(c)+(c.bordereaux?'<div>'+bordereauxLiens(c)+'</div>':'')+ecartHtml(c.controle)+(c.remarque?'<div class="sub clip">'+esc(c.remarque)+'</div>':'')+'</td>'
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

// ---------- Nouvelle commande saisie à la main ----------
function nouvelleCommande(){
  panelCle = '__nouvelle__';
  $('pbody').onclick = null;
  $('ptitle').textContent = 'Nouvelle commande';
  $('psub').textContent = 'Commande ajoutée';
  const st = ['PAYÉE','EN DEVIS','VALIDÉE','EN COMMANDE'];
  $('pbody').innerHTML = '<div class="card"><div class="actions">'
    + '<div class="field"><label>N° de devis</label><input id="n-devis" placeholder="ex. DE2601234" autocomplete="off"></div>'
    + '<div class="field"><label>Client *</label><input id="n-client"></div>'
    + '<div class="field"><label>E-mail</label><input id="n-email" type="email"></div>'
    + '<div class="field"><label>Téléphone</label><input id="n-tel" type="tel"></div>'
    + '<div class="field"><label>Statut</label><select id="n-statut">'+st.map(x => '<option>'+x+'</option>').join('')+'</select></div>'
    + '<div class="field"><label>Affectation</label><select id="n-aff"><option value="">— Non affectée —</option>'+EQUIPE.map(x => '<option>'+esc(x)+'</option>').join('')+'</select></div>'
    + '<div class="field" style="grid-column:1/-1"><label>Zone de flocage</label><input id="n-zone" placeholder="ex. Cœur (9cm) + Dos (27cm)"></div>'
    + '<div class="field" style="grid-column:1/-1"><label>Contenu</label><input id="n-infos" placeholder="ex. 20 x T-shirt personnalisé avant/arrière"></div>'
    + '<div class="field" style="grid-column:1/-1"><label>Remarque</label><input id="n-rem"></div>'
    + '</div><label class="note" style="display:flex;gap:6px;align-items:center;margin-top:10px"><input type="checkbox" id="n-form" checked style="width:auto"> Ouvrir ensuite le formulaire prérempli pour saisir tailles et visuels</label>'
    + '<div class="btnrow"><button class="btn primary" id="n-ok">Créer la commande</button></div><div class="msg" id="a-msg"></div></div>';
  $('overlay').classList.add('on'); $('panel').classList.add('on'); $('panel').setAttribute('aria-hidden','false');
  // Client, e-mail et téléphone repris du devis Odoo
  $('n-devis').addEventListener('change', async () => {
    const n = $('n-devis').value.trim(); if (!n) return;
    try {
      const j = await (await fetch('/gestion/api/odoo/devis/'+encodeURIComponent(n)+'/client')).json();
      if (j.client) { if (!$('n-client').value) $('n-client').value = j.client.nom; if (!$('n-email').value) $('n-email').value = j.client.email; if (!$('n-tel').value) $('n-tel').value = j.client.telephone; msg('Client repris du devis Odoo : '+esc(j.client.nom), 'info'); }
      else msg('Devis introuvable dans Odoo : saisis le client à la main', 'info');
    } catch(e){}
  });
  $('n-ok').onclick = async () => {
    const body = { n_devis: $('n-devis').value, client: $('n-client').value, email: $('n-email').value, telephone: $('n-tel').value, statut: $('n-statut').value,
      affectation: $('n-aff').value, zone_flocage: $('n-zone').value, infos: $('n-infos').value, remarque: $('n-rem').value };
    if (!body.client.trim()) return msg('Le client est obligatoire', 'err');
    const ouvrirForm = $('n-form').checked, fen = ouvrirForm ? window.open('about:blank', '_blank') : null;
    $('n-ok').disabled = true; msg('Ajout en cours…', 'info');
    try {
      const j = await post('/gestion/api/commandes/nouvelle', body);
      await charger(false);
      if (ouvrirForm && j.cle) {
        const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(j.cle)+'/lien-formulaire'); const l = await r.json();
        if (fen && l.url) fen.location.href = l.url;
      } else if (fen) fen.close();
      if (j.cle) { panelCle = j.cle; ouvrir(j.cle); } else fermer();
    } catch(e){ if (fen) fen.close(); msg('❌ '+esc(e.message), 'err'); $('n-ok').disabled = false; }
  };
}

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
  $('pbody').innerHTML = stepsHtml(c) +
    (c.date_dynamique ? '<div class="warnbox">⚠️ La date de commande de cette ligne est une formule <b>=TODAY()</b> dans l\\'Excel : elle change chaque jour, et la date de livraison avec.</div>' : '')
    + '<div class="card"><h3>Commande</h3><div class="grid">'
    + kv('Contenu', esc(c.infos)) + kv('Zone de flocage', esc(c.zone_flocage)) + kv('Planche', esc(c.planche))
    + kv('Date commande', fdate(c.date_commande)) + '<div class="kv" id="livbox">'+livBox(c)+'</div>'
    + kv('Contact', contact) + kv('N° de suivi', esc(c.numero_suivi))
    + '</div>' + (c.instructions ? '<div class="kv" style="margin-top:10px"><div class="k">Instructions client</div><div class="v pre">'+esc(c.instructions)+'</div></div>' : '')
    + (c.remarque ? '<div class="kv" style="margin-top:10px"><div class="k">Remarque</div><div class="v pre">'+esc(c.remarque)+'</div></div>' : '')
    + '</div>'
    + cmdActionsHtml(c)
    + '<div id="journal"></div>'
    + '<div id="dossier"><div class="card"><h3>Dossier client</h3><div class="skel"></div><div class="skel"></div></div></div>';
  brancherCmd(c);
  jrCharger(c);
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
      h += '<div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px">Visuels <a class="btn" href="/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/visuels.zip" title="Télécharger tous les visuels de la commande (zip)">⬇ Tout télécharger</a></h3><div class="visuels">' + d.visuels.map(v =>
        '<div class="visuel"><div class="t">'+esc(v.nom)+'</div><div class="imgs">'
        + (v.images.length ? v.images.map(i => '<div style="display:flex;flex-direction:column;gap:4px"><a href="/gestion/api/fichier/'+encodeURIComponent(i.id)+'" target="_blank" rel="noopener">'
          + (i.miniature ? '<img loading="lazy" src="'+esc(i.miniature)+'" alt="">' : '<img loading="lazy" src="/gestion/api/fichier/'+encodeURIComponent(i.id)+'" alt="">')
          + '<span>'+(i.face==='avant'?'Avant':i.face==='arriere'?'Arrière':esc(i.nom))+'</span></a>'
          + '<a class="btn" style="justify-content:center;padding:4px 8px;font-size:12px" href="/gestion/api/fichier/'+encodeURIComponent(i.id)+'?dl=1" title="Télécharger '+esc(i.nom)+'">⬇ '+esc(i.nom.length > 18 ? i.nom.slice(0, 16) + '…' : i.nom)+'</a></div>').join('') : '<span class="note">Aucune image</span>')
        + '</div></div>').join('') + '</div></div>';
    }
    // BAT
    if (c.bat_reponse && statutKey(c.statut) !== 'PAYÉE') h += '<div class="card"><h3>Réponse du client au BAT</h3>'+batReponseHtml(c)+'</div>';
    if (AVANT_BAT(c) && d.bat) h += '<div class="card"><h3>Suivi du BAT</h3>' + batReponseHtml(c) + (c.bat_envoye_le
      ? '<div class="note">📤 Envoyé au client le '+new Date(c.bat_envoye_le).toLocaleDateString('fr-FR')+(c.bat_envoye_par?' par '+esc(c.bat_envoye_par):'')+' : en attente de sa validation.</div><div class="btnrow" style="margin-top:8px"><button class="btn pink" data-bat-ok="'+esc(c.cle)+'">✅ Validé par le client'+(statutKey(c.statut) === 'EN COMMANDE' ? '' : ' (→ VALIDÉE)')+'</button><button class="btn" data-bat-send="'+esc(c.cle)+'">📨 Renvoyer</button><button class="btn" data-bat-env="'+esc(c.cle)+'" data-v="0">↩ Pas encore envoyé</button></div>'
      : '<div class="btnrow"><button class="btn primary" data-bat-send="'+esc(c.cle)+'">📨 Envoyer le BAT au client (mail + WhatsApp)</button><button class="btn" data-bat-env="'+esc(c.cle)+'" data-v="1">✓ Déjà envoyé autrement</button></div>') + '<div class="msg" id="bat-msg"></div></div>';
    h += '<div class="card"><h3>Bon à tirer</h3>' + (d.bat
      ? '<iframe class="bat" src="/gestion/api/fichier/'+encodeURIComponent(d.bat.id)+'#view=FitH" title="BAT"></iframe><div class="note" style="margin-top:6px"><a href="/gestion/api/fichier/'+encodeURIComponent(d.bat.id)+'" target="_blank" rel="noopener">Ouvrir le BAT en grand</a> · modifié le '+new Date(d.bat.modifie).toLocaleDateString('fr-FR')+'</div>'
      : '<div class="note">Pas encore de « BON A TIRER.pdf » dans le dossier.</div>') + '<div class="btnrow" style="margin-top:8px"><a class="btn primary" href="/gestion/bat/'+encodeURIComponent(c.cle)+'" target="_blank" rel="noopener">🎨 '+(d.bat ? 'Refaire le BAT avec le générateur' : 'Générer le BAT')+'</a></div></div>';
    if (d.dossier.lien) h += '<div class="note"><a href="'+esc(d.dossier.lien)+'" target="_blank" rel="noopener">📁 Ouvrir le dossier dans SharePoint</a></div>';
    $('dossier').innerHTML = h;
    $('dossier').onclick = batClic;
    brancherBordereau(c);
    if (d.bordereaux) { const avant = JSON.stringify(c.bordereaux||null); c.bordereaux = d.bordereaux.length ? d.bordereaux.map(b => ({ id: b.id, nom: b.nom })) : null; if (avant !== JSON.stringify(c.bordereaux)) afficher(); }
    dernierDossier = d;
  } catch(e){
    if (cle === panelCle) $('dossier').innerHTML = '<div class="card warnbox">Dossier indisponible : '+esc(e.message)+'</div>';
  }
}
// ---------- Journal de la commande : messages envoyés, conversation WhatsApp, questions internes à Leïla ----------
const jrHeure = d => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
async function jrCharger(c){
  const box = $('journal'); if (!box) return;
  box.innerHTML = '<div class="card"><h3>💬 Messages & journal</h3><div class="skel"></div></div>';
  try {
    const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/journal');
    const j = await r.json(); if (j.error) throw new Error(j.error);
    if (c.cle !== panelCle) return;
    jrAfficher(c, j);
  } catch(e){ if (c.cle === panelCle) box.innerHTML = '<div class="card"><h3>💬 Messages & journal</h3><div class="note">Journal indisponible : '+esc(e.message)+'</div></div>'; }
}
function jrAfficher(c, j){
  const st = { envoye: ['✅','#065f46'], echec: ['⚠️','#991b1b'], sans_contact: ['⚠️','#991b1b'], ignore: ['⏭','#6b7280'], valide: ['✅','#065f46'], modification: ['✏️','#991b1b'] };
  let h = '<div class="card"><h3>💬 Messages & journal</h3>';
  h += '<div class="k" style="font-size:12px;color:var(--muted);margin-bottom:4px">Messages envoyés par le dashboard</div>';
  h += j.messages.length ? '<div class="jr-list">' + j.messages.map(m => { const s2 = st[m.statut] || ['•','#374151'];
    return '<div class="jr-l"><span style="color:'+s2[1]+'">'+s2[0]+' <b>'+esc(m.titre)+'</b></span> <span class="note">'+jrHeure(m.le)+(m.canal ? ' · '+esc(m.canal) : '')+(m.statut === 'ignore' ? ' · ignoré' : '')+'</span>'+(m.detail ? '<div class="note pre" style="margin-top:2px">'+esc(String(m.detail).slice(0, 300))+'</div>' : '')+'</div>'; }).join('') + '</div>'
    : '<div class="note">Aucun message envoyé par le dashboard pour l’instant.</div>';
  h += '<details style="margin-top:10px"'+(j.conversation.length ? '' : ' disabled')+'><summary style="cursor:pointer;font-size:13px;font-weight:600">Conversation WhatsApp '+(j.telephone ? '('+esc(fphone(j.telephone))+')' : '')+' · '+j.conversation.length+' message(s)</summary>';
  h += j.conversation.length ? '<div class="jr-conv">' + j.conversation.map(m => '<div class="jr-b '+(m.role === 'user' ? 'cl' : 'igs')+'"><div class="pre">'+esc(m.texte)+'</div><small>'+(m.role === 'user' ? 'Client' : 'IGS')+' · '+jrHeure(m.le)+'</small></div>').join('') + '</div>'
    : '<div class="note">'+(j.telephone ? 'Aucun message WhatsApp avec ce numéro.' : 'Pas de téléphone sur la commande.')+'</div>';
  h += '</details>';
  h += '<div class="k" style="font-size:12px;color:var(--muted);margin:12px 0 4px">Demander à Leïla (interne, le client ne voit rien)</div>';
  h += j.questions.slice().reverse().map(q => '<div class="jr-q"><div><b>'+esc(q.par || '')+'</b> : '+esc(q.question)+'</div><div class="jr-r pre">🤖 '+esc(q.reponse)+'</div><small class="note">'+jrHeure(q.le)+'</small></div>').join('');
  h += '<div style="display:flex;gap:6px;margin-top:6px"><input id="jr-q" placeholder="Ex. : tu lui as dit quelle heure pour la récupération ?" style="flex:1;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px"><button class="btn primary" id="jr-go">Demander</button></div><div class="msg" id="jr-msg"></div>';
  h += '</div>';
  $('journal').innerHTML = h;
  const conv = document.querySelector('#journal .jr-conv'); const det = document.querySelector('#journal details');
  if (det && conv) det.addEventListener('toggle', () => { conv.scrollTop = conv.scrollHeight; });
  const go = async () => {
    const q = $('jr-q').value.trim(); if (!q) return;
    $('jr-go').disabled = true; $('jr-go').textContent = '…';
    try { await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/question', { question: q }); await jrCharger(c); }
    catch(e){ const m = $('jr-msg'); if (m) { m.style.display = 'block'; m.className = 'msg err'; m.textContent = e.message; } $('jr-go').disabled = false; $('jr-go').textContent = 'Demander'; }
  };
  $('jr-go').onclick = go;
  $('jr-q').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
// Frise d'avancement de la commande (fiche)
function stepsHtml(c){
  const ETAPES = ['Payée','BAT','Validée','En commande','Production','Flocage','Terminée'];
  const k = statutKey(c.statut);
  let i = { 'EN DEVIS': -1, 'PAYÉE': 0, 'VALIDÉE': 2, 'EN COMMANDE': 3, 'EN PRODUCTION': 4, 'EN FLOCAGE': 5, 'TERMINÉE': 6, 'A EXPEDIER': 6, 'EXPÉDIÉE': 7, 'LIVRÉE': 7 }[k];
  if (i === undefined) i = -1;
  if (k === 'PAYÉE' && c.bat_info && c.bat_info.formulaire) i = 1;
  if (k === 'EN COMMANDE' && !(c.bat_reponse && c.bat_reponse.verdict === 'valide')) i = 1;
  return '<div class="card" style="padding:14px 18px"><div class="steps">' + ETAPES.map((e, n) => '<div class="st '+(n < i ? 'd' : n === i ? 'c' : '')+'"><i></i><span>'+e+'</span></div>').join('') + '</div></div>';
}
// ---------- Liste des BAT (commandes PAYÉE) ----------
let modeBat = false;
// formulaire -> faire -> envoyer -> client (envoyé, attend la validation) ; inconnu = dossier pas encore relu
function batEtape(c){
  if (c.bat_reponse && c.bat_reponse.verdict === 'valide') return 'valide';
  if (c.bat_envoye_le && c.bat_reponse && c.bat_reponse.verdict === 'modification') return 'modif';
  if (c.bat_envoye_le) return 'client';
  const i = c.bat_info; if (!i) return 'inconnu';
  if (!i.dossier || !i.formulaire) return 'formulaire';
  return i.bat ? 'envoyer' : 'faire';
}
// État du BAT sur la ligne de la commande (liste), visible au premier coup d'œil
function batBadge(c){
  if (!AVANT_BAT(c)) return '';
  const e = batEtape(c);
  const t = { modif: ['✏️ BAT : modification demandée', '#fee2e2', '#991b1b'], faire: ['🎨 BAT à faire', '#fef3c7', '#92400e'],
              envoyer: [(c.bat_auto_le ? '🤖 BAT auto à vérifier et envoyer' : '📤 BAT à envoyer'), '#ede9fe', '#5b21b6'], client: ['⏳ BAT envoyé, attend le client', '#e0f2fe', '#075985'] }[e];
  return t ? '<div><a href="/gestion/commandes#bat" class="esp" style="background:'+t[1]+';color:'+t[2]+';text-decoration:none" onclick="event.stopPropagation();event.preventDefault();var b=document.getElementById(\\'tab-bat\\');if(b)b.click();else location.href=\\'/gestion/commandes#bat\\'">'+t[0]+'</a></div>' : '';
}
function batRender(){
  const q = norm(recherche);
  let rows = data.filter(AVANT_BAT);
  if (q) rows = rows.filter(c => norm([c.n_devis, c.client, c.affectation, c.infos].join(' ')).includes(q));
  rows.sort((a,b) => String(a.date_livraison||'9999').localeCompare(String(b.date_livraison||'9999')));
  const G = [
    ['modif', '✏️ Modification demandée par le client', 'Corrige le BAT dans le dossier puis renvoie-le'],
    ['faire', '🎨 BAT à faire', 'Formulaire reçu, pas encore de « BON A TIRER.pdf » dans le dossier'],
    ['envoyer', '📤 BAT à envoyer', 'Le BAT est dans le dossier : vérifie-le puis envoie-le au client'],
    ['client', '⏳ Envoyé, attend la validation du client', 'Quand le client valide, la commande passe en VALIDÉE'],
    ['formulaire', '📝 Attend le formulaire du client', 'Commande payée, formulaire pas encore reçu'],
    ['inconnu', '… Dossier pas encore relu', 'Clique « Relire les dossiers »'],
  ];
  const n = rows.filter(c => ['modif','faire','envoyer'].includes(batEtape(c))).length;
  if ($('bat-n')) $('bat-n').textContent = n || '';
  const ligne = (c, e) => '<div class="cand"><div><a href="#" data-bat-open="'+esc(c.cle)+'"><b>'+esc(c.client)+'</b></a> <span class="sub">'+esc(c.n_devis||'')+'</span>'
    + '<div class="sub">'+(c.date_livraison ? 'Livraison '+fdate(c.date_livraison)+(enRetard(c)?' ⏰':'') : 'Sans date')+(c.affectation?' · '+esc(c.affectation):'')
    + (e === 'client' || e === 'modif' ? ' · envoyé le '+new Date(c.bat_envoye_le).toLocaleDateString('fr-FR')+(c.bat_envoye_par?' par '+esc(c.bat_envoye_par):'') : '')+'</div>'
    + (e === 'envoyer' && c.bat_auto_le ? '<div><span class="esp bd" style="background:#ede9fe;color:#5b21b6">🤖 BAT créé automatiquement le '+new Date(c.bat_auto_le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' : à vérifier avant envoi</span></div>' : '')
    + ((e === 'envoyer' || e === 'client') && c.bat_alertes ? '<div><span class="why r">⚠ Visuel trop grand : '+esc(c.bat_alertes.join(' · '))+'</span></div>' : '')
    + (e === 'faire' && c.bat_auto_erreur ? '<div><span class="why r" title="'+esc(c.bat_auto_erreur)+'">⚠ BAT automatique impossible : '+esc(c.bat_auto_erreur.slice(0, 80))+'</span></div>' : '')
    + batReponseHtml(c)+'</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">'
    + (e === 'envoyer' || e === 'modif' ? '<a class="btn" href="/gestion/bat/'+encodeURIComponent(c.cle)+'" target="_blank" rel="noopener" title="Refaire le BAT avec le générateur">🎨</a>' : '')
    + (e === 'envoyer' && c.bat_auto_le ? '<button class="btn" data-bat-auto="'+esc(c.cle)+'" title="Recréer le BAT automatique (remplace le brouillon)">🤖</button>' : '')
    + (e === 'envoyer' ? '<button class="btn" data-bat-open="'+esc(c.cle)+'">Voir le BAT</button><button class="btn primary" data-bat-send="'+esc(c.cle)+'">📨 Envoyer au client</button><button class="btn" data-bat-env="'+esc(c.cle)+'" data-v="1" title="Déjà envoyé autrement">✓ Déjà envoyé</button>' : '')
    + (e === 'client' ? '<button class="btn pink" data-bat-ok="'+esc(c.cle)+'">✅ Validé</button><button class="btn" data-bat-send="'+esc(c.cle)+'" title="Renvoyer le BAT">📨</button><button class="btn" data-bat-env="'+esc(c.cle)+'" data-v="0" title="Annuler « envoyé »">↩</button>' : '')
    + (e === 'faire' ? '<button class="btn" data-bat-auto="'+esc(c.cle)+'" title="Créer le BAT automatiquement (positions par défaut)">🤖 Auto</button><a class="btn primary" href="/gestion/bat/'+encodeURIComponent(c.cle)+'" target="_blank" rel="noopener">🎨 Générer le BAT</a><button class="btn" data-bat-open="'+esc(c.cle)+'">Ouvrir le dossier</button>' : '')
    + (e === 'modif' ? '<button class="btn" data-bat-open="'+esc(c.cle)+'">Voir le BAT</button><button class="btn primary" data-bat-send="'+esc(c.cle)+'">📨 Renvoyer le BAT corrigé</button><button class="btn" data-bat-ok="'+esc(c.cle)+'" title="Valider quand même">✅</button>' : '')
    + (e === 'formulaire' ? '<button class="btn" data-form="'+esc(c.cle)+'">📝 Remplir le formulaire</button>' : '')
    + '</div></div>';
  $('batbox').innerHTML = '<div class="tools" style="margin:10px 0"><a class="btn" href="/gestion/bat/vierge" target="_blank" rel="noopener" title="BAT à remplir à la main, sans commande">📄 BAT vierge</a><div class="note" style="flex:1">Commandes <b>PAYÉE</b> et <b>EN COMMANDE</b> (et sans statut ou EN DEVIS dès que le formulaire est reçu), de la livraison la plus urgente à la plus lointaine. Dès que le formulaire arrive, le BAT est créé automatiquement (🤖) : vérifie-le, retouche-le si besoin avec 🎨, puis envoie-le.</div><button class="btn" id="bat-scan">↻ Relire les dossiers</button></div>'
    + G.map(([k, t, d]) => { const l = rows.filter(c => batEtape(c) === k); if (!l.length && (k === 'inconnu' || k === 'formulaire')) return '';
      return '<div class="card" style="margin-bottom:12px"><h3>'+t+' · '+l.length+'</h3><div class="note" style="margin-bottom:6px">'+d+'</div>'+(l.length ? l.map(c => ligne(c, k)).join('') : '<div class="ok-empty">✅ Rien ici</div>')+'</div>'; }).join('');
}
// Formulaire client prérempli, ouvert dans un nouvel onglet (fenêtre ouverte tout de suite : pas de blocage de pop-up)
async function ouvrirFormulaire(cle){
  const w = window.open('about:blank', '_blank');
  try {
    const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(cle)+'/lien-formulaire'); const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Erreur');
    if (w) w.location.href = j.url; else location.href = j.url;
  } catch(e){ if (w) w.close(); alert('Lien indisponible : ' + e.message); }
}
function batReponseHtml(c){
  const r = c && c.bat_reponse; if (!r) return '';
  const coul = r.verdict === 'valide' ? '#dcfce7;color:#166534' : r.verdict === 'modification' ? '#fee2e2;color:#991b1b' : '#fef3c7;color:#92400e';
  const lib = r.verdict === 'valide' ? '✅ Validé' : r.verdict === 'modification' ? '✏️ Modification demandée' : '💬 Réponse à lire';
  return '<div style="margin-top:6px;padding:6px 10px;border-radius:8px;background:'+coul+';font-size:13px"><b>'+lib+'</b> par '+(r.canal === 'mail' ? 'mail' : 'WhatsApp')+' le '+new Date(r.le).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' : « '+esc(r.message)+' »</div>';
}
async function batClic(e){
  const f = e.target.closest('[data-form]'); if (f) { e.preventDefault(); return ouvrirFormulaire(f.dataset.form); }
  const au = e.target.closest('[data-bat-auto]');
  if (au) {
    e.preventDefault(); au.disabled = true; au.textContent = '🤖 Création…';
    try { await post('/gestion/api/commandes/'+encodeURIComponent(au.dataset.batAuto)+'/bat-auto'); await post('/gestion/api/bat/actualiser'); await charger(false); }
    catch(err){ alert('BAT automatique impossible : ' + err.message); au.disabled = false; au.textContent = '🤖 Auto'; }
    return;
  }
  const t = e.target.closest('[data-bat-open],[data-bat-env],[data-bat-ok],[data-bat-send],#bat-scan'); if (!t) return;
  e.preventDefault();
  const k = t.dataset.batOpen || t.dataset.batEnv || t.dataset.batOk || t.dataset.batSend;
  const c = k ? data.find(x => x.cle === k) : null;
  try {
    if (t.id === 'bat-scan') { t.disabled = true; t.textContent = '↻ Lecture…'; await post('/gestion/api/bat/actualiser'); await charger(false); return; }
    if (!c) return;
    if (t.dataset.batOpen) { panelCle = c.cle; return ouvrir(c.cle); }
    if (t.dataset.batSend) {
      if (!confirm('Envoyer le BAT à '+c.client+' ?\\n\\n📧 Par mail : '+(c.email || 'aucune adresse')+'\\n💬 Par WhatsApp (numéro de Leïla) : '+(c.telephone ? fphone(c.telephone)+', si le client a écrit dans les dernières 24 h' : 'aucun numéro'))) return;
      t.disabled = true; const old = t.textContent; t.textContent = 'Envoi…';
      try {
        const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/bat-envoyer', {});
        if (j.commande) majLocale(c, j.commande);
        const l = [j.mail ? (j.mail.ok ? '📧 Mail envoyé à '+j.mail.a : '📧 Mail non envoyé : '+j.mail.raison) : '', j.whatsapp ? (j.whatsapp.ok ? '💬 WhatsApp envoyé' : '💬 WhatsApp non envoyé ('+j.whatsapp.raison+')'+(j.mail && j.mail.ok ? ' : BAT envoyé par mail uniquement' : '')) : ''].filter(Boolean);
        alert('✅ BAT envoyé\\n\\n'+l.join('\\n'));
        afficher(); if (panelCle === c.cle) ouvrir(c.cle);
      } catch(err){ alert('❌ ' + err.message); t.disabled = false; t.textContent = old; }
      return;
    }
    if (t.dataset.batEnv) {
      t.disabled = true;
      const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/bat-envoye', { envoye: t.dataset.v === '1' });
      majLocale(c, j.commande); afficher(); if (panelCle === c.cle) ouvrir(c.cle); return;
    }
    if (t.dataset.batOk) {
      const enCommande = statutKey(c.statut) === 'EN COMMANDE';
      if (!confirm(c.client+' a validé son BAT ?' + (enCommande ? ' La commande reste EN COMMANDE.' : ' La commande passe en VALIDÉE.'))) return;
      t.disabled = true;
      const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/bat-valide', {});
      if (j.commande) majLocale(c, j.commande); await charger(false); if (panelCle === c.cle) ouvrir(c.cle); return;
    }
  } catch(err){ alert(err.message); t.disabled = false; }
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
    $('d-go').disabled = true; msg('Création en cours (dossier, visuels, tailles)… cela peut prendre 30 secondes', 'info');
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
    + (st !== 'A EXPEDIER' && st !== 'EXPÉDIÉE' ? '<button class="btn" data-st="A EXPEDIER">📦 À expédier</button>' : '')
    + (st === 'A EXPEDIER' ? '<button class="btn" data-st="EXPÉDIÉE">🚚 Expédiée</button>' : '')
    + (st !== 'LIVRÉE' ? '<button class="btn pink" data-st="LIVRÉE">🏁 Livrée</button>' : '')
    + '</div><div class="actions">'
    + '<div class="field"><label>Statut</label><select id="c-statut">'+STATUTS.map(x => '<option'+(x===st?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'
    + '<div class="field"><label>Affectation</label><select id="c-aff"><option value="">— Non affectée —</option>'+pers.map(x => '<option'+(x===c.affectation?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div>'
    + '<div class="field"><label>Planche</label><select id="c-planche"><option value="">—</option>'+[...new Set(PLANCHE_ETATS.concat(c.planche ? [c.planche] : []))].map(x => '<option'+(x===c.planche?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></div>'
    + '<div class="field"><label>Zone de flocage</label><input id="c-zone" value="'+esc(c.zone_flocage||'')+'"></div>'
    + '<div class="field"><label>E-mail du client</label><input id="c-email" type="email" value="'+esc(c.email||'')+'" placeholder="client@exemple.fr"></div>'
    + '<div class="field"><label>Téléphone du client</label><input id="c-tel" type="tel" value="'+esc(c.telephone ? fphone(c.telephone) : '')+'" placeholder="0690 12 34 56"></div>'
    + '<div class="field"><label>N° de suivi La Poste</label><input id="c-suivi" value="'+esc(c.numero_suivi||'')+'" placeholder="ex. 8J0231167048"></div>'
    + '<div class="field" style="grid-column:1/-1"><label>Remarque</label><input id="c-rem" value="'+esc(c.remarque||'')+'" placeholder="ex. client passe jeudi après-midi"></div>'
    + '</div><div class="espbox"><b>💵 Paiement en espèces à la remise</b>'
    + (c.a_payer_especes
        ? '<span class="esp">Noté'+(c.montant_especes!=null?' · '+montantFr(c.montant_especes):'')+(c.especes_note_par?' par '+esc(c.especes_note_par):'')+'</span><button class="btn" id="esp-off">Retirer</button>'
        : '<input type="text" id="esp-montant" placeholder="Montant (facultatif)" inputmode="decimal"><button class="btn" id="esp-on">Le client paiera en espèces</button>')
    + '</div><div class="btnrow"><button class="btn primary" id="c-save">Enregistrer</button><button class="btn" id="cash-btn">💵 Payé en espèces</button>'+(['PAYÉE','EN DEVIS','SANS STATUT'].includes(statutKey(c.statut)) ? '<button class="btn" data-form="'+esc(c.cle)+'" title="Ouvre le formulaire client prérempli pour le remplir à sa place">📝 Remplir le formulaire</button>' : '')+'<button class="btn pink" id="dup-btn">⧉ Dupliquer la commande…</button><button class="btn" id="c-suppr" style="margin-left:auto;color:#b91c1c">🗑 Supprimer</button></div><div class="msg" id="a-msg"></div></div>';
}
function brancherCmd(c){
  const envoyer = async body => {
    if (body.statut === 'LIVRÉE' && !confirm('Passer la commande '+(c.n_devis||c.client)+' en LIVRÉE ?\\nElle passera dans l\\'historique cette nuit (elle reste consultable ici).')) return;
    document.querySelectorAll('#pbody .btn').forEach(b => b.disabled = true);
    msg('Enregistrement…', 'info');
    try {
      const j = await post('/gestion/api/commandes/'+encodeURIComponent(c.cle)+'/modifier', body);
      if (j.commande) majLocale(c, j.commande);
      afficher();
      await ouvrir(c.cle);
      msg('✅ Enregistré' + (j.commande && j.commande.dossier_info ? '<br>' + esc(j.commande.dossier_info) : ''), 'ok');
    } catch(e){ msg('❌ ' + esc(e.message), 'err'); document.querySelectorAll('#pbody .btn').forEach(b => b.disabled = false); }
  };
  document.querySelectorAll('#pbody [data-st]').forEach(b => b.onclick = () => envoyer({ statut: b.dataset.st }));
  $('dup-btn').onclick = () => dupliquerUI(c);
  document.querySelectorAll('#pbody [data-form]').forEach(b => b.onclick = () => ouvrirFormulaire(c.cle));
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
    v('c-email', 'email', c.email);
    if ($('c-tel').value.replace(/\\D/g, '') !== (c.telephone ? fphone(c.telephone) : '').replace(/\\D/g, '')) body.telephone = $('c-tel').value.trim();
    if (!Object.keys(body).length) return msg('Aucune modification', 'info');
    envoyer(body);
  };
}
function livBox(c){
  return '<div class="k">Livraison prévue '+(c.date_livraison_manuelle?'<span class="manual">✏️ manuelle</span>':'')+'</div>'
    + '<div class="dliv"><input type="date" id="dliv" value="'+esc(c.date_livraison||'')+'"><button class="btn" onclick="saveLiv(\\''+esc(c.cle)+'\\')">Enregistrer</button>'
    + (c.date_livraison_manuelle ? '<button class="btn" onclick="saveLiv(\\''+esc(c.cle)+'\\',true)" title="Revenir à la date calculée (commande + 7 jours)">↺ Date autoel</button>' : '') + '</div>'
    + (c.date_livraison_manuelle ? '<div class="note">Par '+esc(c.date_livraison_modifiee_par||'?')+(c.date_livraison_modifiee_le?' le '+new Date(c.date_livraison_modifiee_le).toLocaleDateString('fr-FR'):'')+' · auto : '+(fdate(c.date_livraison_excel)||'—')+'</div>' : '');
}
async function saveLiv(cle, reset){
  const c = data.find(x => x.cle === cle); if (!c) return;
  const v = reset ? null : $('dliv').value;
  if (!reset && !v) return alert('Choisis une date');
  try{
    const r = await fetch('/gestion/api/commandes/'+encodeURIComponent(cle)+'/livraison', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({date: v})});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Erreur');
    majLocale(c, j.commande);
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
  $('chips').addEventListener('change', e => { if (e.target.id === 'f-sel') { filtre = e.target.value; afficher(); } });
  let th; $('q').addEventListener('input', e => { recherche = e.target.value; clearTimeout(th); th = setTimeout(modeHisto ? chargerHisto : afficher, modeHisto ? 350 : 150); });
  const onglet = m => {
    modeHisto = m === 'histo'; modeBat = m === 'bat';
    $('tab-cours').classList.toggle('on', m === 'cours'); $('tab-histo').classList.toggle('on', modeHisto); $('tab-bat').classList.toggle('on', modeBat);
    document.querySelector('#v-commandes .tablewrap').style.display = modeBat ? 'none' : ''; $('chips').style.display = modeBat ? 'none' : ''; $('batbox').style.display = modeBat ? '' : 'none';
    if (modeHisto) chargerHisto(); else afficher();
  };
  $('nv-cmd').onclick = nouvelleCommande;
  $('tab-cours').onclick = () => onglet('cours'); $('tab-histo').onclick = () => onglet('histo'); $('tab-bat').onclick = () => onglet('bat');
  if (BAT_SEUL || location.hash === '#bat') {
    // Page BAT : uniquement le suivi des BAT
    onglet('bat');
    ['tab-cours','tab-histo','tab-bat','nv-cmd'].forEach(id => { if ($(id)) $(id).style.display = 'none'; });
    if ($('q')) $('q').style.display = 'none';
    const t = document.querySelector('#v-commandes .tools'); if (t) t.insertAdjacentHTML('afterbegin', '<h2 class="titre-page">BAT</h2>');
  } else if ($('tab-bat')) $('tab-bat').style.display = 'none';
  $('batbox').addEventListener('click', batClic);
  if (location.hash === '#historique') onglet('histo');
} else if (VIEW === 'leila') {
  leiEvents();
} else if (VIEW === 'admin') {
  adEvents();
} else if (VIEW === 'caisse') {
  csEvents();
} else if (VIEW === 'heures') {
  hrEvents();
} else if (VIEW === 'stock') {
  { let tq; $('q').addEventListener('input', e => { recherche = e.target.value; clearTimeout(tq); tq = setTimeout(afficher, 150); }); }
  stEvents();
} else if (VIEW === 'planches') {
  $('rows').addEventListener('click', e => {
    const x = e.target.closest('[data-del]');
    if (x) { const p = planches.find(z => z.cle === x.closest('tr.row').dataset.k); if (p) { x.disabled = true; supprimerPl(p).finally(() => { x.disabled = false; }); } return; }
    const a = e.target.closest('a.open'); if (a){ e.preventDefault(); panelCle = a.closest('tr.row').dataset.k; ouvrirPlanche(panelCle); } });
  $('rows').addEventListener('change', e => { if (e.target.matches('select.inl')) saveInline(e.target); });
  $('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b){ filtre = b.dataset.f; afficher(); } });
  $('chips').addEventListener('change', e => { if (e.target.id === 'f-sel') { filtre = e.target.value; afficher(); } });
  $('plkpis').addEventListener('click', e => { const a = e.target.closest('.kpi'); if (a){ e.preventDefault(); filtre = a.dataset.f; afficher(); } });
  { let tq; $('q').addEventListener('input', e => { recherche = e.target.value; clearTimeout(tq); tq = setTimeout(afficher, 150); }); }
  chargerAuto();
  $('nouvelle').addEventListener('click', nouvellePlanche);
} else {
  $('prios').addEventListener('click', e => { const p = e.target.closest('.prio'); if (p){ panelCle = p.dataset.k; ouvrir(panelCle); } });
}
$('refresh').addEventListener('click', () => charger(true));
$('overlay').addEventListener('click', fermer); $('pclose').addEventListener('click', fermer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
if (VIEW === 'admin' || VIEW === 'heures') chargerListes().finally(() => charger(false));
else Promise.allSettled([chargerListes(), charger(false)]).then(() => { try { if (Array.isArray(data) && data.length) afficher(); } catch(e){} });
// Compteurs du menu sur les pages qui ne chargent pas les commandes
if (!['accueil','commandes','planches'].includes(VIEW)) fetch('/gestion/api/commandes').then(r => r.json()).then(j => { if (j && j.commandes) { data = j.commandes; navCompteurs(); } }).catch(() => {});
// Actualisation automatique (pas sur Admin ni Heures : elle effacerait une saisie en cours)
if (VIEW !== 'admin' && VIEW !== 'heures') setInterval(() => { if (!document.hidden) charger(false, true); }, 120000);
</script>
</body>
</html>`;
}

module.exports = { render };
