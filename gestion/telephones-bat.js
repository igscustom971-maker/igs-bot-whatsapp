// ============================================
// IGS GESTION - NUMÉROS CLIENTS DANS ODOO À PARTIR DES BAT ET DES COMMANDES
// Analyse (sans rien modifier) : chaque dossier de commande (Clients/Commandes et ARCHIVES) est lu, le texte des
// PDF (BAT, formulaires…) est extrait pour y trouver le numéro du client, et les commandes enregistrées dans le
// dashboard (téléphone du formulaire) sont ajoutées. Chaque numéro est rapproché de la fiche Odoo (client du devis).
// Application : uniquement sur les fiches Odoo SANS téléphone. Un numéro existant n'est jamais écrasé : les
// différences sont listées pour vérification à la main.
// ============================================

const g = require('./graph');
const cfg = require('./config');
const odoo = require('./odoo');
const commandes = require('./commandes');
const { supabase } = require('./db');

const CLE = 'odoo_telephones_rapport';
const norm = commandes.normalizePhone;
// Numéros d'IGS (pied de page des BAT, signatures) : jamais pris pour celui d'un client
// + le numéro perso d'Ismaël (souvent mis sur les commandes) et le faux numéro de saisie
const NUMEROS_IGS = new Set(['590690691863', '590690955977', process.env.RECAP_PHONE_NUMBER, ...String(process.env.IGS_TELEPHONES || '').split(',')].map(x => norm(x)).filter(Boolean));

// Numéro remis au bon format international, ou null s'il n'est pas plausible.
// Corrige les erreurs fréquentes : +590 sur un mobile de Martinique (0696/0697), +596 sur un mobile de Guadeloupe,
// +33 sur un numéro des Antilles, chiffre doublé (06696…), 0 en trop après l'indicatif.
function telValide(brut) {
  let d = String(brut || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  d = d.replace(/^(590|596|594|262|33)0/, '$1');                 // +590 0690… -> +590 690…
  let m;
  if ((m = d.match(/^0?6?(69[0-7]\d{6})$/))) d = m[1];          // 0690…, 06696… (6 doublé), 690…
  else if ((m = d.match(/^0(5(90|96|94)\d{6})$/))) d = m[1];   // fixe 0590 / 0596
  else if ((m = d.match(/^(?:590|596|33)(69[0-7]\d{6}|59[06]\d{6})$/))) d = m[1];
  else if ((m = d.match(/^0([1-79]\d{8})$/))) d = '33' + m[1];
  if (/^69[0-4]\d{6}$/.test(d) || /^590\d{6}$/.test(d)) d = '590' + d;  // Guadeloupe
  else if (/^69[67]\d{6}$/.test(d) || /^596\d{6}$/.test(d)) d = '596' + d; // Martinique
  if (/^(590(590|690|691|694)|596(596|696|697)|594(594|694)|262(262|692|693))\d{6}$/.test(d)) return d;
  if (/^33[1-79]\d{8}$/.test(d)) return d;
  return null;
}
const RE_TEL = /(?:(?:\+|00)\s?(?:33|590|596|594|262)[\s.\-]?(?:\(0\)\s?)?|0)[1-9](?:[\s.\-]?\d){8}/g;
const RE_DEVIS = /\bDE\s?\d{6,8}\b/i;

let etat = { enCours: false, progression: null };

async function lire() {
  if (!supabase) return null;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', CLE).maybeSingle();
  try { return data ? JSON.parse(data.valeur) : null; } catch { return null; }
}
async function ecrire(r) {
  if (!supabase) return;
  await supabase.from('gestion_reglages').upsert({ cle: CLE, valeur: JSON.stringify(r), updated_at: new Date().toISOString() });
}

// Texte d'un PDF (pdfjs, chargé à la demande)
let pdfjs = null;
async function textePdf(buf) {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  let t = '';
  for (let i = 1; i <= Math.min(doc.numPages, 4); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    t += c.items.map(x => x.str).join(' ') + '\n';
  }
  await doc.destroy().catch(() => {});
  return t;
}
// Numéros plausibles : mobiles et fixes des Antilles/Guyane/Réunion, mobiles métropole (06/07). Les fixes de
// métropole (01-05, 09) ne sont gardés que précédés de « tél », « téléphone », « portable »… (évite les faux numéros
// pris dans des références, tailles ou SIRET).
const MOT_TEL = /(t[ée]l[ée]?(phone)?|phone|portable|mobile|gsm|contact|joindre|num[ée]ro)\s*[:.]?\s*$/i;
function numerosDans(texte) {
  const t = String(texte), out = new Set();
  for (const m of t.matchAll(RE_TEL)) {
    const n = telValide(m[0]);
    if (!n || NUMEROS_IGS.has(n)) continue;
    const dom = !n.startsWith('33');
    const mobileFr = /^33[67]\d{8}$/.test(n);
    const fixeFr = /^33[1-59]\d{8}$/.test(n) && MOT_TEL.test(t.slice(Math.max(0, m.index - 30), m.index));
    if (dom || mobileFr || fixeFr) out.add(n);
  }
  return [...out];
}

async function contenu(item) {
  const r = await g.content(item.id);
  if (Buffer.isBuffer(r)) return r;
  if (r && typeof r.arrayBuffer === 'function') return Buffer.from(await r.arrayBuffer());
  return Buffer.from(r);
}

// Petit pool : n tâches à la fois
async function pool(liste, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < liste.length) { const x = liste[i++]; await fn(x); } }));
}

