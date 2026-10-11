// ============================================
// IGS GESTION - MODULE COMMERCIAL
// - Tableau de bord : devis en cours, à relancer, signés, reste à facturer (données Odoo)
// - Demandes de devis prises par Leïla (WhatsApp) : brouillon Odoo pré-fait, à vérifier puis envoyer
// - Relance à l'amiable d'un devis par mail (contact@), notée dans l'historique Odoo du devis
// - Facture du solde envoyée automatiquement quand une commande avec acompte passe en TERMINÉE / À EXPÉDIER
// Accès : profils admin et commercial.
// ============================================

const odoo = require('./odoo');
const g = require('./graph');
const { supabase } = require('./db');

const MAILBOX = (process.env.FORM_MAILBOX || 'contact@igscustom.fr').toLowerCase();
const RELANCE_JOURS = Number(process.env.COMMERCIAL_RELANCE_JOURS || 5); // devis sans réponse depuis N jours = à relancer
const EN_COURS_JOURS = Number(process.env.COMMERCIAL_EN_COURS_JOURS || 45); // au-delà, un devis sans réponse n'est plus « en cours »
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Odoo : « 2026-10-09 14:00:00 » (UTC sans fuseau) ; Supabase : « …+00:00 » ou « …Z »
const jours = d => { if (!d) return null; const v = String(d).replace(' ', 'T'); const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(v) || v.length <= 10 ? v : v + 'Z'); return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400e3); };

async function journal(user, action, cle, details) {
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action, cle, details }).then(() => {}, () => {});
}

// Relances déjà faites : { numero: { n, derniere } }
async function relances(numeros) {
  if (!supabase || !numeros.length) return {};
  const out = {};
  for (let i = 0; i < numeros.length; i += 150) {
    const { data } = await supabase.from('gestion_actions').select('cle, cree_le').eq('action', 'devis_relance').in('cle', numeros.slice(i, i + 150));
    for (const r of data || []) {
      const o = out[r.cle] || (out[r.cle] = { n: 0, derniere: null });
      o.n++;
      if (!o.derniere || r.cree_le > o.derniere) o.derniere = r.cree_le;
    }
  }
  return out;
}

let cache = { le: 0, data: null };
async function tableauDeBord({ force = false } = {}) {
  if (!odoo.configured()) throw new Error('Odoo non configuré');
  if (!force && cache.data && Date.now() - cache.le < 60e3) return cache.data;
  const tous = await odoo.devisCommerciaux({ jours: 180 });
  const rel = await relances(tous.map(d => d.numero));
  // Statut de la commande dans le dashboard (atelier)
  let parDevis = new Map();
  try { parDevis = new Map(((await require('./commandes').listCommandes()).rows || []).filter(c => c.n_devis).map(c => [c.n_devis.toUpperCase(), c])); } catch {}
  const enrichi = tous.map(d => {
    const r = rel[d.numero] || { n: 0, derniere: null };
    const c = parDevis.get(d.numero.toUpperCase());
    const age = jours(d.date || d.cree_le);
    const depuisRelance = r.derniere ? jours(r.derniere) : null;
    return {
      ...d, age, relances: r.n, derniere_relance: r.derniere, atelier: c ? c.statut : null,
      a_relancer: ['draft', 'sent'].includes(d.etat) && d.etat === 'sent' && age >= RELANCE_JOURS && (depuisRelance === null || depuisRelance >= RELANCE_JOURS),
    };
  });
  const tousEnCours = enrichi.filter(d => ['draft', 'sent'].includes(d.etat));
  const enCours = tousEnCours.filter(d => (d.age ?? 0) <= EN_COURS_JOURS);
  const anciens = tousEnCours.length - enCours.length;
  const signes = enrichi.filter(d => d.etat === 'sale');
  const resteAFacturer = signes.filter(d => d.facturation === 'to invoice' || (d.reste_ttc != null && d.reste_ttc > 0.5));
  const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
  const signesMois = signes.filter(d => Date.parse(String(d.date).replace(' ', 'T') + 'Z') >= debutMois.getTime());
  const il90 = Date.now() - 90 * 86400e3;
  const crees90 = enrichi.filter(d => Date.parse(String(d.cree_le).replace(' ', 'T') + 'Z') >= il90 && d.etat !== 'draft');
  const somme = l => Math.round(l.reduce((s, d) => s + (d.montant_ht || 0), 0) * 100) / 100;
  const data = {
    le: new Date().toISOString(), relance_jours: RELANCE_JOURS, en_cours_jours: EN_COURS_JOURS, anciens_masques: anciens,
    kpi: {
      en_cours: { n: enCours.length, ht: somme(enCours) },
      a_relancer: enCours.filter(d => d.a_relancer).length,
      signes_mois: { n: signesMois.length, ht: somme(signesMois) },
      transformation_90j: crees90.length ? Math.round(crees90.filter(d => d.etat === 'sale').length / crees90.length * 100) : null,
      panier_moyen_ht: signes.length ? Math.round(somme(signes) / signes.length) : null,
      reste_a_facturer: { n: resteAFacturer.length, ttc: Math.round(resteAFacturer.reduce((s, d) => s + (d.reste_ttc || 0), 0) * 100) / 100 },
    },
    en_cours: enCours,
    signes: signes.slice(0, 80),
    reste_a_facturer: resteAFacturer,
    demandes: await demandes(),
    impayes: await impayes().catch(err => { console.error('Commercial impayés :', err.message); return null; }),
  };
  if (data.impayes) data.kpi.impayes = { n: data.impayes.reduce((t, c) => t + c.n, 0), clients: data.impayes.length, a_relancer: data.impayes.filter(x => x.a_relancer).length, ttc: Math.round(data.impayes.reduce((t, x) => t + (x.reste_ttc || 0), 0) * 100) / 100 };
  cache = { le: Date.now(), data };
  return data;
}

