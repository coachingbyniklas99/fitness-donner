/* Early-Bird-Seite: Angebot und freie Plätze live aus dem Buchungssystem, Buchung über den normalen Kurs-Checkout. */
(function () {
  var API = window.FD_API_BASE || 'https://fitnessdonner-gutscheine.coaching-by-niklas99.workers.dev';
  var P = 'niklas';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function eur(c) { var v = (c / 100).toFixed(2).replace('.', ','); return (v.slice(-3) === ',00' ? v.slice(0, -3) : v) + ' €'; }
  var WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  var WTL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  function dd(iso) { return new Date(iso + 'T12:00:00Z'); }
  function lang(iso) { var d = dd(iso); return WTL[d.getUTCDay()] + ', ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.'; }
  function store(fn) { try { return fn(window.sessionStorage); } catch (e) { return null; } }
  function rid() { var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  var HOLD = store(function (s) { var h = s.getItem('fd_eb_hold'); if (!h) { h = rid(); s.setItem('fd_eb_hold', h); } return h; }) || rid();

  var D = null;

  function zeige(was) {
    ['ebLade', 'ebAus', 'ebAn'].forEach(function (id) { $(id).hidden = id !== was; });
  }

  function aus(titel, text) {
    $('ebAusT').textContent = titel; $('ebAusP').textContent = text; zeige('ebAus');
  }

  function render(d) {
    D = d;
    if (!d || !d.aktiv) return aus('Gerade nicht verfügbar', 'Dieses Angebot gibt es im Moment nicht. Schau gern auf der Kursseite vorbei.');
    var k = d.kurs;
    if (k.bild) $('ebBg').src = k.bild;
    var n = d.termine.length;
    var bezahlt = Math.max(1, n - 1);
    var wt = d.termine.length ? WTL[dd(d.termine[0].datum).getUTCDay()] + 's' : '';
    $('ebSub').textContent = n + ' ' + wt + '-Termine bei ' + k.titel + ' im Forged Studio Solingen, du zahlst nur ' + bezahlt + '. Dein Early-Bird-Start in die Kurse.';
    $('ebFacts').innerHTML = '<li><b>' + eur(d.cents) + '</b> statt ' + eur(d.regulaer_cents) + '</li><li>Höchstens <b>' + k.kapazitaet + ' Plätze</b> pro Termin</li>' + (d.bis ? '<li>Angebot bis <b>' + esc(lang(d.bis)) + '</b></li>' : '');
    $('ebFacts').hidden = false;

    if (!d.offen) return aus('Early-Bird beendet', 'Das Angebot ist leider vorbei. Die einzelnen Termine und Karten findest du auf der Kursseite.');
    if (!d.buchbar) return aus(d.voll ? 'Ausgebucht' : 'Gerade nicht buchbar', d.voll ? 'Das Early-Bird-Paket ist leider ausgebucht. Auf der Kursseite siehst du, ob für einzelne Termine noch etwas frei ist.' : 'Das Paket lässt sich im Moment nicht buchen. Schau gern auf der Kursseite vorbei.');

    $('ebAlt').textContent = eur(d.regulaer_cents);
    $('ebNeu').textContent = eur(d.cents);
    $('ebSpar').textContent = 'Du sparst ' + eur(Math.max(0, d.regulaer_cents - d.cents));
    $('ebTitel').textContent = k.titel;
    var meta = [k.minuten + ' Min.', k.raum, 'Forged Studio Solingen – Ohligs'].filter(Boolean).join(' · ');
    $('ebMeta').textContent = meta + (k.adresse ? ' · ' + k.adresse : '');
    $('ebTermine').innerHTML = d.termine.map(function (t, i) {
      var x = dd(t.datum);
      var knapp = t.frei > 0 && t.frei <= 4 ? '<span class="knapp">Nur noch ' + t.frei + (t.frei === 1 ? ' Platz' : ' Plätze') + '</span>' : '';
      var gratis = i === d.termine.length - 1 ? '<span class="gratis">Gratis</span>' : '';
      return '<li><span class="d">' + x.getUTCDate() + '. ' + MON[x.getUTCMonth()] + '</span><span class="w">' + WT[x.getUTCDay()] + '</span><span class="z">' + esc(t.start) + (t.ende ? '–' + esc(t.ende) : '') + '</span>' + gratis + knapp + '</li>';
    }).join('');
    $('ebWrText').textContent = d.texte.widerruf_vorher;
    $('ebWrLabel').textContent = d.texte.widerruf_check;
    $('ebBtn').textContent = 'Early-Bird sichern – ' + eur(d.cents).replace(' ', ' ');
    $('ebAbbr').hidden = !/[?&]abgebrochen=1/.test(location.search);
    zeige('ebAn');
  }

  function fehler(t) { var e = $('ebErr'); e.textContent = t; e.hidden = !t; }

  $('ebForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    fehler('');
    var name = $('ebName').value.trim(), mail = $('ebMail').value.trim(), tel = $('ebTel').value.trim();
    if (!name) return fehler('Bitte deinen Namen angeben.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fehler('Bitte eine gültige E-Mail-Adresse angeben.');
    if (!tel) return fehler('Bitte deine Telefonnummer angeben, falls ein Termin kurzfristig ausfällt.');
    if (!$('ebWr').checked) return fehler('Bitte bestätige den Hinweis zum Widerrufsrecht.');
    var b = $('ebBtn'); var alt = b.textContent; b.disabled = true; b.textContent = 'Einen Moment …';
    fetch(API + '/api/kurse/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: P, art: 'earlybird', name: name, email: mail, phone: tel, widerruf_ok: true, hold: HOLD }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok && r.d.url) { location.href = r.d.url; return; }
        b.disabled = false; b.textContent = alt;
        fehler((r.d && r.d.error) || 'Das hat leider nicht geklappt. Bitte versuche es gleich noch einmal.');
        if (r.d && (r.d.voll)) load();
      })
      .catch(function () { b.disabled = false; b.textContent = alt; fehler('Keine Verbindung. Bitte versuche es gleich noch einmal.'); });
  });

  function load() {
    fetch(API + '/api/kurse/earlybird?p=' + P, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(render)
      .catch(function () { aus('Das Angebot lässt sich gerade nicht laden', 'Bitte versuche es in ein paar Minuten noch einmal.'); });
  }
  load();
})();
