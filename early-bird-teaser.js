/* Kurse-Seite: Karte „Early-Bird“ und Startseite: gelbe Leiste (einmaliges Angebot bis zum Stichtag).
   Kommt live aus dem Buchungssystem und bleibt unsichtbar, solange das Angebot nicht aktiv, abgelaufen oder ausgebucht ist. */
(function () {
  var API = window.FD_API_BASE || 'https://fitnessdonner-gutscheine.coaching-by-niklas99.workers.dev';
  var sec = document.getElementById('earlybird');
  var band = document.getElementById('earlybirdBar');
  if (!sec && !band) return;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function eur(c) { var v = (c / 100).toFixed(2).replace('.', ','); return (v.slice(-3) === ',00' ? v.slice(0, -3) : v) + '\u00a0\u20ac'; }
  var WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var WTL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MON = ['Jan', 'Feb', 'M\u00e4r', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  function dd(iso) { return new Date(iso + 'T12:00:00Z'); }
  function heuteBerlin() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return dd(p);
  }
  function render(d) {
    if (!d || !d.aktiv || !d.offen || !d.buchbar || !d.termine || !d.termine.length) return;
    var n = d.termine.length, bezahlt = Math.max(1, n - 1), k = d.kurs || {};
    var wt = WTL[dd(d.termine[0].datum).getUTCDay()] + 's';
    var bis = d.bis ? dd(d.bis) : null;
    var bisKurz = bis ? bis.getUTCDate() + '.' + (bis.getUTCMonth() + 1) + '.' : '';
    var bisLang = bis ? WTL[bis.getUTCDay()] + ', ' + bisKurz : '';
    if (band) {
      // Startseite: gelbe Leiste ganz oben zeigt solange das Angebot läuft den Early-Bird statt des Kanal-Hinweises
      var msg = {
        href: 'early-bird.html', ext: false,
        tag: bisKurz ? 'Nur bis ' + bisKurz : 'Einmalig',
        long: 'Early-Bird: 3 Termine, 2 bezahlen \u2013 ' + eur(d.cents) + ' statt ' + eur(d.regulaer_cents) + ', danach wieder normale Preise',
        short: 'Early-Bird: 3 Termine, 2 bezahlen \u2013 ' + eur(d.cents),
        go: 'Ansehen &rarr;'
      };
      if (window.FD_barAdd) {
        // Weihnachtszeit: xmas.js wechselt zwischen Gutschein-Hinweis und Early-Bird ab
        window.FD_barAdd(msg);
      } else {
        var a = band.querySelector('a');
        var ico = a.querySelector('.wa-ico'); if (ico) ico.style.display = 'none';
        a.href = msg.href; a.removeAttribute('target'); a.removeAttribute('rel');
        a.querySelector('b').textContent = msg.tag;
        a.querySelector('.nb-long').innerHTML = msg.long;
        a.querySelector('.nb-short').innerHTML = msg.short;
        a.querySelector('.newsbar-go').innerHTML = msg.go;
      }
    }
    if (!sec) return;
    if (k.bild) $('ebtBg').src = k.bild;
    $('ebtEye').textContent = 'Einmaliges Angebot' + (bisKurz ? ' \u00b7 nur bis ' + bisKurz : '');
    $('ebtTxt').innerHTML = n + ' ' + esc(wt) + '-Termine bei <b>' + esc(k.titel || 'Pulse & Power') + '</b> im Forged Studio, du zahlst nur ' + bezahlt + '. Ein Termin geht aufs Haus.';
    $('ebtTermine').innerHTML = d.termine.map(function (t, i) {
      var x = dd(t.datum);
      return '<li><b>' + x.getUTCDate() + '. ' + MON[x.getUTCMonth()] + '</b> ' + WT[x.getUTCDay()] + ', ' + esc(t.start) + ' Uhr' + (i === n - 1 ? ' <i>gratis</i>' : '') + '</li>';
    }).join('');
    $('ebtAlt').textContent = eur(d.regulaer_cents);
    $('ebtNeu').textContent = eur(d.cents);
    if (bis) {
      var rest = Math.round((bis - heuteBerlin()) / 864e5);
      var f = rest <= 0 ? 'Letzter Tag' : rest === 1 ? 'Noch 1 Tag' : rest <= 7 ? 'Noch ' + rest + ' Tage' : 'Bis ' + bisLang;
      $('ebtFrist').textContent = f;
      $('ebtNach').textContent = 'Einmalig \u2013 danach gelten wieder die normalen Preise.';
    }
    sec.hidden = false;
  }
  fetch(API + '/api/kurse/earlybird?p=niklas', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; }).then(render).catch(function () {});
})();