// ---------- Demandes de devis (Leïla) ----------
async function demandes() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('gestion_demandes').select('*').in('statut', ['nouvelle', 'brouillon', 'erreur']).order('cree_le', { ascending: false }).limit(100);
  if (error) return [];
  return data || [];
}

// Nouvelle demande (Leïla) : enregistrée, puis brouillon Odoo pré-fait (client retrouvé/créé, produit, quantité)
async function nouvelleDemande(d, par = 'Leïla (WhatsApp)') {
  if (!supabase) return null;
  const row = {
    source: d.source || 'whatsapp', telephone: d.telephone || null, nom: (d.nom || '').slice(0, 120) || null, email: (d.email || '').slice(0, 160) || null,
    produit: (d.produit || '').slice(0, 120) || null, quantite: Number(d.quantite) > 0 ? Number(d.quantite) : null, zone: (d.zone || '').slice(0, 80) || null,
    details: (d.details || '').slice(0, 600) || null, statut: 'nouvelle',
  };
  // Même client, même produit dans les 6 h : on complète la demande existante plutôt que d'en créer une 2e
  const cleDoublon = row.telephone ? ['telephone', row.telephone] : row.email ? ['email', row.email] : null;
  if (cleDoublon) {
    const { data: ex } = await supabase.from('gestion_demandes').select('*').eq(cleDoublon[0], cleDoublon[1]).in('statut', ['nouvelle', 'brouillon']).gte('cree_le', new Date(Date.now() - 6 * 3600e3).toISOString()).order('cree_le', { ascending: false }).limit(1);
    if (ex && ex[0] && (!row.produit || !ex[0].produit || ex[0].produit.toLowerCase() === row.produit.toLowerCase())) {
      console.log(`Commercial : demande déjà enregistrée pour ${cleDoublon[1]} (${ex[0].devis_numero || 'sans brouillon'})`);
      return ex[0];
    }
  }
  const { data: ins, error } = await supabase.from('gestion_demandes').insert(row).select().single();
  if (error) { console.error('Commercial demande :', error.message); return null; }
  await preparerBrouillon(ins.id, par).catch(() => {});
  cache.le = 0;
  return ins;
}

async function preparerBrouillon(id, par, nom) {
  const { data: d } = await supabase.from('gestion_demandes').select('*').eq('id', id).maybeSingle();
  if (!d) throw new Error('Demande introuvable');
  if (nom && String(nom).trim() && String(nom).trim() !== d.nom) { d.nom = String(nom).trim().slice(0, 120); await supabase.from('gestion_demandes').update({ nom: d.nom }).eq('id', id); }
  if (d.devis_id) return d;
  try {
    if (!odoo.configured()) throw new Error('Odoo non configuré');
    const so = await odoo.brouillonDemande(d);
    await supabase.from('gestion_demandes').update({ statut: 'brouillon', devis_id: so.id, devis_numero: so.numero, erreur: null }).eq('id', id);
    await journal(par, 'demande_brouillon', so.numero, { demande: id, client: so.client, client_cree: so.client_cree, produit: so.produit });
    console.log(`Commercial : brouillon ${so.numero} préparé pour ${so.client}${so.produit ? ' (' + so.produit + ')' : ' (produit à choisir)'}`);
    return { ...d, statut: 'brouillon', devis_id: so.id, devis_numero: so.numero };
  } catch (err) {
    await supabase.from('gestion_demandes').update({ statut: 'erreur', erreur: err.message.slice(0, 300) }).eq('id', id);
    cache.le = 0;
    throw err;
  }
}

