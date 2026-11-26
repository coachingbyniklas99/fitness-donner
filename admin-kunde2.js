/* Verwaltung – Kunden ohne E-Mail, Stammdaten, Zahler und Kartenverkauf per Zahlungslink.
   Hängt sich an admin-kunden.js (Profil) und admin-termine.js (Termine) und nutzt window.FD_ADMIN.
   Alles hier ist nur die Oberfläche; gespeichert wird im Worker (/api/admin/kunde2/…). */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var esc = A.esc, eur = A.eur;
  var overlay = null, poll = null;

  var css = document.createElement('style');
  css.textContent =
    '.k2-rows{display:grid;grid-template-columns:minmax(96px,34%) 1fr;gap:6px 12px;margin:0 0 4px;font-size:15px;line-height:1.4}' +
    '.k2-rows dt{color:var(--muted,#9AA0AB)}.k2-rows dd{margin:0;word-break:break-word}' +
    '.k2-leer{color:var(--muted,#9AA0AB)}' +
    '.k2-pay{margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.1)}' +
    '.k2-pay b{font-weight:600}' +
    '.k2-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}' +
    '.k2-qr{background:#fff;padding:10px;border-radius:12px;max-width:260px;margin:12px auto}.k2-qr svg{display:block;width:100%;height:auto}' +
    '.k2-url{width:100%;box-sizing:border-box;font-size:13px}' +
    '.k2-st{margin:12px 0;padding:11px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.16);font-size:14.5px}' +
    '.k2-st.ok{border-color:rgba(127,210,138,.55);background:rgba(127,210,138,.08)}.k2-st.bad{border-color:rgba(255,120,100,.5);background:rgba(255,120,100,.07)}' +
    '.k2-vs{margin:0 0 18px}.k2-vs .ad-card{border-color:rgba(255,196,87,.55);background:rgba(255,196,87,.06)}' +
    '.k2-sug{display:grid;gap:6px;margin:8px 0}.k2-sug button{display:block;width:100%;text-align:left}';
  document.head.appendChild(css);

  function fd(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function fail(e) { if (e && e.message !== 'abgemeldet') A.note((e && e.message) || 'Das hat nicht geklappt.', true); }
  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

  function zu() {
    stopPoll();
    if (overlay) { overlay.remove(); overlay = null; }
    document.body.classList.remove('tm-offen');
  }
  function fenster(titel, inner) {
    zu();
    overlay = document.createElement('div');
    overlay.className = 'tm-overlay';
    overlay.innerHTML = '<div class="tm-box kt-box" role="dialog" aria-modal="true"><div class="tm-head"><h2>' + esc(titel) + '</h2>' +
      '<button type="button" class="ad-undo" id="k2Zu">Schließen</button></div>' + inner + '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('tm-offen');
    overlay.querySelector('#k2Zu').onclick = zu;
    var o = overlay;
    overlay.addEventListener('click', function (e) { if (e.target === o) zu(); });
    return overlay;
  }
  function $(o, sel) { return o.querySelector(sel); }
  function val(o, sel) { var e = $(o, sel); return e ? String(e.value || '').trim() : ''; }
  function meldung(o, text, schlecht) { var m = $(o, '.tm-msg'); if (m) { m.className = 'tm-msg' + (schlecht ? ' bad' : ''); m.textContent = text || ''; } }

  /* ---------- Neuen Kunden anlegen (auch ohne E-Mail) ---------- */
  function neu(fertig) {
    var o = fenster('Neuer Kunde',
      '<form class="tm-form" id="k2Form">' +
      '<p class="ad-hint" style="margin:0 0 14px">Zum Anlegen reicht ein Name, zum Beispiel &bdquo;Frau Palassos&ldquo;. Alles andere kannst du sp&auml;ter erg&auml;nzen, auch durch eine Zahlung (Apple Pay) im Profil.</p>' +
      '<div class="ad-field"><label for="k2Name">Name</label><input type="text" id="k2Name" autocomplete="off" placeholder="z. B. Frau Palassos"></div>' +
      '<div class="ad-field"><label for="k2Mail">E-Mail <span class="ad-meta" style="margin:0">optional</span></label><input type="email" id="k2Mail" autocomplete="off"></div>' +
      '<div class="ad-field"><label for="k2Tel">Telefon <span class="ad-meta" style="margin:0">optional</span></label><input type="tel" id="k2Tel" autocomplete="off"></div>' +
      '<div class="ad-field"><label for="k2Geb">Geburtsdatum <span class="ad-meta" style="margin:0">optional</span></label><input type="date" id="k2Geb"></div>' +
      '<div class="tm-msg"></div>' +
      '<div class="tm-actions"><button type="submit" class="btn btn-blitz" id="k2Go">Kunde anlegen</button></div>' +
      '</form>');
    setTimeout(function () { var e = $(o, '#k2Name'); if (e) e.focus(); }, 50);
    $(o, '#k2Form').onsubmit = function (ev) {
      ev.preventDefault();
      var name = val(o, '#k2Name');
      if (!name) { meldung(o, 'Bitte einen Namen eintragen.', true); return; }
      var go = $(o, '#k2Go'); go.disabled = true;
      A.api('kunde2/anlegen', { body: { name: name, email: val(o, '#k2Mail'), telefon: val(o, '#k2Tel'), geburtsdatum: val(o, '#k2Geb') } }).then(function (r) {
        zu(); A.note('Kunde angelegt.');
        if (A.go) A.go('kunden');
        if (window.FDKunden) window.FDKunden.oeffnen(r.key);
        if (fertig) fertig(r);
      }).catch(function (e) {
        go.disabled = false;
        if (e && e.message === 'abgemeldet') return;
        meldung(o, (e && e.message) || 'Das hat nicht geklappt.', true);
      });
    };
  }

  /* ---------- Angaben bearbeiten ---------- */
  function daten(p, fertig) {
    var d = p.daten || {};
    var f = function (id, lab, v, typ, extra) { return '<div class="ad-field"><label for="' + id + '">' + lab + '</label><input type="' + (typ || 'text') + '" id="' + id + '" autocomplete="off" value="' + esc(v || '') + '"' + (extra || '') + '></div>'; };
    var o = fenster('Angaben zu ' + (p.name || 'Kunde'),
      '<form class="tm-form" id="k2Form">' +
      f('k2Name', 'Name (so steht er in der Liste)', d.name || p.name) +
      '<div class="kt-two">' + f('k2Vor', 'Vorname', d.vorname) + f('k2Nach', 'Nachname', d.nachname) + '</div>' +
      f('k2Geb', 'Geburtsdatum', d.geburtsdatum, 'date') +
      f('k2Tel', 'Telefon', d.telefon || p.phone, 'tel') +
      (p.intern
        ? f('k2Mail', 'E-Mail (optional)', d.email, 'email') + '<p class="ad-hint" style="margin:-6px 0 14px">Sobald hier eine Adresse steht, bekommt der Kunde Mails und alles unter dieser Adresse landet in diesem Profil.</p>'
        : '<div class="ad-field"><label>E-Mail</label><input type="email" disabled value="' + esc(p.email) + '"></div>') +
      f('k2Str', 'Stra&szlig;e und Hausnummer', d.strasse) +
      '<div class="kt-two">' + f('k2Plz', 'PLZ', d.plz) + f('k2Ort', 'Ort', d.ort) + '</div>' +
      f('k2Land', 'Land (2 Buchstaben)', d.land || 'DE', 'text', ' maxlength="2" style="text-transform:uppercase"') +
      '<div class="tm-msg"></div>' +
      '<div class="tm-actions"><button type="submit" class="btn btn-blitz" id="k2Go">Speichern</button></div>' +
      '</form>');
    $(o, '#k2Form').onsubmit = function (ev) {
      ev.preventDefault();
      var b = { key: p.email, fallback_name: p.name || '', name: val(o, '#k2Name'), vorname: val(o, '#k2Vor'), nachname: val(o, '#k2Nach'), geburtsdatum: val(o, '#k2Geb'),
        telefon: val(o, '#k2Tel'), strasse: val(o, '#k2Str'), plz: val(o, '#k2Plz'), ort: val(o, '#k2Ort'), land: val(o, '#k2Land') };
      if (p.intern) b.email = val(o, '#k2Mail');
      var go = $(o, '#k2Go'); go.disabled = true;
      A.api('kunde2/daten', { body: b }).then(function (r) { zu(); A.note('Gespeichert.'); if (fertig) fertig(r); })
        .catch(function (e) { go.disabled = false; if (e && e.message === 'abgemeldet') return; meldung(o, (e && e.message) || 'Das hat nicht geklappt.', true); });
    };
  }

  /* ---------- Zahler festlegen ---------- */
  function zahler(p, fertig) {
    var o = fenster('Wer zahlt für ' + (p.name || 'diesen Kunden') + '?',
      '<p class="ad-hint" style="margin:0 0 12px">Zum Beispiel die Eltern bei einem Kind. Rechnung und Mails gehen dann an den Zahler. Das Profil der trainierten Person bleibt eigenst&auml;ndig (Termine, Karte, Anamnese).</p>' +
      (p.zahler ? '<div class="kc-nudge" style="margin-top:0"><span>Aktuell: <b>' + esc(p.zahler.name || p.zahler.email) + '</b></span><button type="button" class="ad-mini" id="k2Weg">Zahler entfernen</button></div>' : '') +
      '<div class="ad-field"><label for="k2Suche">Vorhandenen Kunden suchen</label><input type="search" id="k2Suche" autocomplete="off" placeholder="Name oder E-Mail"></div>' +
      '<div class="k2-sug" id="k2Res"></div>' +
      '<details class="pf-d"><summary>Zahler neu anlegen</summary><div class="pf-in">' +
      '<div class="ad-field"><label for="k2ZName">Name des Zahlers</label><input type="text" id="k2ZName" autocomplete="off"></div>' +
      '<div class="ad-field"><label for="k2ZMail">E-Mail des Zahlers</label><input type="email" id="k2ZMail" autocomplete="off"></div>' +
      '<button type="button" class="btn btn-blitz" id="k2ZNeu">Anlegen und als Zahler festlegen</button></div></details>' +
      '<div class="tm-msg"></div>');
    function setzen(key, name) {
      return A.api('kunde2/daten', { body: { key: p.email, fallback_name: p.name || '', zahler: key, zahler_name: name || '' } })
        .then(function () { zu(); A.note('Zahler festgelegt.'); if (fertig) fertig(); })
        .catch(function (e) { if (e && e.message === 'abgemeldet') return; meldung(o, (e && e.message) || 'Das hat nicht geklappt.', true); });
    }
    var weg = $(o, '#k2Weg');
    if (weg) weg.onclick = function () { weg.disabled = true; A.api('kunde2/daten', { body: { key: p.email, fallback_name: p.name || '', zahler: '' } }).then(function () { zu(); A.note('Zahler entfernt.'); if (fertig) fertig(); }).catch(function (e) { weg.disabled = false; fail(e); }); };
    var tm = null, res = $(o, '#k2Res');
    $(o, '#k2Suche').oninput = function () {
      clearTimeout(tm); var q = this.value.trim();
      if (q.length < 2) { res.innerHTML = ''; return; }
      tm = setTimeout(function () {
        A.api('kunden/liste?q=' + encodeURIComponent(q)).then(function (d) {
          var l = (d.kunden || []).filter(function (x) { return x.email !== p.email; }).slice(0, 6);
          res.innerHTML = l.length ? l.map(function (x, i) { return '<button type="button" class="ad-mini" data-i="' + i + '">' + esc(x.name || x.email) + (x.intern ? '' : ' &middot; ' + esc(x.email)) + '</button>'; }).join('') : '<p class="ad-hint">Niemand gefunden.</p>';
          Array.prototype.forEach.call(res.querySelectorAll('[data-i]'), function (b) { b.onclick = function () { var x = l[Number(b.getAttribute('data-i'))]; setzen(x.email, x.name || x.email); }; });
        }).catch(function () {});
      }, 250);
    };
    $(o, '#k2ZNeu').onclick = function () {
      var name = val(o, '#k2ZName'), mail = val(o, '#k2ZMail');
      if (!name) { meldung(o, 'Bitte den Namen des Zahlers eintragen.', true); return; }
      var b = this; b.disabled = true;
      A.api('kunde2/anlegen', { body: { name: name, email: mail } }).then(function (r) { return setzen(r.key, name); })
        .catch(function (e) {
          b.disabled = false; if (e && e.message === 'abgemeldet') return; meldung(o, (e && e.message) || 'Das hat nicht geklappt.', true);
        });
    };
  }

  /* ---------- Karte per Zahlungslink verkaufen ---------- */
  function qrSvg(url) {
    if (typeof window.qrcode !== 'function') return '';
    var q = window.qrcode(0, 'M'); q.addData(url); q.make();
    return q.createSvgTag({ cellSize: 1, margin: 2, scalable: true });
  }
  function kopieren(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, no) {
      var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); } document.body.removeChild(t);
    });
  }
  function karteLink(p, fertig) {
    var o = fenster('Karte per Zahlungslink', '<div class="ad-empty">L&auml;dt &hellip;</div>');
    var F = { card: '', zust: false };
    A.api('karte/optionen?email=').then(function (d) {
      var keys = Object.keys(d.karten || {});
      F.card = keys[0] || '';
      function zeigen() {
        $(o, '.tm-box').innerHTML = '<div class="tm-head"><h2>Karte per Zahlungslink</h2><button type="button" class="ad-undo" id="k2Zu">Schlie&szlig;en</button></div>' +
          '<p class="ad-hint" style="margin:0 0 12px">F&uuml;r <b>' + esc(p.name || 'den Kunden') + '</b>. Der Kunde zahlt mit Apple Pay, Karte, Lastschrift oder PayPal und gibt dabei Name und Adresse ein. Die Angaben erscheinen danach als Vorschlag im Profil, du best&auml;tigst sie mit einem Klick.</p>' +
          '<div class="kt-sec"><span class="kt-lab">Welche Karte?</span><div class="kt-opts two">' + keys.map(function (k) {
            var c = d.karten[k];
            return '<button type="button" class="kt-o' + (k === F.card ? ' on' : '') + '" data-card="' + esc(k) + '"><b>' + esc(c.label) + '</b><span class="pr">' + eur(c.totalCents || c.unitCents * c.sessions) + '</span><span>' + c.sessions + ' Einheiten &middot; ' + eur(c.unitCents) + ' pro Einheit</span></button>';
          }).join('') + '</div></div>' +
          '<label class="ak-check"><input type="checkbox" id="k2Zust"' + (F.zust ? ' checked' : '') + '> Der Kunde hat ausdr&uuml;cklich zugestimmt, dass das Training schon vor Ablauf der 14 Tage beginnt</label>' +
          '<div class="tm-msg"></div>' +
          '<div class="kt-sticky"><button type="button" class="btn btn-blitz" id="k2Go">Zahlungslink erstellen</button></div>';
        $(o, '#k2Zu').onclick = zu;
        Array.prototype.forEach.call(o.querySelectorAll('[data-card]'), function (b) { b.onclick = function () { F.zust = $(o, '#k2Zust').checked; F.card = b.getAttribute('data-card'); zeigen(); }; });
        $(o, '#k2Go').onclick = function () {
          var go = this; go.disabled = true; F.zust = $(o, '#k2Zust').checked;
          A.api('kunde2/karte-link', { body: { key: p.email, name: p.name || '', card: F.card, zustimmung: F.zust } }).then(function (r) { link(r); })
            .catch(function (e) { go.disabled = false; if (e && e.message === 'abgemeldet') return; meldung(o, (e && e.message) || 'Das hat nicht geklappt.', true); });
        };
      }
      function link(r) {
        $(o, '.tm-box').innerHTML = '<div class="tm-head"><h2>Zahlungslink</h2><button type="button" class="ad-undo" id="k2Zu">Schlie&szlig;en</button></div>' +
          '<p class="ad-hint" style="margin:0 0 6px"><b>' + esc(r.label) + '</b> &middot; ' + eur(r.cents) + '. Lass den Kunden den Code scannen oder schick ihm den Link (WhatsApp, Nachricht). Der Link gilt knapp 24 Stunden.</p>' +
          (qrSvg(r.url) ? '<div class="k2-qr">' + qrSvg(r.url) + '</div>' : '') +
          '<input type="text" readonly class="k2-url" id="k2Url" value="' + esc(r.url) + '">' +
          '<div class="tm-actions" style="margin-top:10px"><button type="button" class="btn btn-blitz" id="k2Copy">Link kopieren</button>' +
          (navigator.share ? '<button type="button" class="ad-mini" id="k2Share">Teilen &hellip;</button>' : '') + '</div>' +
          '<div class="k2-st" id="k2St">Wartet auf die Zahlung &hellip;</div>';
        $(o, '#k2Zu').onclick = zu;
        $(o, '#k2Url').onclick = function () { this.select(); };
        $(o, '#k2Copy').onclick = function () { var b = this; kopieren(r.url).then(function () { b.textContent = 'Kopiert'; setTimeout(function () { b.textContent = 'Link kopieren'; }, 1800); }).catch(function () { A.note('Bitte den Link von Hand markieren und kopieren.', true); }); };
        var sh = $(o, '#k2Share'); if (sh) sh.onclick = function () { navigator.share({ title: 'Zahlung ' + r.label, url: r.url }).catch(function () {}); };
        var mine = o, busy = false, alt = true;
        stopPoll();
        poll = setInterval(function () {
          if (overlay !== mine) { stopPoll(); return; }
          if (busy) return; busy = true;
          A.api('kunde2/karte-status?session=' + encodeURIComponent(r.session)).then(function (s) {
            busy = false; var st = $(mine, '#k2St'); if (!st) return;
            if (s.status === 'paid') {
              stopPoll(); st.className = 'k2-st ok';
              st.innerHTML = 'Bezahlt.' + (s.code ? ' Die Karte <b>' + esc(s.code) + '</b> ist angelegt.' : ' Die Karte wird gerade angelegt.') + ' Name und Adresse aus der Zahlung findest du gleich als Vorschlag im Profil.';
              if (fertig) setTimeout(fertig, 2500);
            } else if (s.status === 'expired') { stopPoll(); st.className = 'k2-st bad'; st.textContent = 'Der Link ist abgelaufen. Erstelle bei Bedarf einen neuen.'; }
          }).catch(function () { busy = false; });
        }, 4000);
      }
      zeigen();
    }).catch(function (e) { zu(); fail(e); });
  }

  /* ---------- Vorschläge aus der Zahlung (im Profil) ---------- */
  function adresse(v) { return [v.strasse, [v.plz, v.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '); }
  function vorschlaegeHtml(p) {
    var l = p.vorschlaege || [];
    if (!l.length) return '';
    return '<div class="k2-vs">' + l.map(function (v) {
      var z = v.payer || {};
      return '<div class="ad-card"><div class="ad-who">Angaben aus der Zahlung</div>' +
        '<div class="ad-meta">Karte ' + esc(v.code) + '</div>' +
        '<dl class="k2-rows" style="margin-top:10px">' +
        '<dt>Name</dt><dd>' + (z.name ? esc(z.name) : '<span class="k2-leer">fehlt</span>') + '</dd>' +
        '<dt>Adresse</dt><dd>' + (adresse(z) ? esc(adresse(z)) : '<span class="k2-leer">fehlt</span>') + '</dd>' +
        '<dt>E-Mail</dt><dd>' + (z.email ? esc(z.email) : '<span class="k2-leer">fehlt</span>') + '</dd></dl>' +
        '<p class="ad-hint" style="margin:6px 0 12px">Wer hat bezahlt?</p>' +
        '<div class="tm-actions" style="flex-wrap:wrap">' +
        '<button type="button" class="btn btn-blitz" data-k2="vs:' + esc(v.code) + ':selbst">' + esc(p.name || 'Der Kunde') + ' hat selbst bezahlt</button>' +
        '<button type="button" class="ad-mini" data-k2="vs:' + esc(v.code) + ':zahler">Jemand anderes hat bezahlt (z.&nbsp;B. Eltern)</button>' +
        '<button type="button" class="ad-mini" data-k2="vs:' + esc(v.code) + ':verwerfen">Verwerfen</button></div>' +
        '<div class="tm-msg" data-k2msg="' + esc(v.code) + '"></div></div>';
    }).join('') + '</div>';
  }

  /* ---------- Angaben & Zahler (Abschnitt im Profil) ---------- */
  function angabenHtml(p) {
    var d = p.daten || {};
    var leer = '<span class="k2-leer">nicht eingetragen</span>';
    var adr = adresse(d);
    var html = '<div class="pf-h">Angaben &amp; Zahler</div><div class="ad-card">' +
      '<dl class="k2-rows">' +
      '<dt>Geburtsdatum</dt><dd>' + (d.geburtsdatum ? esc(fd(d.geburtsdatum)) : leer) + '</dd>' +
      '<dt>Telefon</dt><dd>' + (p.phone ? esc(p.phone) : leer) + '</dd>' +
      '<dt>E-Mail</dt><dd>' + (p.kontakt_email ? esc(p.kontakt_email) : '<span class="k2-leer">keine</span>') + '</dd>' +
      '<dt>Adresse</dt><dd>' + (adr ? esc(adr + (d.land && d.land !== 'DE' ? ', ' + d.land : '')) : leer) + '</dd></dl>' +
      '<div class="k2-pay"><dl class="k2-rows" style="margin:0"><dt>Zahler</dt><dd>' +
      (p.zahler ? '<button type="button" class="ad-mini" data-k2="oeffnen:' + esc(p.zahler.key) + '">' + esc(p.zahler.name || p.zahler.email) + '</button>' + (p.zahler.email ? ' <span class="ad-meta" style="margin:0">' + esc(p.zahler.email) + '</span>' : ' <span class="ad-meta" style="margin:0">ohne E-Mail</span>') : '<span class="k2-leer">bezahlt selbst</span>') + '</dd>' +
      ((p.zahlt_fuer || []).length ? '<dt>Zahlt f&uuml;r</dt><dd><span class="k2-chips">' + p.zahlt_fuer.map(function (x) { return '<button type="button" class="ad-mini" data-k2="oeffnen:' + esc(x.key) + '">' + esc(x.name || 'Kunde') + '</button>'; }).join('') + '</span></dd>' : '') +
      '</dl></div>' +
      '<div class="ad-actions" style="margin-top:14px"><button type="button" class="ad-mini" data-k2="daten">Angaben bearbeiten</button>' +
      '<button type="button" class="ad-mini" data-k2="zahler">' + (p.zahler ? 'Zahler &auml;ndern' : 'Zahler festlegen') + '</button></div></div>';
    if (p.daten && !(p.termine || []).length && !(p.karten || []).length) {
      html += '<details class="pf-d" style="margin-top:14px"><summary>Kunde l&ouml;schen</summary><div class="pf-in"><p class="ad-hint">Nur m&ouml;glich, solange der Kunde noch keine Termine, Karten oder zugeordneten Adressen hat (zum Beispiel nach einem Tippfehler). Die Anamnese-Notizen werden mit gel&ouml;scht.</p>' +
        '<button type="button" class="ad-mini ak-red" data-k2="loeschen">Kunde l&ouml;schen</button></div></details>';
    }
    return html;
  }

  /* Knöpfe im Profil verdrahten: root = Profil-Container, fertig = Profil neu laden, oeffnen(key) = anderes Profil */
  function binden(root, p, fertig, oeffnen) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-k2]'), function (b) {
      b.onclick = function () {
        var a = b.getAttribute('data-k2');
        if (a === 'daten') return daten(p, fertig);
        if (a === 'zahler') return zahler(p, fertig);
        if (a === 'loeschen') {
          if (!b.getAttribute('data-sicher')) { b.setAttribute('data-sicher', '1'); b.textContent = 'Wirklich endgültig löschen?'; return; }
          b.disabled = true;
          return A.api('kunde2/loeschen', { body: { key: p.email } }).then(function () { A.note('Kunde gelöscht.'); if (window.FDKunden && window.FDKunden.zurueck) window.FDKunden.zurueck(); }).catch(function (e) { b.disabled = false; fail(e); });
        }
        if (a.indexOf('oeffnen:') === 0) return oeffnen(a.slice(8));
        if (a.indexOf('vs:') === 0) {
          var t = a.split(':'), code = t[1], wer = t[2];
          if (wer === 'verwerfen' && !b.getAttribute('data-sicher')) { b.setAttribute('data-sicher', '1'); b.textContent = 'Wirklich verwerfen?'; return; }
          b.disabled = true;
          return A.api('kunde2/vorschlag', { body: { code: code, wer: wer } }).then(function () { A.note(wer === 'verwerfen' ? 'Verworfen.' : 'Übernommen.'); fertig(); })
            .catch(function (e) {
              b.disabled = false;
              var m = root.querySelector('[data-k2msg="' + code + '"]');
              if (m && e && e.message !== 'abgemeldet') { m.className = 'tm-msg bad'; m.textContent = e.message || 'Das hat nicht geklappt.'; } else fail(e);
            });
        }
      };
    });
  }

  window.FDKunde2 = { neu: neu, daten: daten, zahler: zahler, karteLink: karteLink, vorschlaegeHtml: vorschlaegeHtml, angabenHtml: angabenHtml, binden: binden };

  /* Knopf „Kunde anlegen“ im Reiter Kunden und Kachel auf „Heute“ */
  function einhaengen() {
    var ka = document.getElementById('kundenApp');
    if (ka && ka.parentNode && !document.getElementById('kundenAnlegen')) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-ghost'; b.id = 'kundenAnlegen';
      b.style.cssText = 'width:100%;margin-bottom:14px';
      b.textContent = '+ Kunde anlegen (ohne Termin, auch ohne E-Mail)';
      b.onclick = function () { neu(); };
      var ref = document.getElementById('kundenNeu');
      if (ref && ref.parentNode === ka.parentNode) ka.parentNode.insertBefore(b, ka); else ka.parentNode.insertBefore(b, ka);
    }
  }
  einhaengen();
  setTimeout(einhaengen, 400);
})();
