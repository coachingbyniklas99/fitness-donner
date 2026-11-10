/* Gutschein: Tag und Uhrzeit für den Versand an die beschenkte Person.
   - Baut aus dem einfachen Datumsfeld (#sendDate) eine Auswahl "Sofort" oder "Tag und Uhrzeit".
   - Der 6.12. und der 24.12. sind im Kalender markiert und als Schnellwahl vorhanden.
   - Uhrzeit im Viertelstundentakt, deutsche Zeit. Übergeben wird "JJJJ-MM-TTTHH:MM" im
     bisherigen Feld sendDate; der Worker (ab worker-code-25) verschickt dann zur Uhrzeit.
   - Ohne dieses Skript bleibt das alte Datumsfeld bestehen. */
(function () {
  var sd = document.getElementById('sendDate');
  var form = document.getElementById('gsForm');
  if (!sd || !form) return;
  var field = sd.closest('.gs-field'), row = sd.closest('.gs-row');
  if (!field || !row) return;
  var recName = document.getElementById('recipientName');
  var errBox = document.getElementById('gsError');

  var MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var ICO_NIK = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M11 21 L13 5 L20 10 L27 5 L29 21Z" fill="#C8323A"/><path d="M20 10 V21 M15 15 H25" stroke="#F5D061" stroke-width="2.2"/><rect x="9" y="19.5" width="22" height="4" rx="2" fill="#F5D061"/><ellipse cx="20" cy="27" rx="9.5" ry="7" fill="#F1C9A5"/><path d="M8.5 26 C7 38 15 40 20 40 C25 40 33 38 31.5 26 C27 31 13 31 8.5 26Z" fill="#F3EEE3"/><circle cx="16.3" cy="26.2" r="1.2" fill="#2A2D33"/><circle cx="23.7" cy="26.2" r="1.2" fill="#2A2D33"/><ellipse cx="20" cy="29.4" rx="4.6" ry="2.2" fill="#F3EEE3"/><circle cx="20" cy="28" r="1.7" fill="#E58C84"/></svg>';
  var ICO_BAUM = '<svg viewBox="0 0 40 44" aria-hidden="true"><path d="M20 2l12 16h-6l9 12H27l7 10H6l7-10H5l9-12H8Z" fill="#2E8B5E"/><rect x="17" y="38" width="6" height="6" fill="#6B4A2B"/><path d="M20 0l1.8 4 4.2.4-3.2 2.8 1 4.1-3.8-2.2-3.8 2.2 1-4.1L14 4.4l4.2-.4Z" fill="#F5D061"/><circle cx="17" cy="20" r="1.8" fill="#C8323A"/><circle cx="24" cy="28" r="1.8" fill="#F5D061"/><circle cx="15" cy="34" r="1.8" fill="#F5D061"/><circle cx="26" cy="36" r="1.6" fill="#C8323A"/></svg>';

  /* Jetzt nach deutscher Zeit */
  function berlin() {
    var n = new Date(), b = n;
    try { b = new Date(n.toLocaleString('en-US', { timeZone: 'Europe/Berlin' })); if (isNaN(b)) b = n; } catch (e) { b = n; }
    return b;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function addDays(isoStr, n) { var p = isoStr.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return iso(d.getFullYear(), d.getMonth(), d.getDate()); }

  var now = berlin();
  var today = iso(now.getFullYear(), now.getMonth(), now.getDate());
  var maxDay = addDays(today, 364);

  /* Uhrzeiten: 6 bis 22 Uhr im Viertelstundentakt; heute nur, was noch mindestens 10 Minuten entfernt ist */
  function times(day) {
    var out = [], n = berlin(), lim = n.getHours() * 60 + n.getMinutes() + 10;
    for (var t = 6 * 60; t <= 22 * 60; t += 15) { if (day === today && t < lim) continue; out.push(pad(Math.floor(t / 60)) + ':' + pad(t % 60)); }
    return out;
  }
  var minDay = times(today).length ? today : addDays(today, 1);

  /* Feiertage für Markierung und Schnellwahl: der nächste 6.12. und 24.12. im wählbaren Zeitraum */
  function fest(mo, da) { var y = now.getFullYear(), c = iso(y, mo, da); if (c < minDay) c = iso(y + 1, mo, da); return c <= maxDay ? c : ''; }
  var NIK = fest(11, 6), XMAS = fest(11, 24);

  var S = { mode: 'now', day: '', time: '08:00', vy: now.getFullYear(), vm: now.getMonth() };

  /* Zeile "Zustellung ..." in der Bestellübersicht: zeigt den gewählten Zeitpunkt */
  var sumLi = null, sumLiOrig = '';
  [].slice.call(document.querySelectorAll('.gs-pay li')).forEach(function (li) { if (!sumLi && /^\s*Zustellung/.test(li.textContent)) { sumLi = li; sumLiOrig = li.textContent; } });

  /* Aufbau */
  var box = document.createElement('div');
  box.className = 'gs-when gift-only';
  box.hidden = row.hidden;
  box.innerHTML =
    '<span class="gs-when-lab" id="gsWhenLab">Wann soll der Gutschein ankommen?</span>' +
    '<div class="gs-toggle" role="group" aria-labelledby="gsWhenLab">' +
      '<button type="button" class="on" data-w="now">Sofort nach der Zahlung</button>' +
      '<button type="button" data-w="later">Tag und Uhrzeit wählen</button>' +
    '</div>' +
    '<div class="gs-when-pick" hidden>' +
      '<div class="gs-cal">' +
        '<div class="gs-cal-head"><button type="button" class="gs-cal-nav" data-nav="-1" aria-label="Vorheriger Monat">&lsaquo;</button><b aria-live="polite"></b><button type="button" class="gs-cal-nav" data-nav="1" aria-label="Nächster Monat">&rsaquo;</button></div>' +
        '<div class="gs-cal-grid" role="group" aria-label="Tag auswählen"></div>' +
      '</div>' +
      '<div class="gs-when-side">' +
        '<div class="gs-fest"></div>' +
        '<div class="gs-time"><label for="sendTime">Uhrzeit</label><select id="sendTime"></select></div>' +
        '<p class="gs-when-sum" aria-live="polite"></p>' +
        '<p class="gs-when-hint">Uhrzeit nach deutscher Zeit. Die Mail geht zur gewählten Viertelstunde raus.</p>' +
      '</div>' +
    '</div>';
  row.parentNode.insertBefore(box, row.nextSibling);

  /* Altes Datumsfeld und alte Schnellwahl ausblenden. Das Feld selbst bleibt als Wertträger bestehen. */
  field.hidden = true;
  row.classList.add('gs-row-solo');
  try { sd.type = 'hidden'; } catch (e) { /* bleibt ein Datumsfeld, dann wird nur der Tag übergeben */ }
  var oldQuick = document.getElementById('gsXmas');
  if (oldQuick && oldQuick.parentNode) { oldQuick.parentNode.classList.remove('gift-only'); oldQuick.parentNode.hidden = true; }

  var pick = box.querySelector('.gs-when-pick'), grid = box.querySelector('.gs-cal-grid'), head = box.querySelector('.gs-cal-head b');
  var sel = box.querySelector('#sendTime'), sum = box.querySelector('.gs-when-sum'), festBox = box.querySelector('.gs-fest');
  var navPrev = box.querySelector('[data-nav="-1"]'), navNext = box.querySelector('[data-nav="1"]');

  var fh = '';
  if (NIK) fh += '<button type="button" data-day="' + NIK + '">' + ICO_NIK + '<span>6.12. Nikolaus</span></button>';
  if (XMAS) fh += '<button type="button" data-day="' + XMAS + '">' + ICO_BAUM + '<span>24.12. Heiligabend</span></button>';
  festBox.innerHTML = fh;
  festBox.hidden = !fh;

  function longDate(d) { var p = d.split('-'), dt = new Date(+p[0], +p[1] - 1, +p[2]); return WD[dt.getDay()] + ', ' + (+p[2]) + '. ' + MON[+p[1] - 1] + ' ' + p[0]; }

  function renderCal() {
    head.textContent = MON[S.vm] + ' ' + S.vy;
    var first = new Date(S.vy, S.vm, 1), days = new Date(S.vy, S.vm + 1, 0).getDate(), lead = (first.getDay() + 6) % 7, h = '', i;
    ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach(function (w) { h += '<span class="gs-cal-wd" aria-hidden="true">' + w + '</span>'; });
    for (i = 0; i < lead; i++) h += '<span></span>';
    for (i = 1; i <= days; i++) {
      var d = iso(S.vy, S.vm, i), off = d < minDay || d > maxDay, cls = 'gs-day', ico = '', lab = longDate(d);
      if (d === today) cls += ' is-today';
      if (d === S.day) cls += ' on';
      if (d === NIK) { cls += ' is-fest nik'; ico = ICO_NIK; lab += ', Nikolaus'; }
      if (d === XMAS) { cls += ' is-fest xmas'; ico = ICO_BAUM; lab += ', Heiligabend'; }
      h += '<button type="button" class="' + cls + '" data-day="' + d + '"' + (off ? ' disabled' : '') + ' aria-label="' + lab + '"' + (d === S.day ? ' aria-pressed="true"' : '') + '>' + i + (ico ? '<i class="gs-day-ico">' + ico + '</i>' : '') + '</button>';
    }
    grid.innerHTML = h;
    navPrev.disabled = iso(S.vy, S.vm, 1) <= minDay.slice(0, 8) + '01';
    navNext.disabled = iso(S.vy, S.vm, 1) >= maxDay.slice(0, 8) + '01';
  }

  function renderTimes() {
    var list = times(S.day || addDays(today, 1));
    if (list.indexOf(S.time) < 0) S.time = list.indexOf('08:00') > -1 ? '08:00' : list[0];
    sel.innerHTML = list.map(function (t) { return '<option value="' + t + '"' + (t === S.time ? ' selected' : '') + '>' + t + ' Uhr</option>'; }).join('');
  }

  function sync() {
    var later = S.mode === 'later';
    box.querySelectorAll('.gs-toggle button').forEach(function (b) { b.classList.toggle('on', b.dataset.w === S.mode); b.setAttribute('aria-pressed', b.dataset.w === S.mode); });
    pick.hidden = !later;
    festBox.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.day === S.day); });
    var wer = (recName && recName.value.trim()) || 'Die beschenkte Person';
    sum.textContent = '';
    if (later && S.day) {
      sum.appendChild(document.createTextNode(wer + ' bekommt den Gutschein am '));
      var b = document.createElement('b'); b.textContent = longDate(S.day) + ' um ' + S.time + ' Uhr'; sum.appendChild(b);
      sum.appendChild(document.createTextNode('.'));
    } else if (later) sum.textContent = 'Bitte einen Tag im Kalender antippen.';
    sd.value = (later && S.day) ? (sd.type === 'hidden' ? S.day + 'T' + S.time : S.day) : '';
    if (sumLi) {
      var p = S.day.split('-');
      sumLi.textContent = (later && S.day && !box.hidden)
        ? 'Zustellung an die beschenkte Person am ' + (+p[2]) + '.' + (+p[1]) + '.' + p[0] + ' um ' + S.time + ' Uhr per E-Mail. Deine Kopie kommt sofort.'
        : sumLiOrig;
    }
  }

  function setDay(d) {
    S.day = d; S.mode = 'later';
    var p = d.split('-'); S.vy = +p[0]; S.vm = +p[1] - 1;
    renderCal(); renderTimes(); sync();
  }

  box.querySelector('.gs-toggle').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.mode = b.dataset.w; sync();
  });
  grid.addEventListener('click', function (e) { var b = e.target.closest('.gs-day'); if (b && !b.disabled) setDay(b.dataset.day); });
  festBox.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setDay(b.dataset.day); });
  box.querySelector('.gs-cal-head').addEventListener('click', function (e) {
    var b = e.target.closest('.gs-cal-nav'); if (!b || b.disabled) return;
    var d = new Date(S.vy, S.vm + (+b.dataset.nav), 1); S.vy = d.getFullYear(); S.vm = d.getMonth(); renderCal();
  });
  sel.addEventListener('change', function () { S.time = sel.value; sync(); });
  if (recName) recName.addEventListener('input', sync);
  var modeBox = document.getElementById('gsMode');
  if (modeBox) modeBox.addEventListener('click', function () { setTimeout(sync, 0); });

  /* Wer "Tag und Uhrzeit" gewählt, aber keinen Tag angetippt hat, soll nicht versehentlich sofort verschicken */
  document.addEventListener('submit', function (e) {
    if (e.target !== form || box.hidden || S.mode !== 'later') return;
    var grund = '';
    if (!S.day) grund = 'Bitte einen Tag für den Versand auswählen oder „Sofort nach der Zahlung“ wählen.';
    else if (times(S.day).indexOf(S.time) < 0) { renderTimes(); sync(); grund = 'Die gewählte Uhrzeit ist inzwischen vorbei. Bitte eine spätere Uhrzeit wählen.'; }
    if (!grund) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (errBox) { errBox.textContent = grund; errBox.hidden = false; }
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, true);

  renderCal(); renderTimes(); sync();
})();