async function envoyerDemande(id, user) {
  const { data: d } = await supabase.from('gestion_demandes').select('*').eq('id', id).maybeSingle();
  if (!d || !d.devis_id) throw new Error('Pas de brouillon Odoo pour cette demande');
  const so = await odoo.envoyerDevisOdoo(d.devis_id);
  await supabase.from('gestion_demandes').update({ statut: 'envoye', traite_par: user, traite_le: new Date().toISOString() }).eq('id', id);
  // Leïla prévient le client sur WhatsApp (si la tâche est active et la fenêtre de 24 h ouverte)
  if ((await require('./notifications').reglage('tache_devis_whatsapp', 'off')) === 'on') {
    odoo.devisParNumero(so.name).then(x => prevenirDevisWhatsApp(x || so, user, d.telephone)).catch(err => console.error(`Commercial : WhatsApp devis ${so.name} :`, err.message));
  }
  await journal(user, 'demande_devis_envoye', so.name, { demande: id });
  cache.le = 0;
  return { ok: true, numero: so.name };
}
async function abandonnerDemande(id, user) {
  await supabase.from('gestion_demandes').update({ statut: 'abandonnee', traite_par: user, traite_le: new Date().toISOString() }).eq('id', id);
  cache.le = 0;
  return { ok: true };
}

// ---------- Relance à l'amiable ----------
async function relancer(numero, user, message) {
  const so = await odoo.devisParNumero(numero);
  if (!so) throw new Error('Devis introuvable');
  if (!['draft', 'sent'].includes(so.state)) throw new Error('Ce devis n\'est plus en attente');
  const p = await odoo.readPartner(so.partner_id[0]);
  if (!p?.email) throw new Error(`Pas d'e-mail sur la fiche Odoo de ${so.partner_id[1]}`);
  const lien = await odoo.lienPortailDevis(so.id);
  const prenom = String(p.name || '').split(/\s+/)[0];
  const texte = String(message || '').trim() || `Bonjour${prenom ? ' ' + prenom : ''},\n\nJe me permets de revenir vers vous concernant votre devis ${so.name}. Avez-vous pu en prendre connaissance ?\n\nSi vous avez la moindre question ou une modification à apporter (quantités, visuel, tailles…), n'hésitez pas à me répondre directement, je m'en occupe.\n\nBelle journée,\nL'équipe IGS CUSTOM BAR`;
  const html = `<div style="font:14px/1.6 Arial,sans-serif;color:#1E1E4B">${esc(texte).replace(/\n/g, '<br>')}${lien ? `<p style="margin:22px 0"><a href="${esc(lien)}" style="background:#FF1E8E;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Voir mon devis ${esc(so.name)}</a></p>` : ''}</div>`;
  await g.sendMail(MAILBOX, { to: p.email, subject: `Votre devis ${so.name} - IGS CUSTOM BAR`, html });
  await odoo.noteDevis(so.id, `Relance à l'amiable envoyée par mail à ${esc(p.email)} depuis le dashboard (${esc(user)}).`);
  await journal(user, 'devis_relance', so.name, { email: p.email, client: p.name });
  cache.le = 0;
  console.log(`Commercial : relance du devis ${so.name} envoyée à ${p.email} par ${user}`);
  return { ok: true, email: p.email };
}

