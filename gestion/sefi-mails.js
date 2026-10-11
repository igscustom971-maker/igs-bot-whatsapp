// ============================================
// IGS GESTION - MAILS DE SEFI (tâche « sefi_mails »)
// Quand SEFI écrit à contact@ (rupture, remplacement de couleur, délai…), Leïla le résume à Ismaël sur WhatsApp,
// avec la ou les commandes probablement concernées (d'après les derniers bons de commande envoyés).
// Ismaël répond à Leïla (« ok on fait comme ça ») : elle prépare la réponse à SEFI et la remarque sur la commande,
// et n'envoie qu'après son « oui » (voir assistant-ismael.js, outils mails_sefi / preparer_reponse_sefi).
// ============================================

const g = require('./graph');
const { supabase } = require('./db');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const SEFI_EMAIL = (process.env.SEFI_EMAIL || 'sefi2@orange.fr').toLowerCase();
const MODELE = process.env.SEFI_MAILS_MODELE || process.env.PLANCHES_MODELE || 'claude-haiku-4-5';
const texte = html => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
// Expéditeur reconnu : uniquement l'adresse exacte de SEFI (SEFI_EMAIL, plusieurs possibles séparées par des virgules)
const SEFI_ADRESSES = new Set([SEFI_EMAIL, ...String(process.env.SEFI_EMAILS_AUTRES || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)]);
const estSefi = adr => SEFI_ADRESSES.has(String(adr || '').trim().toLowerCase());
// On garde le message de SEFI, pas tout l'historique cité en dessous (« De : … Envoyé : … », « Le … a écrit : »)
const sansCitation = t => String(t).split(/\n\s*(?:-{2,}\s*Message d'origine|De\s*:.*\n\s*Envoy[ée]\s*:|From\s*:.*\n\s*Sent\s*:|Le .{5,80} a [ée]crit\s*:)/i)[0].trim();

async function reglage(cle, defaut = null) {
  if (!supabase) return defaut;
  const { data } = await supabase.from('gestion_reglages').select('valeur').eq('cle', cle).maybeSingle();
  return data ? data.valeur : defaut;
}
async function setReglage(cle, valeur) {
  if (supabase) await supabase.from('gestion_reglages').upsert({ cle, valeur: String(valeur), updated_at: new Date().toISOString() });
}
async function recents() {
  try { return JSON.parse((await reglage('sefi_mails_recents', '[]')) || '[]'); } catch { return []; }
}
async function setRecents(liste) { await setReglage('sefi_mails_recents', JSON.stringify(liste.slice(-15))); }

// Commandes chez SEFI ces 10 derniers jours (lots envoyés) + commandes EN COMMANDE : contexte pour relier le mail
async function contexteCommandes() {
  const lignes = [];
  if (supabase) {
    const { data } = await supabase.from('gestion_actions').select('cree_le, details').eq('action', 'bdc_sefi_envoye').gte('cree_le', new Date(Date.now() - 10 * 86400e3).toISOString()).order('cree_le', { ascending: false }).limit(15);
    for (const a of data || []) for (const c of a.details?.contenu || []) lignes.push(`${c.devis} – ${c.client} (lot du ${new Date(a.cree_le).toLocaleDateString('fr-FR')}) : ${(c.articles || []).join(', ')}`);
  }
  try {
    const { rows } = await require('./commandes').listCommandes();
    for (const r of rows.filter(x => /EN COMMANDE/i.test(x.statut || ''))) if (!lignes.some(l => l.startsWith(`${r.n_devis} `))) lignes.push(`${r.n_devis} – ${r.client} (EN COMMANDE) : ${String(r.infos || '').replace(/\s*\r?\n\s*/g, ' / ').slice(0, 120)}`);
  } catch {}
  return lignes.slice(0, 40);
}

const SYSTEME = `Tu lis un mail du fournisseur de textile SEFI adressé à IGS CUSTOM BAR (atelier de personnalisation en Guadeloupe) et tu le résumes pour Ismaël, le gérant.
Réponds uniquement avec un objet JSON : resume (1 à 3 phrases claires : ce que dit SEFI, ex. « plus de rouge en M, propose du jaune à la place »), demande_reponse (true si SEFI attend une décision ou une réponse), devis (liste des n° de devis IGS probablement concernés, choisis UNIQUEMENT dans la liste fournie d'après les références, couleurs et tailles ; [] si impossible à dire), question (la décision à prendre par Ismaël en une phrase, ou "").`;

async function analyser(m, corps, contexte) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY non configurée');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELE, max_tokens: 500, system: SYSTEME, messages: [{ role: 'user', content: `Objet : ${m.subject || ''}\nMail de SEFI :\n${corps.slice(0, 3000)}\n\nCommandes passées récemment chez SEFI :\n${contexte.join('\n') || '(aucune connue)'}` }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Claude : ${j.error?.message || res.status}`);
  const t = (j.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

// Prévenir Ismaël : branché par server.js (WhatsApp, repli mail)
const fournisseurs = { envoyerAIsmael: null };

async function relever() {
  if (!supabase) return 'base non configurée';
  const depuisR = await reglage('sefi_mails_depuis');
  if (!depuisR) { await setReglage('sefi_mails_depuis', new Date().toISOString()); return 'démarrage : les mails de SEFI reçus à partir de maintenant seront signalés'; }
  const vus = new Set(JSON.parse((await reglage('sefi_mails_vus', '[]')) || '[]'));
  const u = `/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox/messages`;
  const q = `?$filter=${encodeURIComponent(`receivedDateTime ge ${depuisR}`)}&$orderby=receivedDateTime%20asc&$top=30&$select=id,subject,from,receivedDateTime,body,conversationId`;
  const r = await g.graph(u + q);
  let dernier = depuisR, n = 0;
  const liste = await recents();
  for (const m of r.value || []) {
    dernier = m.receivedDateTime > dernier ? m.receivedDateTime : dernier;
    if (vus.has(m.id)) continue;
    vus.add(m.id);
    const exp = m.from?.emailAddress?.address;
    if (!estSefi(exp)) continue;
    const corps = sansCitation(texte(m.body?.content));
    let a;
    try { a = await analyser(m, corps, await contexteCommandes()); }
    catch (err) { console.error('Mails SEFI : analyse impossible', err.message); a = { resume: corps.slice(0, 300), demande_reponse: true, devis: [], question: '' }; }
    const item = { id: m.id, recu: m.receivedDateTime, de: exp, sujet: String(m.subject || '').slice(0, 150), texte: corps.slice(0, 2000), resume: String(a.resume || '').slice(0, 500), devis: Array.isArray(a.devis) ? a.devis.slice(0, 5) : [], demande_reponse: a.demande_reponse !== false, traite: false };
    liste.push(item);
    // Clients des devis cités
    let clients = '';
    try { const { rows } = await require('./commandes').listCommandes(); clients = item.devis.map(d => { const c = rows.find(x => x.n_devis === d); return c ? `${d} (${c.client})` : d; }).join(', '); } catch { clients = item.devis.join(', '); }
    const msg = `📩 *SEFI a écrit* (${new Date(m.receivedDateTime).toLocaleTimeString('fr-FR', { timeZone: 'America/Guadeloupe', hour: '2-digit', minute: '2-digit' })}) :\n${item.resume}`
      + (clients ? `\nCommande(s) concernée(s) : ${clients}` : '')
      + (a.question ? `\n\n❓ ${a.question}` : '')
      + (item.demande_reponse ? '\nDis-moi ce que je leur réponds (ex. « ok on fait comme ça ») : je te montre la réponse avant de l\'envoyer.' : '');
    try {
      if (fournisseurs.envoyerAIsmael) await fournisseurs.envoyerAIsmael(msg, 'Mail de SEFI');
      require('./assistant-ismael').noter(msg);
    } catch (err) { console.error('Mails SEFI : Ismaël non prévenu', err.message); }
    await supabase.from('gestion_actions').insert({ utilisateur: 'Leïla (SEFI)', action: 'sefi_mail_recu', cle: item.devis.join(',') || null, details: { sujet: item.sujet, resume: item.resume } }).then(() => {}, () => {});
    n++;
  }
  await setRecents(liste);
  await setReglage('sefi_mails_depuis', dernier);
  await setReglage('sefi_mails_vus', JSON.stringify([...vus].slice(-200)));
  return n ? `${n} mail(s) de SEFI signalé(s) à Ismaël` : 'aucun nouveau mail de SEFI';
}

// Réponse à SEFI (dans le fil du mail, depuis contact@) + remarques sur les commandes ; mail marqué traité
async function repondre(id, reponse, remarques = [], par = 'Ismaël (WhatsApp)') {
  const liste = await recents();
  const item = liste.find(x => x.id === id);
  if (!item) throw new Error('mail de SEFI introuvable');
  if (reponse) {
    const esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    await g.gPost(`/users/${encodeURIComponent(MAILBOX)}/messages/${encodeURIComponent(id)}/reply`, { comment: `<div style="font-family:Arial,sans-serif;font-size:14px">${esc(reponse).replace(/\n/g, '<br>')}<br><br>Cordialement,<br>IGS CUSTOM BAR</div>` });
  }
  const faits = [];
  const commandes = require('./commandes');
  const { rows } = await commandes.listCommandes();
  for (const r of remarques) {
    const c = rows.find(x => x.cle === r.cle || x.n_devis === r.cle);
    if (!c || !r.texte) continue;
    await commandes.modifier(c.cle, { remarque: [String(c.remarque || '').trim(), r.texte.trim()].filter(Boolean).join(' | ').slice(-500) }, par);
    faits.push(c.n_devis);
  }
  item.traite = true; item.reponse = reponse || null; item.traite_le = new Date().toISOString();
  await setRecents(liste);
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: par, action: 'sefi_mail_repondu', cle: faits.join(',') || null, details: { sujet: item.sujet, reponse, remarques } }).then(() => {}, () => {});
  return { repondu: !!reponse, remarques: faits };
}

module.exports = { relever, recents, repondre, fournisseurs, _test: { estSefi, sansCitation } };
