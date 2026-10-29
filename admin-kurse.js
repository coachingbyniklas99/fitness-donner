/* Verwaltung – Reiter „Kurse“. Nutzt Anmeldung und API-Helfer aus admin.html (window.FD_ADMIN).
   Rollen: Heute sieht der Inhaber alle Anbieterinnen. Später bekommt jede Trainerin einen
   eigenen Zugang und sieht hier nur ihre eigenen Kurse, Kunden, Karten und Buchungen. */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var box = document.getElementById('kurseApp');
  var WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var S = { p: 'niklas', view: 'termine', data: null, offen: {}, edit: null, best: null };
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
    return A.api('kurse/state?p=' + encodeURIComponent(S.p)).then(function (d) { S.data = d; render(); })
      .catch(function (e) { if (e.message !== 'abgemeldet') A.note(e.message, true); });
  }
  window.FDKurse = { open: function () { if (!S.data) laden(); else render(); } };

  /* ---------- Rahmen ---------- */
  function render() {
    var d = S.data;
    var anb = d.anbieterinnen.length > 1 ? '<div class="ad-chips ak-anb">' + d.anbieterinnen.map(function (a) {
      return '<button type="button" class="ad-chip' + (a.id === S.p ? ' ak-on' : '') + '" data-anb="' + esc(a.id) + '">' + esc(a.name) + '<span>' + (a.aktiv ? (a.zahlung_bereit ? 'aktiv' : 'Stripe fehlt') : 'vorbereitet, inaktiv') + '</span></button>';
    }).join('') + '</div>' : '';
    var views = [['termine', 'Termine'], ['usc', 'Urban Sports' + (d.usc.length ? ' (' + d.usc.length + ')' : '')], ['erstattungen', 'Erstattungen' + (d.erstattungen.length ? ' (' + d.erstattungen.length + ')' : '')],
      ['kurse', 'Kurse'], ['bestellungen', 'Bestellungen'], ['einstellungen', 'Preise & Regeln']];
    box.innerHTML = anb + '<div class="ak-views">' + views.map(function (v) {
      return '<button type="button" class="ak-view' + (S.view === v[0] ? ' on' : '') + '" data-view="' + v[0] + '">' + esc(v[1]) + '</button>';
    }).join('') + '</div><div id="akBody"></div>';
    on('[data-anb]', function (b) { S.p = b.getAttribute('data-anb'); S.data = null; laden(); });
    on('[data-view]', function (b) { S.view = b.getAttribute('data-view'); S.edit = null; render(); });
    ({ termine: vTermine, usc: vUsc, erstattungen: vErstattungen, kurse: vKurse, bestellungen: vBestellungen, einstellungen: vEinstellungen })[S.view]();
  }
  function body(html) { q('#akBody').innerHTML = html; }

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
    if (!d.kurse.length) { body('<div class="ad-empty">Noch kein Kurs angelegt. <button type="button" class="ad-linkbtn" data-go="kurse">Kurs anlegen</button></div>'); on('[data-go]', function () { S.view = 'kurse'; render(); }); return; }
    var list = d.termine.filter(function (t) { return !t.vorbei; });
    var html = '<div class="ad-sec-head"><h2>Kurstermine</h2><button type="button" class="ad-refresh" id="akReload">Neu laden</button></div>'
      + (d.blockiert_pt ? '<p class="ad-hint">Kurszeiten sind f&uuml;r dein Personal Training automatisch blockiert &ndash; online, in der Sperren-Liste und beim Verschieben.</p>' : '')
      + '<div class="ad-list">' + list.map(terminKarte).join('') + '</div>';
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
    var d = S.data;
    if (S.edit) return kursForm();
    var html = '<div class="ad-sec-head"><h2>Kurse</h2><button type="button" class="ad-refresh" id="akNeu">Neuer Kurs</button></div>'
      + '<p class="ad-hint">Ein Kurs l&auml;uft jede Woche am selben Tag zur selben Zeit. Erst wenn er <b>aktiv</b> ist, blockiert er dein Personal Training und ist buchbar.</p>'
      + (d.kurse.length ? '<div class="ad-list">' + d.kurse.map(function (k) {
        return '<div class="ad-card"><div class="ad-card-top"><span class="ad-when">' + esc(k.titel) + '</span><span class="ad-tagline">' + (k.aktiv ? (k.sichtbar === false ? 'aktiv · versteckt' : 'aktiv') : 'Entwurf') + '</span></div>'
          + '<div class="ad-meta">' + esc(WDL[k.wochentag]) + 's ' + esc(k.start) + ' · ' + k.minuten + ' Min. · ' + k.kapazitaet + ' Plätze · ' + esc(k.ort) + '</div>'
          + '<div class="ad-meta">ab ' + esc(k.start_datum.split('-').reverse().join('.')) + (k.end_datum ? ' bis ' + esc(k.end_datum.split('-').reverse().join('.')) : ' · laufend') + (k.min_teilnehmer ? ' · mind. ' + k.min_teilnehmer : '') + '</div>'
          + '<div class="ad-actions"><button type="button" class="ad-mini" data-ed="' + esc(k.id) + '">Bearbeiten</button></div></div>';
      }).join('') + '</div>' : '<div class="ad-empty">Noch kein Kurs.</div>');
    body(html);
    q('#akNeu').onclick = function () { S.edit = { neu: true }; render(); };
    on('[data-ed]', function (b) { S.edit = S.data.kurse.filter(function (k) { return k.id === b.getAttribute('data-ed'); })[0]; render(); });
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
      + '<div class="ad-field"><label>Adresse</label><input name="adresse" value="' + esc(k.adresse || '') + '"></div>'
      + '<div class="ad-field"><label>Mindestteilnehmer (nur Info)</label><input type="number" name="min_teilnehmer" value="' + esc(k.min_teilnehmer || '') + '" min="1"></div>'
      + '<div class="ad-field"><label>Puffer fürs PT (Min.)</label><input type="number" name="puffer_min" value="' + esc(k.puffer_min || 0) + '" min="0" max="120"></div>'
      + '</div>'
      + '<div class="ad-field"><label>Beschreibung (öffentlich)</label><input name="beschreibung" value="' + esc(k.beschreibung || '') + '" maxlength="400"></div>'
      + '<div class="ak-grid">'
      + '<div class="ad-field"><label>Art (z. B. Fitness, Mobility)</label><input name="kategorie" value="' + esc(k.kategorie || '') + '" maxlength="40"></div>'
      + '<div class="ad-field"><label>Farbe Platzhalterbild</label><input type="color" name="farbe" value="' + esc(k.farbe || '#7a5c12') + '" style="height:50px;padding:4px"></div>'
      + '</div>'
      + '<div class="ad-field"><label>Bild (Dateiname auf der Website, leer = Platzhalter)</label><input name="bild" value="' + esc(k.bild || '') + '" placeholder="z. B. newforge-kursraum.webp"></div>'
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
    var senden = function (force) {
      var e = f.elements;
      var num = function (v) { return v === '' ? null : Number(v); };
      var euro = function (v) { return v === '' ? null : Math.round(Number(v) * 100); };
      var kurs = {
        id: S.edit.neu ? undefined : S.edit.id, titel: e.titel.value, wochentag: Number(e.wochentag.value), start: e.start.value,
        minuten: Number(e.minuten.value), kapazitaet: Number(e.kapazitaet.value), start_datum: e.start_datum.value, end_datum: e.end_datum.value,
        ort: e.ort.value, adresse: e.adresse.value, min_teilnehmer: num(e.min_teilnehmer.value), puffer_min: num(e.puffer_min.value),
        beschreibung: e.beschreibung.value, freischalt_tage: num(e.freischalt_tage.value),
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
        q('#akBest').innerHTML = d.bestellungen.length ? d.bestellungen.map(function (o) {
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
