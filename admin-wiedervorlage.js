/* Verwaltung – Reiter „Wiedervorlage“. Nutzt Anmeldung und API-Helfer aus admin.html (window.FD_ADMIN).
   Alles hier ist nur die Oberfläche; Regeln, Prüfungen und Versand liegen im Worker. */
(function () {
  var A = window.FD_ADMIN;
  if (!A) return;
  var box = document.getElementById('wvApp');
  var S = { data: null, lauf: null };

  function esc(x) { return A.esc(x); }
  function q(sel) { return box.querySelector(sel); }
  function qa(sel) { return box.querySelectorAll(sel); }
  function fd(iso) { var p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function ts(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function armed(b, text) {
    if (b.getAttribute('data-armed') === '1') return true;
    var alt = b.textContent;
    b.setAttribute('data-armed', '1'); b.textContent = text;
    setTimeout(function () { b.removeAttribute('data-armed'); b.textContent = alt; }, 4000);
    return false;
  }
  function fail(e) { if (e && e.message !== 'abgemeldet') A.note(e.message || 'Das hat nicht geklappt.', true); }

  function laden() {
    return A.api('wv/state').then(function (d) { S.data = d; render(); }).catch(fail);
  }
  window.FDWiedervorlage = { open: function () { if (!S.data) laden(); else render(); } };

  function render() {
    var d = S.data, s = d.settings, t = d.technik;
    var modusText = { aus: 'Aus – es passiert nichts.', trocken: 'Trockenlauf – täglich nur auflisten, nichts senden.', live: 'Live – echter Versand.' }[s.modus];
    var warn = [];
    if (!t.stripe) warn.push('STRIPE_SECRET_KEY fehlt.');
    if (!t.resend) warn.push('RESEND_API_KEY fehlt.');
    if (!t.secret) warn.push('WV_SECRET (oder ADMIN_PASSWORT) fehlt – ohne gültige Abmeldelinks wird nichts gesendet.');
    if (s.modus === 'live' && !s.hinweisAb) warn.push('„Werbehinweis live seit“ ist leer – dann bekommen nur Kunden mit eingetragener Einwilligung eine Mail.');

    box.innerHTML =
      '<p class="ad-hint">Nach <b>' + s.wochen + ' Wochen</b> ohne neuen Einzeltermin bekommen Kunden eine persönliche Mail mit einem einmaligen Aktionscode (' + A.eur(s.rabattCents) + ', ' + s.gueltigWochen + ' Wochen gültig, verschenkbar). Kurse zählen nicht. Stripe läuft im <b>' + (t.stripeTestmodus ? 'Testmodus' : 'Livemodus') + '</b>.</p>' +
      '<div class="ad-resv-hint"' + (warn.length ? '' : ' hidden') + '>' + warn.map(esc).join('<br>') + '</div>' +

      '<div class="ad-card"><div class="ad-tagline">Status</div>' +
      '<div class="ad-who">' + esc(modusText) + '</div>' +
      (d.last ? '<div class="ad-meta">Letzter Lauf: ' + esc(ts(d.last.at)) + ' · ' + (d.last.modus === 'live' ? 'live' : 'Trockenlauf') +
        ' · ' + (d.last.kandidaten ? d.last.kandidaten.length : 0) + ' Kandidaten · ' + (d.last.gesendet || []).length + ' gesendet' +
        ((d.last.fehler || []).length ? ' · <span class="ak-warn">' + d.last.fehler.length + ' Fehler</span>' : '') + '</div>' : '<div class="ad-meta">Noch kein Lauf.</div>') +
      '<div class="ad-actions"><button type="button" class="ad-mini" id="wvDry">Trockenlauf jetzt</button></div></div>' +
      '<div id="wvLauf"></div>' +

      '<h2 style="margin-top:30px">Einstellungen</h2>' +
      '<form id="wvForm">' +
      field('wvModus', 'Modus', '<select id="wvModus"><option value="aus">Aus</option><option value="trocken">Trockenlauf (nur auflisten)</option><option value="live">Live (echter Versand)</option></select>') +
      field('wvWochen', 'Wochen nach dem letzten Einzeltermin (8–12)', '<div class="ad-eur"><input type="number" id="wvWochen" min="8" max="12" step="1"><span>Wochen</span></div>') +
      field('wvRabatt', 'Wert des Aktionscodes', '<div class="ad-eur"><input type="number" id="wvRabatt" min="5" max="200" step="1"><span>&euro;</span></div>') +
      field('wvGueltig', 'Gültigkeit des Codes', '<div class="ad-eur"><input type="number" id="wvGueltig" min="1" max="26" step="1"><span>Wochen</span></div>') +
      field('wvMax', 'Höchstens so viele Mails pro Tag', '<div class="ad-eur"><input type="number" id="wvMax" min="1" max="100" step="1"><span>Mails</span></div>') +
      field('wvHinweis', 'Werbehinweis auf der Buchungsseite live seit', '<input type="date" id="wvHinweis">', 'Nur Termine, die ab diesem Tag gebucht wurden, bekommen die Mail. Erst eintragen, wenn die neue Buchungsseite und die Datenschutzerklärung online sind.') +
      field('wvWunschAb', 'Hinweis zur Verwendung der Ziele im Formular live seit', '<input type="date" id="wvWunschAb">', 'Erst ab diesem Tag gebuchte Freitexte dürfen zitiert werden.') +
      '<div class="ad-field"><label><input type="checkbox" id="wvWunschAn" style="width:auto;margin-right:8px">Freitext („Worum geht es dir?“) in der Mail aufgreifen</label><div class="ad-sub">Texte mit Gesundheitsbezug, Links oder über ' + s.wunschMax + ' Zeichen werden nie zitiert.</div></div>' +
      field('wvBetreff', 'Betreff', '<input type="text" id="wvBetreff">', 'Platzhalter: {Vorname}') +
      field('wvVorlageW', 'Text mit Wunsch', '<textarea id="wvVorlageW" rows="5"></textarea>', 'Platzhalter: {Vorname}, {Wunsch}. Der Rest der Mail (Code, Gültigkeit, Verschenk-Hinweis, Button, Abmeldelink) ist fest.') +
      field('wvVorlageN', 'Text ohne Wunsch (neutral)', '<textarea id="wvVorlageN" rows="4"></textarea>') +
      '<h2 style="margin-top:30px">Variante B: KI-Entwurf (ausgeschaltet)</h2>' +
      '<p class="ad-hint">Ein von der KI formulierter Absatz landet als Entwurf bei dir und geht erst nach deiner Freigabe raus. An den KI-Dienst gehen nur Vorname, Zahl der Termine und Wochen seit dem letzten Termin – <b>nie</b> das Freitextfeld. Zum Einschalten braucht der Worker zusätzlich das Secret ANTHROPIC_API_KEY (' + (t.ki ? 'gesetzt' : 'nicht gesetzt') + ').</p>' +
      field('wvVariante', 'Variante', '<select id="wvVariante"><option value="A">A – Vorlage (aktiv)</option><option value="B">B – KI-Entwurf zur Freigabe</option></select>') +
      '<div class="ad-field"><label><input type="checkbox" id="wvKi" style="width:auto;margin-right:8px"' + (t.ki ? '' : ' disabled') + '>KI-Entwurf einschalten</label></div>' +
      '<button type="submit" class="btn btn-blitz">Speichern</button></form>' +

      '<h2 style="margin-top:30px">Testmail an mich</h2>' +
      '<p class="ad-hint">Schickt die fertige Mail an ' + esc('deine Inhaber-Adresse') + ', mit Platzhalter-Code. Mit dem Haken wird in Stripe ein echter Code angelegt – im Testmodus harmlos, im Livemodus ein echter, einmal einlösbarer Code.</p>' +
      '<div class="ad-card"><div class="ad-field"><label for="wvTV">Vorname</label><input type="text" id="wvTV" value="Niklas"></div>' +
      '<div class="ad-field"><label for="wvTW">Wunsch (leer = neutrale Fassung)</label><input type="text" id="wvTW" placeholder="z. B. Ich möchte stärker werden"></div>' +
      '<div class="ad-field"><label><input type="checkbox" id="wvTS" style="width:auto;margin-right:8px">Echten Code in Stripe anlegen</label></div>' +
      '<button type="button" class="btn btn-blitz" id="wvTest">Testmail senden</button></div>' +

      '<h2 style="margin-top:30px">Einwilligung eintragen (Altkunden)</h2>' +
      '<p class="ad-hint">Für Kunden, die vor dem Werbehinweis gebucht haben und dir ausdrücklich zugestimmt haben (z. B. mündlich). Trag Datum und Umstand mit ein – im Streitfall musst du die Einwilligung nachweisen können.</p>' +
      '<div class="ad-card"><div class="ad-field"><label for="wvCE">E-Mail-Adresse</label><input type="email" id="wvCE"></div>' +
      '<div class="ad-field"><label for="wvCN">Notiz</label><input type="text" id="wvCN" placeholder="z. B. mündlich zugestimmt am 24.10. beim Training"></div>' +
      '<button type="button" class="ad-mini" id="wvCAdd">Einwilligung speichern</button></div>' +
      '<div class="ad-list" style="margin-top:12px">' + (d.consents.length ? d.consents.map(function (c) {
        return '<div class="ad-card-sm"><div><div class="ad-who">' + esc(c.email) + '</div><div class="ad-meta">' + esc(ts(c.at)) + ' · ' + esc(c.notiz || '') + '</div></div>' +
          '<button type="button" class="ad-mini" data-cdel="' + esc(c.email) + '">Entfernen</button></div>';
      }).join('') : '<div class="ad-empty">Keine eingetragen.</div>') + '</div>' +

      '<h2 style="margin-top:30px">Abmeldungen</h2>' +
      '<p class="ad-hint">Wer sich abmeldet, bekommt nie wieder eine Wiedervorlage. Antwortet jemand per Mail mit „Abmelden“, trag ihn hier von Hand ein.</p>' +
      '<div class="ad-card"><div class="ad-field"><label for="wvOE">E-Mail-Adresse</label><input type="email" id="wvOE"></div>' +
      '<button type="button" class="ad-mini" id="wvOAdd">Abmelden</button></div>' +
      '<div class="ad-list" style="margin-top:12px">' + (d.optouts.length ? d.optouts.map(function (o) {
        return '<div class="ad-card-sm"><div><div class="ad-who">' + esc(o.email) + '</div><div class="ad-meta">' + esc(ts(o.at)) + ' · ' + esc(o.quelle || '') + '</div></div>' +
          '<button type="button" class="ad-mini" data-odel="' + esc(o.email) + '">Wieder zulassen</button></div>';
      }).join('') : '<div class="ad-empty">Niemand abgemeldet.</div>') + '</div>' +

      (d.entwuerfe.length ? '<h2 style="margin-top:30px">Entwürfe zur Freigabe</h2><div class="ad-list">' + d.entwuerfe.map(function (e) {
        return '<div class="ad-card"><div class="ad-who">' + esc(e.name) + ' · ' + esc(e.email) + '</div><div class="ad-meta">Letzter Termin ' + esc(fd(e.letzterTermin)) + ' · ' + (e.quelle === 'ki' ? 'KI-Entwurf' : 'Vorlage') + '</div>' +
          '<div class="ad-field" style="margin-top:12px"><textarea rows="5" data-etext="' + esc(e.bookingId) + '">' + esc(e.text) + '</textarea></div>' +
          '<div class="ad-actions"><button type="button" class="ad-mini" data-efrei="' + esc(e.bookingId) + '">Freigeben und senden</button>' +
          '<button type="button" class="ad-mini" data-everw="' + esc(e.bookingId) + '">Verwerfen</button></div></div>';
      }).join('') + '</div>' : '');

    fill(s);
    bind();
    if (S.lauf) zeigeLauf(S.lauf);
  }

  function field(id, label, input, hint) {
    return '<div class="ad-field"><label for="' + id + '">' + label + '</label>' + input + (hint ? '<div class="ad-sub">' + hint + '</div>' : '') + '</div>';
  }
  function v(id) { return q('#' + id); }

  function fill(s) {
    v('wvModus').value = s.modus;
    v('wvWochen').value = s.wochen;
    v('wvRabatt').value = Math.round(s.rabattCents / 100);
    v('wvGueltig').value = s.gueltigWochen;
    v('wvMax').value = s.maxProTag;
    v('wvHinweis').value = s.hinweisAb || '';
    v('wvWunschAb').value = s.wunschAb || '';
    v('wvWunschAn').checked = !!s.wunschAn;
    v('wvBetreff').value = s.betreff;
    v('wvVorlageW').value = s.vorlageMitWunsch;
    v('wvVorlageN').value = s.vorlageNeutral;
    v('wvVariante').value = s.variante;
    v('wvKi').checked = !!s.kiAktiv;
  }

  function bind() {
    q('#wvForm').onsubmit = function (e) {
      e.preventDefault();
      var modus = v('wvModus').value;
      if (modus === 'live' && S.data.settings.modus !== 'live' && !window.confirm('Live schalten? Ab dem nächsten Tageslauf (ca. 9 Uhr) gehen echte Mails raus. Hast du vorher einen Trockenlauf und eine Testmail geprüft?')) return;
      A.api('wv/settings', { body: { settings: {
        modus: modus,
        wochen: Number(v('wvWochen').value),
        rabattCents: Math.round(Number(v('wvRabatt').value) * 100),
        gueltigWochen: Number(v('wvGueltig').value),
        maxProTag: Number(v('wvMax').value),
        hinweisAb: v('wvHinweis').value,
        wunschAb: v('wvWunschAb').value,
        wunschAn: v('wvWunschAn').checked,
        betreff: v('wvBetreff').value,
        vorlageMitWunsch: v('wvVorlageW').value,
        vorlageNeutral: v('wvVorlageN').value,
        variante: v('wvVariante').value,
        kiAktiv: v('wvKi').checked,
      } } }).then(function () { A.note('Gespeichert.'); S.lauf = null; return laden(); }).catch(fail);
    };

    q('#wvDry').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Läuft …';
      A.api('wv/trockenlauf', { body: {} }).then(function (rep) { if (rep.fehler && !rep.kandidaten) { A.note(String(rep.fehler), true); S.lauf = null; } else { S.lauf = rep; } return laden(); })
        .catch(function (e) { b.disabled = false; b.textContent = 'Trockenlauf jetzt'; fail(e); });
    };

    q('#wvTest').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Wird gesendet …';
      A.api('wv/testmail', { body: { vorname: v('wvTV').value, wunsch: v('wvTW').value, mitStripe: v('wvTS').checked } })
        .then(function (r) { A.note('Testmail ist unterwegs' + (r.echterCode ? ' (Code ' + r.code + ')' : '') + '.'); })
        .catch(fail)
        .then(function () { b.disabled = false; b.textContent = 'Testmail senden'; });
    };

    q('#wvCAdd').onclick = function () {
      A.api('wv/einwilligung', { body: { email: v('wvCE').value, notiz: v('wvCN').value } })
        .then(function () { A.note('Einwilligung gespeichert.'); return laden(); }).catch(fail);
    };
    Array.prototype.forEach.call(qa('[data-cdel]'), function (b) {
      b.onclick = function () {
        if (!armed(b, 'Wirklich?')) return;
        A.api('wv/einwilligung-loeschen', { body: { email: b.getAttribute('data-cdel') } }).then(laden).catch(fail);
      };
    });
    q('#wvOAdd').onclick = function () {
      A.api('wv/optout', { body: { email: v('wvOE').value } })
        .then(function () { A.note('Abgemeldet.'); return laden(); }).catch(fail);
    };
    Array.prototype.forEach.call(qa('[data-odel]'), function (b) {
      b.onclick = function () {
        if (!armed(b, 'Wirklich?')) return;
        A.api('wv/optout-loeschen', { body: { email: b.getAttribute('data-odel') } }).then(laden).catch(fail);
      };
    });
    Array.prototype.forEach.call(qa('[data-efrei]'), function (b) {
      b.onclick = function () {
        if (!armed(b, 'Wirklich senden?')) return;
        var id = b.getAttribute('data-efrei');
        A.api('wv/entwurf-freigeben', { body: { id: id, text: q('[data-etext="' + id + '"]').value } })
          .then(function () { A.note('Gesendet.'); return laden(); }).catch(fail);
      };
    });
    Array.prototype.forEach.call(qa('[data-everw]'), function (b) {
      b.onclick = function () {
        if (!armed(b, 'Wirklich verwerfen?')) return;
        A.api('wv/entwurf-verwerfen', { body: { id: b.getAttribute('data-everw') } }).then(laden).catch(fail);
      };
    });
  }

  function zeigeLauf(rep) {
    var k = rep.kandidaten || [], u = rep.uebersprungen || [];
    var html = '<h2 style="margin-top:26px">Ergebnis des Laufs</h2>' +
      '<p class="ad-hint">Erfasst werden Kunden, deren letzter Einzeltermin zwischen <b>' + esc(fd(rep.fensterStart)) + '</b> und <b>' + esc(fd(rep.schwelle)) + '</b> liegt.' +
      (rep.abgeschnitten ? ' <b class="ak-warn">Es gibt sehr viele Buchungen – nur die neuesten wurden gelesen.</b>' : '') + '</p>' +
      '<div class="ad-list">' + (k.length ? k.map(function (c) {
        return '<div class="ad-card"><div class="ad-card-top"><div class="ad-who">' + esc(c.name) + '</div><div class="ad-tagline">' + esc(c.status) + '</div></div>' +
          '<div class="ad-meta">' + esc(c.email) + ' · letzter Termin ' + esc(fd(c.letzterTermin)) + ' · ' + esc(c.leistung) + ' · ' + c.anzahl + ' Buchung(en) · ' + esc(c.grund) + '</div>' +
          '<div class="ad-note" style="white-space:pre-wrap;margin-top:10px">' + esc(c.absatz) + '</div>' +
          '<div class="ad-meta" style="margin-top:6px">' + (c.wunsch ? 'Zitierter Wunsch: „' + esc(c.wunsch) + '“' : 'Neutrale Fassung (' + esc(c.wunschGrund) + ')') + '</div></div>';
      }).join('') : '<div class="ad-empty">Niemand wäre heute dran.</div>') + '</div>';
    if (u.length) {
      html += '<h2 style="margin-top:22px">Übersprungen</h2><div class="ad-list">' + u.map(function (x) {
        return '<div class="ad-card-sm"><div><div class="ad-who">' + esc(x.name) + ' · ' + esc(x.email) + '</div><div class="ad-meta">Termin ' + esc(fd(x.datum)) + '</div></div><div class="ad-meta">' + esc(x.grund) + '</div></div>';
      }).join('') + '</div>';
    }
    var el = q('#wvLauf');
    if (el) el.innerHTML = html;
  }
})();
