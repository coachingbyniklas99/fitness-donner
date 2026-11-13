/* Verwaltung: Termin verschieben und von Hand eintragen (Dialog). Nutzt window.FD_ADMIN aus admin.html.
   Gerechnet und gespeichert wird im Worker (/api/admin/termin/…); hier ist nur die Oberfläche. */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var info = null, overlay = null;

  function esc(x) { return A.esc(x); }
  function fd(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function heute() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function mins(a) { var p = String(a).split(':'); return Number(p[0]) * 60 + Number(p[1]); }

  function laden() {
    if (info) return Promise.resolve(info);
    return A.api('termin/info').then(function (d) { info = d; return d; });
  }

  function schliessen() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.body.classList.remove('tm-offen');
  }

  function oeffnen(titel, inhalt) {
    schliessen();
    overlay = document.createElement('div');
    overlay.className = 'tm-overlay';
    overlay.innerHTML = '<div class="tm-box" role="dialog" aria-modal="true"><div class="tm-head"><h2>' + esc(titel) + '</h2>' +
      '<button type="button" class="ad-undo" id="tmZu">Schließen</button></div>' + inhalt + '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('tm-offen');
    overlay.querySelector('#tmZu').onclick = schliessen;
    overlay.addEventListener('click', function (e) { if (e.target === overlay) schliessen(); });
    return overlay;
  }

  function dauerOptionen(sel) {
    var l = [30, 45, 60, 75, 90, 120], h = '';
    if (l.indexOf(sel) === -1) l.push(sel);
    l.sort(function (a, b) { return a - b; });
    l.forEach(function (m) { h += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + m + ' Minuten</option>'; });
    return h;
  }
  function ortOptionen(orte, sel) {
    return orte.map(function (o) { return '<option value="' + esc(o.city) + '"' + (o.city === sel ? ' selected' : '') + '>' + esc(o.city) + ' · ' + esc(o.place) + '</option>'; }).join('');
  }

  /* Gemeinsamer Ablauf: speichern, bei Überschneidung nachfragen */
  function absenden(pfad, daten, knopf, meldung, fertig) {
    var msg = overlay.querySelector('#tmMsg');
    msg.textContent = ''; msg.className = 'tm-msg';
    knopf.disabled = true;
    A.api(pfad, { body: daten }).then(function (r) {
      schliessen();
      A.note(meldung(r));
      if (fertig) fertig(r);
    }).catch(function (e) {
      knopf.disabled = false;
      if (e && e.message === 'abgemeldet') return;
      msg.className = 'tm-msg bad';
      msg.textContent = (e && e.message) || 'Das hat nicht geklappt.';
      if (e && /belegt|gesperrt/.test(e.message || '')) {
        var b = document.getElementById('tmForce');
        if (b) b.hidden = false;
      }
    });
  }

  function kalenderText(r) { return r.kalender === true ? ' Der Google-Kalender ist aktualisiert.' : r.kalender === false ? ' Achtung: Der Google-Kalender konnte nicht aktualisiert werden.' : ''; }

  /* ---------- Verschieben ---------- */
  function verschieben(b, fertig) {
    laden().then(function (d) {
      var dauer = (b.end && b.start) ? mins(b.end) - mins(b.start) : 60;
      var o = oeffnen('Termin verschieben',
        '<div class="ad-meta">Bisher: <b>' + esc(fd(b.date)) + ', ' + esc(b.start) + '–' + esc(b.end || '') + ' Uhr</b> · ' + esc(b.name || '') + '</div>' +
        '<form id="tmForm" class="tm-form">' +
        '<div class="ad-field"><label for="tmDate">Neuer Tag</label><input type="date" id="tmDate" min="' + heute() + '" value="' + esc(b.date) + '" required></div>' +
        '<div class="ad-field"><label for="tmStart">Beginn</label><input type="time" id="tmStart" step="300" value="' + esc(b.start) + '" required></div>' +
        '<div class="ad-field"><label for="tmMin">Dauer</label><select id="tmMin">' + dauerOptionen(dauer) + '</select></div>' +
        '<div class="ad-field"><label for="tmOrt">Ort</label><select id="tmOrt">' + ortOptionen(d.orte, b.city) + '</select></div>' +
        '<label class="tm-check"><input type="checkbox" id="tmMail" checked> Kunden per Mail informieren (mit neuer Kalenderdatei)</label>' +
        '<div class="tm-msg" id="tmMsg"></div>' +
        '<div class="tm-actions"><button type="submit" class="btn btn-blitz" id="tmGo">Verschieben</button>' +
        '<button type="button" class="ad-danger" id="tmForce" hidden>Trotzdem verschieben</button></div>' +
        '<p class="ad-hint">' + (d.kalender ? 'Der alte Eintrag verschwindet aus dem Google-Kalender, der neue wird angelegt.' : 'Der Google-Kalender ist nicht verbunden.') + ' Eine Karteneinheit bleibt dabei erhalten.</p>' +
        '</form>');
      function los(force) {
        absenden('termin/verschieben', {
          date: b.date, slotId: b.slot_id, neuDate: o.querySelector('#tmDate').value, start: o.querySelector('#tmStart').value,
          minutes: Number(o.querySelector('#tmMin').value), ort: o.querySelector('#tmOrt').value,
          mail: o.querySelector('#tmMail').checked, force: force === true
        }, force === true ? o.querySelector('#tmForce') : o.querySelector('#tmGo'), function (r) {
          return 'Verschoben auf ' + fd(r.date) + ', ' + r.start + ' Uhr.' + kalenderText(r) + (r.mail ? ' Der Kunde hat eine Mail bekommen.' : '');
        }, fertig);
      }
      o.querySelector('#tmForm').onsubmit = function (e) { e.preventDefault(); los(false); };
      o.querySelector('#tmForce').onclick = function () { los(true); };
    }).catch(function (e) { if (e && e.message !== 'abgemeldet') A.note(e.message || 'Das hat nicht geklappt.', true); });
  }

  /* ---------- Von Hand eintragen: ein Termin oder mehrere auf einmal – der Kunde bekommt EINE Mail ---------- */
  var HINWEIS_STANDARD = 'Für deine Rechnung fehlen mir noch ein paar Angaben (z. B. Rechnungsanschrift sowie Name bzw. Firma). Bitte schick sie mir kurz nach – einfach auf diese Mail antworten.';
  function plusTage(iso, n) {
    var p = String(iso).split('-'), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function eintragen(vor, fertig) {
    vor = vor || {};
    laden().then(function (d) {
      var karten = d.cards.slice();
      var mitKarte = vor.code ? true : karten.length > 0 && vor.art !== 'bar';
      var kopt = '<option value="">Karte wählen …</option>' + karten.map(function (c) {
        return '<option value="' + esc(c.code) + '"' + (c.code === vor.code ? ' selected' : '') + '>' + esc((c.name || c.email || '–') + ' · ' + c.label + ' · ' + c.left + ' von ' + c.total + ' frei · ' + c.code) + '</option>';
      }).join('');
      var rows = [{ date: '', start: '12:00', minutes: 60, ort: 'Solingen' }];
      var hinweisAngefasst = false;
      var o = oeffnen('Termine eintragen',
        '<form id="tmForm" class="tm-form">' +
        '<div class="ad-field"><label for="tmArt">Bezahlung</label><select id="tmArt">' +
        '<option value="karte"' + (mitKarte ? ' selected' : '') + '>Mit Karte (pro Termin eine Einheit)</option>' +
        '<option value="bar"' + (mitKarte ? '' : ' selected') + '>Ohne Karte (bar oder privat bezahlt)</option></select></div>' +
        '<div class="ad-field" id="tmKarteF"><label for="tmKarte">Karte</label><select id="tmKarte">' + kopt + '</select></div>' +
        '<div class="ad-field"><label for="tmName">Name</label><input type="text" id="tmName" autocomplete="off" value="' + esc(vor.name || '') + '"></div>' +
        '<div class="ad-field"><label for="tmEmail">E-Mail</label><input type="email" id="tmEmail" autocomplete="off" value="' + esc(vor.email || '') + '"></div>' +
        '<div class="ad-field"><label for="tmPhone">Telefon (optional)</label><input type="tel" id="tmPhone" autocomplete="off" value="' + esc(vor.phone || '') + '"></div>' +
        '<div class="tm-sec"><div class="tm-lab">Termine <span id="tmZahl"></span></div><div class="tm-rows" id="tmRows"></div>' +
        '<button type="button" class="ad-mini" id="tmAdd">+ Weiteren Termin</button><div class="tm-sum" id="tmSum"></div></div>' +
        '<label class="tm-check"><input type="checkbox" id="tmMail" checked> <span>Kunden <b>eine</b> Mail mit allen Terminen schicken (mit Kalenderdateien)</span></label>' +
        '<div id="tmMailBox">' +
        '<div class="tm-pending" id="tmPend" hidden><label class="tm-check"><input type="checkbox" id="tmPendOn" checked> <span id="tmPendT"></span></label>' +
        '<button type="button" class="ad-mini" id="tmPendNow">Nur diese Termine jetzt per Mail senden</button></div>' +
        '<div class="ad-field"><label for="tmHint">Hinweis in der Mail <span class="ad-meta" style="margin:0">optional</span></label>' +
        '<textarea id="tmHint" rows="3" placeholder="z. B. Rechnungsangaben bitte nachreichen"></textarea></div>' +
        '</div>' +
        '<div class="tm-msg" id="tmMsg"></div>' +
        '<div class="tm-actions"><button type="submit" class="btn btn-blitz" id="tmGo">Eintragen</button>' +
        '<button type="button" class="ad-danger" id="tmForce" hidden>Trotzdem eintragen</button></div>' +
        '<p class="ad-hint">Die Termine kommen in den Google-Kalender und sind online nicht mehr buchbar. Ohne Haken bei &bdquo;Mail&ldquo; warten sie, bis du das n&auml;chste Mal eine Mail an den Kunden schickst &ndash; dann gehen alle zusammen raus.</p>' +
        '</form>');
      var art = o.querySelector('#tmArt'), kf = o.querySelector('#tmKarteF'), ks = o.querySelector('#tmKarte');
      var mailEl = o.querySelector('#tmMail'), hintEl = o.querySelector('#tmHint');

      function karte() { return art.value === 'karte' ? karten.filter(function (x) { return x.code === ks.value; })[0] : null; }

      function summe() {
        var c = karte(), s = o.querySelector('#tmSum'), n = rows.length;
        o.querySelector('#tmZahl').textContent = '(' + n + ')';
        if (c) {
          var bad = n > c.left;
          s.className = 'tm-sum' + (bad ? ' bad' : '');
          s.textContent = n + (n === 1 ? ' Einheit wird' : ' Einheiten werden') + ' abgezogen – auf der Karte sind ' + c.left + ' von ' + c.total + ' frei' + (bad ? ' (zu wenig!)' : '') + '.';
        } else { s.className = 'tm-sum'; s.textContent = ''; }
        o.querySelector('#tmGo').textContent = n === 1 ? 'Termin eintragen' : n + ' Termine eintragen';
      }

      function rowsRender() {
        var box = o.querySelector('#tmRows');
        box.innerHTML = rows.map(function (r, i) {
          return '<div class="tm-row" data-i="' + i + '"><span class="tm-nr">' + (i + 1) + '</span>' +
            '<input type="date" class="r-date" min="' + heute() + '" value="' + esc(r.date) + '" aria-label="Tag ' + (i + 1) + '">' +
            '<input type="time" class="r-start" step="300" value="' + esc(r.start) + '" aria-label="Beginn ' + (i + 1) + '">' +
            '<select class="r-min" aria-label="Dauer ' + (i + 1) + '">' + dauerOptionen(r.minutes) + '</select>' +
            '<select class="r-ort" aria-label="Ort ' + (i + 1) + '">' + ortOptionen(d.orte, r.ort) + '</select>' +
            (rows.length > 1 ? '<button type="button" class="tm-del" data-del="' + i + '" aria-label="Termin ' + (i + 1) + ' entfernen">&times;</button>' : '<span></span>') + '</div>';
        }).join('');
        Array.prototype.forEach.call(box.querySelectorAll('.tm-row'), function (el) {
          var i = Number(el.getAttribute('data-i'));
          el.querySelector('.r-date').oninput = function () { rows[i].date = this.value; };
          el.querySelector('.r-start').oninput = function () { rows[i].start = this.value; };
          el.querySelector('.r-min').onchange = function () { rows[i].minutes = Number(this.value); };
          el.querySelector('.r-ort').onchange = function () { rows[i].ort = this.value; };
          var del = el.querySelector('.tm-del');
          if (del) del.onclick = function () { rows.splice(i, 1); rowsRender(); };
        });
        summe();
      }

      /* Karte/Zahlstatus bestimmt: wartende Mails, Hinweistext */
      function kartenInfo() {
        var c = karte(), pend = o.querySelector('#tmPend');
        if (c && c.mail_offen > 0) {
          pend.hidden = false;
          o.querySelector('#tmPendT').textContent = c.mail_offen + (c.mail_offen === 1 ? ' bisher nicht gemailten Termin' : ' bisher nicht gemailte Termine') + ' dieser Karte in dieselbe Mail aufnehmen';
        } else pend.hidden = true;
        if (!hinweisAngefasst) hintEl.value = c && c.zahlstatus === 'offen' ? HINWEIS_STANDARD : '';
        summe();
      }
      function artWechsel() { kf.hidden = art.value !== 'karte'; kartenInfo(); }
      art.onchange = artWechsel;
      ks.onchange = function () {
        var c = karte();
        if (c) {
          if (!o.querySelector('#tmName').value) o.querySelector('#tmName').value = c.name || '';
          if (!o.querySelector('#tmEmail').value) o.querySelector('#tmEmail').value = c.email || '';
        }
        kartenInfo();
      };
      hintEl.oninput = function () { hinweisAngefasst = true; };
      mailEl.onchange = function () { o.querySelector('#tmMailBox').hidden = !mailEl.checked; };
      o.querySelector('#tmAdd').onclick = function () {
        var l = rows[rows.length - 1];
        rows.push({ date: l.date ? plusTage(l.date, 7) : '', start: l.start, minutes: l.minutes, ort: l.ort });
        rowsRender();
      };

      function meldung(text, schlecht) { var m = o.querySelector('#tmMsg'); m.className = 'tm-msg' + (schlecht ? ' bad' : ''); m.textContent = text; }

      o.querySelector('#tmPendNow').onclick = function () {
        var b = this, mail = String(o.querySelector('#tmEmail').value || (karte() || {}).email || '').trim();
        if (!mail) { meldung('Bitte eine E-Mail-Adresse angeben.', true); return; }
        b.disabled = true;
        A.api('termin/mail-senden', { body: { email: mail, hinweis: hintEl.value } }).then(function (r) {
          info = null; schliessen(); A.note('Eine Mail mit ' + r.count + (r.count === 1 ? ' Termin' : ' Terminen') + ' ist raus.');
          if (fertig) fertig(r);
        }).catch(function (e) { b.disabled = false; if (e && e.message === 'abgemeldet') return; meldung((e && e.message) || 'Das hat nicht geklappt.', true); });
      };

      function los(force) {
        var mk = art.value === 'karte';
        if (mk && !ks.value) { meldung('Bitte eine Karte wählen oder „Ohne Karte“ einstellen.', true); return; }
        for (var i = 0; i < rows.length; i++) {
          if (!rows[i].date || !rows[i].start) { meldung('Bitte bei Termin ' + (i + 1) + ' Tag und Uhrzeit angeben.', true); return; }
        }
        var c = karte();
        if (c && rows.length > c.left) { meldung('Auf der Karte ' + (c.left === 1 ? 'ist nur noch 1 Einheit' : 'sind nur noch ' + c.left + ' Einheiten') + ' frei.', true); return; }
        var mail = mailEl.checked, pendEl = o.querySelector('#tmPend');
        absenden('termin/eintragen-mehrere', {
          art: mk ? 'karte' : 'bar', code: mk ? ks.value : '', name: o.querySelector('#tmName').value, email: o.querySelector('#tmEmail').value,
          phone: o.querySelector('#tmPhone').value,
          termine: rows.map(function (r) { return { date: r.date, start: r.start, minutes: Number(r.minutes), ort: r.ort }; }),
          mail: mail, hinweis: mail ? hintEl.value : '', mitOffenen: pendEl.hidden ? true : o.querySelector('#tmPendOn').checked, force: force === true
        }, force === true ? o.querySelector('#tmForce') : o.querySelector('#tmGo'), function (r) {
          info = null;   // Karten-Stand hat sich geändert
          return (r.count === 1 ? 'Eingetragen: ' : r.count + ' Termine eingetragen: ') + r.termine.map(function (x) { return fd(x.date) + ' ' + x.start; }).join(', ') + '.' +
            (r.karte ? ' Auf der Karte sind noch ' + r.karte.left + ' von ' + r.karte.total + ' frei.' : '') + kalenderText(r) +
            (r.mail ? ' Der Kunde hat EINE Mail mit ' + (r.mail_anzahl > 1 ? 'allen ' + r.mail_anzahl + ' Terminen' : 'dem Termin') + ' bekommen.'
              : mail ? ' Achtung: Die Mail ging nicht raus – sie steht aus (Termine unter „Termin eintragen“ später mailen).' : ' Keine Mail verschickt – die Termine warten auf die nächste Mail.');
        }, fertig);
      }
      o.querySelector('#tmForm').onsubmit = function (e) { e.preventDefault(); los(false); };
      o.querySelector('#tmForce').onclick = function () { los(true); };
      rowsRender();
      artWechsel();
    }).catch(function (e) { if (e && e.message !== 'abgemeldet') A.note(e.message || 'Das hat nicht geklappt.', true); });
  }

  window.FDTermine = { verschieben: verschieben, eintragen: eintragen };
})();
