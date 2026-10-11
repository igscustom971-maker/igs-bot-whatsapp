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
const NUMEROS_IGS = new Set(['590690691863', ...String(process.env.IGS_TELEPHONES || '').split(',').map(norm).filter(Boolean)]);
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
    const n = norm(m[0]);
    if (!n || n.length < 11 || n.length > 12 || NUMEROS_IGS.has(n)) continue;
    const dom = /^(590(590|690|691|694)|596(596|696|697)|594(594|694)|262(262|692|693))\d{6}$/.test(n);
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
            if (cellule && norm(cellule[1])) nums = [norm(cellule[1])];
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
        for (const c of data || []) { const n = norm(c.telephone); if (n && !NUMEROS_IGS.has(n)) ajoute(c.n_devis, c.client, n, 'formulaire de commande (dashboard)'); }
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
      const lignes = [];
      for (const fi of fiches.values()) {
        const actuel = norm(fi.partner.phone || '');
        // Le numéro trouvé dans le plus de sources passe en premier ; s'il est nettement devant, il est retenu
        const nums = [...fi.numeros.keys()].sort((a, b) => fi.numeros.get(b).length - fi.numeros.get(a).length);
        const net = nums.length > 1 && fi.numeros.get(nums[0]).length > fi.numeros.get(nums[1]).length;
        let statut;
        if (actuel && nums.includes(actuel)) statut = 'deja_ok';
        else if (actuel) statut = 'different';
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
      await ecrire({ le: new Date().toISOString(), par: user, duree_s: Math.round((Date.now() - t0) / 1000), dossiers: etat.progression.total, pdf: etat.progression.pdf, mails: etat.progression.mails || 0, resume, lignes, introuvables: introuvables.slice(0, 200), sansNumero: sansNumeroFinal.slice(0, 300), illisibles: illisibles.slice(0, 100) });
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
    if (!l || !['a_ajouter', 'plusieurs'].includes(l.statut) || !l.numeros.some(n => n.numero === c.numero)) { out.ignores++; continue; }
    try {
      const p = await odoo.readPartner(l.partnerId);
      if (!p) { out.ignores++; out.details.push(`${l.client} : fiche introuvable`); continue; }
      if (p.phone && String(p.phone).trim()) { out.ignores++; l.statut = norm(p.phone) === c.numero ? 'deja_ok' : 'different'; l.telephoneOdoo = p.phone; continue; }
      const phone = odoo.formatTel(c.numero);
      await odoo.ecrirePartner(l.partnerId, { phone });
      l.statut = 'ajoute'; l.telephoneOdoo = phone;
      out.ajoutes++;
      if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'odoo_telephone_ajoute', cle: `partner-${l.partnerId}`, details: { client: l.client, partner_id: l.partnerId, telephone: phone, source: 'BAT / commandes' } });
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

module.exports = { analyser, appliquer, rapport, _test: { numerosDans, textePdf } };
