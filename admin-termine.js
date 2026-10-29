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

  /* ---------- Von Hand eintragen ---------- */
  function eintragen(vor, fertig) {
    vor = vor || {};
    laden().then(function (d) {
      var karten = d.cards.slice();
      var mitKarte = vor.code ? true : karten.length > 0 && vor.art !== 'bar';
      var kopt = '<option value="">Karte wählen …</option>' + karten.map(function (c) {
        return '<option value="' + esc(c.code) + '"' + (c.code === vor.code ? ' selected' : '') + '>' + esc((c.name || c.email || '–') + ' · ' + c.label + ' · ' + c.left + ' von ' + c.total + ' frei · ' + c.code) + '</option>';
      }).join('');
      var o = oeffnen('Termin eintragen',
        '<form id="tmForm" class="tm-form">' +
        '<div class="ad-field"><label for="tmArt">Bezahlung</label><select id="tmArt">' +
        '<option value="karte"' + (mitKarte ? ' selected' : '') + '>Mit Karte (eine Einheit wird abgezogen)</option>' +
        '<option value="bar"' + (mitKarte ? '' : ' selected') + '>Ohne Karte (bar oder privat bezahlt)</option></select></div>' +
        '<div class="ad-field" id="tmKarteF"><label for="tmKarte">Karte</label><select id="tmKarte">' + kopt + '</select></div>' +
        '<div class="ad-field"><label for="tmName">Name</label><input type="text" id="tmName" autocomplete="off" value="' + esc(vor.name || '') + '"></div>' +
        '<div class="ad-field"><label for="tmEmail">E-Mail</label><input type="email" id="tmEmail" autocomplete="off" value="' + esc(vor.email || '') + '"></div>' +
        '<div class="ad-field"><label for="tmPhone">Telefon (optional)</label><input type="tel" id="tmPhone" autocomplete="off" value="' + esc(vor.phone || '') + '"></div>' +
        '<div class="ad-field"><label for="tmDate">Tag</label><input type="date" id="tmDate" min="' + heute() + '" required></div>' +
        '<div class="ad-field"><label for="tmStart">Beginn</label><input type="time" id="tmStart" step="300" required></div>' +
        '<div class="ad-field"><label for="tmMin">Dauer</label><select id="tmMin">' + dauerOptionen(60) + '</select></div>' +
        '<div class="ad-field"><label for="tmOrt">Ort</label><select id="tmOrt">' + ortOptionen(d.orte, 'Solingen') + '</select></div>' +
        '<label class="tm-check"><input type="checkbox" id="tmMail" checked> Kunden per Mail bestätigen (mit Kalenderdatei)</label>' +
        '<div class="tm-msg" id="tmMsg"></div>' +
        '<div class="tm-actions"><button type="submit" class="btn btn-blitz" id="tmGo">Eintragen</button>' +
        '<button type="button" class="ad-danger" id="tmForce" hidden>Trotzdem eintragen</button></div>' +
        '<p class="ad-hint">Der Termin kommt in den Google-Kalender und ist online nicht mehr buchbar.</p>' +
        '</form>');
      var art = o.querySelector('#tmArt'), kf = o.querySelector('#tmKarteF'), ks = o.querySelector('#tmKarte');
      function artWechsel() { kf.hidden = art.value !== 'karte'; }
      art.onchange = artWechsel; artWechsel();
      ks.onchange = function () {
        var c = karten.filter(function (x) { return x.code === ks.value; })[0];
        if (!c) return;
        if (!o.querySelector('#tmName').value) o.querySelector('#tmName').value = c.name || '';
        if (!o.querySelector('#tmEmail').value) o.querySelector('#tmEmail').value = c.email || '';
      };
      function los(force) {
        var mk = art.value === 'karte';
        if (mk && !ks.value) { var m = o.querySelector('#tmMsg'); m.className = 'tm-msg bad'; m.textContent = 'Bitte eine Karte wählen oder „Ohne Karte“ einstellen.'; return; }
        absenden('termin/eintragen', {
          art: mk ? 'karte' : 'bar', code: mk ? ks.value : '', name: o.querySelector('#tmName').value, email: o.querySelector('#tmEmail').value,
          phone: o.querySelector('#tmPhone').value, date: o.querySelector('#tmDate').value, start: o.querySelector('#tmStart').value,
          minutes: Number(o.querySelector('#tmMin').value), ort: o.querySelector('#tmOrt').value, mail: o.querySelector('#tmMail').checked, force: force === true
        }, force === true ? o.querySelector('#tmForce') : o.querySelector('#tmGo'), function (r) {
          info = null;   // Karten-Stand hat sich geändert
          return 'Eingetragen: ' + fd(r.date) + ', ' + r.start + ' Uhr.' + (r.karte ? ' Auf der Karte sind noch ' + r.karte.left + ' von ' + r.karte.total + ' frei.' : '') + kalenderText(r) + (r.mail ? ' Der Kunde hat eine Bestätigung bekommen.' : '');
        }, fertig);
      }
      o.querySelector('#tmForm').onsubmit = function (e) { e.preventDefault(); los(false); };
      o.querySelector('#tmForce').onclick = function () { los(true); };
    }).catch(function (e) { if (e && e.message !== 'abgemeldet') A.note(e.message || 'Das hat nicht geklappt.', true); });
  }

  window.FDTermine = { verschieben: verschieben, eintragen: eintragen };
})();
