/* Verwaltung – Reiter „Kunden“. Nutzt Anmeldung und API-Helfer aus admin.html (window.FD_ADMIN).
   Zeigt pro Kunde Termine, Karten/Gutscheine, Kurse, Widerrufe und den Mail-Verlauf.
   Alles hier ist nur die Oberfläche; gesammelt wird im Worker (/api/admin/kunden/…). */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var box = document.getElementById('kundenApp');
  if (!box) return;
  var S = { liste: null, q: '', profil: null, mail: null, timer: null, nachladen: false };

  function esc(x) { return A.esc(x); }
  function fd(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function ts(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fail(e) { if (e && e.message !== 'abgemeldet') A.note(e.message || 'Das hat nicht geklappt.', true); }
  function heute() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function n(x, eins, mehr) { return x + ' ' + (x === 1 ? eins : mehr); }

  window.FDKunden = { open: function () { if (!S.liste) laden(); else render(); } };

  /* ---------- Laden ---------- */
  function laden() {
    return A.api('kunden/liste?q=' + encodeURIComponent(S.q)).then(function (d) { S.liste = d; S.profil = null; render(); }).catch(fail);
  }
  function profilLaden(email) {
    S.mail = null;
    return A.api('kunden/profil?email=' + encodeURIComponent(email)).then(function (d) { S.profil = d; render(); window.scrollTo(0, 0); }).catch(fail);
  }
  function mailLaden(key) {
    return A.api('kunden/mail?key=' + encodeURIComponent(key)).then(function (d) { S.mail = d; render(); var m = document.getElementById('kdMail'); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'start' }); }).catch(fail);
  }

  /* ---------- Darstellung ---------- */
  function render() {
    if (S.profil) renderProfil(); else renderListe();
  }

  function renderListe() {
    var d = S.liste || { kunden: [], total: 0 };
    var html =
      '<p class="ad-hint">Suche nach Name, E-Mail-Adresse oder Telefonnummer. Ein Klick öffnet das Profil mit allen Terminen, Karten und gesendeten Mails.</p>' +
      '<input type="search" class="ad-search" id="kdSuche" placeholder="Name, E-Mail oder Telefon" value="' + esc(S.q) + '" autocomplete="off">';
    if (!d.kunden.length) {
      html += '<div class="ad-empty">' + (S.q ? 'Niemand gefunden.' : 'Noch keine Kunden.') + '</div>';
    } else {
      html += '<div class="ad-list">' + d.kunden.map(function (k) {
        var teile = [];
        if (k.termine) teile.push(n(k.termine, 'Termin', 'Termine'));
        if (k.kommend) teile.push('nächster ' + fd(k.kommend));
        if (k.karten) teile.push(n(k.karten, 'Karte/Gutschein', 'Karten/Gutscheine'));
        if (k.kurse) teile.push(n(k.kurse, 'Kurs', 'Kurse'));
        if (k.mails) teile.push(n(k.mails, 'Mail', 'Mails'));
        return '<button type="button" class="ad-card kd-row" data-email="' + esc(k.email) + '">' +
          '<span class="ad-who">' + esc(k.name || k.email) + '</span>' +
          (k.name ? '<span class="ad-meta">' + esc(k.email) + (k.phone ? ' · ' + esc(k.phone) : '') + '</span>' : (k.phone ? '<span class="ad-meta">' + esc(k.phone) + '</span>' : '')) +
          '<span class="ad-meta">' + (teile.length ? esc(teile.join(' · ')) : 'Nur Kontaktdaten') + '</span></button>';
      }).join('') + '</div>' +
      (d.total > d.kunden.length ? '<div class="ad-hint" style="margin-top:12px">' + d.kunden.length + ' von ' + d.total + ' angezeigt – bitte suchen, um einen bestimmten Kunden zu finden.</div>' : '');
    }
    html += '<h2 style="margin-top:34px">Ältere Mails nachladen</h2>' +
      '<p class="ad-hint">Der Mail-Verlauf wird erst seit dem Start dieser Funktion mitgeschrieben. Mails davor kann ich aus Resend nachladen (je Durchgang 10 Mails, das dauert ein paar Sekunden). Das klappt nur, wenn der Resend-Schlüssel im Worker auch lesen darf – sonst erscheint hier eine Meldung. Mails an dich selbst werden dabei übersprungen.</p>' +
      '<div class="ad-card"><button type="button" class="ad-mini" id="kdNach"' + (S.nachladen ? ' disabled' : '') + '>' + (S.nachladen ? 'Lädt …' : 'Ältere Mails nachladen') + '</button>' +
      '<div class="ad-meta" id="kdNachErg" style="margin-top:10px"></div></div>';
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
    Array.prototype.forEach.call(box.querySelectorAll('.kd-row'), function (b) {
      b.onclick = function () { profilLaden(b.getAttribute('data-email')); };
    });
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
      A.api('kunden/liste?q=' + encodeURIComponent(S.q)).then(function (d) { S.liste = d; }).catch(function () {});
    });
  }

  var STATUS = { confirmed: 'bestätigt', cancelled: 'storniert', active: 'aktiv', redeemed: 'aufgebraucht', bestaetigt: 'bestätigt', abgesagt: 'abgesagt' };
  function stat(s) { return STATUS[s] || s || ''; }

  function abschnitt(titel, anzahl, inhalt, leer) {
    return '<h2 style="margin-top:30px">' + esc(titel) + (anzahl ? ' <span class="kd-count">' + anzahl + '</span>' : '') + '</h2>' +
      (inhalt || '<div class="ad-empty">' + esc(leer) + '</div>');
  }

  function renderProfil() {
    var p = S.profil, t0 = heute();
    var kommend = p.termine.filter(function (t) { return t.date >= t0; }).sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
    var vergangen = p.termine.filter(function (t) { return t.date < t0; });

    function terminKarte(t) {
      var verschoben = t.orig_date && t.orig_date !== t.date;
      return '<div class="ad-card"><div class="ad-card-top"><span class="ad-when">' + esc(fd(t.date)) + ' · ' + esc(t.start) + (t.end ? '–' + esc(t.end) : '') + ' Uhr</span>' +
        '<span class="ad-tagline">' + esc(stat(t.status)) + '</span></div>' +
        '<div class="ad-who">' + esc(t.label) + '</div>' +
        '<div class="ad-meta">' + esc([t.city, t.place].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="ad-meta">Bezahlt: ' + (t.card_code ? 'mit Karte ' + esc(t.card_code) : t.voucher_code ? esc(t.paid) + ' (Gutschein ' + esc(t.voucher_code) + ')' : esc(t.paid)) + (t.promo_code ? ' · Aktionscode ' + esc(t.promo_code) : '') + '</div>' +
        (verschoben ? '<div class="ad-meta">Verschoben von ' + esc(fd(t.orig_date)) + '</div>' : '') +
        '<div class="ad-meta">Gebucht am ' + esc(ts(t.created)) + '</div>' +
        (t.note ? '<div class="ad-note">' + esc(t.note) + '</div>' : '') + '</div>';
    }

    var termineHtml = '';
    if (kommend.length) termineHtml += '<div class="kd-sub">Kommend</div><div class="ad-list">' + kommend.map(terminKarte).join('') + '</div>';
    if (vergangen.length) termineHtml += '<div class="kd-sub">Vergangen</div><div class="ad-list">' + vergangen.map(terminKarte).join('') + '</div>';

    var kartenHtml = p.karten.length ? '<div class="ad-list">' + p.karten.map(function (k) {
      return '<div class="ad-card"><div class="ad-card-top"><span class="ad-code">' + esc(k.code) + '</span><span class="ad-tagline">' + esc(k.label) + '</span></div>' +
        '<div class="ad-who">Übrig: ' + esc(k.rest) + '</div>' +
        '<div class="ad-meta">' + esc(k.rolle) + ' · ' + esc(stat(k.status)) + ' · gültig bis ' + esc(fd(k.expires)) + ' · gekauft ' + esc(fd(k.created)) + '</div>' +
        (k.einloesungen ? '<div class="ad-meta">' + n(k.einloesungen, 'Einlösung', 'Einlösungen') + '</div>' : '') + '</div>';
    }).join('') + '</div>' : '';

    var kurseHtml = p.kurse.length ? '<div class="ad-list">' + p.kurse.map(function (k) {
      var tn = (k.termine || []).map(function (x) { return fd(x.datum || x); }).filter(Boolean);
      return '<div class="ad-card"><div class="ad-card-top"><span class="ad-who">' + esc(k.kurs || 'Kurs') + '</span><span class="ad-tagline">' + esc(k.art) + '</span></div>' +
        '<div class="ad-meta">Preis ' + esc(k.preis) + ' · bezahlt ' + esc(k.bezahlt) + (k.pay_status === 'unpaid' ? ' · Lastschrift läuft' : '') + ' · ' + esc(stat(k.status)) + '</div>' +
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
    }).join('') + '</div>' : '';

    var mailAnsicht = '';
    if (S.mail) {
      var m = S.mail;
      mailAnsicht = '<div class="ad-card" id="kdMail" style="margin-top:14px"><div class="ad-card-top"><span class="ad-tagline">' + esc(m.art || 'Mail') + '</span>' +
        '<button type="button" class="ad-undo" id="kdMailZu">Schließen</button></div>' +
        '<div class="ad-who">' + esc(m.subject) + '</div>' +
        '<div class="ad-meta">An ' + esc(m.to) + ' · ' + esc(ts(m.ts)) + '</div>' +
        (m.from ? '<div class="ad-meta">Von ' + esc(m.from) + '</div>' : '') +
        ((m.anhaenge || []).length ? '<div class="ad-meta">Anhang: ' + esc(m.anhaenge.join(', ')) + '</div>' : '') +
        '<iframe class="kd-frame" id="kdFrame" sandbox="" title="Mail"></iframe></div>';
    }

    box.innerHTML =
      '<button type="button" class="ad-refresh" id="kdZurueck">← Alle Kunden</button>' +
      '<div class="ad-card" style="margin-top:14px">' +
      '<div class="ad-who" style="font-size:20px">' + esc(p.name || p.email) + '</div>' +
      '<div class="ad-actions" style="margin-top:10px">' +
      '<a class="ad-mini" href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' +
      (p.phone ? '<a class="ad-mini" href="tel:' + esc(String(p.phone).replace(/[^+\d]/g, '')) + '">' + esc(p.phone) + '</a>' : '') + '</div>' +
      '<div class="ad-meta" style="margin-top:12px">' + [n(p.termine.length, 'Termin', 'Termine'), n(p.karten.length, 'Karte/Gutschein', 'Karten/Gutscheine'), n(p.kurse.length, 'Kurs', 'Kurse'), n(p.mails.length, 'Mail', 'Mails')].join(' · ') + '</div>' +
      '<div class="ad-meta">Wiedervorlage: ' + (p.wv.abgemeldet ? 'abgemeldet' : p.wv.einwilligung ? 'Einwilligung eingetragen' : 'keine Besonderheit') + '</div></div>' +
      abschnitt('Termine', p.termine.length, termineHtml, 'Keine Termine gespeichert.') +
      abschnitt('Karten und Gutscheine', p.karten.length, kartenHtml, 'Keine Karten oder Gutscheine.') +
      abschnitt('Kurse', p.kurse.length, kurseHtml, 'Keine Kursbestellungen.') +
      (p.widerrufe.length ? abschnitt('Widerrufe', p.widerrufe.length, widerrufHtml, '') : '') +
      abschnitt('Mail-Verlauf', p.mails.length, mailsHtml + mailAnsicht,
        p.mails_ab ? 'Keine Mails gespeichert (Protokoll seit ' + fd(p.mails_ab) + ').' : 'Noch keine Mails gespeichert.') +
      '<p class="ad-hint" style="margin-top:14px">Abgesagte Termine werden aus dem Buchungssystem gelöscht – sie erscheinen hier nur über die Absage-Mail im Mail-Verlauf. ' +
      (p.mails_ab ? 'Der Mail-Verlauf beginnt am ' + esc(fd(p.mails_ab)) + '; ältere Mails lassen sich in der Kundenliste nachladen. ' : '') +
      'Mails werden 3 Jahre gespeichert.</p>';

    document.getElementById('kdZurueck').onclick = function () { S.profil = null; S.mail = null; if (!S.liste) laden(); else render(); window.scrollTo(0, 0); };
    Array.prototype.forEach.call(box.querySelectorAll('.kd-mailrow'), function (b) {
      b.onclick = function () { mailLaden(b.getAttribute('data-key')); };
    });
    if (S.mail) {
      document.getElementById('kdMailZu').onclick = function () { S.mail = null; render(); };
      var fr = document.getElementById('kdFrame');
      fr.srcdoc = S.mail.html || '<p style="font-family:sans-serif">Kein Inhalt gespeichert.</p>';
    }
  }
})();