// ---------- Devis envoyé : message WhatsApp de Leïla au client (si la fenêtre de 24 h WhatsApp est ouverte) ----------
// Ton : tutoiement / vouvoiement et prénom selon le profil du client (historique WhatsApp, note client)
function texteDevisWhatsApp(ton, numero) {
  const p = ton.prenom ? ' ' + ton.prenom : '';
  // Plusieurs tournures : le client ne reçoit pas toujours le même message
  const tu = [
    `Salut${p} ! Je viens de t'envoyer ton devis ${numero} par mail 📩 Jette un œil (pense aux spams) et dis-moi si tout te va ou s'il faut ajuster quelque chose.`,
    `Hello${p}, ton devis ${numero} est parti sur ta boîte mail ! Regarde quand tu peux et dis-moi si ça te convient, tu pourras le régler directement depuis le lien.`,
    `Coucou${p} 😊 C'est bon, ton devis ${numero} t'attend dans tes mails. Si quelque chose ne va pas (quantités, tailles…), dis-le-moi et on corrige.`,
  ];
  const vous = [
    `Bonjour${p} 👋 Votre devis ${numero} vient de vous être envoyé par mail. Pensez à jeter un œil dans vos spams, et revenez vers nous pour toute question ou modification.`,
    `Bonjour${p}, je vous ai transmis votre devis ${numero} par mail 📩 Le règlement peut se faire directement depuis le lien. Dites-moi si tout vous convient !`,
    `Bonjour${p} ! Votre devis ${numero} est dans votre boîte mail. Si vous souhaitez ajuster quelque chose, il suffit de me répondre ici.`,
  ];
  const l = ton.tu ? tu : vous;
  return l[Math.floor(Math.random() * l.length)];
}
async function prevenirDevisWhatsApp(so, user, telDemande) {
  if (!supabase || !so?.name) return { statut: 'ignore' };
  const { data: deja } = await supabase.from('gestion_actions').select('id').eq('action', 'devis_whatsapp').eq('cle', so.name).limit(1);
  if (deja && deja.length) return { statut: 'deja' };
  const norm = require('./commandes').normalizePhone;
  let tel = telDemande ? norm(telDemande) : null, nom = so.partner_id ? so.partner_id[1] : '';
  if (!tel && so.partner_id) { const p = await odoo.readPartner(so.partner_id[0]).catch(() => null); tel = p?.phone ? norm(p.phone) : null; nom = p?.name || nom; }
  if (!tel) return { statut: 'sans_numero' };
  // Fenêtre WhatsApp : le client doit avoir écrit dans les dernières 24 h (marge de 15 min)
  const { data: recents } = await supabase.from('conversations').select('created_at').eq('phone_number', tel).eq('role', 'user').gte('created_at', new Date(Date.now() - 23.75 * 3600e3).toISOString()).limit(1);
  if (!recents || !recents.length) { await journal(user, 'devis_whatsapp', so.name, { tel, statut: 'hors_fenetre' }); return { statut: 'hors_fenetre' }; }
  const notif = require('./notifications');
  const ton = await notif.profilClient(tel, nom).catch(() => ({ tu: false, prenom: '' }));
  await notif.envoyerTexteWhatsApp(tel, texteDevisWhatsApp(ton, so.name));
  await journal(user, 'devis_whatsapp', so.name, { tel, statut: 'envoye', tu: !!ton.tu });
  console.log(`Commercial : Leïla a prévenu ${tel} sur WhatsApp de l'envoi du devis ${so.name}`);
  return { statut: 'envoye' };
}
// Tâche « devis_whatsapp » : devis passés « envoyé » dans Odoo (depuis le dashboard ou directement dans Odoo)
async function devisEnvoyesWhatsapp() {
  if (!supabase) return 'base non configurée';
  const { data: r } = await supabase.from('gestion_reglages').select('valeur').eq('cle', 'devis_whatsapp_depuis').maybeSingle();
  // Premier passage : seulement les devis envoyés à partir de maintenant (pas de message pour les anciens)
  if (!r) { await supabase.from('gestion_reglages').upsert({ cle: 'devis_whatsapp_depuis', valeur: new Date().toISOString(), updated_at: new Date().toISOString() }); return 'démarrage : les devis envoyés à partir de maintenant seront signalés'; }
  const depuis = new Date(Math.max(Date.parse(r.valeur) || 0, Date.now() - 3 * 3600e3)).toISOString();
  const liste = await odoo.devisEnvoyesDepuis(depuis);
  const bilan = {};
  for (const so of liste) {
    try { const x = await prevenirDevisWhatsApp(so, 'Leïla (automatique)'); bilan[x.statut] = (bilan[x.statut] || 0) + 1; }
    catch (err) { bilan.erreur = (bilan.erreur || 0) + 1; console.error(`Commercial : WhatsApp devis ${so.name} :`, err.message); }
  }
  return liste.length ? Object.entries(bilan).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') : 'aucun devis envoyé récemment';
}

