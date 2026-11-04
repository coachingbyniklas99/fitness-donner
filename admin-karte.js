/* Verwaltung – Karten: Übersicht (Chips "Nr. 5 von 8"), „Neue Karte ausstellen“, Rechnungen, Rechnungsvorlage.
   Nutzt window.FD_ADMIN aus admin.html. Gerechnet, bezahlt und gemailt wird im Worker (/api/admin/karte/…, /rechnung/…);
   hier ist nur die Oberfläche. */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var S = { codes: null, byCode: {}, byEmail: {}, loading: null };

  function esc(x) { return A.esc(x); }
  function fd(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function fk(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' : ''; }
  function pad(n) { return ('0' + n).slice(-2); }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function plusDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); }
  function eur(c) { return A.eur(c); }
  function fail(e) { if (e && e.message !== 'abgemeldet') A.note(e.message || 'Das hat nicht geklappt.', true); }

  /* ---------- Kartenstände (aus „codes“) ---------- */
  function index() {
    S.byCode = {}; S.byEmail = {};
    (S.codes || []).forEach(function (c) {
      if (c.kind !== 'karte') return;
      S.byCode[c.code] = c;
      var e = String(c.email || '').toLowerCase();
      (S.byEmail[e] = S.byEmail[e] || []).push(c);
    });
  }
  function laden(neu) {
    if (S.loading && !neu) return S.loading;
    S.loading = A.api('codes?q=').then(function (d) {
      S.codes = d.codes || []; index();
      document.dispatchEvent(new CustomEvent('fd:karten'));
      return S.codes;
    }).catch(function (e) { S.loading = null; throw e; });
    return S.loading;
  }

  /* Punkte: done = absolviert, verf = verfallen, now = diese Einheit, booked = gebucht, free = frei */
  function dots(arr) {
    return '<span class="dots" aria-hidden="true">' + arr.map(function (k) { return '<i class="d-' + k + '"></i>'; }).join('') + '</span>';
  }
  function dotRow(total, done, now, booked) {
    var a = [], i;
    for (i = 0; i < total; i++) a.push(i < done ? 'done' : (now && i === done) ? 'now' : i < done + (now ? 1 : 0) + booked ? 'booked' : 'free');
    return dots(a);
  }

  /* Für jeden kommenden Termin mit Karte: Nr. x von y. Reihenfolge nach Datum. */
  function annotate(list) {
    var rank = {};
    list.slice().sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? -1 : 1; }).forEach(function (b) {
      b._k = null;
      if (!b.card_code) return;
      var c = S.byCode[b.card_code];
      if (!c) return;
      rank[b.card_code] = (rank[b.card_code] || 0) + 1;
      var nr = (c.done || 0) + (c.manual > 0 ? c.manual : 0) + rank[b.card_code];
      var bookedAfter = Math.max(0, (c.upcoming || 0) - rank[b.card_code]);
      b._k = { nr: nr, total: c.total, done: (c.done || 0) + (c.manual > 0 ? c.manual : 0), last: nr >= c.total, code: c.code, name: c.name, email: c.email, booked: bookedAfter, left: c.left };
    });
    return list;
  }

  function chip(b) {
    if (b._k) {
      var k = b._k;
      return '<span class="ch ' + (k.last ? 'ch-letzte' : 'ch-karte') + '"><span class="ch-top"><b>Karte &middot; Nr. ' + k.nr + ' von ' + k.total + '</b>' +
        '<small>' + (k.done === 1 ? '1 absolviert' : k.done + ' absolviert') + (k.last ? ' &middot; letzte Einheit' : '') + '</small></span>' +
        dotRow(k.total, k.done, true, k.booked) + '</span>';
    }
    if (b.card_code) return '<span class="ch ch-karte"><span class="ch-top"><b>Karte</b><small>' + esc(b.card_code) + '</small></span></span>';
    if (b.voucher_code) return '<span class="ch ch-gut"><span class="ch-top"><b>Gutschein</b></span></span>';
    if (/probe/i.test(b.label || '')) return '<span class="ch ch-probe"><span class="ch-top"><b>Probetraining</b><small>1 von 1</small></span></span>';
    if (/bar|privat/i.test(b.paid || '')) return '<span class="ch ch-bar"><span class="ch-top"><b>Bar / privat</b><small>1 von 1</small></span></span>';
    return '<span class="ch ch-einzel"><span class="ch-top"><b>Einzelstunde</b><small>1 von 1</small></span></span>';
  }

  function legend() {
    return '<details class="legend"><summary>Was bedeuten die Farben? <span>&rsaquo;</span></summary><div class="legend-body">' +
      '<div><span class="ch ch-karte" style="margin:0;padding:3px 9px"><b>Karte</b></span> Nr. 5 von 8: so viele Einheiten sind mit diesem Termin verbraucht. Ausgefüllte Punkte = absolviert.</div>' +
      '<div><span class="ch ch-letzte" style="margin:0;padding:3px 9px"><b>Letzte</b></span> Letzte Einheit der Karte: Zeit für ein Angebot für eine neue Karte.</div>' +
      '<div><span class="ch ch-einzel" style="margin:0;padding:3px 9px"><b>Einzel</b></span> Einzelstunde, 1 von 1.</div>' +
      '<div><span class="ch ch-probe" style="margin:0;padding:3px 9px"><b>Probe</b></span> Probetraining.</div>' +
      '<div><span class="ch ch-gut" style="margin:0;padding:3px 9px"><b>Gutschein</b></span> Bezahlt mit Gutschein.</div>' +
      '<div><span class="ch ch-bar" style="margin:0;padding:3px 9px"><b>Bar</b></span> Bar oder privat bezahlt.</div>' +
      '</div></details>';
  }

  /* ---------- Fenster ---------- */
  var overlay = null;
  function zu() { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; document.body.classList.remove('tm-offen'); }
  function fenster(titel, inner) {
    zu();
    overlay = document.createElement('div');
    overlay.className = 'tm-overlay';
    overlay.innerHTML = '<div class="tm-box kt-box" role="dialog" aria-modal="true"><div class="tm-head"><h2>' + esc(titel) + '</h2>' +
      '<button type="button" class="ad-undo" id="ktZu">Schließen</button></div>' + inner + '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('tm-offen');
    overlay.querySelector('#ktZu').onclick = zu;
    overlay.addEventListener('click', function (e) { if (e.target === overlay) zu(); });
    return overlay;
  }

  var ZAHL = {
    lastschrift: { ic: '&#127974;', t: 'Lastschrift', d: 'Der Betrag wird in den nächsten Tagen eingezogen.' },
    ueberweisung: { ic: '&#128228;', t: 'Überweisung auf Rechnung', d: 'Der Kunde überweist bis zum Fälligkeitsdatum.' },
    bar: { ic: '&#128182;', t: 'Schon bezahlt (bar / privat)', d: 'Rechnung wird als bezahlt ausgestellt, nichts weiter offen.' }
  };
  var ZAHL_KURZ = { lastschrift: 'Lastschrift', ueberweisung: 'Überweisung', bar: 'Bar / bezahlt' };

  /* ---------- Neue Karte ausstellen ---------- */
  function ausstellen(v, fertig) {
    v = v || {};
    var F = { name: v.name || '', email: v.email || '', card: '', zahlart: '', faellig: '', gueltig: '', preis: '', mail: true, zustimmung: false, besch: '', hinweis: '', zhd: '', opt: null };
    var o = fenster('Neue Karte ausstellen', '<div class="ad-empty">L&auml;dt &hellip;</div>');
    var busy = false;

    function optionen() {
      return A.api('karte/optionen?email=' + encodeURIComponent(F.email || '')).then(function (d) {
        F.opt = d;
        if (!F.card) F.card = (d.letzte_karte && d.karten[d.letzte_karte]) ? d.letzte_karte : (Object.keys(d.karten)[0] || '');
        if (!F.zahlart) F.zahlart = d.zahlart || 'ueberweisung';
        if (!F.faellig) F.faellig = d.standard_faellig || plusDays(14);
        if (!F.gueltig) F.gueltig = d.gueltig_bis || plusDays(365);
        if (!F.zhd) F.zhd = F.name;
        return d;
      });
    }

    function summe() {
      var k = F.opt && F.opt.karten[F.card]; if (!k) return 0;
      var unit = F.preis !== '' && !isNaN(Number(F.preis)) ? Math.round(Number(F.preis) * 100) : k.unitCents;
      return unit * k.sessions;
    }
    function zeigen() {
      var d = F.opt, k = d.karten[F.card] || {}, mandatFehlt = F.zahlart === 'lastschrift' && !d.mandat;
      var kartenHtml = Object.keys(d.karten).map(function (key) {
        var c = d.karten[key];
        return '<button type="button" class="kt-o' + (key === F.card ? ' on' : '') + '" data-card="' + esc(key) + '"><b>' + esc(c.label) + '</b><span class="pr">' + eur(c.unitCents * c.sessions) + '</span><span>' + c.sessions + ' Einheiten &middot; ' + eur(c.unitCents) + ' pro Einheit</span></button>';
      }).join('');
      var zahlHtml = ['lastschrift', 'ueberweisung', 'bar'].map(function (z) {
        return '<button type="button" class="kt-o' + (z === F.zahlart ? ' on' : '') + '" data-zahl="' + z + '"><span class="ic">' + ZAHL[z].ic + '</span><div><b>' + ZAHL[z].t + '</b><span>' + ZAHL[z].d + '</span></div>' +
          (z === d.zahlart ? '<em>' + (d.zahlart_hinweis ? 'zuletzt' : 'Standard') + '</em>' : '') + '</button>';
      }).join('');
      var s = summe();
      var schritte = ['Karte mit Code wird angelegt (' + esc(k.label || '') + ', gültig bis ' + esc(fd(F.gueltig)) + ').',
        F.zahlart === 'bar' ? 'Rechnung über ' + eur(s) + ' wird erstellt und gleich als bezahlt markiert.' : 'Rechnung über ' + eur(s) + ' wird erstellt (wie deine bisherigen Rechnungen).'];
      if (F.zahlart === 'lastschrift') schritte.push(mandatFehlt ? '<b>Achtung:</b> Es ist kein Lastschrift-Mandat gespeichert &ndash; siehe Hinweis oben.' : 'Der Betrag wird in den nächsten Tagen per Lastschrift eingezogen.');
      if (F.zahlart === 'ueberweisung') schritte.push('Der Kunde soll bis zum <b>' + esc(fd(F.faellig)) + '</b> überweisen.');
      schritte.push(F.mail ? 'Mail an <b>' + esc(F.email || '…') + '</b> mit Code, Rechnung (PDF), Zahlungshinweis und Widerrufsbelehrung.' : 'Keine Mail an den Kunden (du gibst ihm den Code selbst).');
      var body =
        '<div class="kt-sec"><label class="kt-lab" for="ktName">Kunde</label>' +
        '<div class="kt-two"><div class="ad-field" style="margin:0 0 10px"><input type="text" id="ktName" placeholder="Name" autocomplete="off" value="' + esc(F.name) + '"></div>' +
        '<div class="ad-field" style="margin:0 0 10px"><input type="email" id="ktMail" placeholder="E-Mail" autocomplete="off" value="' + esc(F.email) + '"></div></div>' +
        '<div id="ktSug"></div></div>' +
        '<div class="kt-sec"><span class="kt-lab">Welche Karte?</span><div class="kt-opts two">' + kartenHtml + '</div></div>' +
        '<div class="kt-sec"><span class="kt-lab">Wie bezahlt der Kunde?</span><div class="kt-pay">' + zahlHtml + '</div>' +
        (d.zahlart_hinweis ? '<div class="ad-meta" style="margin-top:8px">' + esc(d.zahlart_hinweis) + '</div>' : '') +
        (mandatFehlt ? '<div class="kt-warn">F&uuml;r diesen Kunden ist kein SEPA-Mandat gespeichert, deshalb kann ich nicht einfach abbuchen. Beim Klick schicke ich ihm stattdessen die Rechnung mit Zahlungslink (dort w&auml;hlt er Lastschrift oder &Uuml;berweisung). Tipp: Im Kundenprofil kannst du ein Mandat anfordern (Knopf &bdquo;Mandat anfordern&ldquo;). Neue Online-K&auml;ufe mit Lastschrift speichern es k&uuml;nftig automatisch.</div>' : '') + '</div>' +
        (F.zahlart !== 'bar' ? '<div class="kt-sec" id="ktFaellig"' + (F.zahlart === 'lastschrift' && !mandatFehlt ? ' hidden' : '') + '><div class="ad-field" style="margin:0"><label for="ktFael">Zahlung f&auml;llig am</label><input type="date" id="ktFael" min="' + plusDays(0) + '" value="' + esc(F.faellig) + '"></div></div>' : '') +
        '<details class="pf-d" style="margin-bottom:14px"><summary>Rechnung anpassen <span class="ad-meta" style="margin:0">optional</span></summary><div class="pf-in">' +
        '<div class="kt-two"><div class="ad-field"><label for="ktPreis">Preis pro Einheit (&euro;)</label><input type="number" id="ktPreis" min="0" step="0.01" placeholder="' + ((k.unitCents || 0) / 100) + '" value="' + esc(F.preis) + '"></div>' +
        '<div class="ad-field"><label for="ktBis">Gültig bis</label><input type="date" id="ktBis" value="' + esc(F.gueltig) + '"></div></div>' +
        '<div class="ad-field"><label for="ktZhd">z. Hd. (Name auf der Rechnung)</label><input type="text" id="ktZhd" value="' + esc(F.zhd) + '"></div>' +
        '<div class="ad-field"><label for="ktBesch">Rechnungstext (leer = Vorlage)</label><input type="text" id="ktBesch" placeholder="' + esc(d.vorlage ? d.vorlage.beschreibung : '') + '" value="' + esc(F.besch) + '"></div>' +
        '<div class="ad-field"><label for="ktHinw">Zusatzhinweis in der Mail (optional)</label><input type="text" id="ktHinw" value="' + esc(F.hinweis) + '"></div>' +
        '<label class="ak-check"><input type="checkbox" id="ktZust"' + (F.zustimmung ? ' checked' : '') + '> Der Kunde hat ausdr&uuml;cklich zugestimmt, dass das Training schon vor Ablauf der 14 Tage beginnt (z.&nbsp;B. per WhatsApp)</label>' +
        '</div></details>' +
        '<label class="tm-check" style="margin-top:0"><input type="checkbox" id="ktMailOn"' + (F.mail ? ' checked' : '') + '> Kunden per Mail informieren</label>' +
        '<details class="pf-d" id="ktPrevBox"><summary>So sieht die Mail aus</summary><div class="pf-in"><div id="ktPrev" class="ad-meta">Wird beim &Ouml;ffnen geladen &hellip;</div></div></details>' +
        '<div class="kt-steps"><h4>Das passiert beim Klick</h4><ol>' + schritte.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol></div>' +
        '<div class="tm-msg" id="ktMsg"></div>' +
        '<div class="kt-sticky"><button type="button" class="btn btn-blitz" id="ktGo"' + (!F.email || !F.name ? ' disabled' : '') + '>' + (mandatFehlt ? 'Karte ausstellen &amp; Rechnung mit Zahlungslink senden' : F.mail ? 'Karte ausstellen &amp; Rechnung senden' : 'Karte ausstellen (ohne Mail)') + '</button></div>';
      o.querySelector('.tm-box').innerHTML = '<div class="tm-head"><h2>Neue Karte ausstellen</h2><button type="button" class="ad-undo" id="ktZu">Schlie&szlig;en</button></div>' + body;
      verdrahten();
    }

    function lesen() {
      var q = function (id) { var e = o.querySelector('#' + id); return e ? e.value : null; };
      if (q('ktName') !== null) F.name = q('ktName');
      if (q('ktMail') !== null) F.email = q('ktMail').trim();
      if (q('ktFael') !== null) F.faellig = q('ktFael');
      if (q('ktPreis') !== null) F.preis = q('ktPreis');
      if (q('ktBis') !== null) F.gueltig = q('ktBis');
      if (q('ktZhd') !== null) F.zhd = q('ktZhd');
      if (q('ktBesch') !== null) F.besch = q('ktBesch');
      if (q('ktHinw') !== null) F.hinweis = q('ktHinw');
      var m = o.querySelector('#ktMailOn'); if (m) F.mail = m.checked;
      var z = o.querySelector('#ktZust'); if (z) F.zustimmung = z.checked;
    }
    function bodyFor(extra) {
      var b = { name: F.name, email: F.email, card: F.card, zahlart: F.zahlart, faellig: F.zahlart === 'bar' ? '' : F.faellig, gueltig_bis: F.gueltig, mail: F.mail,
        zustimmung: F.zustimmung, zhd: F.zhd, beschreibung: F.besch, hinweis: F.hinweis };
      if (F.preis !== '' && !isNaN(Number(F.preis))) b.einheitspreis = Number(F.preis);
      if (extra) for (var k in extra) b[k] = extra[k];
      return b;
    }

    function verdrahten() {
      o.querySelector('#ktZu').onclick = zu;
      Array.prototype.forEach.call(o.querySelectorAll('[data-card]'), function (b) { b.onclick = function () { lesen(); F.card = b.getAttribute('data-card'); zeigen(); }; });
      Array.prototype.forEach.call(o.querySelectorAll('[data-zahl]'), function (b) { b.onclick = function () { lesen(); F.zahlart = b.getAttribute('data-zahl'); zeigen(); }; });
      ['ktName', 'ktMail', 'ktPreis', 'ktBis', 'ktFael', 'ktZhd', 'ktBesch', 'ktHinw'].forEach(function (id) {
        var e = o.querySelector('#' + id); if (e) e.oninput = function () { lesen(); var go = o.querySelector('#ktGo'); if (go) go.disabled = !F.email || !F.name; };
      });
      Array.prototype.forEach.call(o.querySelectorAll('#ktMailOn,#ktZust'), function (e) { e.onchange = function () { lesen(); zeigen(); }; });
      var mailEl = o.querySelector('#ktMail');
      mailEl.onchange = function () { lesen(); F.zahlart = ''; F.faellig = ''; optionen().then(zeigen).catch(fail); };
      // Kundensuche beim Tippen im Namensfeld
      var nameEl = o.querySelector('#ktName'), sug = o.querySelector('#ktSug'), t = null;
      nameEl.addEventListener('input', function () {
        clearTimeout(t);
        var q = nameEl.value.trim();
        if (q.length < 2 || v.email) { sug.innerHTML = ''; return; }
        t = setTimeout(function () {
          A.api('kunden/liste?q=' + encodeURIComponent(q)).then(function (d) {
            sug.innerHTML = d.kunden.slice(0, 5).length ? '<div class="kt-sug">' + d.kunden.slice(0, 5).map(function (k, i) { return '<button type="button" data-i="' + i + '">' + esc(k.name || k.email) + '<small>' + esc(k.email) + '</small></button>'; }).join('') + '</div>' : '';
            Array.prototype.forEach.call(sug.querySelectorAll('[data-i]'), function (b) {
              b.onclick = function () { var k = d.kunden[Number(b.getAttribute('data-i'))]; F.name = k.name || ''; F.email = k.email; F.zhd = F.name; F.zahlart = ''; F.faellig = ''; optionen().then(zeigen).catch(fail); };
            });
          }).catch(function () {});
        }, 250);
      });
      var pb = o.querySelector('#ktPrevBox');
      pb.ontoggle = function () {
        if (!pb.open) return;
        lesen();
        var box = o.querySelector('#ktPrev'); box.textContent = 'Lädt …';
        A.api('karte/vorschau', { body: bodyFor() }).then(function (r) {
          box.innerHTML = '<div class="ad-meta" style="margin:0 0 8px"><b>Betreff:</b> ' + esc(r.betreff) + '</div><div class="ad-meta" style="margin:0 0 8px"><b>Rechnung:</b> ' + esc(r.rechnung_text) + ' &middot; ' + eur(r.cents) + '</div><iframe class="kt-frame" sandbox="" title="Mail-Vorschau"></iframe>';
          box.querySelector('iframe').srcdoc = r.html;
        }).catch(function (e) { box.textContent = (e && e.message) || 'Vorschau nicht möglich.'; });
      };
      o.querySelector('#ktGo').onclick = function () {
        if (busy) return;
        lesen();
        var msg = o.querySelector('#ktMsg'), go = o.querySelector('#ktGo');
        msg.className = 'tm-msg'; msg.textContent = '';
        busy = true; go.disabled = true; go.textContent = 'Moment …';
        var mandatFehlt = F.zahlart === 'lastschrift' && !F.opt.mandat;
        A.api('karte/neu', { body: bodyFor(mandatFehlt ? { zahlungslink: true } : null) }).then(function (r) {
          busy = false; laden(true).catch(function () {});
          fertig && fertig(r);
          erfolg(r);
        }).catch(function (e) {
          busy = false; go.disabled = false; go.innerHTML = 'Nochmal versuchen';
          if (e && e.message === 'abgemeldet') return;
          msg.className = 'tm-msg bad'; msg.textContent = (e && e.message) || 'Das hat nicht geklappt.';
        });
      };
    }

    function erfolg(r) {
      var inner = '<div class="kt-ok"><div class="tick">&#10003;</div><h2 style="margin:0">Karte ausgestellt</h2>' +
        '<div class="code">' + esc(r.code) + '</div><div class="ad-meta">' + esc(r.label || '') + ' &middot; ' + eur(r.cents || 0) + '</div></div>' +
        '<div class="kt-steps" style="margin-top:18px"><h4>Erledigt</h4><ol>' +
        '<li>Karte angelegt, g&uuml;ltig bis ' + esc(fd(r.gueltig_bis)) + '.</li>' +
        '<li>Rechnung ' + esc(r.rechnung && r.rechnung.nummer || '') + ' erstellt' + (r.rechnung && r.rechnung.status === 'paid' ? ' (bezahlt)' : '') + '.</li>' +
        (r.zahlung_text ? '<li>' + esc(r.zahlung_text) + '</li>' : '') +
        '<li>' + (r.mail ? 'Mail an ' + esc(F.email) + ' ist raus.' : 'Keine Mail verschickt.') + '</li></ol></div>' +
        '<div class="tm-actions" style="margin-top:6px"><button type="button" class="btn btn-blitz" id="ktTermin">Ersten Termin eintragen</button>' +
        (r.rechnung && r.rechnung.url ? '<a class="ad-mini" target="_blank" rel="noopener" href="' + esc(r.rechnung.url) + '">Rechnung ansehen</a>' : '') +
        '<button type="button" class="ad-mini" id="ktFertig">Fertig</button></div>';
      o.querySelector('.tm-box').innerHTML = '<div class="tm-head"><h2>&nbsp;</h2><button type="button" class="ad-undo" id="ktZu">Schlie&szlig;en</button></div>' + inner;
      o.querySelector('#ktZu').onclick = zu;
      o.querySelector('#ktFertig').onclick = zu;
      o.querySelector('#ktTermin').onclick = function () { zu(); if (window.FDTermine) window.FDTermine.eintragen({ code: r.code, art: 'karte', name: F.name, email: F.email }, function () { document.dispatchEvent(new CustomEvent('fd:neu')); }); };
    }

    optionen().then(zeigen).catch(function (e) { zu(); fail(e); });
  }

  /* ---------- Zahlart ändern ---------- */
  function zahlartWaehlen(p, fertig) {
    var cur = p.zahlart || '';
    var o = fenster('Wie bezahlt ' + (p.name || 'der Kunde') + '?',
      '<p class="ad-hint">Das merke ich mir f&uuml;r jede weitere Karte. Du kannst es beim Ausstellen immer noch &auml;ndern.</p><div class="kt-pay">' +
      ['lastschrift', 'ueberweisung', 'bar'].map(function (z) {
        return '<button type="button" class="kt-o' + (z === cur ? ' on' : '') + '" data-z="' + z + '"><span class="ic">' + ZAHL[z].ic + '</span><div><b>' + ZAHL[z].t + '</b><span>' + ZAHL[z].d + '</span></div></button>';
      }).join('') + '</div>');
    Array.prototype.forEach.call(o.querySelectorAll('[data-z]'), function (b) {
      b.onclick = function () {
        A.api('kunden/zahlart', { body: { email: p.email, zahlart: b.getAttribute('data-z') } }).then(function () { zu(); A.note('Gespeichert.'); fertig && fertig(); }).catch(fail);
      };
    });
  }


  /* ---------- SEPA-Mandat per Link anfordern ---------- */
  function mandatAnfordern(p, fertig) {
    var o = fenster('Lastschrift-Mandat anfordern',
      '<p class="ad-hint">' + esc(p.name || p.email) + ' bekommt eine Mail mit einem sicheren Stripe-Link. Dort gibt sie einmal IBAN und Namen ein und best&auml;tigt das Mandat &ndash; das dauert etwa 30 Sekunden. Danach kannst du jede weitere Karte mit einem Klick abbuchen.</p>' +
      '<div class="kt-sec"><div class="ad-meta">Mail geht an: <b>' + esc(p.email) + '</b></div></div>' +
      '<div class="kt-sticky"><button type="button" class="btn btn-blitz" id="ktMandat">Mail mit Mandat-Link senden</button></div>');
    o.querySelector('#ktMandat').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Sende …';
      A.api('kunden/mandat-link', { body: { email: p.email, name: p.name || '' } }).then(function () {
        zu(); A.note('Mail mit Mandat-Link gesendet.'); fertig && fertig();
      }).catch(function (e) { b.disabled = false; b.textContent = 'Mail mit Mandat-Link senden'; fail(e); });
    };
  }

  /* ---------- Rechnungen ---------- */
  var RB = null;
  function rechnungenRender(box) {
    if (!box) return;
    box.innerHTML = '<div class="ad-empty">L&auml;dt &hellip;</div>';
    A.api('rechnung/liste').then(function (d) {
      var l = d.rechnungen || [];
      var offen = l.filter(function (x) { return x.status !== 'paid'; }), bezahlt = l.filter(function (x) { return x.status === 'paid'; });
      function row(x) {
        var due = x.faellig ? fd(x.faellig) : '';
        var ueber = x.status !== 'paid' && x.faellig && x.faellig < isoOf(new Date());
        return '<div class="rv-row"><div class="rv-main"><b>' + esc(x.name || x.email) + '</b><small>' + esc(x.nummer) + ' &middot; ' + esc(x.text || '') + '</small>' +
          '<small class="st ' + (x.status === 'paid' ? 'ok' : ueber ? 'offen' : 'laeuft') + '">' + (x.status === 'paid' ? 'Bezahlt' : x.lastschrift ? 'Lastschrift l&auml;uft' : ueber ? '&Uuml;berf&auml;llig seit ' + esc(due) : 'Offen bis ' + esc(due)) + '</small></div>' +
          '<div class="rv-sum">' + eur(x.cents) + '</div></div>' +
          (x.status !== 'paid' ? '<div class="ad-actions" style="margin:-4px 0 4px"><button type="button" class="ad-mini" data-paid="' + esc(x.id) + '">Als bezahlt markieren</button>' + (x.url ? '<a class="ad-mini" target="_blank" rel="noopener" href="' + esc(x.url) + '">Ansehen</a>' : '') + '</div>' : '');
      }
      box.innerHTML = '<p class="ad-hint">Hier siehst du alle Rechnungen, die über „Karte ausstellen“ entstanden sind. Sobald das Geld da ist, tippst du „Als bezahlt markieren“.</p>' +
        '<div class="pf-h" style="margin-top:6px">Offen <span class="kd-count">' + offen.length + '</span></div><div class="ad-list">' + (offen.map(row).join('') || '<div class="ad-empty">Nichts offen. &#10003;</div>') + '</div>' +
        '<div class="pf-h">Bezahlt <span class="kd-count">' + bezahlt.length + '</span></div><div class="ad-list">' + (bezahlt.slice(0, 15).map(row).join('') || '<div class="ad-empty">Noch nichts.</div>') + '</div>';
      Array.prototype.forEach.call(box.querySelectorAll('[data-paid]'), function (b) {
        b.onclick = function () {
          b.disabled = true;
          A.api('rechnung/bezahlt', { body: { id: b.getAttribute('data-paid') } }).then(function () { A.note('Als bezahlt markiert.'); rechnungenRender(box); document.dispatchEvent(new CustomEvent('fd:neu')); }).catch(function (e) { b.disabled = false; fail(e); });
        };
      });
    }).catch(function (e) { box.innerHTML = '<div class="ad-empty">' + esc((e && e.message) || 'Nicht geladen.') + '</div>'; });
  }

  /* ---------- Rechnungsvorlage & Mailtexte ---------- */
  function vorlageRender(box) {
    box.innerHTML = '<div class="ad-empty">L&auml;dt &hellip;</div>';
    A.api('rechnung/vorlage').then(function (d) {
      var V = d.vorlage;
      function f(id, label, val, hint, area) {
        return '<div class="ad-field"><label for="vl' + id + '">' + label + '</label>' + (area ? '<textarea id="vl' + id + '" rows="3">' + esc(val) + '</textarea>' : '<input type="text" id="vl' + id + '" value="' + esc(val) + '">') + (hint ? '<div class="ad-meta">' + hint + '</div>' : '') + '</div>';
      }
      box.innerHTML = '<p class="ad-hint">Diese Vorlage nutzt <b>jede neue Karte</b>. Beim Ausstellen kannst du sie f&uuml;r einen einzelnen Kunden trotzdem noch &auml;ndern. Platzhalter: <b>{karte}</b> <b>{einheiten}</b> <b>{einheitspreis}</b> <b>{betrag}</b> <b>{faellig}</b> <b>{code}</b> <b>{name}</b></p>' +
        '<form id="vlForm"><h2>Rechnung</h2>' +
        f('Besch', 'Text der Rechnungszeile', V.beschreibung, 'So sieht es aus: <i id="vlBeispiel"></i>') +
        f('Steuer', 'Zeile unter dem Absender (z. B. Steuernummer)', V.kopf, '') +
        f('Fuss', 'Fußzeile', V.fuss, '', true) +
        '<div class="ad-field"><label for="vlTage">Zahlungsfrist bei Überweisung</label><div class="ad-eur"><input type="number" id="vlTage" min="0" max="60" value="' + esc(V.faellig_tage) + '"><span>Tage</span></div></div>' +
        '<h2 style="margin-top:28px">Mail an den Kunden</h2>' +
        f('Betreff', 'Betreff', V.mail_betreff, '') +
        f('Intro', 'Einleitung', V.mail_intro, '', true) +
        f('Lastschrift', 'Hinweis bei Lastschrift', V.mail_lastschrift, '', true) +
        f('Ueberweisung', 'Hinweis bei Überweisung', V.mail_ueberweisung, '', true) +
        f('Bezahlt', 'Hinweis bei „schon bezahlt“', V.mail_bezahlt, '', true) +
        '<div class="kt-steps"><h4>Immer am Ende der Mail</h4><ol><li>Hinweis auf das Widerrufsrecht mit der vollständigen Belehrung (kann hier nicht gelöscht werden).</li><li>Link zu den Buchungsbedingungen.</li></ol></div>' +
        '<button type="submit" class="btn btn-blitz">Vorlage speichern</button></form>' +
        '<h2 style="margin-top:30px">Vorschau</h2><p class="ad-hint">Mit Beispieldaten. Aktualisiert sich beim Speichern.</p><button type="button" class="ad-mini" id="vlPrev">Mail-Vorschau laden</button><div id="vlPrevBox"></div>';
      function beispiel() { var t = box.querySelector('#vlBesch').value; box.querySelector('#vlBeispiel').textContent = t.replace('{karte}', '8er-Karte').replace('{einheiten}', '8').replace('{einheitspreis}', '99 €').replace('{betrag}', '792 €'); }
      box.querySelector('#vlBesch').oninput = beispiel; beispiel();
      box.querySelector('#vlForm').onsubmit = function (e) {
        e.preventDefault();
        var q = function (id) { return box.querySelector('#vl' + id).value; };
        A.api('rechnung/vorlage', { body: { beschreibung: q('Besch'), kopf: q('Steuer'), fuss: q('Fuss'), faellig_tage: Number(q('Tage')), mail_betreff: q('Betreff'), mail_intro: q('Intro'), mail_lastschrift: q('Lastschrift'), mail_ueberweisung: q('Ueberweisung'), mail_bezahlt: q('Bezahlt') } })
          .then(function () { A.note('Vorlage gespeichert.'); }).catch(fail);
      };
      box.querySelector('#vlPrev').onclick = function () {
        var pb = box.querySelector('#vlPrevBox'); pb.innerHTML = '<div class="ad-meta">Lädt …</div>';
        A.api('karte/vorschau', { body: { name: 'Max Mustermann', email: 'max@example.de', card: 'karte8', zahlart: 'ueberweisung', faellig: plusDays(V.faellig_tage || 14), mail: true } }).then(function (r) {
          pb.innerHTML = '<iframe class="kt-frame" sandbox="" title="Vorschau"></iframe>'; pb.querySelector('iframe').srcdoc = r.html;
        }).catch(function (e) { pb.innerHTML = '<div class="ad-meta">' + esc((e && e.message) || 'Nicht möglich.') + '</div>'; });
      };
    }).catch(function (e) { box.innerHTML = '<div class="ad-empty">' + esc((e && e.message) || 'Nicht geladen.') + '</div>'; });
  }

  window.FDKarte = {
    laden: laden, annotate: annotate, chip: chip, legend: legend, dots: dots, dotRow: dotRow,
    info: function (code) { return S.byCode[code] || null; },
    karten: function (email) { return S.byEmail[String(email || '').toLowerCase()] || []; },
    alle: function () { return S.codes || []; },
    ausstellen: ausstellen, zahlartWaehlen: zahlartWaehlen, mandatAnfordern: mandatAnfordern, zahlText: function (z) { return ZAHL_KURZ[z] || ''; },
    rechnungen: rechnungenRender, vorlage: vorlageRender
  };
})();
