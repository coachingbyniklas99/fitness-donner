/* Kursplan-Baustein: Tagesleiste + Kurse des gewählten Tags.
   Wird auf kurse.html und auf kurs-buchen.html (Schritt 1) benutzt.

   FDKursplan.start(box, {
     daten:    Antwort von GET /api/kurse (oder null, solange noch nichts da ist),
     onBuchen: function (kurs, termin) { … }   // Klick auf „Kurs buchen“
     tag:      'YYYY-MM-DD' (optional, vorausgewählter Tag)
   })
   Ohne aktive Kurse zeigt der Plan trotzdem die Tage – mit dem Hinweis, dass der Kursplan bald steht. */
(function () {
  var WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var WOCHEN = 10;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dat(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function plus(s, n) { var d = dat(s); d.setDate(d.getDate() + n); return iso(d); }
  function kurz(s) { var d = dat(s); return WD[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
  function heute() {
    try {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
        .reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
      return p.year + '-' + p.month + '-' + p.day;
    } catch (e) { return iso(new Date()); }
  }

  /** Was ist für diesen Termin buchbar? (für die kleinen Schilder) */
  function moeglich(k, t) {
    var out = [];
    if (t.abgesagt || !t.buchbar) return out;
    if (k.produkte.tageskarte.aktiv && t.frei > 0 && t.tageskarte_offen) out.push(k.produkte.tageskarte.label);
    var sd = (k.startdaten || []).filter(function (x) { return x.datum === t.datum; })[0];
    ['karte5', 'karte10'].forEach(function (a) { if (sd && sd[a] && sd[a].ok && k.produkte[a].aktiv) out.push(k.produkte[a].label); });
    return out;
  }
  function pill(t) {
    if (t.abgesagt) return '<span class="kp-pill">Fällt aus</span>';
    if (t.frei < 1) return '<span class="kp-pill voll">Ausgebucht</span>';
    if (t.frei <= 3) return '<span class="kp-pill knapp">Noch ' + t.frei + (t.frei === 1 ? ' Platz' : ' Plätze') + '</span>';
    return '<span class="kp-pill gut">' + t.frei + ' Plätze frei</span>';
  }
  function bild(k) {
    if (k.bild) return '<div class="kp-bild"><img src="' + esc(k.bild) + '" alt="' + esc(k.titel) + '" loading="lazy"></div>';
    var f = /^#[0-9a-f]{6}$/i.test(k.farbe || '') ? k.farbe : '#7a5c12';
    return '<div class="kp-bild kp-platzhalter" style="--kp-farbe:' + f + '" aria-hidden="true"><b>' + esc(k.titel) + '</b></div>';
  }

  function start(box, opts) {
    var daten = opts.daten || { kurse: [] };
    var HEUTE = heute();
    var termine = [];   // { k, t }
    (daten.kurse || []).forEach(function (k) { (k.termine || []).forEach(function (t) { termine.push({ k: k, t: t }); }); });
    var leer = !termine.length;
    function am(d) {
      return termine.filter(function (x) { return x.t.datum === d; })
        .sort(function (a, b) { return a.t.start.localeCompare(b.t.start); });
    }
    function naechster(ab) {
      var x = termine.filter(function (y) { return y.t.datum >= ab && !y.t.abgesagt; }).map(function (y) { return y.t.datum; }).sort()[0];
      return x || '';
    }
    var S = { tag: opts.tag || '', ab: 0 };
    if (!S.tag) S.tag = am(HEUTE).length ? HEUTE : (naechster(HEUTE) || HEUTE);
    function setzeTag(d) {
      S.tag = d;
      var diff = Math.round((dat(d) - dat(HEUTE)) / 864e5);
      if (diff < S.ab || diff >= S.ab + 7) S.ab = Math.max(0, Math.floor(diff / 7) * 7);
    }
    setzeTag(S.tag);

    function render() {
      var tage = [];
      for (var i = 0; i < 7; i++) tage.push(plus(HEUTE, S.ab + i));
      var html = '<div class="kp-tage"><button type="button" class="kp-pfeil" data-kp="zurueck" aria-label="Vorherige Woche"' + (S.ab <= 0 ? ' disabled' : '') + '>‹</button><div class="kp-liste" role="tablist">'
        + tage.map(function (d) {
          var dd = dat(d), hat = am(d).some(function (x) { return !x.t.abgesagt; });
          var lbl = (d === HEUTE ? 'Heute, ' : d === plus(HEUTE, 1) ? 'Morgen, ' : '') + WD[dd.getDay()] + ' ' + dd.getDate() + '.' + (d === tage[0] || dd.getDate() === 1 ? (dd.getMonth() + 1) + '.' : '');
          return '<button type="button" role="tab" aria-selected="' + (d === S.tag) + '" class="kp-tag' + (d === S.tag ? ' on' : '') + (hat || leer ? '' : ' ohne') + '" data-kp-tag="' + d + '">' + lbl + (hat ? '<span class="kp-punkt" aria-hidden="true"></span>' : '') + '</button>';
        }).join('') + '</div><button type="button" class="kp-pfeil" data-kp="weiter" aria-label="Nächste Woche"' + (S.ab >= 7 * (WOCHEN - 1) ? ' disabled' : '') + '>›</button></div>';

      var liste = am(S.tag), dS = dat(S.tag);
      html += '<div class="kp-kopf"><b>' + WDL[dS.getDay()] + ', ' + dS.getDate() + '. ' + MON[dS.getMonth()] + '</b><span>'
        + (leer ? '' : liste.length ? liste.length + (liste.length === 1 ? ' Kurs' : ' Kurse') : 'keine Kurse') + '</span></div>';

      if (leer) {
        html += '<div class="kp-bald"><div class="kp-bald-titel">Der Kursplan steht bald.</div>'
          + '<p>Die festen Kurszeiten im New Forge stimme ich gerade ab. Sobald sie stehen, findest du hier jeden Tag die Kurse mit freien Plätzen &ndash; direkt buchbar, als Einzelticket oder 5er- und 10er-Karte.</p>'
          + (document.querySelector('.kanal-header') ? '</div>' : '<p>Erhalte die neuesten Infos inklusive Early-Bird-Angebote im WhatsApp-Kanal.</p>'
          + '<a class="btn btn-blitz btn-sm" href="https://whatsapp.com/channel/0029Vb9Sacj9xVJgW1Vm7O2Z" target="_blank" rel="noopener">Zum WhatsApp-Kanal</a></div>');
      } else if (!liste.length) {
        var n = naechster(plus(S.tag, 1));
        html += '<div class="kp-leer">An diesem Tag gibt es keine Kurse.' + (n ? '<br><button type="button" class="btn btn-ghost btn-sm" data-kp-tag="' + n + '">Nächster Kurstag: ' + kurz(n) + '</button>' : '') + '</div>';
      } else {
        html += '<div class="kp-zeilen">' + liste.map(function (x) {
          var k = x.k, t = x.t, tags = moeglich(k, t);
          return '<div class="kp-zeile' + (t.abgesagt ? ' aus' : '') + '">' + bild(k)
            + '<div class="kp-zeit-box"><div class="kp-zeit">' + esc(t.start) + ' – ' + esc(t.ende) + '</div>'
            + (tags.length ? '<div class="kp-tags">' + tags.map(function (g) { return '<span>' + esc(g) + '</span>'; }).join('') + '</div>' : '') + '</div>'
            + '<div class="kp-name"><b>' + esc(k.titel) + '</b><span>' + esc(k.kategorie ? k.kategorie + ' · ' : '') + 'mit ' + esc(k.anbieterin) + '</span></div>'
            + '<div class="kp-ort">Solingen-Ohligs<b>' + esc(k.ort) + '</b></div>'
            + '<div class="kp-aktion">' + pill(t) + (t.abgesagt ? '' : '<button type="button" class="btn btn-blitz btn-sm" data-kp-buchen="' + esc(k.id + '|' + t.datum) + '">Kurs buchen</button>') + '</div></div>';
        }).join('') + '</div>';
      }
      box.innerHTML = html;

      Array.prototype.forEach.call(box.querySelectorAll('[data-kp-tag]'), function (b) {
        b.onclick = function () { setzeTag(b.getAttribute('data-kp-tag')); render(); };
      });
      var z = box.querySelector('[data-kp="zurueck"]'), w = box.querySelector('[data-kp="weiter"]');
      if (z) z.onclick = function () { S.ab = Math.max(0, S.ab - 7); S.tag = plus(HEUTE, S.ab); render(); };
      if (w) w.onclick = function () { S.ab += 7; S.tag = plus(HEUTE, S.ab); render(); };
      Array.prototype.forEach.call(box.querySelectorAll('[data-kp-buchen]'), function (b) {
        b.onclick = function () {
          var p = b.getAttribute('data-kp-buchen').split('|');
          var x = termine.filter(function (y) { return y.k.id === p[0] && y.t.datum === p[1]; })[0];
          if (x && opts.onBuchen) opts.onBuchen(x.k, x.t);
        };
      });
      var leiste = box.querySelector('.kp-liste'), aktiv = box.querySelector('.kp-tag.on');
      if (leiste && aktiv) leiste.scrollLeft = aktiv.offsetLeft - leiste.offsetLeft - (leiste.clientWidth - aktiv.offsetWidth) / 2;
      if (opts.onRender) opts.onRender();
    }
    render();
    return { tag: function () { return S.tag; } };
  }

  window.FDKursplan = { start: start };
})();