// ---------- Relance des factures impayées : J+7 amiable, J+15 ferme, J+30 dernier rappel ----------
// Le mail part de comptabilite@ avec la facture en PDF et le lien de paiement en ligne (portail Odoo)
const RELANCE_MAILBOX = (process.env.RELANCE_MAILBOX || 'comptabilite@igscustom.fr').toLowerCase();
const NIVEAUX = [
  { n: 1, jours: 7, nom: 'Relance amiable' },
  { n: 2, jours: 15, nom: 'Relance ferme' },
  { n: 3, jours: 30, nom: 'Dernier rappel' },
];
const eurFr = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const dateFr = d => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('fr-FR') : '');
// Texte d'une relance pour UN client : une ou plusieurs factures, montant total (le ton suit le niveau)
function texteRelance(niveau, fs) {
  const total = eurFr(fs.reduce((t, f) => t + (f.amount_residual || 0), 0));
  const ligne = f => `- ${f.name}${f.invoice_date ? ' du ' + dateFr(f.invoice_date) : ''}${f.invoice_date_due ? ', échéance le ' + dateFr(f.invoice_date_due) : ''} : ${eurFr(f.amount_residual)}`;
  const une = fs.length === 1, f0 = fs[0];
  const quoi = une
    ? `la facture ${f0.name}${f0.invoice_date_due ? ` (échéance le ${dateFr(f0.invoice_date_due)})` : ''} d'un montant de ${total}`
    : `les ${fs.length} factures suivantes (total ${total})`;
  const liste = une ? '' : `\n\n${fs.map(ligne).join('\n')}\n\nTotal restant dû : ${total}`;
  const pj = une ? 'la facture en pièce jointe ainsi qu\'un lien pour la régler' : 'les factures en pièce jointe ainsi qu\'un lien pour régler chacune d\'elles';
  const fin = `\n\nVous trouverez ${pj} en ligne par carte bancaire. Le virement reste bien sûr possible.\n\nCordialement,\nService comptabilité - IGS CUSTOM BAR`;
  const reste = une ? 'reste à régler à ce jour.' : 'restent à régler à ce jour :';
  if (niveau === 1) return `Bonjour,\n\nSauf erreur de notre part, ${quoi} ${reste}${liste}\n\nSi le règlement a été effectué entre-temps, merci de ne pas tenir compte de ce message.` + fin;
  if (niveau === 2) return `Bonjour,\n\nMalgré notre précédent rappel, ${quoi} ${une ? 'demeure impayée.' : 'demeurent impayées :'}${liste}\n\nNous vous remercions de bien vouloir procéder au règlement sous 8 jours, ou de nous contacter si une difficulté se présente.` + fin;
  return `Bonjour,\n\nMalgré nos relances, ${quoi} ${une ? "n'est toujours pas réglée." : "ne sont toujours pas réglées :"}${liste}\n\nCe message constitue un dernier rappel amiable : sans règlement ou prise de contact de votre part sous 8 jours, nous serons contraints d'engager une procédure de recouvrement.` + fin;
}
const SUJETS = {
  1: (n, k) => k > 1 ? `Rappel : ${k} factures à régler - IGS CUSTOM BAR` : `Rappel : facture ${n} à régler - IGS CUSTOM BAR`,
  2: (n, k) => k > 1 ? `2e relance : ${k} factures impayées - IGS CUSTOM BAR` : `2e relance : facture ${n} impayée - IGS CUSTOM BAR`,
  3: (n, k) => k > 1 ? `Dernier rappel : ${k} factures impayées - IGS CUSTOM BAR` : `Dernier rappel : facture ${n} - IGS CUSTOM BAR`,
};