async function analyser(user) {
  if (etat.enCours) throw new Error('Analyse déjà en cours');
  if (!odoo.configured()) throw new Error('Odoo non configuré');
  etat = { enCours: true, progression: { dossiers: 0, total: 0, pdf: 0 } };
  (async () => {
    const t0 = Date.now();
    const sources = new Map(); // devis -> { client, numeros: Map(numero -> [sources]) , erreurs }
    const ajoute = (devis, client, numero, source) => {
      const k = devis.toUpperCase();
      if (!sources.has(k)) sources.set(k, { devis: k, client, numeros: new Map() });
      const s = sources.get(k);
      if (!s.client && client) s.client = client;
      if (!s.numeros.has(numero)) s.numeros.set(numero, []);
      if (!s.numeros.get(numero).includes(source)) s.numeros.get(numero).push(source);
    };
    const sansNumero = [], illisibles = [];
    try {
      // 1. Dossiers de commande (actifs + ARCHIVES)
      const racine = await g.itemByPath(cfg.COMMANDES_PATH);
      const top = (await g.children(racine.id)).filter(i => i.folder);
      let dossiers = top.filter(f => !/^archives?$/i.test(f.name.trim()));
      const arch = top.find(f => /^archives?$/i.test(f.name.trim()));
      if (arch) dossiers = dossiers.concat((await g.children(arch.id)).filter(i => i.folder).map(f => ({ ...f, archive: true })));
      etat.progression.total = dossiers.length;
      await pool(dossiers, 4, async f => {
        try {
          const devis = (f.name.match(RE_DEVIS) || [''])[0].replace(/\s/g, '');
          const client = String(f.name).split(/\s+-\s+/).slice(1).join(' - ').trim() || null;
          if (!devis) { sansNumero.push({ dossier: f.name, raison: 'pas de N° de devis dans le nom du dossier' }); return; }
          const pdfs = (await g.children(f.id)).filter(i => i.file && /\.pdf$/i.test(i.name) && (i.size || 0) < 15e6)
            .sort((a, b) => (/bon.?a.?tirer|^bat/i.test(b.name) ? 1 : 0) - (/bon.?a.?tirer|^bat/i.test(a.name) ? 1 : 0)).slice(0, 4);
          let trouve = false;
          for (const p of pdfs) {
            try {
              const nums = numerosDans(await textePdf(await contenu(p)));
              etat.progression.pdf++;
              for (const n of nums) { ajoute(devis, client, n, `${f.archive ? 'ARCHIVES/' : ''}${f.name}/${p.name}`); trouve = true; }
            } catch (err) { illisibles.push({ dossier: f.name, fichier: p.name, raison: err.message.slice(0, 120) }); }
          }
          if (!trouve) sansNumero.push({ dossier: f.name, devis, raison: pdfs.length ? 'aucun numéro lisible dans les PDF (BAT en image ?)' : 'aucun PDF dans le dossier' });
        } catch (err) { illisibles.push({ dossier: f.name, raison: err.message.slice(0, 120) }); }
        finally { etat.progression.dossiers++; }
      });
      // 2. Boîte contact@ : mails « Nouvelle commande - DE… » du formulaire et mails des clients citant un N° de devis
      etat.progression.etape = 'mails';
      try {
        const box = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
        const depuis = new Date(Date.now() - 730 * 86400e3).toISOString();
        let url = `/users/${encodeURIComponent(box)}/messages?$filter=receivedDateTime ge ${depuis}&$select=subject,from,body,receivedDateTime&$orderby=receivedDateTime desc&$top=100`;
        let pages = 0;
        etat.progression.mails = 0;
        while (url && pages < 60) {
          const r = await g.graph(url);
          pages++;
          for (const m of r.value || []) {
            etat.progression.mails++;
            const sujet = String(m.subject || '');
            const devis = (sujet.match(RE_DEVIS) || [''])[0].replace(/\s/g, '');
            if (!devis) continue;
            const deIgs = /@igscustom\.fr$/i.test(m.from?.emailAddress?.address || '');
            const formulaire = /^nouvelle commande/i.test(sujet);
            if (deIgs && !formulaire) continue; // nos propres réponses : seulement notre numéro et les échanges cités
            const html = String(m.body?.content || '');
            let nums = [];
            const cellule = html.match(/T[ée]l[ée]phone\s*<\/b>\s*<\/td>\s*<td>([^<]{6,40})</i);
            if (cellule && telValide(cellule[1])) nums = [telValide(cellule[1])];
            else nums = numerosDans(html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').split(/De\s*:|From\s*:|Le .{5,60} a écrit/)[0]);
            const client = formulaire ? sujet.split(/\s+-\s+/).slice(2).join(' - ') : (m.from?.emailAddress?.name || null);
            for (const n of nums) if (!NUMEROS_IGS.has(n)) ajoute(devis, client, n, `mail « ${sujet.slice(0, 60)} » du ${new Date(m.receivedDateTime).toLocaleDateString('fr-FR')}`);
          }
          url = r['@odata.nextLink'] || null;
        }
      } catch (err) { illisibles.push({ dossier: 'Boîte mail contact@', raison: err.message.slice(0, 160) }); }

      // 3. Commandes du dashboard (téléphone donné dans le formulaire), y compris l'historique
      if (supabase) {
        const { data } = await supabase.from('gestion_commandes').select('n_devis, client, telephone').not('telephone', 'is', null).not('n_devis', 'is', null).limit(5000);
        for (const c of data || []) { const n = telValide(c.telephone); if (n && !NUMEROS_IGS.has(n)) ajoute(c.n_devis, c.client, n, 'formulaire de commande (dashboard)'); }
      }
      // 4. Rapprochement avec Odoo (client du devis), regroupé par fiche client
      const fiches = new Map(); // partnerId -> { partner, numeros: Map(n -> sources), devis: [] }
      const introuvables = [];
      await pool([...sources.values()], 4, async s => {
        let p = null;
        try { p = await odoo.clientDuDevis(s.devis); } catch (err) { introuvables.push({ devis: s.devis, client: s.client, raison: err.message.slice(0, 100) }); return; }
        if (!p) { introuvables.push({ devis: s.devis, client: s.client, raison: 'devis introuvable dans Odoo' }); return; }
        if (!fiches.has(p.id)) fiches.set(p.id, { partner: p, numeros: new Map(), devis: [] });
        const fi = fiches.get(p.id);
        fi.devis.push(s.devis);
        for (const [n, src] of s.numeros) fi.numeros.set(n, [...(fi.numeros.get(n) || []), ...src.map(x => `${s.devis} · ${x}`)]);
      });
      // Un même numéro trouvé chez plusieurs clients différents = numéro de l'équipe ou faux numéro : exclu partout
      const parNumero = new Map();
      for (const fi of fiches.values()) for (const n of fi.numeros.keys()) parNumero.set(n, (parNumero.get(n) || new Set()).add(fi.partner.id));
      const exclus = [...parNumero].filter(([, ids]) => ids.size > 1).map(([n, ids]) => ({ numero: n, affiche: odoo.formatTel(n), clients: ids.size }));
      for (const fi of fiches.values()) for (const e of exclus) fi.numeros.delete(e.numero);
      const lignes = [];
      for (const fi of fiches.values()) {
        if (!fi.numeros.size && !fi.partner.phone) continue;
        const actuel = telValide(fi.partner.phone || '') || norm(fi.partner.phone || '');
        // Le numéro trouvé dans le plus de sources passe en premier ; s'il est nettement devant, il est retenu
        const nums = [...fi.numeros.keys()].sort((a, b) => fi.numeros.get(b).length - fi.numeros.get(a).length);
        const net = nums.length > 1 && fi.numeros.get(nums[0]).length > fi.numeros.get(nums[1]).length;
        let statut;
        if (actuel && nums.includes(actuel)) statut = 'deja_ok';
        else if (actuel) statut = 'different';
        else if (!nums.length) continue;
        else if (nums.length === 1 || net) statut = 'a_ajouter';
        else statut = 'plusieurs';
        lignes.push({
          partnerId: fi.partner.id, client: fi.partner.name, telephoneOdoo: fi.partner.phone || null, statut,
          numeros: nums.map(n => ({ numero: n, affiche: odoo.formatTel(n), sources: fi.numeros.get(n).slice(0, 4) })), devis: fi.devis.slice(0, 6),
        });
      }
      const sansNumeroFinal = sansNumero.filter(x => !x.devis || !sources.has(x.devis.toUpperCase()));
      const ordre = { a_ajouter: 0, plusieurs: 1, different: 2, deja_ok: 3 };
      lignes.sort((a, b) => ordre[a.statut] - ordre[b.statut] || a.client.localeCompare(b.client));
      const resume = lignes.reduce((m, l) => (m[l.statut] = (m[l.statut] || 0) + 1, m), {});
      await ecrire({ le: new Date().toISOString(), par: user, duree_s: Math.round((Date.now() - t0) / 1000), dossiers: etat.progression.total, pdf: etat.progression.pdf, mails: etat.progression.mails || 0, resume, lignes, introuvables: introuvables.slice(0, 200), exclus, sansNumero: sansNumeroFinal.slice(0, 300), illisibles: illisibles.slice(0, 100) });
      console.log(`Gestion téléphones Odoo : analyse terminée (${lignes.length} fiches, ${JSON.stringify(resume)})`);
    } catch (err) {
      console.error('Gestion téléphones Odoo (analyse) :', err.message);
      await ecrire({ le: new Date().toISOString(), par: user, erreur: err.message }).catch(() => {});
    } finally { etat = { enCours: false, progression: null }; }
  })();
  return { ok: true, lance: true };
}

// Ajoute le numéro sur les fiches choisies (statut « à ajouter », ou « plusieurs » avec le numéro choisi), jamais d'écrasement
async function appliquer(choix, user) {
  const r = await lire();
  if (!r || !r.lignes) throw new Error('Lance d\'abord une analyse');
  const out = { ajoutes: 0, ignores: 0, details: [] };
  const liste = Array.isArray(choix) && choix.length ? choix : r.lignes.filter(l => l.statut === 'a_ajouter').map(l => ({ partnerId: l.partnerId, numero: l.numeros[0].numero }));
  for (const c of liste) {
    const l = r.lignes.find(x => x.partnerId === Number(c.partnerId));
    const manuel = !!c.manuel;
    if (manuel) {
      const n = telValide(c.numero);
      if (!n) { out.ignores++; out.details.push(`${l ? l.client : c.partnerId} : numéro « ${c.numero} » invalide`); continue; }
      c.numero = n;
    }
    if (!l || (!manuel && (!['a_ajouter', 'plusieurs'].includes(l.statut) || !l.numeros.some(n => n.numero === c.numero)))) { out.ignores++; continue; }
    try {
      const p = await odoo.readPartner(l.partnerId);
      if (!p) { out.ignores++; out.details.push(`${l.client} : fiche introuvable`); continue; }
      if (p.phone && String(p.phone).trim() && !(manuel && c.remplacer)) { out.ignores++; l.statut = norm(p.phone) === c.numero ? 'deja_ok' : 'different'; l.telephoneOdoo = p.phone; continue; }
      const phone = odoo.formatTel(c.numero);
      await odoo.ecrirePartner(l.partnerId, { phone });
      l.statut = 'ajoute'; l.telephoneOdoo = phone;
      out.ajoutes++;
      if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'odoo_telephone_ajoute', cle: `partner-${l.partnerId}`, details: { client: l.client, partner_id: l.partnerId, telephone: phone, ancien: p.phone || null, source: manuel ? 'saisie manuelle' : 'BAT / commandes' } });
    } catch (err) { out.ignores++; out.details.push(`${l.client} : ${err.message.slice(0, 100)}`); }
  }
  r.resume = r.lignes.reduce((m, x) => (m[x.statut] = (m[x.statut] || 0) + 1, m), {});
  await ecrire(r);
  console.log(`Gestion téléphones Odoo : ${out.ajoutes} numéro(s) ajouté(s) par ${user}`);
  return out;
}

