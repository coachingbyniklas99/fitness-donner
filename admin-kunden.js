/* Verwaltung – Reiter „Kunden“ (neu): Liste mit Karten-Stand, Profil mit Einheiten-Übersicht, Rechnung, Karte ausstellen.
   Nutzt Anmeldung und API-Helfer aus admin.html (window.FD_ADMIN) und admin-karte.js (window.FDKarte).
   Alles hier ist nur die Oberfläche; gesammelt wird im Worker (/api/admin/kunden/…). */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var box = document.getElementById('kundenApp');
  if (!box) return;
  var S = { liste: null, q: '', filter: 'alle', profil: null, mail: null, timer: null, nachladen: false };

  function esc(x) { return A.esc(x); }
  function fd(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  var WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  function tagName(iso) { var t = heute(); if (String(iso).slice(0, 10) === t) return 'Heute'; var m = new Date(); m.setDate(m.getDate() + 1); if (String(iso).slice(0, 10) === m.getFullYear() + '-' + pad(m.getMonth() + 1) + '-' + pad(m.getDate())) return 'Morgen'; return wd(iso); }
  function wd(iso) { var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return isNaN(d) ? '' : WD[d.getUTCDay()] + ', ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.'; }
  function ts(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fail(e) { if (e && e.message !== 'abgemeldet') A.note(e.message || 'Das hat nicht geklappt.', true); }
  function pad(n) { return ('0' + n).slice(-2); }
  function heute() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function jetztHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function n(x, eins, mehr) { return x + ' ' + (x === 1 ? eins : mehr); }
  function initial(s) { return esc(String(s || '?').trim().charAt(0).toUpperCase() || '?'); }
  function K() { return window.FDKarte; }

  window.FDKunden = {
    open: function () { var l = K() ? K().laden().catch(function () {}) : Promise.resolve(); if (!S.liste) laden(); else l.then(render); },
    oeffnen: function (email) { return profilLaden(email); }
  };
  document.addEventListener('fd:karten', function () { if (box.offsetParent !== null) render(); });
  document.addEventListener('fd:neu', function () { if (S.profil) profilLaden(S.profil.email); else laden(); });

  /* ---------- Laden ---------- */
  function laden() {
    var kl = K() ? K().laden().catch(function () {}) : Promise.resolve();
    return A.api('kunden/liste?q=' + encodeURIComponent(S.q)).then(function (d) { S.liste = d; S.profil = null; return kl; }).then(render).catch(fail);
  }
  function profilLaden(email) {
    S.mail = null;
    var kl = K() ? K().laden().catch(function () {}) : Promise.resolve();
    return A.api('kunden/profil?email=' + encodeURIComponent(email)).then(function (d) { S.profil = d; return kl; }).then(function () { render(); window.scrollTo(0, 0); }).catch(fail);
  }
  function mailLaden(key) {
    return A.api('kunden/mail?key=' + encodeURIComponent(key)).then(function (d) { S.mail = d; render(); var m = document.getElementById('kdMail'); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'start' }); }).catch(fail);
  }

  function render() { if (S.profil) renderProfil(); else renderListe(); }

  /* ---------- Liste ---------- */
  function aktiveKarte(email) {
    var l = K() ? K().karten(email) : [];
    return l.filter(function (c) { return (c.status === 'active' && ((c.left || 0) > 0 || (c.upcoming || 0) > 0)) || (c.status === 'redeemed' && (c.upcoming || 0) > 0); })[0] || null;
  }
  function kartenZeile(c) {
    var done = (c.done || 0) + (c.manual > 0 ? c.manual : 0), booked = c.upcoming || 0, frei = Math.max(0, c.total - done - booked);
    var fast = (booked + frei) <= 1;
    return '<span class="ch ' + (fast ? 'ch-letzte' : 'ch-karte') + '"><span class="ch-top"><b>' + esc(c.label) + ' &middot; ' + done + ' von ' + c.total + ' absolviert</b>' +
      '<small>' + (booked ? booked + ' gebucht' : 'nichts gebucht') + (frei ? ' &middot; ' + frei + ' frei' : '') + '</small></span>' + K().dotRow(c.total, done, false, booked) + '</span>';
  }
  function zeilen(d) {
    return d.kunden.map(function (k) {
      var c = aktiveKarte(k.email);
      k._c = c;
      return k;
    });
  }
  function passt(k) {
    var c = k._c, f = S.filter;
    if (f === 'karte') return !!c;
    if (f === 'fast') return !!c && ((c.upcoming || 0) + Math.max(0, c.total - (c.done || 0) - (c.manual > 0 ? c.manual : 0) - (c.upcoming || 0))) <= 1;
    if (f === 'offen') return (k.offen || 0) > 0;
    if (f === 'ohne') return !c && !k.kommend;
    return true;
  }

  function renderListe() {
    var d = S.liste || { kunden: [], total: 0 };
    var l = zeilen(d), cnt = { alle: l.length, karte: 0, fast: 0, offen: 0, ohne: 0 };
    l.forEach(function (k) { var f = S.filter; ['karte', 'fast', 'offen', 'ohne'].forEach(function (x) { S.filter = x; if (passt(k)) cnt[x]++; }); S.filter = f; });
    var FILT = [['alle', 'Alle'], ['karte', 'Mit Karte'], ['fast', 'Karte fast leer'], ['offen', 'Rechnung offen'], ['ohne', 'Ohne Termin']];
    var sicht = l.filter(passt).sort(function (a, b) {
      if (!!a.kommend !== !!b.kommend) return a.kommend ? -1 : 1;
      if (a.kommend && b.kommend && a.kommend !== b.kommend) return a.kommend < b.kommend ? -1 : 1;
      return String(a.name || a.email).localeCompare(String(b.name || b.email), 'de');
    });
    var html =
      '<p class="ad-hint">Tippe einen Kunden an: Dort siehst du Karte, Termine, Rechnung und Mails &ndash; und stellst eine neue Karte aus.</p>' +
      '<input type="search" class="ad-search" id="kdSuche" style="margin-bottom:12px" placeholder="Name, E-Mail oder Telefon suchen" value="' + esc(S.q) + '" autocomplete="off">' +
      '<div class="kd-filters">' + FILT.map(function (f) { return '<button type="button" class="kd-f' + (S.filter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '<b>' + cnt[f[0]] + '</b></button>'; }).join('') + '</div>';
    if (!sicht.length) {
      html += '<div class="ad-empty">' + (S.q ? 'Niemand gefunden.' : S.filter !== 'alle' ? 'Niemand in dieser Gruppe.' : 'Noch keine Kunden.') + '</div>';
    } else {
      html += '<div class="ad-list">' + sicht.map(function (k) {
        var c = k._c;
        var info = k.kommend ? 'Nächster Termin: <b style="color:var(--bone)">' + esc(tagName(k.kommend)) + '</b>' : 'Kein Termin geplant';
        return '<button type="button" class="kd-item" data-email="' + esc(k.email) + '"><span class="kd-av">' + initial(k.name || k.email) + '</span>' +
          '<span class="kd-who"><b>' + esc(k.name || k.email) + '</b><span>' + info + '</span>' +
          (c ? kartenZeile(c) : (k.termine ? '<span class="ch ch-einzel"><span class="ch-top"><b>Einzelstunden</b><small>' + n(k.termine, 'Termin', 'Termine') + '</small></span></span>' : '')) +
          ((k.offen || 0) > 0 ? '<span><span class="kd-badge offen">Rechnung offen</span></span>' : '') + '</span></button>';
      }).join('') + '</div>' +
      (d.total > d.kunden.length ? '<div class="ad-hint" style="margin-top:12px">' + d.kunden.length + ' von ' + d.total + ' angezeigt &ndash; bitte suchen, um einen bestimmten Kunden zu finden.</div>' : '');
    }
    html += '<details class="pf-d" style="margin-top:30px"><summary>Mail-Verlauf vervollständigen</summary><div class="pf-in"><p class="ad-hint">Der Mail-Verlauf wird erst seit dem Start dieser Funktion mitgeschrieben. Ältere Mails kann ich aus Resend nachladen (je Durchgang 10 Mails, das dauert ein paar Sekunden). Mails an dich selbst werden übersprungen.</p>' +
      '<button type="button" class="ad-mini" id="kdNach"' + (S.nachladen ? ' disabled' : '') + '>' + (S.nachladen ? 'Lädt …' : 'Ältere Mails nachladen') + '</button>' +
      '<div class="ad-meta" id="kdNachErg" style="margin-top:10px"></div></div></details>';
    box.innerHTML = html;

    var s = document.getElementById('kdSuche');
    s.oninput = function () {
      S.q = s.value;
      clearTimeout(S.timer);
      S.timer = setTimeout(function () {
        var pos = s.selectionStart;
        laden().then(function () { var n2 = document.getElementById('kdSuche'); if (n2) { n2.focus(); try { n2.setSelectionRange(pos, pos); } catch (e) {} } });
      }, 300);
    };
    Array.prototype.forEach.call(box.querySelectorAll('[data-f]'), function (b) { b.onclick = function () { S.filter = b.getAttribute('data-f'); renderListe(); }; });
    Array.prototype.forEach.call(box.querySelectorAll('.kd-item'), function (b) { b.onclick = function () { profilLaden(b.getAttribute('data-email')); }; });
    document.getElementById('kdNach').onclick = nachladen;
  }

  function nachladen() {
    var erg = document.getElementById('kdNachErg');
    S.nachladen = true;
    document.getElementById('kdNach').disabled = true;
    var neu = 0, runde = 0;
    function schritt(after) {
      runde++;
      erg.textContent = 'Runde ' + runde + ' … ' + neu + ' Mails geladen';
      return A.api('kunden/nachladen', { body: { after: after || '' } }).then(function (r) {
        neu += r.neu;
        if (r.weiter && runde < 60) return schritt(r.after);
        erg.textContent = 'Fertig: ' + neu + ' ältere Mails übernommen.' + (r.fehler ? ' ' + r.fehler + ' ließen sich nicht laden.' : '');
      });
    }
    schritt('').catch(function (e) {
      erg.textContent = (e && e.message) || 'Das hat nicht geklappt.';
    }).then(function () {
      S.nachladen = false;
      var b = document.getElementById('kdNach'); if (b) b.disabled = false;
    });
  }

  /* ---------- Profil ---------- */
  var STATUS = { confirmed: 'bestätigt', cancelled: 'storniert', active: 'aktiv', redeemed: 'aufgebraucht', bestaetigt: 'bestätigt', abgesagt: 'abgesagt', verfallen: 'kurzfristig abgesagt (verfallen)' };
  function stat(s) { return STATUS[s] || s || ''; }
  /* Aktiv = noch Einheiten frei ODER noch Termine offen (Status „aufgebraucht“ gilt schon, wenn alle Einheiten gebucht sind) */
  function istAktiv(k) { return k.status === 'active' || (k.status === 'redeemed' && (k.kommend || 0) > 0); }

  function einheiten(k, termine) {
    var t0 = heute(), jetzt = jetztHM(), units = [], i;
    var mine = termine.filter(function (t) { return t.card_code === k.code && (t.status === 'confirmed' || t.status === 'verfallen'); })
      .sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
    for (i = 0; i < (k.manuell > 0 ? k.manuell : 0); i++) units.push({ s: 'manuell' });
    mine.forEach(function (t) {
      var vorbei = t.status === 'verfallen' || t.date < t0 || (t.date === t0 && t.end && t.end <= jetzt);
      units.push({ s: t.status === 'verfallen' ? 'verf' : vorbei ? 'done' : 'booked', t: t });
    });
    var total = (k.absolviert || 0) + (k.kommend || 0) + (k.frei || 0) + (k.manuell > 0 ? k.manuell : 0);
    if (k.total) total = k.total;
    while (units.length < total) units.push({ s: 'free' });
    for (i = 0; i < units.length; i++) if (units[i].s === 'booked') { units[i].s = 'now'; break; }
    return units;
  }

  function rechnungZeile(k, p) {
    var r = k.rechnung;
    if (!r && k.zahlstatus) {
      var offenZ = k.zahlstatus === 'offen';
      return '<div class="kc-rech"><span>' + (offenZ ? '<span class="st offen">Nicht bezahlt</span> &middot; ' + (k.rechnung_nr ? 'Rechnung <b>' + esc(k.rechnung_nr) + '</b> gestellt' : 'Rechnung folgt noch') : '<span class="st ok">Bezahlt</span>' + (k.rechnung_nr ? ' &middot; Rechnung <b>' + esc(k.rechnung_nr) + '</b>' : '')) + '</span>' +
        '<span class="ad-actions" style="margin:0"><button type="button" class="ad-mini" data-zahlstatus="' + esc(k.code) + '">' + (offenZ ? 'Rechnung eintragen / bezahlt' : 'Zahlung ansehen') + '</button></span></div>';
    }
    if (!r) return '<div class="kc-rech"><span style="color:var(--muted)">Keine Rechnung zu dieser Karte gespeichert.</span></div>';
    var ueber = r.status !== 'paid' && r.faellig && r.faellig < heute();
    var txt = r.status === 'paid' ? '<span class="st ok">Bezahlt</span>' : r.methode === 'lastschrift' ? '<span class="st laeuft">Lastschrift l&auml;uft</span>' : ueber ? '<span class="st offen">&Uuml;berf&auml;llig seit ' + esc(fd(r.faellig)) + '</span>' : '<span class="st laeuft">Offen bis ' + esc(fd(r.faellig)) + '</span>';
    return '<div class="kc-rech"><span>Rechnung <b>' + esc(r.nummer) + '</b> &middot; ' + A.eur(r.cents) + ' &middot; ' + txt + '</span><span class="ad-actions" style="margin:0">' +
      (r.status !== 'paid' ? '<button type="button" class="ad-mini" data-paid="' + esc(r.id) + '">Als bezahlt markieren</button>' : '') +
      (r.url ? '<a class="ad-mini" target="_blank" rel="noopener" href="' + esc(r.url) + '">Ansehen</a>' : '') + '</span></div>';
  }

  function karteHtml(k, p) {
    var units = einheiten(k, p.termine), total = units.length;
    var done = units.filter(function (u) { return u.s === 'done' || u.s === 'verf' || u.s === 'manuell'; }).length;
    var booked = units.filter(function (u) { return u.s === 'now' || u.s === 'booked'; }).length;
    var frei = units.filter(function (u) { return u.s === 'free'; }).length;
    var aktiv = istAktiv(k);
    var nr = 0, nextU = units.filter(function (u) { return u.s === 'now'; })[0];
    var big = nextU ? '<div class="kc-big"><b>Nr. ' + (done + 1) + ' von ' + total + '</b><span>ist der n&auml;chste Termin' + (nextU.t ? ' &middot; ' + esc(wd(nextU.t.date)) + ', ' + esc(nextU.t.start) + ' Uhr' : '') + '</span></div>'
      : '<div class="kc-big"><b>' + done + ' von ' + total + '</b><span>absolviert' + (frei ? ' &middot; ' + frei + ' noch nicht gebucht' : '') + '</span></div>';
    var bar = '<div class="kc-bar">' + units.map(function (u) { return '<i class="u-' + u.s + '"></i>'; }).join('') + '</div>';
    var stats = '<div class="kc-stats"><span><b>' + done + '</b> absolviert</span><span><b>' + booked + '</b> gebucht</span><span><b>' + frei + '</b> frei</span>' + (k.expires ? '<span>g&uuml;ltig bis <b>' + esc(fd(k.expires)) + '</b></span>' : '') + '</div>';
    var list = units.map(function (u, i) {
      var nrx = i + 1, t = u.t, tag = '', sub = '', main = '';
      if (u.s === 'done') { main = esc(wd(t.date)) + ', ' + esc(t.start) + ' Uhr'; tag = 'Absolviert'; sub = esc([t.city, t.place].filter(Boolean).join(' · ')); }
      else if (u.s === 'verf') { main = esc(wd(t.date)) + ' &middot; kurzfristig abgesagt'; tag = 'Verfallen'; sub = 'Einheit z&auml;hlt als genutzt'; }
      else if (u.s === 'manuell') { main = 'Von Hand abgezogen'; tag = 'Abgezogen'; }
      else if (u.s === 'now') { main = esc(wd(t.date)) + ', ' + esc(t.start) + ' Uhr'; tag = 'N&auml;chster'; sub = esc([t.city, t.place].filter(Boolean).join(' · ')); }
      else if (u.s === 'booked') { main = esc(wd(t.date)) + ', ' + esc(t.start) + ' Uhr'; tag = 'Gebucht'; sub = esc([t.city, t.place].filter(Boolean).join(' · ')); }
      else { main = 'Noch nicht gebucht'; tag = ''; }
      return '<div class="kc-u u-' + u.s + '"><span class="kc-n">' + nrx + '</span><span class="kc-t">' + main + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
        (u.s === 'free' && aktiv ? '<button type="button" class="ad-mini" data-eintragen="' + esc(k.code) + '">Termin eintragen</button>' : '<span class="kc-tag">' + tag + '</span>') + '</div>';
    }).join('');
    var nudge = aktiv && (booked + frei) <= 1 ? '<div class="kc-nudge"><span>' + (booked + frei === 0 ? 'Alle Einheiten sind verbraucht.' : 'Nur noch eine Einheit &uuml;brig.') + ' Zeit f&uuml;r eine neue Karte?</span><button type="button" class="ad-mini" data-neuekarte="1">Neue Karte ausstellen</button></div>' : '';
    return '<div class="kc' + (aktiv ? '' : ' kc-aus') + '"><div class="kc-top"><span class="kc-title">' + esc(k.label) + '</span><span class="kc-code">' + esc(k.code) + (aktiv ? '' : ' &middot; ' + esc(stat(k.status))) + '</span></div>' +
      big + bar + stats + '<div class="kc-units">' + list + '</div>' + rechnungZeile(k, p) + nudge + '</div>';
  }

  function renderProfil() {
    var p = S.profil, t0 = heute();
    var kommend = p.termine.filter(function (t) { return t.date >= t0; }).sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
    var vergangen = p.termine.filter(function (t) { return t.date < t0; }).sort(function (a, b) { return (b.date + b.start).localeCompare(a.date + a.start); });
    var karten = p.karten.filter(function (k) { return k.kind === 'karte'; });
    var gutscheine = p.karten.filter(function (k) { return k.kind !== 'karte'; });
    var aktiv = karten.filter(istAktiv), frueher = karten.filter(function (k) { return !istAktiv(k); });

    function terminKarte(t) {
      var verschoben = t.orig_date && t.orig_date !== t.date;
      var k = t.card_code && K() && K().info(t.card_code);
      var chipHtml = '';
      if (t.card_code) chipHtml = '<span class="ch ch-karte"><span class="ch-top"><b>Karte</b><small>' + esc(t.card_code) + '</small></span></span>';
      else if (t.voucher_code) chipHtml = '<span class="ch ch-gut"><span class="ch-top"><b>Gutschein</b></span></span>';
      else if (/probe/i.test(t.label || '')) chipHtml = '<span class="ch ch-probe"><span class="ch-top"><b>Probetraining</b><small>1 von 1</small></span></span>';
      else chipHtml = '<span class="ch ch-einzel"><span class="ch-top"><b>Einzelstunde</b><small>1 von 1</small></span></span>';
      return '<div class="ad-card"><div class="ad-card-top"><span class="ad-when">' + esc(fd(t.date)) + ' &middot; ' + esc(t.start) + (t.end ? '–' + esc(t.end) : '') + ' Uhr</span>' +
        '<span class="ad-tagline">' + esc(stat(t.status)) + '</span></div>' +
        '<div class="ad-who">' + esc(t.label) + '</div>' + chipHtml +
        '<div class="ad-meta">' + esc([t.city, t.place].filter(Boolean).join(' · ')) + '</div>' +
        (t.promo_code ? '<div class="ad-meta">Aktionscode ' + esc(t.promo_code) + '</div>' : '') +
        (verschoben ? '<div class="ad-meta">Verschoben von ' + esc(fd(t.orig_date)) + '</div>' : '') +
        (t.note ? '<div class="ad-note">' + esc(t.note) + '</div>' : '') +
        (t.status === 'confirmed' && t.date >= t0 && t.slot_id ? '<div class="ad-actions" style="margin-top:12px"><button type="button" class="ad-mini" data-move="' + esc(t.date + '|' + t.slot_id) + '">Verschieben</button><button type="button" class="ad-mini ak-red" data-absagen="' + esc(t.date + '|' + t.slot_id) + '">Absagen &hellip;</button></div>' : '') + '</div>';
    }

    var gutHtml = gutscheine.length ? '<div class="ad-list">' + gutscheine.map(function (k) {
      return '<div class="ad-card"><div class="ad-card-top"><span class="ad-code">' + esc(k.code) + '</span><span class="ad-tagline">' + esc(k.label) + '</span></div>' +
        '<div class="ad-who">&Uuml;brig: ' + esc(k.rest) + '</div><div class="ad-meta">' + esc(k.rolle) + ' &middot; ' + esc(stat(k.status)) + ' &middot; g&uuml;ltig bis ' + esc(fd(k.expires)) + '</div></div>';
    }).join('') + '</div>' : '';

    var kurseHtml = p.kurse.length ? '<div class="ad-list">' + p.kurse.map(function (k) {
      var tn = (k.termine || []).map(function (x) { return fd(x.datum || x); }).filter(Boolean);
      return '<div class="ad-card"><div class="ad-card-top"><span class="ad-who">' + esc(k.kurs || 'Kurs') + '</span><span class="ad-tagline">' + esc(k.art) + '</span></div>' +
        '<div class="ad-meta">Preis ' + esc(k.preis) + ' &middot; bezahlt ' + esc(k.bezahlt) + (k.pay_status === 'unpaid' ? ' &middot; Lastschrift l&auml;uft' : '') + ' &middot; ' + esc(stat(k.status)) + '</div>' +
        (tn.length ? '<div class="ad-meta">Termine: ' + esc(tn.join(', ')) + '</div>' : '') +
        (k.erstattungen ? '<div class="ad-meta ak-warn">' + n(k.erstattungen, 'Erstattung', 'Erstattungen') + '</div>' : '') +
        '<div class="ad-meta">Bestellt am ' + esc(ts(k.created)) + '</div></div>';
    }).join('') + '</div>' : '';

    var widerrufHtml = p.widerrufe.length ? '<div class="ad-list">' + p.widerrufe.map(function (w) {
      return '<div class="ad-card"><div class="ad-who">Widerruf vom ' + esc(ts(w.received)) + '</div><div class="ad-meta">Vertrag: ' + esc(w.vertrag) + '</div>' +
        (w.nachricht ? '<div class="ad-note">' + esc(w.nachricht) + '</div>' : '') + '</div>';
    }).join('') + '</div>' : '';

    var mailsHtml = p.mails.length ? '<div class="ad-list">' + p.mails.map(function (m) {
      return '<button type="button" class="ad-card kd-mailrow' + (S.mail && S.mail.key === m.key ? ' on' : '') + '" data-key="' + esc(m.key) + '">' +
        '<span class="kd-mailtop"><span class="ad-tagline">' + esc(m.art) + '</span><span class="ad-meta">' + esc(ts(m.ts)) + '</span></span>' +
        '<span class="ad-who kd-subj">' + esc(m.subject) + '</span></button>';
    }).join('') + '</div>' : '<div class="ad-empty">' + (p.mails_ab ? 'Keine Mails gespeichert (Protokoll seit ' + fd(p.mails_ab) + ').' : 'Noch keine Mails gespeichert.') + '</div>';

    var mailAnsicht = '';
    if (S.mail) {
      var m = S.mail;
      mailAnsicht = '<div class="ad-card" id="kdMail" style="margin-top:14px"><div class="ad-card-top"><span class="ad-tagline">' + esc(m.art || 'Mail') + '</span>' +
        '<button type="button" class="ad-undo" id="kdMailZu">Schließen</button></div>' +
        '<div class="ad-who">' + esc(m.subject) + '</div>' +
        '<div class="ad-meta">An ' + esc(m.to) + ' &middot; ' + esc(ts(m.ts)) + '</div>' +
        (m.from ? '<div class="ad-meta">Von ' + esc(m.from) + '</div>' : '') +
        ((m.anhaenge || []).length ? '<div class="ad-meta">Anhang: ' + esc(m.anhaenge.join(', ')) + '</div>' : '') +
        '<iframe class="kd-frame" id="kdFrame" sandbox="" title="Mail"></iframe></div>';
    }

    var tel = String(p.phone || '').replace(/[^+\d]/g, '');
    var wa = tel ? 'https://wa.me/' + tel.replace(/^\+/, '').replace(/^00/, '').replace(/^0/, '49') : '';
    var zahl = p.zahlart ? K().zahlText(p.zahlart) : '';

    box.innerHTML =
      '<button type="button" class="ad-refresh" id="kdZurueck">&lsaquo; Alle Kunden</button>' +
      '<div class="pf-head"><div class="pf-top"><span class="kd-av">' + initial(p.name || p.email) + '</span><div><div class="pf-name">' + esc(p.name || p.email) + '</div><div class="pf-sub">' + esc(p.email) + '</div></div></div>' +
      '<div class="pf-contact"><a class="pf-c" ' + (tel ? 'href="tel:' + esc(tel) + '"' : 'aria-disabled="true"') + '><b>&#9742;</b>Anrufen</a>' +
      '<a class="pf-c" ' + (wa ? 'href="' + esc(wa) + '" target="_blank" rel="noopener"' : 'aria-disabled="true"') + '><b>&#128172;</b>WhatsApp</a>' +
      '<a class="pf-c" href="mailto:' + esc(p.email) + '"><b>&#9993;</b>E-Mail</a></div>' +
      '<button type="button" class="pf-zahl" id="kdZahl"><span>Zahlt per</span><div style="flex:1;margin-left:8px;font-weight:600">' + (zahl ? esc(zahl) : '<span>noch nicht festgelegt</span>') + '</div><em>' + (zahl ? 'Ändern' : 'Festlegen') + '</em></button>' +
      (p.zahlart === 'lastschrift' || p.mandat === false ? '<div class="pf-mandat ' + (p.mandat ? 'ok' : 'fehlt') + '">' + (p.mandat ? '<span>&#10003; Lastschrift-Mandat gespeichert</span>' : '<span>Kein Lastschrift-Mandat gespeichert</span><button type="button" class="ad-mini" id="kdMandat">Mandat anfordern</button>') + '</div>' : '') +
      '<div class="pf-cta"><button type="button" class="btn btn-blitz" id="kdNeueKarte">+ Neue Karte ausstellen</button><button type="button" class="btn btn-ghost" id="kdNeuTermin">+ Termin eintragen</button></div></div>' +

      '<div class="pf-h">Karte' + (aktiv.length > 1 ? 'n' : '') + '</div>' +
      (aktiv.length ? aktiv.map(function (k) { return karteHtml(k, p); }).join('') : '<div class="ad-empty">Keine aktive Karte. Mit „Neue Karte ausstellen“ legst du in einem Schritt Karte, Rechnung und Mail an.</div>') +
      (frueher.length ? '<details class="pf-d"><summary>Frühere Karten <span class="kd-count">' + frueher.length + '</span></summary><div class="pf-in">' + frueher.map(function (k) { return karteHtml(k, p); }).join('') + '</div></details>' : '') +
      (gutscheine.length ? '<div class="pf-h">Gutscheine <span class="kd-count">' + gutscheine.length + '</span></div>' + gutHtml : '') +

      '<div class="pf-h">Kommende Termine <span class="kd-count">' + kommend.length + '</span></div>' +
      (kommend.length ? '<div class="ad-list">' + kommend.map(terminKarte).join('') + '</div>' : '<div class="ad-empty">Keine kommenden Termine.</div>') +
      '<div class="pf-h">Weitere Angaben</div>' +
      (vergangen.length ? '<details class="pf-d"><summary>Vergangene Termine <span class="kd-count">' + vergangen.length + '</span></summary><div class="pf-in"><div class="ad-list">' + vergangen.map(terminKarte).join('') + '</div></div></details>' : '') +
      (p.kurse.length ? '<details class="pf-d"><summary>Kurse <span class="kd-count">' + p.kurse.length + '</span></summary><div class="pf-in">' + kurseHtml + '</div></details>' : '') +
      (p.widerrufe.length ? '<details class="pf-d" open><summary>Widerrufe <span class="kd-count">' + p.widerrufe.length + '</span></summary><div class="pf-in">' + widerrufHtml + '</div></details>' : '') +
      '<details class="pf-d"' + (S.mail ? ' open' : '') + '><summary>Mail-Verlauf <span class="kd-count">' + p.mails.length + '</span></summary><div class="pf-in">' + mailsHtml + mailAnsicht + '</div></details>' +
      '<p class="ad-hint" style="margin-top:14px">Abgesagte Termine werden aus dem Buchungssystem gelöscht &ndash; sie erscheinen nur über die Absage-Mail im Mail-Verlauf. Wiedervorlage: ' + (p.wv.abgemeldet ? 'abgemeldet' : p.wv.einwilligung ? 'Einwilligung eingetragen' : 'keine Besonderheit') + '. Mails werden 3 Jahre gespeichert.</p>';

    document.getElementById('kdZurueck').onclick = function () { S.profil = null; S.mail = null; if (!S.liste) laden(); else render(); window.scrollTo(0, 0); };
    function nachAktion() { profilLaden(p.email); }
    Array.prototype.forEach.call(box.querySelectorAll('[data-move]'), function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-move'), t = p.termine.filter(function (x) { return x.date + '|' + x.slot_id === k; })[0];
        if (!t || !window.FDTermine) return;
        var min = t.minutes || (t.end && t.start ? (Number(t.end.slice(0, 2)) * 60 + Number(t.end.slice(3))) - (Number(t.start.slice(0, 2)) * 60 + Number(t.start.slice(3))) : 60);
        window.FDTermine.verschieben({ date: t.date, slot_id: t.slot_id, start: t.start, end: t.end || '', city: t.city, name: p.name || p.email, minutesFallback: min }, nachAktion);
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-absagen]'), function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-absagen'), t = p.termine.filter(function (x) { return x.date + '|' + x.slot_id === k; })[0];
        if (t && A.absagen) A.absagen({ date: t.date, slot_id: t.slot_id, start: t.start, end: t.end, name: p.name || p.email, card_code: t.card_code, voucher_code: t.voucher_code }, nachAktion);
      };
    });
    function neueKarte() { K().ausstellen({ name: p.name, email: p.email }, function () { }); }
    document.getElementById('kdNeueKarte').onclick = neueKarte;
    Array.prototype.forEach.call(box.querySelectorAll('[data-neuekarte]'), function (b) { b.onclick = neueKarte; });
    var md = document.getElementById('kdMandat'); if (md) md.onclick = function () { K().mandatAnfordern(p, nachAktion); };
    document.getElementById('kdZahl').onclick = function () { K().zahlartWaehlen(p, nachAktion); };
    document.getElementById('kdNeuTermin').onclick = function () {
      if (!window.FDTermine) return;
      var kt = karten.filter(function (k) { return k.status === 'active' && k.frei > 0; })[0];
      window.FDTermine.eintragen({ code: kt ? kt.code : '', art: kt ? 'karte' : 'bar', name: p.name, email: p.email, phone: p.phone }, nachAktion);
    };
    Array.prototype.forEach.call(box.querySelectorAll('[data-eintragen]'), function (b) {
      b.onclick = function () { if (window.FDTermine) window.FDTermine.eintragen({ code: b.getAttribute('data-eintragen'), name: p.name, email: p.email, phone: p.phone }, nachAktion); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-zahlstatus]'), function (b) {
      b.onclick = function () { K().zahlstatus(b.getAttribute('data-zahlstatus'), nachAktion); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-paid]'), function (b) {
      b.onclick = function () { b.disabled = true; A.api('rechnung/bezahlt', { body: { id: b.getAttribute('data-paid') } }).then(function () { A.note('Als bezahlt markiert.'); nachAktion(); }).catch(function (e) { b.disabled = false; fail(e); }); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('.kd-mailrow'), function (b) { b.onclick = function () { mailLaden(b.getAttribute('data-key')); }; });
    if (S.mail) {
      document.getElementById('kdMailZu').onclick = function () { S.mail = null; render(); };
      document.getElementById('kdFrame').srcdoc = S.mail.html || '<p style="font-family:sans-serif">Kein Inhalt gespeichert.</p>';
    }
  }
})();
