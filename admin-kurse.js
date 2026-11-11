/* Verwaltung – Reiter „Kurse“. Nutzt Anmeldung und API-Helfer aus admin.html (window.FD_ADMIN).
   Rollen: Heute sieht der Inhaber alle Anbieterinnen. Später bekommt jede Trainerin einen
   eigenen Zugang und sieht hier nur ihre eigenen Kurse, Kunden, Karten und Buchungen. */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var box = document.getElementById('kurseApp');
  var WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var S = { p: 'niklas', view: 'home', kurs: '', data: null, offen: {}, edit: null, best: null, pause: '' };
  function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function eur(c) { return A.eur(c || 0); }
  function dk(iso) { var d = new Date(iso + 'T12:00:00Z'); return WD[d.getUTCDay()] + ', ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.'; }
  function hm(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function q(sel) { return box.querySelector(sel); }
  function qa(sel) { return box.querySelectorAll(sel); }
  function on(sel, fn) { Array.prototype.forEach.call(qa(sel), function (b) { b.onclick = function (e) { fn(b, e); }; }); }
  function armed(b, text) {
    if (b.getAttribute('data-armed') === '1') return true;
    var alt = b.textContent;
    b.setAttribute('data-armed', '1'); b.textContent = text;
    setTimeout(function () { b.removeAttribute('data-armed'); b.textContent = alt; }, 4000);
    return false;
  }
  function post(path, body) { body.p = S.p; return A.api('kurse/' + path, { body: body }); }

  function laden() {
    return A.api('kurse/state?p=' + encodeURIComponent(S.p)).then(function (d) {
      S.data = d;
      document.dispatchEvent(new CustomEvent('fd:kurse', { detail: { erstattungen: (d.erstattungen || []).filter(function (e) { return e.status !== 'erledigt'; }).length } }));
      render();
    })
      .catch(function (e) { if (e.message !== 'abgemeldet') A.note(e.message, true); });
  }
  window.FDKurse = { open: function (zurueck) {
    if (zurueck) { S.view = 'home'; S.kurs = ''; S.edit = null; }
    if (!S.data) laden(); else render();
  } };

  /* ---------- Rahmen ---------- */
  function render() {
    var d = S.data;
    var anb = d.anbieterinnen.length > 1 ? '<div class="ad-chips ak-anb">' + d.anbieterinnen.map(function (a) {
      return '<button type="button" class="ad-chip' + (a.id === S.p ? ' ak-on' : '') + '" data-anb="' + esc(a.id) + '">' + esc(a.name) + '<span>' + (a.aktiv ? (a.zahlung_bereit ? 'aktiv' : 'Stripe fehlt') : 'vorbereitet, inaktiv') + '</span></button>';
    }).join('') + '</div>' : '';
    var TITEL = { termine: 'Termine', usc: 'Urban Sports', erstattungen: 'Erstattungen', bestellungen: 'Bestellungen', karten: 'Kurskarten', mitteilung: 'Mitteilung an Mitglieder', einstellungen: 'Preise & Regeln', kurse: S.edit && S.edit.neu ? 'Neuer Kurs' : 'Kurs bearbeiten' };
    var kopf = S.view === 'home' ? '' : '<div class="ak-nav"><button type="button" class="ak-back" data-view="home">&lsaquo; Kurse</button><span class="ak-nav-t">' + esc(TITEL[S.view] || '') + (S.kurs && (S.view === 'termine' || S.view === 'bestellungen') ? ' &middot; ' + esc(kursTitel(S.kurs)) : '') + '</span></div>';
    box.innerHTML = anb + kopf + '<div id="akBody"></div>';
    on('[data-anb]', function (b) { S.p = b.getAttribute('data-anb'); S.data = null; S.view = 'home'; S.kurs = ''; S.edit = null; laden(); });
    on('[data-view]', gehe);
    ({ home: vHome, termine: vTermine, usc: vUsc, erstattungen: vErstattungen, kurse: vKurse, bestellungen: vBestellungen, karten: vKarten, mitteilung: vMitteilung, einstellungen: vEinstellungen })[S.view]();
  }
  function gehe(b) {
    S.view = b.getAttribute('data-view'); S.edit = null;
    S.kurs = S.view === 'home' ? '' : (b.getAttribute('data-kurs') || '');
    render(); window.scrollTo(0, 0);
  }
  function kursTitel(id) { var k = (S.data.kurse || []).filter(function (x) { return x.id === id; })[0]; return k ? k.titel : ''; }
  function body(html) { q('#akBody').innerHTML = html; }



  /* ---------- Bildauswahl für Kurse ---------- */
  var BILDER = { site: null, up: null };
  function bildSrc(v) { return /^https?:/.test(v) ? v : (v ? v : ''); }
  function bildLaden() {
    var a = BILDER.site ? Promise.resolve() : fetch('kurs-bilder.json?v=1').then(function (r) { return r.json(); }).then(function (j) { BILDER.site = j; }).catch(function () { BILDER.site = []; });
    var b = A.api('kurse/bilder?p=' + encodeURIComponent(S.p)).then(function (d) { BILDER.up = d.bilder || []; }).catch(function () { BILDER.up = []; });
    return Promise.all([a, b]);
  }
  function bildAbbild(file, maxW) {
    return new Promise(function (res, rej) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        var sc = Math.min(1, maxW / img.naturalWidth), w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
        var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(u);
        c.toBlob(function (bl) {
          if (bl && bl.type === 'image/webp') return res({ blob: bl, w: w, h: h });
          c.toBlob(function (b2) { b2 ? res({ blob: b2, w: w, h: h }) : rej(new Error('Das Bild ließ sich nicht umwandeln.')); }, 'image/jpeg', 0.88);
        }, 'image/webp', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('Dieses Bild kann ich nicht lesen. Bitte JPG, PNG oder WebP nehmen.')); };
      img.src = u;
    });
  }
  function bildWahl(f) {
    var inp = f.elements.bild, prev = q('#akBildPrev'), nm = q('#akBildName'), panel = q('#akBildPanel');
    var tab = 'site';
    function titelZu(v) {
      if (!v) return 'Kein Bild – es wird die Farbfläche gezeigt.';
      var s = (BILDER.site || []).filter(function (x) { return x.datei === v; })[0];
      if (s) return s.titel;
      var u = (BILDER.up || []).filter(function (x) { return x.url === v; })[0];
      return u ? 'Eigenes Bild: ' + u.titel : v;
    }
    function zeige() {
      var v = inp.value.trim();
      prev.innerHTML = v ? '<img src="' + esc(bildSrc(v)) + '" alt="">' : '<span>kein Bild</span>';
      nm.textContent = titelZu(v);
      q('#akBildOpen').textContent = v ? 'Anderes Bild wählen' : 'Bild wählen';
      q('#akBildWeg').hidden = !v;
    }
    function waehle(v) { inp.value = v; panel.hidden = true; zeige(); f.dispatchEvent(new Event('input', { bubbles: true })); }
    function kachel(src, titel, v, extra, del) {
      return '<div class="ak-kachel' + (inp.value === v ? ' ak-on' : '') + '"><button type="button" class="ak-kb" data-wahl="' + esc(v) + '"><img src="' + esc(src) + '" alt="" loading="lazy"><span class="ak-kt">' + esc(titel) + '</span>' + (extra || '') + '</button>' + (del || '') + '</div>';
    }
    function zeichne() {
      var h = '<div class="ak-btabs"><button type="button" class="ad-chip' + (tab === 'site' ? ' ak-on' : '') + '" data-tab="site">Auf der Website</button><button type="button" class="ad-chip' + (tab === 'up' ? ' ak-on' : '') + '" data-tab="up">Meine Uploads' + (BILDER.up && BILDER.up.length ? ' (' + BILDER.up.length + ')' : '') + '</button></div>';
      h += '<div class="ad-actions" style="margin:10px 0"><label class="ad-mini ak-upl">Vom Computer hochladen<input type="file" accept="image/*" id="akBildFile" hidden></label><span class="ad-meta" id="akBildMsg"></span></div>';
      if (tab === 'site') {
        var gr = {}, order = [];
        (BILDER.site || []).forEach(function (x) { if (!gr[x.gruppe]) { gr[x.gruppe] = []; order.push(x.gruppe); } gr[x.gruppe].push(x); });
        order.forEach(function (g) {
          h += '<h4 class="ak-bgr">' + esc(g) + '</h4><div class="ak-bgrid">' + gr[g].map(function (x) {
            return kachel('kurs-bilder-vorschau/' + x.datei, x.titel, x.datei, (x.hoch ? '<em>Hochformat, wird zugeschnitten</em>' : '') + (x.hinweis ? '<em class="ak-bw" title="' + esc(x.hinweis) + '">Hyrox-Logo sichtbar</em>' : ''));
          }).join('') + '</div>';
        });
      } else {
        h += (BILDER.up && BILDER.up.length) ? '<div class="ak-bgrid">' + BILDER.up.map(function (x) {
          return kachel(x.url, x.titel, x.url, '', '<button type="button" class="ak-bdel" data-del="' + esc(x.id) + '" aria-label="Bild löschen">&times;</button>');
        }).join('') + '</div>' : '<div class="ad-empty">Noch keine eigenen Bilder. Lade oben eins vom Computer hoch.</div>';
      }
      panel.innerHTML = h;
      Array.prototype.forEach.call(panel.querySelectorAll('[data-tab]'), function (b) { b.onclick = function () { tab = b.getAttribute('data-tab'); zeichne(); }; });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-wahl]'), function (b) { b.onclick = function () { waehle(b.getAttribute('data-wahl')); }; });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-del]'), function (b) {
        b.onclick = function () {
          if (!armed(b, 'Löschen?')) return;
          post('bild-loeschen', { id: b.getAttribute('data-del') }).then(function () { A.note('Bild gelöscht.'); return bildLaden(); }).then(zeichne).catch(function (e) { A.note(e.message, true); });
        };
      });
      q('#akBildFile').onchange = function () {
        var fl = this.files && this.files[0]; if (!fl) return;
        var msg = q('#akBildMsg'); msg.textContent = 'Wird hochgeladen …';
        bildAbbild(fl, 1600).then(function (r) {
          return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res({ d: fr.result, r: r }); }; fr.readAsDataURL(r.blob); });
        }).then(function (x) {
          return post('bild-hochladen', { name: fl.name, daten: x.d, w: x.r.w, h: x.r.h });
        }).then(function (j) { return bildLaden().then(function () { waehle(j.url); A.note('Bild hochgeladen und ausgewählt.'); }); })
          .catch(function (e) { var m = q('#akBildMsg'); if (m) m.textContent = ''; A.note(e.message, true); });
      };
    }
    q('#akBildOpen').onclick = function () {
      if (!panel.hidden) { panel.hidden = true; return; }
      panel.hidden = false; panel.innerHTML = '<div class="ad-empty">Lädt …</div>';
      bildLaden().then(function () { var v = inp.value.trim(); tab = /^https?:/.test(v) ? 'up' : 'site'; zeichne(); zeige(); });
    };
    q('#akBildWeg').onclick = function () { waehle(''); };
    zeige();
    bildLaden().then(zeige);
  }


  /* ---------- Vorschau: Kurs-Karte wie auf der Website, am Computer und am Handy ---------- */
  function vorschau(f) {
    var rahmen = [
      { box: q('#akVpD'), breite: 1100 },
      { box: q('#akVpM'), breite: 390 }
    ];
    function minZuHm(s, m) { var p = String(s || '17:30').split(':'), t = (+p[0]) * 60 + (+p[1] || 0) + (+m || 60); return ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2); }
    function daten() {
      var e = f.elements, st = e.start.value || '18:00', min = Number(e.minuten.value) || 60, kap = Number(e.kapazitaet.value) || 12;
      var morgen = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      var kurs = {
        id: 'v', anbieterin: 'Niklas Donner', anbieterin_id: 'niklas', titel: e.titel.value || 'Kursname', kategorie: e.kategorie.value, bild: e.bild.value.trim(), farbe: e.farbe.value,
        ort: e.ort.value, raum: e.raum.value, adresse: e.adresse.value, minuten: min, kapazitaet: kap, kurz: e.kurz.value, beschreibung: e.beschreibung.value,
        produkte: { tageskarte: { aktiv: true, label: 'Einzelticket', freischalt_tage: 2 }, karte5: { aktiv: true, label: '5er-Karte' }, karte10: { aktiv: true, label: '10er-Karte' } },
        termine: [{ datum: morgen, start: st, ende: minZuHm(st, min), extra: false, abgesagt: false, buchbar: true, frei: kap, tageskarte_offen: true, tageskarte_ab: morgen + 'T00:00:00Z' }]
      };
      return { daten: { kurse: [kurs] }, tag: morgen };
    }
    function passe(r) {
      var fr = r.fr; if (!fr || !fr.contentDocument || !fr.contentDocument.body) return;
      var h = Math.ceil(fr.contentDocument.body.getBoundingClientRect().height);
      var verf = r.box.clientWidth || r.breite, s = Math.min(1, verf / r.breite);
      fr.style.width = r.breite + 'px'; fr.style.height = h + 'px';
      fr.style.transform = 'scale(' + s + ')'; fr.style.transformOrigin = '0 0';
      r.box.style.height = Math.ceil(h * s) + 'px';
    }
    function fuelle(r) {
      var w = r.fr.contentWindow;
      if (!w || !w.FDKursplan) return;
      var d = daten(), box = r.fr.contentDocument.getElementById('b');
      w.FDKursplan.start(box, { daten: d.daten, tag: d.tag, onBuchen: function () {} });
      Array.prototype.forEach.call(r.fr.contentDocument.querySelectorAll('img'), function (im) { im.loading = 'eager'; im.onload = function () { passe(r); }; });
      passe(r); setTimeout(function () { passe(r); }, 300); setTimeout(function () { passe(r); }, 1200);
    }
    rahmen.forEach(function (r) {
      var fr = document.createElement('iframe');
      fr.className = 'ak-vf'; fr.setAttribute('title', 'Vorschau');
      fr.srcdoc = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="kursplan.css">'
        + '<style>html,body{background:#15171C;margin:0}body{padding:14px;min-height:0}</style></head><body><div id="b"></div><script src="kursplan.js"><\/script></body></html>';
      fr.onload = function () {
        fuelle(r);
        try { new fr.contentWindow.ResizeObserver(function () { passe(r); }).observe(fr.contentDocument.body); } catch (e) { /* alter Browser */ }
      };
      r.fr = fr; r.box.appendChild(fr);
    });
    var t;
    f.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { rahmen.forEach(fuelle); }, 200); });
    f.addEventListener('change', function () { clearTimeout(t); t = setTimeout(function () { rahmen.forEach(fuelle); }, 200); });
    window.addEventListener('resize', function () { rahmen.forEach(passe); });
  }

  /* ---------- Pause (Zeitraum, in dem ein Kurs ausfällt) ---------- */
  function pausenListe(k) {
    var heute = new Date().toISOString().slice(0, 10);
    var gr = {}, out = [];
    (k.ausfall || []).forEach(function (a) {
      if (!a.pause || a.datum < heute) return;
      var key = a.at || '';
      if (!gr[key]) { gr[key] = { von: a.datum, bis: a.datum, n: 0, grund: a.grund || '' }; out.push(gr[key]); }
      if (a.datum < gr[key].von) gr[key].von = a.datum;
      if (a.datum > gr[key].bis) gr[key].bis = a.datum;
      gr[key].n++;
    });
    return out.sort(function (a, b) { return a.von.localeCompare(b.von); });
  }
  function pauseBox(k) {
    var liste = pausenListe(k);
    var h = '<div class="ak-pause">';
    liste.forEach(function (x) {
      h += '<div class="ad-meta ak-pz"><b>Pause ' + esc(dk(x.von)) + (x.bis !== x.von ? ' bis ' + esc(dk(x.bis)) : '') + '</b> &middot; ' + x.n + (x.n === 1 ? ' Termin' : ' Termine') + (x.grund && x.grund !== 'Pause' ? ' &middot; ' + esc(x.grund) : '')
        + ' <button type="button" class="ad-mini" data-pauf="' + esc(k.id) + '|' + esc(x.von) + '|' + esc(x.bis) + '">Aufheben</button></div>';
    });
    if (S.pause === k.id) {
      var heute = new Date().toISOString().slice(0, 10);
      h += '<form class="ad-issue ak-form" data-pauseform="' + esc(k.id) + '"><p class="ad-hint">Alle Termine in diesem Zeitraum fallen aus (z.&nbsp;B. Ferien, Urlaub, Feiertage). Es geht keine Mail raus &ndash; gibt es dort schon Buchungen, sagst du diese Termine bitte einzeln ab.</p>'
        + '<div class="ak-grid"><div class="ad-field"><label>Von</label><input type="date" name="von" value="' + heute + '" required></div>'
        + '<div class="ad-field"><label>Bis (einschlie&szlig;lich)</label><input type="date" name="bis" required></div></div>'
        + '<div class="ad-field"><label>Grund (nur f&uuml;r dich, z.&nbsp;B. Sommerpause)</label><input name="grund" maxlength="200" placeholder="Pause"></div>'
        + '<label class="ak-check"><input type="checkbox" name="ptfrei"> Zeit f&uuml;rs Personal Training freigeben</label>'
        + '<div class="ad-actions"><button type="submit" class="ad-danger">Pause eintragen</button><button type="button" class="ad-mini" data-pauseclose="1">Abbrechen</button></div></form>';
    }
    return h + '</div>';
  }
  function pauseBind() {
    on('[data-pause]', function (b) { S.pause = S.pause === b.getAttribute('data-pause') ? '' : b.getAttribute('data-pause'); render(); });
    on('[data-pauseclose]', function () { S.pause = ''; render(); });
    on('[data-pauf]', function (b) {
      if (!armed(b, 'Wirklich aufheben?')) return;
      var x = b.getAttribute('data-pauf').split('|');
      b.disabled = true;
      post('pause-aufheben', { kurs: x[0], von: x[1], bis: x[2] })
        .then(function (r) { A.note('Pause aufgehoben: ' + r.zurueck + (r.zurueck === 1 ? ' Termin findet' : ' Termine finden') + ' wieder statt.'); return laden(); })
        .catch(function (e) { b.disabled = false; A.note(e.message, true); });
    });
    Array.prototype.forEach.call(qa('form[data-pauseform]'), function (f) {
      f.onsubmit = function (e) {
        e.preventDefault();
        var btn = f.querySelector('button[type=submit]');
        if (!armed(btn, 'Wirklich alle Termine absagen?')) return;
        btn.disabled = true;
        post('pause', { kurs: f.getAttribute('data-pauseform'), von: f.elements.von.value, bis: f.elements.bis.value, grund: f.elements.grund.value, pt_frei: f.elements.ptfrei.checked })
          .then(function (r) { S.pause = ''; A.note(r.abgesagt ? 'Pause eingetragen: ' + r.abgesagt + (r.abgesagt === 1 ? ' Termin fällt' : ' Termine fallen') + ' aus.' : 'In diesem Zeitraum gab es keinen Termin mehr.'); return laden(); })
          .catch(function (err) { btn.disabled = false; A.note(err.message, true); });
      };
    });
  }

  /* ---------- Termine ---------- */
  function belegtText(t) {
    var b = t.belegung, qu = b.quelle || {};
    var teile = [];
    if (qu.karte) teile.push('Karte ' + qu.karte);
    if (qu.tageskarte || qu.warteliste) teile.push('Tageskarte ' + ((qu.tageskarte || 0) + (qu.warteliste || 0)));
    if (qu.inklusiv) teile.push('Inklusiv ' + qu.inklusiv);
    if (qu.ersatz) teile.push('Ersatz ' + qu.ersatz);
    if (qu.manuell) teile.push('Manuell ' + qu.manuell);
    if (b.usc) teile.push('USC ' + b.usc + (t.usc_gemeinsam ? '' : ' (extra)'));
    return teile.join(' · ');
  }

  function vTermine() {
    var d = S.data;
    if (!d.kurse.length) { body('<div class="ad-empty">Noch kein Kurs angelegt. <button type="button" class="ad-linkbtn" data-go="kurse">Kurs anlegen</button></div>'); on('[data-go]', function () { S.view = 'kurse'; S.edit = { neu: true }; render(); }); return; }
    var list = d.termine.filter(function (t) { return !t.vorbei && (!S.kurs || t.kurs === S.kurs); });
    var html = '<div class="ad-sec-head"><h2>Kurstermine</h2><button type="button" class="ad-refresh" id="akReload">Neu laden</button></div>'
      + (d.blockiert_pt ? '<p class="ad-hint">Kurszeiten sind f&uuml;r dein Personal Training automatisch blockiert &ndash; online, in „Zeit blockieren“ und beim Verschieben.</p>' : '')
      + (list.length ? '<div class="ad-list">' + list.map(terminKarte).join('') + '</div>' : '<div class="ad-empty">Keine kommenden Termine.</div>');
    body(html);
    q('#akReload').onclick = function () { laden().then(function () { A.note('Aktualisiert.'); }); };
    on('[data-tn]', function (b) { var k = b.getAttribute('data-tn'); S.offen[k] = S.offen[k] === 'tn' ? '' : 'tn'; vTermine(); });
    on('[data-plus]', function (b) { var k = b.getAttribute('data-plus'); S.offen[k] = S.offen[k] === 'plus' ? '' : 'plus'; vTermine(); });
    on('[data-abs]', function (b) { var k = b.getAttribute('data-abs'); S.offen[k] = S.offen[k] === 'abs' ? '' : 'abs'; vTermine(); });
    on('[data-rm]', function (b) {
      if (!armed(b, 'Wirklich entfernen?')) return;
      var x = b.getAttribute('data-rm').split('|');
      b.disabled = true;
      post('teilnehmer-entfernen', { kurs: x[0], datum: x[1], sitz: x[2], mit_erstattung: false })
        .then(function () { A.note('Entfernt. Wer auf der Warteliste steht, bekommt ein Angebot.'); return laden(); })
        .catch(function (e) { b.disabled = false; A.note(e.message, true); });
    });
    on('[data-wlrm]', function (b) {
      var x = b.getAttribute('data-wlrm').split('|');
      post('warteliste-entfernen', { kurs: x[0], datum: x[1], id: x[2] }).then(function () { A.note('Von der Warteliste genommen.'); return laden(); })
        .catch(function (e) { A.note(e.message, true); });
    });
    Array.prototype.forEach.call(qa('form[data-plusform]'), function (f) {
      f.onsubmit = function (e) {
        e.preventDefault();
        var x = f.getAttribute('data-plusform').split('|');
        post('teilnehmer', { kurs: x[0], datum: x[1], name: f.elements.name.value, email: f.elements.email.value, phone: f.elements.phone.value,
          notiz: f.elements.notiz.value, mail: f.elements.mail.checked, ueber_kapazitaet: f.elements.ueber.checked })
          .then(function () { A.note('Eingetragen.'); S.offen[x[0] + '|' + x[1]] = 'tn'; return laden(); })
          .catch(function (err) { A.note(err.message, true); });
      };
    });
    Array.prototype.forEach.call(qa('form[data-absform]'), function (f) {
      var modus = function () { var e = f.querySelector('[name=modus]:checked').value === 'ersatz'; f.querySelector('.ak-ersatz').hidden = !e; };
      Array.prototype.forEach.call(f.querySelectorAll('[name=modus]'), function (r) { r.onchange = modus; });
      var sel = f.elements.ersatz;
      sel.onchange = function () { f.querySelector('.ak-sonder').hidden = sel.value !== 'sonder'; };
      modus();
      f.onsubmit = function (e) {
        e.preventDefault();
        var btn = f.querySelector('button[type=submit]');
        if (!armed(btn, 'Wirklich absagen und informieren?')) return;
        var x = f.getAttribute('data-absform').split('|');
        var b = { kurs: x[0], datum: x[1], grund: f.elements.grund.value, modus: f.querySelector('[name=modus]:checked').value,
          pt_frei: f.elements.ptfrei.checked, benachrichtigen: f.elements.mail.checked };
        if (b.modus === 'ersatz') {
          b.ersatz = sel.value === 'sonder' ? { datum: f.elements.sdatum.value, start: f.elements.sstart.value } : { datum: sel.value };
        }
        btn.disabled = true;
        post('absage', b).then(function (r) {
          A.note('Abgesagt. ' + r.betroffen + ' betroffen, ' + r.mails + ' Mails raus.' + (r.modus === 'erstattung' && r.betroffen ? ' Erstattungen stehen im Reiter „Erstattungen“.' : ''));
          S.offen[x[0] + '|' + x[1]] = '';
          return laden();
        }).catch(function (err) {
          btn.disabled = false;
          var k = err.message;
          A.note(k, true);
        });
      };
    });
  }

  function terminKarte(t) {
    var key = t.kurs + '|' + t.datum;
    var b = t.belegung, offen = S.offen[key] || '';
    var aktiv = t.plaetze.filter(function (z) { return z.status === 'gebucht' || z.status === 'reserviert'; });
    var head = '<div class="ad-card' + (t.abgesagt ? ' ak-aus' : '') + '"><div class="ad-card-top"><span class="ad-when">' + esc(dk(t.datum)) + ' &middot; ' + esc(t.start) + '–' + esc(t.ende) + '</span>'
      + '<span class="ad-tagline">' + esc(t.titel) + (t.extra ? ' · Sondertermin' : '') + '</span></div>';
    if (t.abgesagt) {
      return head + '<div class="ad-who">F&auml;llt aus</div><div class="ad-meta">' + esc((t.absage && t.absage.grund) || '') + (t.absage && t.absage.ersatz ? ' · Ersatz ' + esc(dk(t.absage.ersatz.datum)) + ' ' + esc(t.absage.ersatz.start) : '')
        + (t.absage && t.absage.modus === 'erstattung' ? ' · Erstattung' : '') + (t.absage && t.absage.pt_frei ? ' · Zeit fürs PT frei' : '') + '</div></div>';
    }
    var bar = '<div class="ak-bar"><span style="width:' + Math.min(100, Math.round(100 * b.belegt / b.kap)) + '%"></span></div>';
    var html = head
      + '<div class="ad-who">' + (b.gebucht + b.reserviert + (t.usc_gemeinsam ? b.usc : 0)) + ' / ' + b.kap + ' belegt' + (b.ueberbucht ? ' <span class="ak-warn">überbucht</span>' : '') + ' &middot; <span style="color:var(--blitz)">' + b.frei + ' frei</span></div>'
      + bar
      + '<div class="ad-meta">' + esc(belegtText(t) || 'noch keine Buchungen') + (b.reserviert ? ' · ' + b.reserviert + ' gerade in der Zahlung' : '') + '</div>'
      + '<div class="ad-meta">' + (t.tageskarte_offen ? 'Tageskarten offen' : 'Tageskarten ab ' + esc(hm(t.tageskarte_ab))) + (t.min_teilnehmer ? ' · Mindestens ' + t.min_teilnehmer + ' (nur Info)' : '') + (t.warteliste.length ? ' · Warteliste ' + t.warteliste.length : '') + '</div>'
      + '<div class="ad-actions">'
      + '<button type="button" class="ad-mini" data-tn="' + esc(key) + '">' + (offen === 'tn' ? 'Liste zu' : 'Teilnehmende (' + aktiv.length + ')') + '</button>'
      + '<button type="button" class="ad-mini" data-plus="' + esc(key) + '">+ Eintragen</button>'
      + '<button type="button" class="ad-mini ak-red" data-abs="' + esc(key) + '">Termin absagen</button></div>';
    if (offen === 'tn') {
      html += '<div class="ak-tn">' + (aktiv.length ? aktiv.map(function (z) {
        return '<div class="ak-tn-row"><div><b>' + esc(z.name) + '</b> <span class="ak-src">' + esc(z.quelle_label) + (z.status === 'reserviert' ? (z.angebot ? ' · Angebot bis ' + esc(hm(z.bis)) : ' · in Zahlung') : '')
          + (z.ersatz_fuer ? ' · Ersatz für ' + esc(dk(z.ersatz_fuer)) + (z.antwort ? ' (' + esc(z.antwort) + ')' : '') : '') + '</span><br>'
          + (z.phone ? '<a class="ad-link" href="tel:' + esc(z.phone.replace(/\s/g, '')) + '">' + esc(z.phone) + '</a>' : '')
          + (z.email ? '<a class="ad-link" href="mailto:' + esc(z.email) + '">' + esc(z.email) + '</a>' : '') + (z.notiz ? '<div class="ad-meta">' + esc(z.notiz) + '</div>' : '') + '</div>'
          + (z.status === 'gebucht' ? '<button type="button" class="ad-undo" data-rm="' + esc(key + '|' + z.id) + '">Entfernen</button>' : '') + '</div>';
      }).join('') : '<div class="ad-empty">Noch niemand.</div>')
        + (t.warteliste.length ? '<div class="ak-sub">Warteliste</div>' + t.warteliste.map(function (w, i) {
          return '<div class="ak-tn-row"><div><b>' + (i + 1) + '. ' + esc(w.name) + '</b> <span class="ak-src">' + (w.status === 'angeboten' ? 'Angebot bis ' + esc(hm(w.angebot_bis)) : 'wartet') + '</span><br>'
            + '<a class="ad-link" href="mailto:' + esc(w.email) + '">' + esc(w.email) + '</a>' + (w.phone ? '<a class="ad-link" href="tel:' + esc(w.phone.replace(/\s/g, '')) + '">' + esc(w.phone) + '</a>' : '') + '</div>'
            + '<button type="button" class="ad-undo" data-wlrm="' + esc(key + '|' + w.id) + '">Raus</button></div>';
        }).join('') : '') + '</div>';
    }
    if (offen === 'plus') {
      html += '<form class="ad-issue ak-form" data-plusform="' + esc(key) + '"><div class="ak-grid">'
        + '<div class="ad-field"><label>Name</label><input name="name" required></div>'
        + '<div class="ad-field"><label>E-Mail (optional)</label><input name="email" type="email"></div>'
        + '<div class="ad-field"><label>Telefon</label><input name="phone"></div>'
        + '<div class="ad-field"><label>Notiz</label><input name="notiz" placeholder="z. B. bar bezahlt, 4er-Karte inklusive"></div></div>'
        + '<label class="ak-check"><input type="checkbox" name="mail"> Best&auml;tigung per Mail schicken</label>'
        + '<label class="ak-check"><input type="checkbox" name="ueber"> Auch wenn der Termin voll ist</label>'
        + '<button type="submit" class="btn btn-blitz">Eintragen</button>'
        + '<p class="ad-hint" style="margin-top:12px">F&uuml;r Barzahlung, Kulanz oder Probestunde. Es l&auml;uft keine Zahlung &uuml;ber Stripe.</p></form>';
    }
    if (offen === 'abs') {
      var andere = S.data.termine.filter(function (x) { return x.kurs === t.kurs && x.datum !== t.datum && !x.vorbei && !x.abgesagt; });
      html += '<form class="ad-issue ak-form ak-absform" data-absform="' + esc(key) + '">'
        + '<div class="ad-field"><label>Grund (steht in der Mail)</label><input name="grund" placeholder="z. B. Ich bin leider krank."></div>'
        + '<div class="ak-radio"><label><input type="radio" name="modus" value="ersatz" checked> Ersatztermin anbieten</label><label><input type="radio" name="modus" value="erstattung"> Erstattung</label></div>'
        + '<div class="ak-ersatz"><div class="ad-field"><label>Ersatztermin</label><select name="ersatz">'
        + andere.map(function (x) { return '<option value="' + esc(x.datum) + '">' + esc(dk(x.datum)) + ' ' + esc(x.start) + ' · ' + x.belegung.frei + ' frei</option>'; }).join('')
        + '<option value="sonder">Sondertermin (anderer Tag / andere Uhrzeit) …</option></select></div>'
        + '<div class="ak-sonder ak-grid"' + (andere.length ? ' hidden' : '') + '><div class="ad-field"><label>Datum</label><input type="date" name="sdatum"></div><div class="ad-field"><label>Uhrzeit</label><input type="time" name="sstart" value="' + esc(t.start) + '"></div></div>'
        + '<p class="ad-hint">Alle Gebuchten bekommen am Ersatztermin einen Platz und per Mail die Wahl: annehmen oder Geld zur&uuml;ck.</p></div>'
        + '<label class="ak-check"><input type="checkbox" name="mail" checked> Teilnehmende per Mail informieren</label>'
        + '<label class="ak-check"><input type="checkbox" name="ptfrei"> Zeit wieder f&uuml;rs Personal Training freigeben</label>'
        + '<button type="submit" class="ad-danger">Termin absagen</button></form>';
    }
    return html + '</div>';
  }

  /* ---------- USC ---------- */
  function vUsc() {
    var d = S.data;
    var html = '<h2>Freie Pl&auml;tze f&uuml;r Urban Sports melden</h2>'
      + '<p class="ad-hint">Sobald f&uuml;r einen Termin die Tageskarten freigeschaltet sind, steht er hier. Melde die freien Pl&auml;tze bei Urban Sports Club und trag ein, wie viele du gemeldet hast. Du kannst die Zahl jederzeit anpassen. '
      + (d.einstellungen.usc_gemeinsam ? 'USC-Pl&auml;tze gehen vom selben Restkontingent ab wie die Tageskarten.' : 'USC-Pl&auml;tze kommen zus&auml;tzlich zur Kapazit&auml;t.') + '</p>'
      + (d.usc.length ? '<div class="ad-list">' + d.usc.map(function (u) {
        return '<div class="ad-card ad-card-sm ak-usc"><div><b>' + esc(dk(u.datum)) + ' · ' + esc(u.start) + '</b><br><span class="ad-meta">' + esc(u.titel) + ' · <span style="color:var(--blitz)">' + u.frei + ' frei</span>' + (u.gemeinsam ? ' · max. ' + u.max + ' meldbar' : '') + '</span></div>'
          + '<div class="ak-usc-in"><input type="number" min="0" max="' + (u.gemeinsam ? u.max : 50) + '" value="' + u.gemeldet + '" data-usc="' + esc(u.kurs + '|' + u.datum) + '"><button type="button" class="ad-undo" data-uscsave="' + esc(u.kurs + '|' + u.datum) + '">Speichern</button></div></div>';
      }).join('') + '</div>' : '<div class="ad-empty">Gerade gibt es nichts zu melden. Termine erscheinen hier ' + d.einstellungen.freischalt_tage + ' Tage vorher.</div>');
    body(html);
    on('[data-uscsave]', function (b) {
      var k = b.getAttribute('data-uscsave'), x = k.split('|');
      var inp = box.querySelector('[data-usc="' + k + '"]');
      b.disabled = true;
      post('usc', { kurs: x[0], datum: x[1], plaetze: Number(inp.value) }).then(function () { A.note('USC-Plätze gespeichert.'); return laden(); })
        .catch(function (e) { b.disabled = false; A.note(e.message, true); });
    });
  }

  /* ---------- Erstattungen ---------- */
  function vErstattungen() {
    var d = S.data;
    var html = '<h2>Erstattungen</h2><p class="ad-hint">Entstehen bei Absagen durch dich. Der Barteil geht &uuml;ber Stripe aufs urspr&uuml;ngliche Zahlungsmittel zur&uuml;ck, der Gutscheinteil automatisch auf den Gutschein. Die Kundin oder der Kunde bekommt eine Mail.</p>'
      + (d.erstattungen.length ? '<div class="ad-list">' + d.erstattungen.map(function (e) {
        return '<div class="ad-card"><div class="ad-card-top"><span class="ad-when">' + esc(dk(e.datum)) + '</span><span class="ad-tagline">' + (e.status === 'angefordert' ? 'vom Kunden gewählt' : 'Absage') + '</span></div>'
          + '<div class="ad-who">' + esc(e.name) + '</div><div class="ad-meta">' + eur(e.cents_bar) + ' über Stripe' + (e.cents_gutschein ? ' + ' + eur(e.cents_gutschein) + ' zurück auf Gutschein' : '') + ' · ' + esc(e.grund || '') + '</div>'
          + '<div class="ad-actions">' + (e.cents_bar ? '<button type="button" class="ad-mini" data-er="' + esc(e.id) + '" data-wie="ausfuehren">In Stripe erstatten (' + eur(e.cents_bar) + ')</button>' : '<button type="button" class="ad-mini" data-er="' + esc(e.id) + '" data-wie="ausfuehren">Gutschein gutschreiben</button>')
          + '<button type="button" class="ad-mini" data-er="' + esc(e.id) + '" data-wie="erledigt">Schon von Hand erledigt</button></div></div>';
      }).join('') + '</div>' : '<div class="ad-empty">Keine offenen Erstattungen.</div>')
      + (d.erledigt.length ? '<h2 style="margin-top:28px">Zuletzt erledigt</h2><div class="ad-list">' + d.erledigt.slice().reverse().map(function (e) {
        return '<div class="ad-card ad-card-sm"><div><b>' + esc(e.name) + '</b><br><span class="ad-meta">' + esc(dk(e.datum)) + ' · ' + eur(e.cents_bar + e.cents_gutschein) + ' · ' + (e.wie === 'ausfuehren' ? 'über Stripe' : 'von Hand') + '</span></div></div>';
      }).join('') + '</div>' : '');
    body(html);
    on('[data-er]', function (b) {
      if (!armed(b, 'Wirklich? Ja, auslösen')) return;
      b.disabled = true;
      post('erstattung', { id: b.getAttribute('data-er'), aktion: b.getAttribute('data-wie') }).then(function () { A.note('Erstattung erledigt, Mail ist raus.'); return laden(); })
        .catch(function (e) { b.disabled = false; A.note(e.message, true); });
    });
  }

  /* ---------- Kurse ---------- */
  function vKurse() {
    if (!S.edit) { S.view = 'home'; return render(); }
    kursForm();
  }

  /* ---------- Startseite: Kurse ---------- */
  function zeile(view, ico, titel, sub) {
    return '<button type="button" class="mh-row" data-view="' + view + '"><span class="mh-ico">' + ico + '</span><span class="mh-txt"><b>' + titel + '</b><small>' + sub + '</small></span><span class="hd-chev">&rsaquo;</span></button>';
  }
  function vHome() {
    var d = S.data, todo = [];
    if (d.erstattungen.length) todo.push(zeile('erstattungen', '&euro;', d.erstattungen.length + (d.erstattungen.length === 1 ? ' Erstattung offen' : ' Erstattungen offen'), 'Nach Kursabsagen &ndash; ausf&uuml;hren oder abhaken'));
    if (d.usc.length) todo.push(zeile('usc', '&#9889;', d.usc.length + (d.usc.length === 1 ? ' Termin' : ' Termine') + ' f&uuml;r Urban Sports melden', 'Freie Pl&auml;tze bei Urban Sports Club eintragen'));
    var html = (todo.length ? '<h3 class="hd-h" style="margin-top:4px">Zu tun</h3><div class="mh-group">' + todo.join('') + '</div>' : '')
      + '<div class="ad-sec-head"><h2>Meine Kurse</h2><button type="button" class="ad-refresh" id="akNeu">+ Neuer Kurs</button></div>'
      + (d.kurse.length ? '<div class="ad-list">' + d.kurse.map(function (k) {
        var next = d.termine.filter(function (t) { return t.kurs === k.id && !t.vorbei && !t.abgesagt; })[0];
        var bel = next ? next.belegung.gebucht + next.belegung.reserviert + (next.usc_gemeinsam ? next.belegung.usc : 0) : 0;
        return '<div class="ad-card"><div class="ad-card-top"><span class="ad-when">' + esc(k.titel) + '</span><span class="ad-tagline">' + (k.aktiv ? (k.sichtbar === false ? 'aktiv · versteckt' : 'aktiv') : 'Entwurf') + '</span></div>'
          + '<div class="ad-meta">' + esc(WDL[k.wochentag]) + 's ' + esc(k.start) + ' · ' + k.minuten + ' Min. · ' + k.kapazitaet + ' Pl&auml;tze · ' + esc(k.ort) + '</div>'
          + '<div class="ad-meta">' + (next ? 'N&auml;chster Termin: ' + esc(dk(next.datum)) + ' &middot; <b>' + bel + ' / ' + next.belegung.kap + ' belegt</b>' : 'Kein kommender Termin') + '</div>'
          + '<div class="ad-actions"><button type="button" class="ad-mini" data-view="termine" data-kurs="' + esc(k.id) + '">Termine &amp; Teilnehmende</button>'
          + '<button type="button" class="ad-mini" data-view="bestellungen" data-kurs="' + esc(k.id) + '">Bestellungen</button>'
          + '<button type="button" class="ad-mini" data-ed="' + esc(k.id) + '">Bearbeiten</button>'
          + '<button type="button" class="ad-mini" data-pause="' + esc(k.id) + '">Pause</button></div>' + pauseBox(k) + '</div>';
      }).join('') + '</div>' : '<div class="ad-empty"><b>Noch kein Kurs.</b><br>So legst du den ersten an: 1) &bdquo;+ Neuer Kurs&ldquo; tippen, 2) Wochentag, Uhrzeit und Pl&auml;tze eintragen, 3) &bdquo;aktiv&ldquo; setzen und speichern.</div>')
      + '<h3 class="hd-h">Weiteres</h3><div class="mh-group">'
      + zeile('karten', '&#127903;', 'Kurskarten', '5er- und 10er-Karten: Stand, Ausnahmen gutschreiben')
      + zeile('mitteilung', '&#128276;', 'Mitteilung an Mitglieder', 'Kurs f&auml;llt aus, freie Pl&auml;tze, Specials aufs Handy')
      + zeile('bestellungen', '&#128269;', 'Alle Bestellungen', 'Suchen nach Name, E-Mail oder Code')
      + zeile('einstellungen', '&#9881;', 'Preise &amp; Regeln', 'Tageskarte, Karten und Fristen f&uuml;r Kurse')
      + (d.erstattungen.length ? '' : zeile('erstattungen', '&euro;', 'Erstattungen', 'Keine offenen &ndash; hier siehst du die erledigten'))
      + zeile('usc', '&#9889;', 'Urban Sports', 'Freie Pl&auml;tze melden') + '</div>';
    body(html);
    on('[data-view]', gehe);
    pauseBind();
    q('#akNeu').onclick = function () { S.edit = { neu: true }; S.view = 'kurse'; render(); window.scrollTo(0, 0); };
    on('[data-ed]', function (b) { S.edit = S.data.kurse.filter(function (k) { return k.id === b.getAttribute('data-ed'); })[0]; S.view = 'kurse'; render(); window.scrollTo(0, 0); });
  }

  function kursForm() {
    var k = S.edit.neu ? { wochentag: 1, start: '18:00', minuten: 60, kapazitaet: 12, ort: 'Forged Studio Solingen', adresse: 'Prinzenstraße 2a, 42697 Solingen', start_datum: new Date().toISOString().slice(0, 10), produkte: {}, preise: {}, aktiv: false, sichtbar: true } : S.edit;
    var s = S.data.einstellungen;
    var pr = k.preise || {}, pd = k.produkte || {};
    var cent = function (v) { return v == null ? '' : Math.round(v / 100); };
    var prod = function (art, label) {
      var x = pd[art] || {};
      return '<div class="ak-prod"><b>' + label + '</b><label class="ak-check"><input type="checkbox" name="' + art + '_aktiv"' + (x.aktiv !== false ? ' checked' : '') + '> angeboten</label>'
        + '<label class="ak-check"><input type="checkbox" name="' + art + '_wr"' + (x.widerruf_ausgeschlossen !== false ? ' checked' : '') + '> widerruf_ausgeschlossen (§ 312g Abs. 2 Nr. 9 BGB)</label></div>';
    };
    var html = '<h2>' + (S.edit.neu ? 'Neuer Kurs' : 'Kurs bearbeiten') + '</h2><form class="ak-kurs" id="akKursForm">'
      + '<div class="ak-grid">'
      + '<div class="ad-field"><label>Name</label><input name="titel" value="' + esc(k.titel || '') + '" required placeholder="z. B. Bootcamp"></div>'
      + '<div class="ad-field"><label>Anbieterin</label><select name="p">' + S.data.anbieterinnen.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === S.p ? ' selected' : '') + ' disabled>' + esc(a.name) + '</option>'; }).join('') + '</select></div>'
      + '<div class="ad-field"><label>Wochentag</label><select name="wochentag">' + WDL.map(function (w, i) { return '<option value="' + i + '"' + (Number(k.wochentag) === i ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select></div>'
      + '<div class="ad-field"><label>Uhrzeit</label><input type="time" name="start" value="' + esc(k.start) + '"></div>'
      + '<div class="ad-field"><label>Dauer (Min.)</label><input type="number" name="minuten" value="' + esc(k.minuten) + '" min="15" max="240"></div>'
      + '<div class="ad-field"><label>Kapazität pro Termin</label><input type="number" name="kapazitaet" value="' + esc(k.kapazitaet) + '" min="1" max="100"></div>'
      + '<div class="ad-field"><label>Erster Termin ab</label><input type="date" name="start_datum" value="' + esc(k.start_datum) + '"></div>'
      + '<div class="ad-field"><label>Letzter Termin (leer = laufend)</label><input type="date" name="end_datum" value="' + esc(k.end_datum || '') + '"></div>'
      + '<div class="ad-field"><label>Ort</label><input name="ort" value="' + esc(k.ort) + '"></div>'
      + '<div class="ad-field"><label>Raum im Studio</label><input name="raum" list="akRaeume" value="' + esc(k.raum || '') + '" maxlength="40" placeholder="z. B. Functional Area"><datalist id="akRaeume"><option value="Functional Area"><option value="Kursraum"></datalist></div>'
      + '<div class="ad-field"><label>Adresse</label><input name="adresse" value="' + esc(k.adresse || '') + '"></div>'
      + '<div class="ad-field"><label>Mindestteilnehmer (nur Info)</label><input type="number" name="min_teilnehmer" value="' + esc(k.min_teilnehmer || '') + '" min="1"></div>'
      + '<div class="ad-field"><label>Puffer fürs PT (Min.)</label><input type="number" name="puffer_min" value="' + esc(k.puffer_min || 0) + '" min="0" max="120"></div>'
      + '</div>'
      + '<div class="ad-field"><label>Kurzbeschreibung (1–2 Sätze, steht in der Kursübersicht; leer = erster Satz der Beschreibung)</label><textarea name="kurz" rows="2" maxlength="220">' + esc(k.kurz || '') + '</textarea></div>'
      + '<div class="ad-field"><label>Beschreibung (öffentlich, erscheint beim Aufklappen)</label><textarea name="beschreibung" rows="6" maxlength="700">' + esc(k.beschreibung || '') + '</textarea></div>'
      + '<div class="ak-grid">'
      + '<div class="ad-field"><label>Art (z. B. Fitness, Mobility)</label><input name="kategorie" value="' + esc(k.kategorie || '') + '" maxlength="40"></div>'
      + '<div class="ad-field"><label>Farbe Platzhalterbild</label><input type="color" name="farbe" value="' + esc(k.farbe || '#7a5c12') + '" style="height:50px;padding:4px"></div>'
      + '</div>'
      + '<div class="ad-field"><label>Bild</label><input type="hidden" name="bild" value="' + esc(k.bild || '') + '">'
      + '<div class="ak-bildwahl"><div class="ak-bild-prev" id="akBildPrev"></div><div class="ak-bild-side"><div class="ad-meta" id="akBildName"></div>'
      + '<div class="ad-actions"><button type="button" class="ad-mini" id="akBildOpen">Bild w&auml;hlen</button><button type="button" class="ad-mini" id="akBildWeg">Kein Bild</button></div></div></div>'
      + '<div id="akBildPanel" class="ak-bildpanel" hidden></div></div>'
      + '<h2 style="margin-top:22px">Vorschau</h2><p class="ad-hint">So erscheint der Kurs in der \u00dcbersicht auf der Website. Die Vorschau aktualisiert sich beim Tippen und beim Bild-W\u00e4hlen. Tipp in der Vorschau auf \u201eMehr erfahren\u201c, um die ganze Beschreibung zu sehen.</p>'
      + '<div class="ak-vorschau"><div class="ak-vl">Am Computer</div><div class="ak-vp" id="akVpD"></div><div class="ak-vl">Am Handy</div><div class="ak-vp ak-vpm" id="akVpM"></div></div>'
      + '<h2 style="margin-top:22px">Freischaltung &amp; USC</h2><div class="ak-grid">'
      + '<div class="ad-field"><label>Tageskarten X Tage vorher (leer = ' + s.freischalt_tage + ')</label><input type="number" name="freischalt_tage" value="' + esc(k.freischalt_tage == null ? '' : k.freischalt_tage) + '" min="0" max="60"></div>'
      + '<div class="ad-field"><label>USC-Plätze</label><select name="usc_gemeinsam"><option value="">Standard (' + (s.usc_gemeinsam ? 'gemeinsam' : 'zusätzlich') + ')</option><option value="true"' + (k.usc_gemeinsam === true ? ' selected' : '') + '>vom selben Restkontingent</option><option value="false"' + (k.usc_gemeinsam === false ? ' selected' : '') + '>zusätzlich zur Kapazität</option></select></div>'
      + '</div>'
      + '<h2 style="margin-top:22px">Preise (leer = Standard)</h2><div class="ak-grid">'
      + '<div class="ad-field"><label>Tageskarte (' + eur(s.tageskarte_cents) + ')</label><div class="ad-eur"><input type="number" name="tk" value="' + cent(pr.tageskarte_cents) + '" min="0"><span>&euro;</span></div></div>'
      + '<div class="ad-field"><label>5er-Karte (' + eur(s.karten.karte5.cents) + ')</label><div class="ad-eur"><input type="number" name="k5" value="' + cent(pr.karte5_cents) + '" min="0"><span>&euro;</span></div></div>'
      + '<div class="ad-field"><label>10er-Karte (' + eur(s.karten.karte10.cents) + ')</label><div class="ad-eur"><input type="number" name="k10" value="' + cent(pr.karte10_cents) + '" min="0"><span>&euro;</span></div></div>'
      + '</div>'
      + '<h2 style="margin-top:22px">Angebote</h2>' + prod('karte5', '5er-Karte') + prod('karte10', '10er-Karte') + prod('tageskarte', 'Tageskarte')
      + '<h2 style="margin-top:22px">Status</h2>'
      + '<label class="ak-check"><input type="checkbox" name="aktiv"' + (k.aktiv ? ' checked' : '') + '> aktiv (buchbar, blockiert dein Personal Training)</label>'
      + '<label class="ak-check"><input type="checkbox" name="sichtbar"' + (k.sichtbar !== false ? ' checked' : '') + '> auf der Website sichtbar</label>'
      + '<label class="ak-check"><input type="checkbox" name="blockiert_pt"' + (k.blockiert_pt !== false ? ' checked' : '') + '> blockiert Personal-Training-Slots</label>'
      + '<div id="akKonf"></div>'
      + '<div class="ad-actions"><button type="submit" class="btn btn-blitz">Speichern</button><button type="button" class="ad-undo" id="akAbbr">Abbrechen</button></div></form>';
    body(html);
    q('#akAbbr').onclick = function () { S.edit = null; render(); };
    var f = q('#akKursForm');
    bildWahl(f);
    vorschau(f);
    var senden = function (force) {
      var e = f.elements;
      var num = function (v) { return v === '' ? null : Number(v); };
      var euro = function (v) { return v === '' ? null : Math.round(Number(v) * 100); };
      var kurs = {
        id: S.edit.neu ? undefined : S.edit.id, titel: e.titel.value, wochentag: Number(e.wochentag.value), start: e.start.value,
        minuten: Number(e.minuten.value), kapazitaet: Number(e.kapazitaet.value), start_datum: e.start_datum.value, end_datum: e.end_datum.value,
        ort: e.ort.value, adresse: e.adresse.value, min_teilnehmer: num(e.min_teilnehmer.value), puffer_min: num(e.puffer_min.value),
        beschreibung: e.beschreibung.value, kurz: e.kurz.value, raum: e.raum.value, freischalt_tage: num(e.freischalt_tage.value),
        kategorie: e.kategorie.value, farbe: e.farbe.value, bild: e.bild.value.trim(),
        usc_gemeinsam: e.usc_gemeinsam.value === '' ? null : e.usc_gemeinsam.value === 'true',
        preise: { tageskarte_cents: euro(e.tk.value), karte5_cents: euro(e.k5.value), karte10_cents: euro(e.k10.value) },
        produkte: {
          karte5: { aktiv: e.karte5_aktiv.checked, widerruf_ausgeschlossen: e.karte5_wr.checked },
          karte10: { aktiv: e.karte10_aktiv.checked, widerruf_ausgeschlossen: e.karte10_wr.checked },
          tageskarte: { aktiv: e.tageskarte_aktiv.checked, widerruf_ausgeschlossen: e.tageskarte_wr.checked },
        },
        aktiv: e.aktiv.checked, sichtbar: e.sichtbar.checked, blockiert_pt: e.blockiert_pt.checked,
      };
      A.api('kurse/kurs', { body: { p: S.p, kurs: kurs, force: !!force } }).then(function () {
        A.note('Kurs gespeichert.'); S.edit = null; return laden();
      }).catch(function (err) {
        // 409 mit Konflikten: Liste zeigen und bewusst bestätigen lassen
        A.note(err.message, true);
        q('#akKonf').innerHTML = '<div class="ad-resv-hint" style="margin-top:14px">' + esc(err.message) + '<br><button type="button" class="ad-linkbtn" id="akForce">Trotzdem speichern</button></div>';
        q('#akForce').onclick = function () { senden(true); };
      });
    };
    f.onsubmit = function (ev) { ev.preventDefault(); senden(false); };
  }

  /* ---------- Bestellungen ---------- */
  function vBestellungen() {
    body('<h2>Bestellungen</h2><input type="search" class="ad-search" id="akSuche" placeholder="Name, E-Mail, Gutschein oder Kartencode" value="' + esc(S.bq || '') + '"><div id="akBest" class="ad-list"><div class="ad-empty">L&auml;dt …</div></div>');
    var t;
    q('#akSuche').oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { S.bq = v; liste(); }, 300); };
    function liste() {
      A.api('kurse/bestellungen?p=' + encodeURIComponent(S.p) + '&q=' + encodeURIComponent(S.bq || '')).then(function (d) {
        var bl = d.bestellungen.filter(function (o) { return !S.kurs || o.kurs === kursTitel(S.kurs); });
        q('#akBest').innerHTML = bl.length ? bl.map(function (o) {
          return '<div class="ad-card"><div class="ad-card-top"><span class="ad-code">' + esc(o.label) + '</span><span class="ad-tagline">' + esc(o.kurs) + '</span></div>'
            + '<div class="ad-who">' + esc(o.name) + '</div><div class="ad-meta">' + esc(o.email) + (o.phone ? ' · ' + esc(o.phone) : '') + '</div>'
            + '<div class="ad-meta">' + o.termine.map(dk).join(', ') + '</div>'
            + '<div class="ad-meta">Preis ' + esc(o.preis) + ' · bezahlt ' + esc(o.bezahlt) + (o.gutschein ? ' · Gutschein ' + esc(o.gutschein) : '') + (o.pay_status === 'unpaid' ? ' · Lastschrift läuft' : o.pay_status === 'failed' ? ' · LASTSCHRIFT GEPLATZT' : '')
            + (o.ueberbucht.length ? ' · <span class="ak-warn">überbucht ' + o.ueberbucht.map(dk).join(', ') + '</span>' : '') + (o.gutschein_problem ? ' · <span class="ak-warn">' + esc(o.gutschein_problem) + '</span>' : '') + '</div></div>';
        }).join('') : '<div class="ad-empty">Nichts gefunden.</div>';
      }).catch(function (e) { A.note(e.message, true); });
    }
    liste();
  }

  /* ---------- Kurskarten (ohne feste Termine) ---------- */
  var KST = { gebucht: 'gebucht', freigegeben: 'abgesagt · zurück', verfallen: 'verfallen', gutgeschrieben: 'gutgeschrieben' };
  function vKarten() {
    body('<h2>Kurskarten</h2><p class="ad-hint">Karten ohne feste Termine. Zu sp&auml;t abgesagte Eins&auml;tze (unter 24&nbsp;Stunden) verfallen &ndash; f&uuml;r Ausnahmen kannst du sie hier gutschreiben.</p><input type="search" class="ad-search" id="akKs" placeholder="Name, E-Mail oder Kartencode" value="' + esc(S.kq || '') + '"><div id="akKl" class="ad-list"><div class="ad-empty">L&auml;dt …</div></div>');
    q('#akKs').oninput = function () { S.kq = this.value; zeige(); };
    var daten = [];
    function zeige() {
      var f = String(S.kq || '').toLowerCase();
      var l = daten.filter(function (c) { return !f || (c.name + ' ' + c.email + ' ' + c.code).toLowerCase().indexOf(f) !== -1; });
      q('#akKl').innerHTML = l.length ? l.map(function (c) {
        return '<div class="ad-card"><div class="ad-card-top"><span class="ad-code">' + esc(c.code) + '</span><span class="ad-tagline">' + esc(c.label) + '</span></div>'
          + '<div class="ad-who">' + esc(c.name) + '</div><div class="ad-meta">' + esc(c.email) + (c.telefon ? ' &middot; ' + esc(c.telefon) : '') + '</div>'
          + (c.adresse ? '<div class="ad-meta">' + esc(c.adresse) + '</div>' : '')
          + (c.profil_geaendert ? '<div class="ad-meta"><b>Daten ge&auml;ndert am ' + esc(hm(c.profil_geaendert)) + '</b></div>' : '')
          + '<div class="ad-meta"><b>' + c.frei + ' von ' + (c.anzahl + c.korrektur) + ' frei</b> · g&uuml;ltig bis ' + esc(c.bis.split('-').reverse().join('.')) + (c.korrektur ? ' · Korrektur ' + (c.korrektur > 0 ? '+' : '') + c.korrektur : '') + '</div>'
          + (c.buchungen.length ? '<div class="ad-meta">' + c.buchungen.map(function (b) {
              return esc(dk(b.datum)) + ' ' + esc(b.start) + ' ' + esc(b.kurs_titel) + ' (' + esc(KST[b.status] || b.status) + ')'
                + (b.status === 'verfallen' ? ' <button type="button" class="ad-mini" data-gut="' + esc(c.code) + '|' + esc(b.bestellung) + '">gutschreiben</button>' : '');
            }).join('<br>') + '</div>' : '')
          + '<div class="ad-actions"><button type="button" class="ad-mini" data-plus="' + esc(c.code) + '">+1 Einheit</button>'
          + '<button type="button" class="ad-mini" data-minus="' + esc(c.code) + '">&minus;1 Einheit</button>'
          + '<button type="button" class="ad-mini" data-verl="' + esc(c.code) + '">+1 Monat g&uuml;ltig</button></div></div>';
      }).join('') : '<div class="ad-empty">Noch keine Karte verkauft.</div>';
      on('[data-gut]', function (b) { var x = b.getAttribute('data-gut').split('|'); if (!armed(b, 'Wirklich gutschreiben?')) return; aktion({ code: x[0], aktion: 'eintrag-gutschreiben', bestellung: x[1] }); });
      on('[data-plus]', function (b) { if (!armed(b, 'Wirklich +1?')) return; aktion({ code: b.getAttribute('data-plus'), aktion: 'gutschreiben' }); });
      on('[data-minus]', function (b) { if (!armed(b, 'Wirklich −1?')) return; aktion({ code: b.getAttribute('data-minus'), aktion: 'abziehen' }); });
      on('[data-verl]', function (b) { if (!armed(b, 'Wirklich verlängern?')) return; aktion({ code: b.getAttribute('data-verl'), aktion: 'verlaengern', monate: 1 }); });
    }
    function aktion(b) { post('karte-aktion', b).then(function (d) { daten = d.karten; zeige(); A.note('Gespeichert.'); }).catch(function (e) { A.note(e.message, true); }); }
    A.api('kurse/karten?p=' + encodeURIComponent(S.p)).then(function (d) { daten = d.karten; zeige(); }).catch(function (e) { A.note(e.message, true); });
  }

  /* ---------- Mitteilung an Mitglieder (Push aufs Handy) ---------- */
  function vMitteilung() {
    var termine = S.data.termine.filter(function (t) { return !t.vorbei && !t.abgesagt; });
    var opt = '<option value="">Ohne Termin-Link</option>' + termine.map(function (t) { return '<option value="' + esc(t.kurs + '|' + t.datum) + '">' + esc(kursTitel(t.kurs)) + ' &middot; ' + esc(dk(t.datum)) + ' ' + esc(t.start) + '</option>'; }).join('');
    body('<h2>Mitteilung an Mitglieder</h2>'
      + '<p class="ad-hint">Geht als Push-Nachricht aufs Handy der Mitglieder, die im Mitgliederbereich &bdquo;Mitteilungen einschalten&ldquo; getippt haben. Auf dem iPhone nur, wenn sie die App &uuml;ber den Home-Bildschirm nutzen.</p>'
      + '<div class="ad-card" id="akPInfo"><div class="ad-meta">L&auml;dt &hellip;</div></div>'
      + '<div class="ad-actions" style="margin:14px 0"><button type="button" class="ad-mini" data-vorl="ausfall">Vorlage: Kurs f&auml;llt aus</button><button type="button" class="ad-mini" data-vorl="frei">Vorlage: Pl&auml;tze frei</button></div>'
      + '<div class="ad-field"><label for="akPT">Titel</label><input id="akPT" maxlength="60" placeholder="z. B. Plätze frei am Samstag"></div>'
      + '<div class="ad-field"><label for="akPX">Text</label><textarea id="akPX" rows="3" maxlength="200" placeholder="Kurz und konkret, höchstens 200 Zeichen"></textarea></div>'
      + '<div class="ad-field"><label for="akPK">Termin (Link in der Nachricht)</label><select id="akPK">' + opt + '</select></div>'
      + '<div class="ad-field"><label for="akPZ">Empfänger</label><select id="akPZ"><option value="alle">Alle Mitglieder mit Mitteilungen</option><option value="gebucht">Nur Mitglieder, die diesen Termin gebucht haben</option></select></div>'
      + '<button type="button" class="btn btn-blitz" id="akPS">Senden</button>'
      + '<h3 class="hd-h" style="margin-top:26px">Zuletzt gesendet</h3><div id="akPLog"></div>');
    function info() {
      A.api('kurse/push-info', { body: { p: S.p } }).then(function (d) {
        q('#akPInfo').innerHTML = '<div class="ad-meta"><b>' + d.mitglieder + ' Mitglied' + (d.mitglieder === 1 ? '' : 'er') + '</b> mit Mitteilungen &middot; ' + d.geraete + ' Ger&auml;t' + (d.geraete === 1 ? '' : 'e') + '</div>';
        q('#akPLog').innerHTML = d.log.length ? d.log.map(function (l) { return '<div class="ad-card"><div class="ad-who">' + esc(l.titel) + '</div><div class="ad-meta">' + esc(l.text) + '</div><div class="ad-meta">' + esc(hm(l.at)) + ' &middot; ' + l.gesendet + ' von ' + l.geraete + ' Ger&auml;ten' + (l.termin ? ' &middot; ' + esc(l.termin) : '') + '</div></div>'; }).join('') : '<div class="ad-empty">Noch nichts gesendet.</div>';
      }).catch(function (e) { A.note(e.message, true); });
    }
    info();
    on('[data-vorl]', function (b) {
      if (b.getAttribute('data-vorl') === 'ausfall') { q('#akPT').value = 'Kurs fällt aus'; q('#akPX').value = 'Der Kurs am … fällt leider aus. Deine Einheit bleibt auf deiner Karte.'; q('#akPZ').value = 'gebucht'; }
      else { q('#akPT').value = 'Noch Plätze frei'; q('#akPX').value = 'Am … sind noch Plätze frei. Tipp im Mitgliederbereich auf den Kurs und buch dir deinen Platz.'; q('#akPZ').value = 'alle'; }
    });
    q('#akPS').onclick = function () {
      var b = this;
      if (!armed(b, 'Wirklich an alle senden?')) return;
      var k = q('#akPK').value.split('|');
      var body = { p: S.p, titel: q('#akPT').value, text: q('#akPX').value, ziel: q('#akPZ').value };
      if (k[0]) { body.kurs = k[0]; body.datum = k[1]; }
      b.disabled = true;
      A.api('kurse/push-senden', { body: body }).then(function (d) {
        b.disabled = false;
        A.note(d.geraete ? 'Gesendet an ' + d.gesendet + ' von ' + d.geraete + ' Geräten.' : 'Niemand erreicht: Es hat noch kein Mitglied Mitteilungen eingeschaltet.');
        info();
      }).catch(function (e) { b.disabled = false; A.note(e.message, true); });
    };
  }

  /* ---------- Preise & Regeln ---------- */
  function vEinstellungen() {
    var s = S.data.einstellungen;
    var c = function (v) { return Math.round(v / 100); };
    var abo = s.ics_token ? (window.FD_API_PUBLIC || 'https://fitnessdonner-gutscheine.coaching-by-niklas99.workers.dev') + '/api/kurse/kalender.ics?p=' + S.p + '&k=' + s.ics_token : '';
    body('<h2>Preise &amp; Regeln</h2><p class="ad-hint">Gilt f&uuml;r alle Kurse dieser Anbieterin, solange beim Kurs nichts anderes steht. Schon verkaufte Karten bleiben, wie sie sind. Kurspreise auf kurse.html und preise.html ziehen sich die Zahlen automatisch.</p>'
      + '<form id="akSet"><div class="ak-grid">'
      + '<div class="ad-field"><label>Tageskarte</label><div class="ad-eur"><input type="number" name="tk" value="' + c(s.tageskarte_cents) + '" min="0"><span>&euro;</span></div></div>'
      + '<div class="ad-field"><label>5er-Karte gesamt</label><div class="ad-eur"><input type="number" name="k5" value="' + c(s.karten.karte5.cents) + '" min="0"><span>&euro;</span></div></div>'
      + '<div class="ad-field"><label>10er-Karte gesamt</label><div class="ad-eur"><input type="number" name="k10" value="' + c(s.karten.karte10.cents) + '" min="0"><span>&euro;</span></div></div>'
      + '<div class="ad-field"><label>Tageskarten freischalten</label><div class="ad-eur"><input type="number" name="fr" value="' + s.freischalt_tage + '" min="0" max="60"><span>Tage vorher</span></div></div>'
      + '<div class="ad-field"><label>Warteliste: Zeit zum Bestätigen</label><div class="ad-eur"><input type="number" name="wl" value="' + s.warteliste_stunden + '" min="1" max="72"><span>Std.</span></div></div>'
      + '<div class="ad-field"><label>Online buchbar bis</label><div class="ad-eur"><input type="number" name="bs" value="' + s.buchungsschluss_min + '" min="0"><span>Min. vorher</span></div></div>'
      + '<div class="ad-field"><label>Startdaten für Karten</label><div class="ad-eur"><input type="number" name="vl" value="' + s.serie_vorlauf_wochen + '" min="1" max="26"><span>Wochen</span></div></div>'
      + '<div class="ad-field"><label>Karten gültig</label><div class="ad-eur"><input type="number" name="gm" value="' + s.gueltig_monate + '" min="1" max="36"><span>Monate</span></div></div>'
      + '<div class="ad-field"><label>Kurse inklusive bei 4er-Karte (PT)</label><input type="number" name="i4" value="' + s.inklusiv.karte4 + '" min="0"></div>'
      + '<div class="ad-field"><label>Kurse inklusive bei 8er-Karte (PT)</label><input type="number" name="i8" value="' + s.inklusiv.karte8 + '" min="0"></div>'
      + '</div>'
      + '<label class="ak-check"><input type="checkbox" name="usc"' + (s.usc_aktiv ? ' checked' : '') + '> Liste „Freie Plätze für Urban Sports melden“</label>'
      + '<label class="ak-check"><input type="checkbox" name="uscg"' + (s.usc_gemeinsam ? ' checked' : '') + '> USC-Plätze gehen vom selben Restkontingent ab wie Tageskarten</label>'
      + '<label class="ak-check"><input type="checkbox" name="uscm"' + (s.usc_mail ? ' checked' : '') + '> Mail an mich, sobald ich Plätze melden kann</label>'
      + '<button type="submit" class="btn btn-blitz" style="margin-top:14px">Speichern</button></form>'
      + '<h2 style="margin-top:30px">Kalender-Abo</h2><p class="ad-hint">Ein geheimer Link mit allen Kursterminen und der Belegung &ndash; in Google Kalender unter „Weitere Kalender → Per URL“ einf&uuml;gen. Er blockiert dort nichts doppelt.</p>'
      + (abo ? '<input class="ad-search" readonly value="' + esc(abo) + '" onclick="this.select()">' : '')
      + '<div class="ad-actions"><button type="button" class="ad-mini" id="akIcs">' + (abo ? 'Neuen Link erzeugen' : 'Link erzeugen') + '</button>' + (abo ? '<button type="button" class="ad-mini" id="akIcsAus">Abo abschalten</button>' : '') + '</div>');
    var f = q('#akSet');
    var e = f.elements;
    var save = function (extra) {
      var b = {
        tageskarte_cents: Number(e.tk.value) * 100, karten: { karte5: { cents: Number(e.k5.value) * 100 }, karte10: { cents: Number(e.k10.value) * 100 } },
        freischalt_tage: Number(e.fr.value), warteliste_stunden: Number(e.wl.value), buchungsschluss_min: Number(e.bs.value), serie_vorlauf_wochen: Number(e.vl.value),
        gueltig_monate: Number(e.gm.value), inklusiv: { karte4: Number(e.i4.value), karte8: Number(e.i8.value) },
        usc_aktiv: e.usc.checked, usc_gemeinsam: e.uscg.checked, usc_mail: e.uscm.checked,
      };
      for (var k in (extra || {})) b[k] = extra[k];
      return A.api('kurse/einstellungen', { body: { p: S.p, einstellungen: b } }).then(function () { A.note('Gespeichert.'); return laden(); })
        .catch(function (err) { A.note(err.message, true); });
    };
    f.onsubmit = function (ev) { ev.preventDefault(); save(); };
    q('#akIcs').onclick = function () { save({ ics_neu: true }); };
    if (q('#akIcsAus')) q('#akIcsAus').onclick = function () { save({ ics_aus: true }); };
  }
})();