async function relancesFactures(noms) {
  const out = {};
  if (!supabase || !noms.length) return out;
  for (let i = 0; i < noms.length; i += 150) {
    const { data } = await supabase.from('gestion_actions').select('cle, cree_le, details').eq('action', 'facture_relance').in('cle', noms.slice(i, i + 150));
    for (const r of data || []) {
      const o = out[r.cle] || (out[r.cle] = { niveau: 0, n: 0, derniere: null });
      o.n++; o.niveau = Math.max(o.niveau, Number(r.details?.niveau) || 1);
      if (!o.derniere || r.cree_le > o.derniere) o.derniere = r.cree_le;
    }
  }
  return out;
}
// Une carte par CLIENT : toutes ses factures impayées, le total, et UNE relance pour l'ensemble.
// Niveau de chaque facture : J+7 amiable, J+15 ferme, J+30 dernier rappel ; le ton du mail suit la facture la plus avancée.
async function impayes() {
  const fs = await odoo.facturesImpayees();
  const rel = await relancesFactures(fs.map(f => f.name));
  const parClient = new Map();
  for (const f of fs) {
    const retard = f.invoice_date_due ? jours(f.invoice_date_due) : null;
    const r = rel[f.name] || { niveau: 0, n: 0, derniere: null };
    const du = NIVEAUX.filter(x => (retard ?? -1) >= x.jours).reduce((m, x) => Math.max(m, x.n), 0);
    const x = { id: f.id, numero: f.name, date: f.invoice_date, echeance: f.invoice_date_due, total_ttc: f.amount_total, reste_ttc: f.amount_residual, partiel: f.payment_state === 'partial', origine: f.invoice_origin || null,
      retard, niveau_fait: r.niveau, relances: r.n, derniere_relance: r.derniere, a_relancer: du > r.niveau && r.niveau < 3, _f: f };
    const k = f.partner_id ? f.partner_id[0] : 0;
    if (!parClient.has(k)) parClient.set(k, { partner_id: k, client: f.partner_id ? f.partner_id[1] : '—', factures: [] });
    parClient.get(k).factures.push(x);
  }
  const clients = [...parClient.values()].map(c => {
    const fx = c.factures.sort((a, b) => (b.retard ?? -999) - (a.retard ?? -999));
    // Factures mises dans la relance : celles déjà échues (toutes si aucune ne l'est encore)
    const echues = fx.filter(x => (x.retard ?? -1) >= 0);
    const dans = echues.length ? echues : fx;
    const fait = Math.max(0, ...dans.map(x => x.niveau_fait));
    const propose = Math.min(3, Math.max(1, fait + 1));
    const brut = dans.map(x => x._f);
    const out = {
      partner_id: c.partner_id, client: c.client, n: fx.length,
      reste_ttc: Math.round(fx.reduce((t, x) => t + (x.reste_ttc || 0), 0) * 100) / 100,
      retard: fx[0].retard, niveau_fait: fait, relances: Math.max(0, ...fx.map(x => x.relances)),
      derniere_relance: fx.map(x => x.derniere_relance).filter(Boolean).sort().pop() || null,
      a_relancer: fx.some(x => x.a_relancer), niveau_propose: propose, nom_niveau: NIVEAUX.at(propose - 1).nom,
      ids: dans.map(x => x.id),
      textes: { 1: texteRelance(1, brut), 2: texteRelance(2, brut), 3: texteRelance(3, brut) },
      factures: fx.map(({ _f, ...x }) => ({ ...x, lien: odoo.lienOdoo('account.move', x.id) })),
    };
    out.texte = out.textes[propose];
    return out;
  });
  return clients.sort((a, b) => (b.a_relancer - a.a_relancer) || ((b.retard ?? -999) - (a.retard ?? -999)));
}
// Relance d'un client : un seul mail pour toutes les factures choisies (ids), total, PDF de chacune, un lien de paiement par facture
async function relancerClientImpayes(ids, user, { niveau, message } = {}) {
  const liste = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean))].slice(0, 20);
  if (!liste.length) throw new Error('Aucune facture choisie');
  const fs = [];
  for (const id of liste) fs.push(await odoo.factureRelance(id));
  const aRelancer = fs.filter(f => f.amount_residual > 0.5 && !['paid', 'in_payment'].includes(f.payment_state));
  if (!aRelancer.length) throw new Error(fs.length > 1 ? 'Ces factures sont déjà réglées' : `La facture ${fs[0].name} est déjà réglée`);
  const partenaires = new Set(aRelancer.map(f => f.partner_id && f.partner_id[0]));
  if (partenaires.size > 1) throw new Error('Une relance ne peut regrouper que les factures d\'un même client');
  const f0 = aRelancer[0];
  if (!f0.email) throw new Error(`Pas d'e-mail sur la fiche Odoo de ${f0.client} : ajoute-le dans Odoo puis réessaie`);
  const n = [1, 2, 3].includes(Number(niveau)) ? Number(niveau) : 1;
  const texte = String(message || '').trim() || texteRelance(n, aRelancer);
  const total = aRelancer.reduce((t, f) => t + (f.amount_residual || 0), 0);
  const pieces = [];
  for (const f of aRelancer) { const pdf = await odoo.pdfFacture(f.id); if (pdf) pieces.push({ name: `${f.name.replace(/[\\/:*?"<>|]/g, '-')}.pdf`, contentType: 'application/pdf', buffer: pdf }); }
  const boutons = aRelancer.filter(f => f.lien).map(f => `<a href="${esc(f.lien)}" style="display:inline-block;margin:0 8px 8px 0;background:#FF1E8E;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Payer ${esc(f.name)} · ${esc(eurFr(f.amount_residual))}</a>`).join('');
  const html = `<div style="font:14px/1.6 Arial,sans-serif;color:#1E1E4B">${esc(texte).replace(/\n/g, '<br>')}`
    + (boutons ? `<p style="margin:22px 0 14px">${boutons}</p>` : '')
    + `<p style="font-size:12px;color:#68677D">Total restant dû : ${esc(eurFr(total))}</p></div>`;
  const mail = { to: f0.email, subject: SUJETS[n](f0.name, aRelancer.length), html, replyTo: RELANCE_MAILBOX, attachments: pieces };
  let depuis = RELANCE_MAILBOX;
  try { await g.sendMail(RELANCE_MAILBOX, mail); }
  catch (err) {
    // Boîte comptabilité inaccessible à l'application : envoi depuis contact@, réponses toujours vers comptabilite@
    if (RELANCE_MAILBOX === MAILBOX || !/^Graph (4\d\d)\b/.test(err.message)) throw err;
    console.error(`Commercial : relance ${f0.client} depuis ${RELANCE_MAILBOX} refusée (${err.message.slice(0, 80)}), envoi depuis ${MAILBOX}`);
    await g.sendMail(MAILBOX, mail); depuis = MAILBOX;
  }
  const noms = aRelancer.map(f => f.name);
  for (const f of aRelancer) {
    await odoo.noteFacture(f.id, `${NIVEAUX.at(n - 1).nom} envoyée par mail à ${esc(f0.email)} depuis le dashboard (${esc(user)})${noms.length > 1 ? ` avec ${noms.length - 1} autre(s) facture(s) : ${esc(noms.filter(x => x !== f.name).join(', '))}` : ''}.`);
    await journal(user, 'facture_relance', f.name, { niveau: n, email: f0.email, client: f0.client, reste_ttc: f.amount_residual, groupe: noms, depuis, pdf: pieces.length });
  }
  cache.le = 0;
  console.log(`Commercial : ${NIVEAUX.at(n - 1).nom.toLowerCase()} envoyée à ${f0.email} (${noms.join(', ')}) par ${user}`);
  return { ok: true, email: f0.email, niveau: n, factures: noms.length, pdf: pieces.length, total: Math.round(total * 100) / 100, liens: aRelancer.filter(f => f.lien).length, depuis };
}

