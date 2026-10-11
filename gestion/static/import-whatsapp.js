// IGS Dashboard - lecture d'un export WhatsApp dans le navigateur (onglet Leïla > Importer un historique)
// Accepte : le .txt de la discussion, le .zip exporté par WhatsApp (avec ou sans médias : seuls le .txt et les
// fiches contact .vcf sont lus, les photos ne sont jamais envoyées au serveur), ou une fiche contact .vcf seule.
(function () {
  var JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var chargement = null;
  function chargerJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (chargement) return chargement;
    chargement = new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = JSZIP; s.async = true;
      s.onload = function () { window.JSZip ? ok(window.JSZip) : ko(new Error('Lecture des .zip indisponible')); };
      s.onerror = function () { chargement = null; ko(new Error('Lecture des .zip indisponible (connexion)')); };
      document.head.appendChild(s);
    });
    return chargement;
  }

  // Numéro saisi librement (+590 690…, 0690…, 00590…) -> format WhatsApp 590690XXXXXX
  function normaliserNumero(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (d.length === 10 && d[0] === '0') {
      var p = d.slice(0, 4), r = d.slice(1);
      if (['0690', '0691', '0590'].indexOf(p) >= 0) d = '590' + r;
      else if (['0696', '0697', '0596'].indexOf(p) >= 0) d = '596' + r;
      else if (['0694', '0594'].indexOf(p) >= 0) d = '594' + r;
      else if (['0692', '0693', '0262'].indexOf(p) >= 0) d = '262' + r;
      else d = '33' + r;
    }
    return d.length >= 9 && d.length <= 15 ? d : '';
  }

  // Fiches contact vCard (.vcf) : nom + numéros
  function lireVcf(texte) {
    var out = [];
    String(texte || '').replace(/\r?\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1).forEach(function (bloc) {
      var nom = (bloc.match(/^FN[^:\n]*:(.*)$/im) || [])[1] || '';
      var tels = [];
      bloc.replace(/^(?:item\d+\.)?TEL[^:\n]*:(.*)$/gim, function (_, t) { var n = normaliserNumero(t); if (n && tels.indexOf(n) < 0) tels.push(n); return _; });
      // waid=… : numéro WhatsApp exact
      bloc.replace(/waid=(\d{8,15})/gi, function (_, t) { if (tels.indexOf(t) < 0) tels.unshift(t); return _; });
      tels.forEach(function (t) { out.push({ nom: nom.replace(/\\,/g, ',').trim(), tel: t }); });
    });
    return out;
  }

  // « Discussion WhatsApp avec Jean Client.txt », « WhatsApp Chat with +590 690 11 22 33.txt »
  function infosNomFichier(nom) {
    var base = String(nom || '').replace(/^.*[\/\\]/, '').replace(/\.(txt|zip)$/i, '');
    var m = base.match(/(?:\bavec|\bwith)\s+(.+)$/i) || base.match(/(?:whatsapp|chat|discussion)\s*[-–]\s*(.+)$/i);
    var contact = m ? m[1].trim() : '';
    var tel = contact && /^[+\d][\d\s().-]{7,}$/.test(contact) ? normaliserNumero(contact) : '';
    return { contact: contact, numero: tel };
  }

  // Expéditeurs de la discussion (pour vérifier le nom de l'équipe)
  var LIGNE = /^[‎‏\s]*\[?\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s+)?(.*)$/;
  function expediteurs(texte) {
    var n = {};
    String(texte || '').split(/\r?\n/).forEach(function (l) {
      var m = l.match(LIGNE); if (!m) return;
      var i = m[1].indexOf(': '); if (i <= 0) return;
      var s = m[1].slice(0, i).replace(/^[‎‏~\s]+/, '').trim();
      n[s] = (n[s] || 0) + 1;
    });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; });
  }

  async function lireExportWhatsApp(fichier) {
    var nom = fichier.name || '';
    var res = { texte: '', contacts: [], fichier: nom, contact: '', numero: '', expediteurs: [] };
    if (/\.vcf$/i.test(nom)) {
      res.contacts = lireVcf(await fichier.text());
    } else if (/\.zip$/i.test(nom) || fichier.type === 'application/zip') {
      var JSZip = await chargerJSZip();
      var zip = await JSZip.loadAsync(fichier);
      var txts = [], vcfs = [];
      zip.forEach(function (chemin, f) {
        if (f.dir || /(^|\/)__MACOSX\//.test(chemin)) return;
        if (/\.txt$/i.test(chemin)) txts.push(f);
        else if (/\.vcf$/i.test(chemin)) vcfs.push(f);
      });
      if (!txts.length && !vcfs.length) throw new Error('Aucune discussion (.txt) ni fiche contact (.vcf) dans ce .zip');
      // La discussion : _chat.txt (iPhone) ou « Discussion WhatsApp avec … .txt », sinon le plus gros .txt
      txts.sort(function (a, b) {
        var pa = /_chat\.txt$|whatsapp|discussion|chat with/i.test(a.name) ? 1 : 0, pb = /_chat\.txt$|whatsapp|discussion|chat with/i.test(b.name) ? 1 : 0;
        return pb - pa || ((b._data && b._data.uncompressedSize) || 0) - ((a._data && a._data.uncompressedSize) || 0);
      });
      if (txts.length) {
        if (txts[0]._data && txts[0]._data.uncompressedSize > 30 * 1024 * 1024) throw new Error('Discussion trop volumineuse (plus de 30 Mo)');
        res.texte = await txts[0].async('string');
        var info = infosNomFichier(/_chat\.txt$/i.test(txts[0].name) ? nom : txts[0].name);
        res.contact = info.contact; res.numero = info.numero;
      }
      for (var i = 0; i < vcfs.length && i < 30; i++) res.contacts = res.contacts.concat(lireVcf(await vcfs[i].async('string')));
    } else {
      res.texte = await fichier.text();
      var inf = infosNomFichier(nom);
      res.contact = inf.contact; res.numero = inf.numero;
    }
    if (!res.contact && /\.zip$/i.test(nom)) { var z = infosNomFichier(nom); res.contact = z.contact; res.numero = res.numero || z.numero; }
    // Numéro du client : celui du nom de la discussion, sinon une fiche contact au même nom, sinon la seule fiche du .zip
    if (!res.numero && res.contacts.length) {
      var meme = res.contacts.filter(function (c) { return res.contact && c.nom && c.nom.toLowerCase() === res.contact.toLowerCase(); });
      if (meme.length) res.numero = meme[0].tel;
      else if (res.contacts.length === 1 && !res.texte) res.numero = res.contacts[0].tel;
    }
    res.expediteurs = expediteurs(res.texte);
    // dédoublonne les contacts
    var vus = {};
    res.contacts = res.contacts.filter(function (c) { var k = c.tel; if (vus[k]) return false; vus[k] = 1; return true; });
    return res;
  }

  window.lireExportWhatsApp = lireExportWhatsApp;
  window.normaliserNumeroWhatsApp = normaliserNumero;
})();