async function rapport() {
  return { enCours: etat.enCours, progression: etat.progression, rapport: await lire() };
}


// ---------- Clients qui commandent sur WhatsApp (sans formulaire) ----------
// Numéros qui écrivent sur WhatsApp mais absents d'Odoo, avec le client Odoo le plus probable :
// nom WhatsApp / prénom donné, planche ajoutée par Leïla pour ce numéro, ou recherche à la main.
async function whatsappNonRattaches() {
  if (!supabase) throw new Error('Base non configurée');
  if (!odoo.configured()) throw new Error('Odoo non configuré');
  const depuis = new Date(Date.now() - 548 * 86400e3).toISOString();
  const stats = new Map();
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase.from('conversations').select('phone_number, role, content, created_at').gte('created_at', depuis).order('created_at', { ascending: false }).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    for (const m of data || []) {
      const cle = telValide(m.phone_number) || String(m.phone_number);
      const st = stats.get(cle) || { numero: m.phone_number, formats: new Set(), messages: 0, dernier: m.created_at, extrait: null };
      st.messages++; st.formats.add(m.phone_number);
      if (!st.extrait && m.role === 'user' && m.content && !/^\[|^<m[ée]dias? omis>$/i.test(m.content.trim())) st.extrait = String(m.content).slice(0, 140);
      stats.set(cle, st);
    }
    if (!data || data.length < 1000) break;
  }
  const dejaOdoo = new Map();
  for (const p of await odoo.telephonesOdoo()) { const n = telValide(p.phone) || norm(p.phone); if (n) dejaOdoo.set(n, p); }
  let liste = [...stats.values()].filter(x => { const n = telValide(x.numero) || x.numero; return !NUMEROS_IGS.has(n) && !dejaOdoo.has(n); })
    .sort((a, b) => b.messages - a.messages).slice(0, 80);
  // Noms connus (nom WhatsApp ou prénom donné à Leïla)
  const noms = new Map();
  for (let i = 0; i < liste.length; i += 100) {
    const { data } = await supabase.from('clients').select('phone_number, name').in('phone_number', liste.slice(i, i + 100).flatMap(x => [...x.formats]));
    for (const c of data || []) if (c.name) for (const x of liste) if (x.formats.has(c.phone_number)) noms.set(x.numero, c.name);
  }
  // Planches ajoutées par Leïla pour ce numéro (remarque « Demande WhatsApp (Leïla) … · numéro »)
  const plParTel = new Map();
  try {
    const pl = (await require('./planches').listPlanches()).rows || [];
    for (const p of pl) { const m = String(p.remarques || '').match(/·\s*(\d{11,12})\b/); if (m) plParTel.set(m[1], p.client); }
  } catch {}
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < liste.length) {
      const x = liste[i++];
      x.nom = noms.get(x.numero) || null;
      x.valide = !!telValide(x.numero);
      x.affiche = odoo.formatTel(telValide(x.numero) || x.numero);
      const formats = [...x.formats]; delete x.formats;
      if (!x.nom) for (const f of formats) if (noms.get(f)) x.nom = noms.get(f);
      x.suggestions = [];
      const pl = formats.map(f => plParTel.get(f)).find(Boolean);
      const termes = [pl, x.nom].filter(Boolean);
      for (const t of termes) {
        try { for (const s of await odoo.searchPartners(t)) if (!x.suggestions.some(y => y.id === s.id)) x.suggestions.push({ id: s.id, nom: s.name, score: s.score, telephone: s.phone || null, via: t === pl ? 'planche WhatsApp' : 'nom WhatsApp' }); } catch {}
      }
      x.suggestions = x.suggestions.sort((a, b) => b.score - a.score).slice(0, 4);
    }
  }));
  return { numeros: liste, total: stats.size };
}

async function rattacherWhatsapp(numero, partnerId, remplacer, user) {
  const n = telValide(numero);
  if (!n) throw new Error('Numéro invalide');
  const p = await odoo.readPartner(Number(partnerId));
  if (!p) throw new Error('Client Odoo introuvable');
  if (p.phone && String(p.phone).trim() && !remplacer) throw new Error(`${p.name} a déjà le numéro ${p.phone} dans Odoo : confirme le remplacement`);
  const phone = odoo.formatTel(n);
  await odoo.ecrirePartner(p.id, { phone });
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'odoo_telephone_ajoute', cle: `partner-${p.id}`, details: { client: p.name, partner_id: p.id, telephone: phone, ancien: p.phone || null, source: 'WhatsApp' } });
  console.log(`Gestion téléphones Odoo : ${phone} (WhatsApp) rattaché à ${p.name} par ${user}`);
  return { ok: true, client: p.name, telephone: phone };
}

module.exports = { whatsappNonRattaches, rattacherWhatsapp, analyser, appliquer, rapport, telValide, _test: { numerosDans, textePdf, telValide } };