// ---------- Facture du solde ----------
const LIB_SOLDE = { introuvable: 'devis introuvable dans Odoo', pas_confirme: 'devis pas encore confirmé', pas_d_acompte: 'pas d\'acompte facturé', brouillon_existant: 'une facture brouillon existe déjà dans Odoo', deja_facture: 'déjà entièrement facturé', rien_a_facturer: 'rien à facturer', pas_d_email: 'pas d\'e-mail sur la fiche client Odoo', en_cours: 'facture déjà en cours de création' };
const soldeEnCours = new Set(); // verrou par devis : bouton manuel et passage automatique ne facturent jamais deux fois
async function facturerSolde(numero, user, { auto = false } = {}) {
  const cleV = String(numero || '').trim().toUpperCase();
  if (soldeEnCours.has(cleV)) return { statut: 'en_cours', libelle: LIB_SOLDE.en_cours };
  soldeEnCours.add(cleV);
  let r;
  try { r = await odoo.facturerSolde(numero, { exigerAcompte: auto }); }
  finally { soldeEnCours.delete(cleV); }
  if (r.statut === 'envoyee') {
    await journal(user, 'facture_solde_envoyee', numero, { facture: r.numero, ttc: r.montant_ttc, auto });
    console.log(`Commercial : facture du solde ${r.numero} (${r.montant_ttc} € TTC) envoyée pour ${numero}${auto ? ' (automatique)' : ''}`);
    cache.le = 0;
  }
  return { ...r, libelle: LIB_SOLDE[r.statut] || null };
}

// Appelé quand une commande change de statut (atelier) : TERMINÉE / À EXPÉDIER -> facture du solde si acompte
async function surStatutCommande(c, nouveauStatut, par) {
  try {
    const st = String(nouveauStatut || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!['TERMINEE', 'AEXPEDIER'].includes(st) || !c?.n_devis || !odoo.configured()) return;
    if ((await require('./notifications').reglage('tache_facture_solde', 'off')) !== 'on') return;
    const r = await facturerSolde(c.n_devis, `${par} (automatique)`, { auto: true });
    if (r.statut !== 'envoyee' && !['pas_d_acompte', 'deja_facture', 'pas_confirme', 'en_cours'].includes(r.statut)) {
      // Cas à regarder à la main : prévenir par mail
      await g.sendMail(MAILBOX, { to: MAILBOX, subject: `Facture du solde non envoyée - ${c.n_devis} - ${c.client || ''}`, html: `<p>La commande ${esc(c.n_devis)} (${esc(c.client || '')}) est passée en ${esc(nouveauStatut)}, mais la facture du solde n'a pas pu partir : <b>${esc(r.libelle || r.statut)}</b>.</p><p>À vérifier dans Odoo.</p>` }).catch(() => {});
    }
  } catch (err) {
    console.error(`Commercial : facture du solde ${c?.n_devis} :`, err.message);
    g.sendMail(MAILBOX, { to: MAILBOX, subject: `Facture du solde en erreur - ${c?.n_devis}`, html: `<p>Erreur lors de la facture du solde de ${esc(c?.n_devis)} : ${esc(err.message)}</p>` }).catch(() => {});
  }
}


// ---------- Clients à réactiver ----------
let cacheReac = { le: 0, data: null };
async function clientsAReactiver({ force = false } = {}) {
  if (!force && cacheReac.data && Date.now() - cacheReac.le < 10 * 60e3) return cacheReac.data;
  const liste = await odoo.clientsAReactiver();
  const rel = {};
  if (supabase && liste.length) {
    const { data } = await supabase.from('gestion_actions').select('cle, cree_le').eq('action', 'client_reactivation').in('cle', liste.map(c => `partner-${c.id}`));
    for (const r of data || []) if (!rel[r.cle] || r.cree_le > rel[r.cle]) rel[r.cle] = r.cree_le;
  }
  const data = liste.map(c => ({ ...c, relance_le: rel[`partner-${c.id}`] || null }));
  cacheReac = { le: Date.now(), data };
  return data;
}
async function relancerClient(partnerId, user, message) {
  const p = await odoo.readPartner(Number(partnerId));
  if (!p?.email) throw new Error('Pas d\'e-mail sur la fiche Odoo de ce client');
  const prenom = String(p.name || '').split(/\s+/)[0];
  const texte = String(message || '').trim() || `Bonjour${prenom ? ' ' + prenom : ''},\n\nÇa fait un moment ! J'espère que tout va bien de votre côté.\n\nSi vous avez un projet en vue (t-shirts, polos, sweats, tote bags, planches DTF…) pour un événement, votre équipe ou la saison qui arrive, je vous prépare un devis avec plaisir. Il suffit de répondre à ce mail.\n\nÀ très vite,\nL'équipe IGS CUSTOM BAR`;
  await g.sendMail(MAILBOX, { to: p.email, subject: 'Des nouvelles de IGS CUSTOM BAR', html: `<div style="font:14px/1.6 Arial,sans-serif;color:#1E1E4B">${esc(texte).replace(/\n/g, '<br>')}</div>` });
  await journal(user, 'client_reactivation', `partner-${p.id}`, { client: p.name, email: p.email });
  cacheReac.le = 0;
  return { ok: true, email: p.email };
}

