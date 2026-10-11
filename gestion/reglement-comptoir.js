// ============================================
// IGS GESTION - RÈGLEMENT AU COMPTOIR (TPE et/ou espèces) pour une commande ou une planche DTF
// Le client paie sur place par carte (TPE), éventuellement une partie en espèces :
//  - Odoo : devis basculé en facture (validée, sans envoi), part espèces déduite par une ligne « Règlement en espèces »,
//    note « Règlement par TPE : X € » sur la facture pour le rapprochement avec la remise TPE en banque ;
//  - dashboard : remarque sur la commande / planche, part espèces enregistrée dans la caisse, mention espèces retirée.
// ============================================

const { supabase } = require('./db');
const txt = v => (v === null || v === undefined ? '' : String(v).trim());
const montant = v => { const s = txt(v).replace(',', '.').replace(/[\s€]/g, ''); if (!s) return null; const n = Number(s); if (!(n >= 0)) throw new Error(`Montant invalide : ${v}`); return Math.round(n * 100) / 100; };
const eur = n => `${Number(n).toFixed(2).replace('.', ',')} €`;

async function enregistrer({ type, cle, tpe, especes }, user) {
  const odoo = require('./odoo');
  if (!odoo.configured()) throw new Error('Odoo non configuré');
  let item, numero, client;
  if (type === 'planche') {
    const { rows } = await require('./planches').listPlanches();
    item = rows.find(p => p.cle === cle);
    if (!item) throw new Error('Planche introuvable : actualise et réessaie');
  } else {
    const { rows } = await require('./commandes').listCommandes();
    item = rows.find(c => c.cle === cle);
    if (!item) throw new Error('Commande introuvable : actualise et réessaie');
  }
  numero = item.n_devis; client = item.client;
  if (!numero) throw new Error('Pas de devis Odoo pour cette ' + (type === 'planche' ? 'planche' : 'commande') + ' : impossible de facturer');
  const esp = montant(especes) || 0;
  const r = await odoo.reglementComptoir(numero, { tpe: montant(tpe), especes: esp, par: user });

  const mention = [r.tpe > 0 ? `PAYÉ TPE ${eur(r.tpe)}` : '', r.especes > 0 ? `ESPÈCES ${eur(r.especes)}` : ''].filter(Boolean).join(' + ');
  const etapes = [`✅ Facture ${r.factures.join(', ')} validée dans Odoo (reste à payer avant règlement : ${eur(r.du)})`];
  if (r.tpe > 0) etapes.push(`💳 TPE : ${eur(r.tpe)} — note « Règlement par TPE » ajoutée pour le rapprochement bancaire`);
  if (r.especes > 0) etapes.push(r.especes_deduites ? `💵 Espèces : ${eur(r.especes)} déduites de la facture (ligne « Règlement en espèces ») et notées dans la caisse` : `💵 Espèces : ${eur(r.especes)} notées dans la caisse ; ⚠️ facture déjà partiellement payée, ligne espèces à ajouter à la main dans Odoo`);
  if (Math.abs(r.ecart) >= 0.01) etapes.push(`⚠️ Écart de ${eur(r.ecart)} entre le reste à payer et les montants saisis : à vérifier`);

  // Dashboard
  try {
    if (type === 'planche') {
      await require('./planches').modifier(cle, { paiement: r.tpe > 0 ? 'CB' : 'ESPECE', remarques: [txt(item.remarques), mention].filter(Boolean).join(' - ').slice(0, 500) }, user);
    } else {
      const commandes = require('./commandes');
      await commandes.modifier(cle, { remarque: [txt(item.remarque), mention].filter(Boolean).join(' | ').slice(-500) }, user);
      if (item.a_payer_especes) await commandes.setEspeces(cle, { actif: false }, user).catch(() => {});
    }
  } catch (err) { etapes.push(`⚠️ Remarque non ajoutée dans le dashboard : ${err.message}`); }
  if (r.especes > 0) {
    try { await require('./caisse').encaisser({ montant: r.especes, source: type === 'planche' ? 'planche' : 'commande', ref: numero, client, note: 'Paiement mixte TPE + espèces' }, user); }
    catch (err) { etapes.push(`⚠️ Espèces non notées dans la caisse : ${err.message}`); }
  }
  if (supabase) await supabase.from('gestion_actions').insert({ utilisateur: user, action: 'reglement_comptoir', cle: numero, details: { type, client, ...r } }).then(() => {}, () => {});
  console.log(`Règlement comptoir ${numero} (${client}) par ${user} : ${mention}`);
  return { ...r, etapes };
}

module.exports = { enregistrer };
