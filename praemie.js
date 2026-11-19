/* Prämien-Seite (nicht verlinkt): ein kostenloses Training über einen Partner-Link, z. B. /praemie?c=nf-cowork. Plätze live aus dem Buchungssystem, Buchung direkt ohne Zahlung. */
(function () {
  var API = window.FD_API_BASE || 'https://fitnessdonner-gutscheine.coaching-by-niklas99.workers.dev';
  var P = 'niklas';
  var C = (new URLSearchParams(location.search).get('c') || '').trim();
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function eur(c) { var v = (c / 100).toFixed(2).replace('.', ','); return (v.slice(-3) === ',00' ? v.slice(0, -3) : v) + ' €'; }
  var WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  var WTL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  function dd(iso) { return new Date(iso + 'T12:00:00Z'); }
  function lang(iso) { var d = dd(iso); return WTL[d.getUTCDay()] + ', ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.'; }
  var D = null, WAHL = '';

  function zeige(was) { ['prLade', 'prAus', 'prAn', 'prOk'].forEach(function (id) { $(id).hidden = id !== was; }); }
  function aus(t, p) { $('prAusT').textContent = t; $('prAusP').textContent = p; zeige('prAus'); }
  function fehler(t) { var e = $('prErr'); e.textContent = t; e.hidden = !t; }

  function waLink() {
    var t = 'Hallo Niklas, ich möchte meine Prämie einlösen (' + (D ? D.titel : 'New Forge Coworking') + ').\nName: \nE-Mail: \nWunschtermin: ' + (WAHL ? lang(WAHL) : '');
    $('prWa').href = 'https://wa.me/491776311404?text=' + encodeURIComponent(t);
  }

  function waehle(datum) {
    WAHL = datum;
    Array.prototype.forEach.call(document.querySelectorAll('.pr-t'), function (b) { b.setAttribute('aria-checked', b.getAttribute('data-d') === datum ? 'true' : 'false'); });
    waLink();
  }

  function render(d) {
    D = d;
    if (!d) return aus('Link nicht gültig', 'Dieser Prämien-Link funktioniert leider nicht. Bitte nutze den Link oder QR-Code aus dem Flyer.');
    var k = d.kurs || {};
    if (k.bild) $('prBg').src = k.bild;
    $('prEye').textContent = 'Prämie für ' + d.titel;
    $('prSub').textContent = 'Als Mitglied im ' + d.titel + ' trainierst du einmal kostenlos bei ' + (k.titel || 'unseren Kursen') + ' im Forged Studio Solingen. Normalerweise kostet ein Training ' + eur(d.regulaer_cents || 1800) + '.';
    $('prFacts').innerHTML = '<li><b>0 €</b> statt ' + eur(d.regulaer_cents || 1800) + '</li><li><b>1 Training</b> pro Person</li><li>Höchstens <b>12 Plätze</b> pro Termin</li>';
    $('prFacts').hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('.pr-preis-txt'), function (s) { s.textContent = eur(d.regulaer_cents || 1800); });
    if (d.abgelaufen) return aus('Prämie beendet', 'Die Termine dieser Prämie sind vorbei. Alle weiteren Kurse findest du auf der Kursseite.');
    if (!d.offen) return aus('Alle Termine belegt', 'Für die Prämie ist leider gerade kein Platz mehr frei. Schreib mir gern per WhatsApp an 0177 6311404.');
    $('prAlt').textContent = eur(d.regulaer_cents);
    $('prTitel').textContent = k.titel;
    $('prMeta').textContent = [k.minuten + ' Min.', k.raum, 'Forged Studio Solingen – Ohligs'].filter(Boolean).join(' · ') + (k.adresse ? ' · ' + k.adresse : '');
    var erster = '';
    $('prTermine').innerHTML = d.termine.map(function (t) {
      var x = dd(t.datum), geht = t.buchbar && t.frei > 0;
      if (geht && !erster) erster = t.datum;
      var hinweis = !geht ? '<span class="voll">' + (t.abgesagt ? 'Fällt aus' : t.buchbar ? 'Voll' : 'Geschlossen') + '</span>' : (t.frei <= 4 ? '<span class="knapp">Nur noch ' + t.frei + (t.frei === 1 ? ' Platz' : ' Plätze') + '</span>' : '');
      return '<button type="button" class="pr-t" role="radio" aria-checked="false" data-d="' + esc(t.datum) + '"' + (geht ? '' : ' disabled') + '><span class="d">' + x.getUTCDate() + '. ' + MON[x.getUTCMonth()] + '</span><span class="w">' + WT[x.getUTCDay()] + '</span><span class="z">' + esc(t.start || '') + (t.ende ? '–' + esc(t.ende) : '') + '</span>' + hinweis + '</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.pr-t'), function (b) { b.addEventListener('click', function () { if (!b.disabled) waehle(b.getAttribute('data-d')); }); });
    if (WAHL && d.termine.some(function (t) { return t.datum === WAHL && t.buchbar && t.frei > 0; })) waehle(WAHL); else waehle(erster);
    zeige('prAn');
  }

  $('prForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    fehler('');
    var name = $('prName').value.trim(), mail = $('prMail').value.trim(), tel = $('prTel').value.trim();
    if (!WAHL) return fehler('Bitte wähle einen Termin.');
    if (!name) return fehler('Bitte gib deinen Namen an.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fehler('Bitte gib eine gültige E-Mail-Adresse an.');
    var b = $('prBtn'); var alt = b.textContent; b.disabled = true; b.textContent = 'Einen Moment …';
    fetch(API + '/api/kurse/praemie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: P, c: C, datum: WAHL, name: name, email: mail, phone: tel, website: $('prWeb').value }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        b.disabled = false; b.textContent = alt;
        if (r.ok && r.d.ok) {
          $('prOkP').textContent = 'Dein kostenloses Training: ' + (r.d.kurs || '') + ' am ' + lang(r.d.datum || WAHL) + (r.d.start ? ', ' + r.d.start + (r.d.ende ? '–' + r.d.ende : '') + ' Uhr' : '') + ' im Forged Studio Solingen.';
          if (r.d.link) $('prOkLink').href = r.d.link; else $('prOkLink').hidden = true;
          zeige('prOk');
          return;
        }
        fehler((r.d && r.d.error) || 'Das hat leider nicht geklappt. Bitte versuche es gleich noch einmal.');
        if (r.d && /voll|geschlossen|ausf/i.test(r.d.error || '')) load();
      })
      .catch(function () { b.disabled = false; b.textContent = alt; fehler('Keine Verbindung. Bitte versuche es gleich noch einmal.'); });
  });

  function load() {
    if (!C) return render(null);
    fetch(API + '/api/kurse/praemie?p=' + P + '&c=' + encodeURIComponent(C), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).then(render)
      .catch(function () { aus('Die Prämie lässt sich gerade nicht laden', 'Bitte versuche es in ein paar Minuten noch einmal.'); });
  }
  waLink();
  load();
})();