// ---------- Fiche client complète ----------
async function rechercherClients(q) {
  if (String(q || '').trim().length < 2) return [];
  return (await odoo.searchPartners(q)).map(p => ({ id: p.id, nom: p.name, email: p.email, telephone: p.phone, ville: p.ville }));
}
async function ficheClient(partnerId) {
  const f = await odoo.ficheClientOdoo(partnerId);
  const norm = require('./commandes').normalizePhone;
  const tel = norm(f.client.telephone || '');
  // Commandes de l'atelier liées à ses devis
  try {
    const nums = new Set(f.devis.map(d => d.numero.toUpperCase()));
    const rows = (await require('./commandes').listCommandes()).rows || [];
    f.atelier = rows.filter(c => c.n_devis && nums.has(c.n_devis.toUpperCase())).map(c => ({ devis: c.n_devis, statut: c.statut, livraison: c.date_livraison || null }));
  } catch { f.atelier = []; }
  // Planches (même nom de client)
  try {
    const k = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pl = (await require('./planches').listPlanches()).rows || [];
    f.planches = pl.filter(p => k(p.client) === k(f.client.nom)).slice(0, 20).map(p => ({ date: p.date_commande, statut: p.statut, metres: p.format || p.metres, hebdo: !!p.hebdo, paiement: p.paiement }));
  } catch { f.planches = []; }
  // Conversation WhatsApp (Leïla + équipe) et note client
  f.conversation = []; f.note = null;
  if (supabase && tel) {
    const [{ data: conv }, { data: note }] = await Promise.all([
      supabase.from('conversations').select('role, content, created_at').eq('phone_number', tel).order('created_at', { ascending: false }).limit(40),
      supabase.from('client_notes').select('note').eq('phone_number', tel).maybeSingle(),
    ]);
    f.conversation = (conv || []).reverse().map(m => ({ role: m.role, texte: m.content, le: m.created_at }));
    f.note = note?.note || null;
  }
  return f;
}

// ---------- Origine des demandes (90 jours) ----------
async function origines() {
  const tous = await odoo.devisCommerciaux({ jours: 90, planches: true });
  const viaLeila = new Set();
  if (supabase) {
    const { data } = await supabase.from('gestion_demandes').select('devis_numero').not('devis_numero', 'is', null).gte('cree_le', new Date(Date.now() - 95 * 86400e3).toISOString());
    for (const d of data || []) viaLeila.add(d.devis_numero);
  }
  const textile = new Set((await odoo.devisCommerciaux({ jours: 90 })).map(d => d.numero));
  const groupes = {};
  for (const d of tous) {
    if (d.etat === 'cancel' && !d.montant_ht) continue;
    const src = viaLeila.has(d.numero) ? 'Leïla (WhatsApp)' : textile.has(d.numero) ? 'Textile (boutique, mail, site…)' : 'Planches DTF';
    const gr = groupes[src] || (groupes[src] = { source: src, devis: 0, signes: 0, ca_signe_ht: 0 });
    gr.devis++;
    if (d.etat === 'sale') { gr.signes++; gr.ca_signe_ht += d.montant_ht || 0; }
  }
  return Object.values(groupes).map(x => ({ ...x, ca_signe_ht: Math.round(x.ca_signe_ht), taux: x.devis ? Math.round(x.signes / x.devis * 100) : null })).sort((a, b) => b.devis - a.devis);
}

module.exports = { clientsAReactiver, relancerClient, rechercherClients, ficheClient, origines, tableauDeBord, demandes, nouvelleDemande, preparerBrouillon, envoyerDemande, abandonnerDemande, relancer, facturerSolde, surStatutCommande, impayes, relancerClientImpayes, prevenirDevisWhatsApp, devisEnvoyesWhatsapp, RELANCE_JOURS };
