/* Kursbuchung – fitnessdonner.de/kurs-buchen.html
   Ablauf: 1 Termin (Kursplan) → 2 Angebot (10er, 5er, Einzelticket) → 3 Daten → Stripe
   Parameter: ?k=<kurs>&d=<datum> (springt direkt zu Schritt 2), &angebot=<token> (Warteliste),
              &abgebrochen=1 (zurück von Stripe), &p=<anbieterin> (Standard niklas), &embed=1 (iframe) */
var API_BASE = window.FD_API_BASE || 'https://fitnessdonner-gutscheine.coaching-by-niklas99.workers.dev';

(function () {
  var Q = new URLSearchParams(location.search);
  var P = (Q.get('p') || 'niklas').toLowerCase();
  var EMBED = Q.get('embed') === '1';
  var el = function (id) { return document.getElementById(id); };
  var WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var S = { data: null, kurs: null, termin: null, art: '', gutschein: null, angebot: Q.get('angebot') || '', step: 1 };
  if (EMBED) document.body.classList.add('ku-embed');

  /* ---------- Hilfen ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function eur(c) { var v = (c / 100).toFixed(2).replace('.', ','); return (v.slice(-3) === ',00' ? v.slice(0, -3) : v) + ' €'; }
  function dobj(iso) { return new Date(iso + 'T12:00:00Z'); }
  function dk(iso) { var d = dobj(iso); return WD[d.getUTCDay()] + ' ' + ('0' + d.getUTCDate()).slice(-2) + '.' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '.'; }
  function dl(iso) { return dk(iso) + iso.slice(0, 4); }
  function fail(t) { var e = el('error'); e.textContent = t; e.hidden = false; e.scrollIntoView({ block: 'center', behavior: 'smooth' }); groesse(); }
  function clearError() { el('error').hidden = true; }
  function store(fn) { try { return fn(window.sessionStorage); } catch (e) { return null; } }
  function rid() { var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  var HOLD = store(function (s) { var h = s.getItem('fd_kurs_hold'); if (!h) { h = rid(); s.setItem('fd_kurs_hold', h); } return h; }) || rid();
  function api(path, body) {
    return fetch(API_BASE + '/api/kurse' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); });
  }
  function groesse() {
    if (!EMBED || !window.parent || window.parent === window) return;
    try { window.parent.postMessage({ fdKurse: { hoehe: document.documentElement.scrollHeight } }, '*'); } catch (e) {}
  }
  if (EMBED && window.ResizeObserver) new ResizeObserver(groesse).observe(document.body);

  function saveDraft() {
    store(function (s) {
      s.setItem('fd_kurs', JSON.stringify({ k: S.kurs && S.kurs.id, d: S.termin && S.termin.datum, art: S.art,
        name: el('name').value, email: el('email').value, phone: el('phone').value, gutschein: el('gutschein').value }));
    });
  }
  function loadDraft() { var raw = store(function (s) { return s.getItem('fd_kurs'); }); try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  /* ---------- Schritte ---------- */
  function goStep(n) {
    if (n >= 2 && !S.termin) return;
    if (n >= 3 && !S.art) return;
    S.step = n;
    Array.prototype.forEach.call(document.querySelectorAll('.tk-panel'), function (p) { p.hidden = Number(p.getAttribute('data-panel')) !== n; });
    Array.prototype.forEach.call(document.querySelectorAll('.tk-step'), function (b) {
      var s = Number(b.getAttribute('data-goto'));
      b.classList.toggle('is-now', s === n);
      b.classList.toggle('is-done', s < n);
    });
    if (n === 2) renderAngebot();
    if (n === 3) renderDaten();
    clearError();
    if (!EMBED && n > 1) window.scrollTo({ top: el('stepBar').offsetTop - 70, behavior: 'smooth' });
    groesse();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-back]'), function (b) { b.onclick = function () { goStep(Number(b.getAttribute('data-back'))); }; });
  Array.prototype.forEach.call(document.querySelectorAll('.tk-step'), function (b) { b.onclick = function () { goStep(Number(b.getAttribute('data-goto'))); }; });

  function waehle(kursId, datum) {
    var k = S.data.kurse.filter(function (x) { return x.id === kursId; })[0];
    var t = k && k.termine.filter(function (x) { return x.datum === datum; })[0];
    if (!k || !t) return false;
    S.kurs = k; S.termin = t; S.art = ''; S.gutschein = null;
    el('wlBox').hidden = true;
    return true;
  }
  function startdatum(datum) { return (S.kurs.startdaten || []).filter(function (x) { return x.datum === datum; })[0]; }

  /* ---------- Schritt 2: Angebot ---------- */
  function pill(t) {
    if (t.abgesagt) return '<span class="kp-pill">Fällt aus</span>';
    if (t.frei < 1) return '<span class="kp-pill voll">Ausgebucht</span>';
    if (t.frei <= 3) return '<span class="kp-pill knapp">Noch ' + t.frei + (t.frei === 1 ? ' Platz' : ' Plätze') + '</span>';
    return '<span class="kp-pill gut">' + t.frei + ' Plätze frei</span>';
  }
  function karte(o) {
    return '<div class="ku-ang' + (o.erstes ? ' erstes' : '') + (o.zu ? ' zu' : '') + (o.flag ? ' mit-flag' : '') + '">'
      + (o.flag ? '<span class="ku-flag">' + o.flag + '</span>' : '')
      + '<div><div class="ku-ang-name">' + o.name + '</div><div class="ku-ang-preis">' + eur(o.cents) + '<small>' + o.einheit + '</small></div><div class="ku-ang-text">' + o.text + '</div></div>'
      + '<div class="ku-ang-aktion">' + (o.aktion || '') + '</div>' + (o.extra || '') + '</div>';
  }
  function kartenAngebot(art) {
    var k = S.kurs, t = S.termin, pr = k.produkte[art];
    if (!pr || !pr.aktiv) return '';
    var n = pr.termine, sd = startdatum(t.datum), r = sd && sd[art];
    var proT = eur(Math.round(pr.cents / n)) + ' pro Termin';
    if (r && r.ok) {
      return karte({ name: pr.label + ' ab diesem Termin', cents: pr.cents, einheit: proT, erstes: art === 'karte10',
        flag: art === 'karte10' ? 'Empfohlen · bester Preis pro Termin' : '',
        text: 'Du bist an <b>' + n + ' festen Terminen</b> dabei: ' + dk(r.termine[0]) + ' bis ' + dk(r.bis) + '<br>Dein Platz ist an jedem dieser Termine sicher. ' + S.data.gueltig_monate + ' Monate gültig.',
        aktion: '<button type="button" class="btn ' + (art === 'karte10' ? 'btn-blitz' : 'btn-ghost') + '" data-art="' + art + '">' + esc(pr.label) + ' wählen</button>',
        extra: '<ol class="ku-ang-termine">' + r.termine.map(function (d) { return '<li>' + dk(d) + '</li>'; }).join('') + '</ol>' });
    }
    var alt = (S.kurs.startdaten || []).filter(function (x) { return x.datum > t.datum && x[art] && x[art].ok; })[0];
    var grund = r ? r.grund : 'Karten ab diesem Termin lassen sich noch nicht buchen.';
    return karte({ name: pr.label + ' ab diesem Termin', cents: pr.cents, einheit: proT, zu: true,
      text: '<span class="ku-grund">' + esc(grund) + '</span>' + (alt ? '<br>Frühestmöglicher Start: <b>' + dl(alt.datum) + '</b>' : ''),
      aktion: alt ? '<button type="button" class="btn btn-ghost btn-sm" data-start="' + alt.datum + '">Ab ' + dk(alt.datum) + ' ansehen</button>' : '' });
  }
  function einzelAngebot() {
    var k = S.kurs, t = S.termin, pr = k.produkte.tageskarte;
    if (!pr || !pr.aktiv) return '';
    var o = { name: pr.label, cents: pr.cents, einheit: 'für diesen Termin' };
    if (t.frei < 1) {
      o.text = 'Dieser Termin ist ausgebucht. Trag dich auf die Warteliste ein – wird ein Platz frei, bekommst du eine Mail und hast ' + S.data.warteliste_stunden + ' Stunden Zeit zum Buchen.';
      o.aktion = '<button type="button" class="btn btn-ghost" id="wlAuf">Auf die Warteliste</button>';
    } else if (!t.tageskarte_offen) {
      var ab = t.tageskarte_ab.slice(0, 10);
      o.zu = true;
      o.text = 'Einzeltickets gibt es <b>ab ' + dk(ab) + '</b> für die Plätze, die dann noch frei sind. Bis dahin haben Kartenkunden Vorrang.';
      o.aktion = '<button type="button" class="btn btn-ghost" disabled>Ab ' + dk(ab) + '</button>';
    } else {
      o.text = 'Nur dieser eine Termin.' + (t.frei <= 3 ? ' <b>Noch ' + t.frei + (t.frei === 1 ? ' Platz' : ' Plätze') + ' frei.</b>' : '');
      o.aktion = '<button type="button" class="btn btn-ghost" data-art="tageskarte">Einzelticket wählen</button>';
    }
    return karte(o);
  }
  function renderAngebot() {
    var k = S.kurs, t = S.termin;
    el('aKurs').textContent = k.titel;
    el('aTermin').textContent = dl(t.datum) + ', ' + t.start + '–' + t.ende + ' Uhr';
    el('aMeta').textContent = k.ort + ' · mit ' + k.anbieterin + (k.beschreibung ? ' · ' + k.beschreibung : '');
    el('aPill').innerHTML = pill(t);
    el('angebote').innerHTML = kartenAngebot('karte10') + kartenAngebot('karte5') + einzelAngebot();
    var h = el('aHinweis');
    if (t.frei > 0 && !t.tageskarte_offen) {
      h.innerHTML = '<b>Warum gerade nur Karten?</b> Alle Plätze stehen zuerst Kartenkunden offen. ' + k.produkte.tageskarte.freischalt_tage + ' Tage vor dem Termin werden die übrigen Plätze als Einzeltickets freigeschaltet.';
      h.hidden = false;
    } else h.hidden = true;
    Array.prototype.forEach.call(el('angebote').querySelectorAll('[data-art]'), function (b) {
      b.onclick = function () { S.art = b.getAttribute('data-art'); S.angebot = ''; goStep(3); };
    });
    Array.prototype.forEach.call(el('angebote').querySelectorAll('[data-start]'), function (b) {
      b.onclick = function () { waehle(S.kurs.id, b.getAttribute('data-start')); renderAngebot(); window.scrollTo({ top: el('stepBar').offsetTop - 70, behavior: 'smooth' }); };
    });
    var wl = el('wlAuf');
    if (wl) wl.onclick = zeigWarteliste;
    groesse();
  }

  /* ---------- Warteliste ---------- */
  function zeigWarteliste() {
    var k = S.kurs, t = S.termin;
    el('wlText').innerHTML = '<b style="color:var(--bone)">' + esc(dl(t.datum)) + ', ' + esc(t.start) + '–' + esc(t.ende) + ' Uhr</b> ist ausgebucht. '
      + esc(S.data.texte.warteliste_info).replace('festes Zeitfenster', S.data.warteliste_stunden + ' Stunden Zeit');
    el('wlOkText').textContent = 'Ich bin einverstanden, dass meine Angaben für die Warteliste dieses Termins gespeichert und nach dem Termin gelöscht werden.';
    el('wlDone').hidden = true;
    el('wlBox').hidden = false;
    if (!el('wlName').value) el('wlName').value = el('name').value;
    if (!el('wlMail').value) el('wlMail').value = el('email').value;
    el('wlBox').scrollIntoView({ block: 'center', behavior: 'smooth' });
    groesse();
  }
  el('wlBtn').onclick = function () {
    clearError();
    el('wlBtn').disabled = true;
    api('/warteliste', { p: P, kurs: S.kurs.id, datum: S.termin.datum, name: el('wlName').value, email: el('wlMail').value, phone: el('wlPhone').value, datenschutz_ok: el('wlOk').checked })
      .then(function (r) {
        el('wlBtn').disabled = false;
        if (r.s !== 200) { fail(r.d.error || 'Das hat nicht geklappt.'); return; }
        el('wlDone').textContent = r.d.schon ? 'Du stehst schon auf der Warteliste – du bekommst eine Mail, sobald ein Platz frei wird.'
          : 'Eingetragen' + (r.d.position ? ' (Platz ' + r.d.position + ')' : '') + '. Du bekommst gleich eine Bestätigung per Mail.';
        el('wlDone').hidden = false;
        groesse();
      }).catch(function () { el('wlBtn').disabled = false; fail('Keine Verbindung.'); });
  };

  /* ---------- Schritt 3: Daten ---------- */
  function termineDerWahl() {
    if (S.art === 'tageskarte') return [S.termin.datum];
    var r = startdatum(S.termin.datum);
    return r && r[S.art] && r[S.art].ok ? r[S.art].termine : [];
  }
  function produkt() { return S.kurs.produkte[S.art]; }
  function rabatt() { return S.gutschein ? S.gutschein.discount_cents : 0; }
  function renderDaten() {
    var k = S.kurs, ts = termineDerWahl(), p = produkt();
    el('s3Sub').innerHTML = esc(k.titel) + ' · ' + esc(p.label) + ' · ' + (ts.length > 1 ? ts.length + ' Termine ab ' + esc(dl(ts[0])) : esc(dl(ts[0])));
    var items = [
      '<b style="color:var(--bone)">' + esc(k.titel) + '</b>, ' + esc(k.wochentag_name) + 's ' + esc(k.start) + '–' + esc(k.ende) + ' Uhr',
      'Ort: ' + esc(k.ort) + (k.adresse ? ', ' + esc(k.adresse) : ''),
      'Anbieterin: ' + esc(k.anbieterin),
      esc(p.label) + ' · ' + eur(p.cents),
      (ts.length > 1 ? 'Termine: ' : 'Termin: ') + ts.map(dl).join(', ')
    ];
    if (S.art !== 'tageskarte') items.push('Karte gültig ' + S.data.gueltig_monate + ' Monate (Rahmen für Ersatztermine)');
    if (rabatt()) items.push('Gutschein ' + esc(S.gutschein.code) + ': −' + eur(rabatt()));
    el('orderList').innerHTML = items.map(function (x) { return '<li>' + x + '</li>'; }).join('');
    el('regeln').innerHTML = '<b>So läuft es</b><ul>' + S.data.texte.regeln.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    var aus = p.widerruf_ausgeschlossen;
    el('widerrufText').textContent = aus ? S.data.texte.widerruf_aus_vorher : '';
    el('widerrufText').hidden = !aus;
    el('widerrufLabel').textContent = aus ? S.data.texte.widerruf_aus_check : S.data.texte.widerruf_an_check;
    var offen = Math.max(0, p.cents - rabatt());
    el('sumValue').textContent = eur(offen);
    el('payBtn').textContent = offen > 0 ? 'Zahlungspflichtig buchen' : 'Verbindlich buchen';
    el('secure').hidden = offen <= 0;
    if (S.angebot) {
      var n = el('notice');
      n.innerHTML = '<b>Dein Platz von der Warteliste ist für dich reserviert.</b> Buche ihn jetzt mit einem Einzelticket – das Angebot gilt bis zur Uhrzeit aus deiner Mail.';
      n.hidden = false;
    }
    groesse();
  }
  el('gsBtn').onclick = function () {
    var code = el('gutschein').value.trim();
    if (!code) { S.gutschein = null; el('gsMsg').textContent = ''; renderDaten(); return; }
    el('gsMsg').textContent = 'Moment …';
    api('/gutschein', { p: P, code: code, preis_cents: produkt().cents }).then(function (r) {
      if (!r.d.ok) { S.gutschein = null; el('gsMsg').textContent = r.d.error; renderDaten(); return; }
      S.gutschein = r.d;
      el('gsMsg').innerHTML = '<span style="color:var(--blitz)">' + eur(r.d.discount_cents) + ' werden angerechnet'
        + (r.d.rest_cents > r.d.discount_cents ? ' – Restguthaben danach ' + eur(r.d.rest_cents - r.d.discount_cents) : '') + '.</span>';
      renderDaten();
    }).catch(function () { el('gsMsg').textContent = 'Keine Verbindung.'; });
  };

  el('form').onsubmit = function (e) {
    e.preventDefault();
    clearError();
    if (!el('widerrufOk').checked) { fail('Bitte bestätige den Hinweis vor dem Kauf.'); return; }
    var btn = el('payBtn'), alt = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Moment …';
    saveDraft();
    var p = produkt();
    var body = { p: P, kurs: S.kurs.id, art: S.art, name: el('name').value, email: el('email').value, phone: el('phone').value, hold: HOLD };
    if (S.art === 'tageskarte') body.datum = S.termin.datum; else body.start = S.termin.datum;
    if (S.gutschein) body.gutschein = S.gutschein.code;
    if (S.angebot) body.angebot = S.angebot;
    if (p.widerruf_ausgeschlossen) body.widerruf_ok = true; else body.vorzeitig = true;
    api('/checkout', body).then(function (r) {
      if (r.s === 200 && r.d.status === 'payment' && r.d.url) {
        try { (EMBED ? window.top : window).location.href = r.d.url; } catch (err) { window.open(r.d.url, '_blank'); }
        return;
      }
      btn.disabled = false;
      btn.textContent = alt;
      if (r.s === 200 && r.d.status === 'confirmed') {
        store(function (s) { s.removeItem('fd_kurs'); });
        var abs = new URL('kurs-buchung.html?p=' + encodeURIComponent(P) + '&o=' + encodeURIComponent(r.d.o) + '&t=' + encodeURIComponent(r.d.t), location.href).href;
        try { (EMBED ? window.top : window).location.href = abs; } catch (err) { location.href = abs; }
        return;
      }
      fail(r.d.error || 'Das hat nicht geklappt. Bitte versuch es noch einmal.');
      if (r.d.voll) neuLaden(function () { goStep(2); });
    }).catch(function () { btn.disabled = false; btn.textContent = alt; fail('Keine Verbindung. Bitte prüfe dein Internet und versuch es noch einmal.'); });
  };

  /* ---------- Laden ---------- */
  function planZeigen(tag) {
    window.FDKursplan.start(el('plan'), {
      daten: S.data, tag: tag,
      onBuchen: function (k, t) { if (waehle(k.id, t.datum)) goStep(2); },
      onRender: groesse,
    });
  }
  function neuLaden(dann) {
    api('?p=' + encodeURIComponent(P)).then(function (r) {
      if (r.s === 200) {
        S.data = r.d;
        var kid = S.kurs && S.kurs.id, d = S.termin && S.termin.datum;
        if (kid && d) waehle(kid, d);
        planZeigen(d);
      }
      if (dann) dann();
    });
  }

  function start() {
    api('?p=' + encodeURIComponent(P)).then(function (r) {
      el('loading').hidden = true;
      S.data = r.s === 200 ? r.d : { kurse: [] };
      var draft = loadDraft();
      if (draft) { el('name').value = draft.name || ''; el('email').value = draft.email || ''; el('phone').value = draft.phone || ''; el('gutschein').value = draft.gutschein || ''; }
      var k = Q.get('k'), d = Q.get('d');
      if (Q.get('abgebrochen') === '1' && draft && draft.k && draft.d) { k = draft.k; d = draft.d; }
      planZeigen(d || '');
      goStep(1);
      if (k && d && waehle(k, d)) {
        if (S.angebot) { S.art = 'tageskarte'; goStep(3); return; }
        if (Q.get('abgebrochen') === '1' && draft && draft.art) {
          S.art = draft.art;
          var n = el('notice');
          n.innerHTML = '<b>Zahlung abgebrochen.</b> Deine Auswahl ist noch da – die reservierten Plätze sind wieder freigegeben.';
          n.hidden = false;
          if (termineDerWahl().length) { goStep(3); return; }
          S.art = '';
        }
        goStep(2);
      }
    }).catch(function () { el('loading').hidden = true; S.data = { kurse: [] }; planZeigen(''); goStep(1); fail('Der Kursplan konnte nicht geladen werden. Bitte lade die Seite neu.'); });
  }

  // Wer von der Zahlseite zurückkommt (auch per Zurück-Taste), gibt zuerst seine Reservierung frei
  fetch(API_BASE + '/api/kurse/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hold: HOLD }) })
    .catch(function () {}).then(start);
  window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
})();
