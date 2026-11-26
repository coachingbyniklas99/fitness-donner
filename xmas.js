/* Weihnachts-Hinweis auf den Gutschein: bis einschliesslich 24.12. (Berliner Zeit) sichtbar, danach verschwindet alles von selbst.
   Setzt die Klasse "fdx" auf <html> (blendet Elemente mit .fdx-only ein)
   und zeigt den Gutschein in der gelben Leiste ganz oben. Wo dort auch das Early-Bird-Angebot laeuft, wechseln beide sich ab. */
(function () {
  'use strict';
  var BIS = '2026-12-24';
  var heute;
  try { heute = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return; }
  if (heute > BIS) return;
  /* Die Gutscheinseiten haben ihr eigenes Festtagsdesign (gutschein-xmas.js) */
  var seite = (location.pathname.split('/').pop() || 'index.html');
  var istGutschein = /^gutschein/.test(seite);
  if (istGutschein) return;
  window.FD_XMAS = true;
  document.documentElement.classList.add('fdx');
  /* Farbe wie auf der Gutscheinseite: rot bis Nikolaus (6.12. 18 Uhr), danach gruen */
  try {
    var jetzt = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    var mo = jetzt.getMonth(), da = jetzt.getDate(), hh = jetzt.getHours();
    var rot = (mo === 10) || (mo === 11 && (da < 6 || (da === 6 && hh < 18)));
    if (!rot) document.documentElement.classList.add('fdx-gr');
  } catch (e) {}
  /* Bis Nikolaus beide Anlaesse, danach nur noch Weihnachten */
  var nikPhase = !document.documentElement.classList.contains('fdx-gr');
  var msgs = [nikPhase ? {
    href: 'gutschein.html', tag: 'Nikolaus &amp; Weihnachten',
    long: 'Geschenk zu Nikolaus oder Weihnachten? Gutschein für Personal Training &amp; Kurse – digital, sofort im Postfach',
    short: 'Nikolaus &amp; Weihnachten: Gutschein verschenken', go: 'Gutschein ansehen &rarr;'
  } : {
    href: 'gutschein-weihnachten.html', tag: 'Weihnachten',
    long: 'Weihnachtsgeschenk gesucht? Gutschein für Personal Training &amp; Kurse – digital, sofort im Postfach',
    short: 'Weihnachtsgeschenk: Gutschein verschenken', go: 'Gutschein ansehen &rarr;'
  }];
  var band = null, a = null, idx = 0, timer = null;

  function apply(m) {
    if (!a) return;
    var ico = a.querySelector('.wa-ico'); if (ico) ico.style.display = (m.href.indexOf('whatsapp') > -1) ? '' : 'none';
    a.href = m.href;
    if (m.ext) { a.target = '_blank'; a.rel = 'noopener'; } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
    var b = a.querySelector('b'); if (b) b.innerHTML = m.tag;
    var l = a.querySelector('.nb-long'); if (l) l.innerHTML = m.long;
    var s = a.querySelector('.nb-short'); if (s) s.innerHTML = m.short;
    var g = a.querySelector('.newsbar-go'); if (g) g.innerHTML = m.go;
  }
  function show(i) {
    idx = i;
    if (msgs.length < 2) { apply(msgs[i]); return; }
    a.style.transition = 'opacity .25s'; a.style.opacity = '0';
    setTimeout(function () { apply(msgs[i]); a.style.opacity = '1'; }, 260);
  }
  function start() {
    if (timer || msgs.length < 2 || !band) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = setInterval(function () { show((idx + 1) % msgs.length); }, 6500);
    band.addEventListener('mouseenter', function () { clearInterval(timer); timer = null; });
    band.addEventListener('mouseleave', start);
  }
  /* Das Early-Bird-Skript meldet sein Angebot hier an, statt die Leiste zu ueberschreiben */
  window.FD_barAdd = function (m) {
    for (var i = 0; i < msgs.length; i++) if (msgs[i].href === m.href) { msgs[i] = m; return; }
    msgs.push(m); start();
  };

  function init() {
    band = document.getElementById('earlybirdBar') || document.querySelector('.newsbar');
    if (!band && seite === 'kurse.html') {
      var n = document.querySelector('nav');
      if (n) {
        band = document.createElement('div'); band.className = 'newsbar'; band.id = 'earlybirdBar';
        band.innerHTML = '<a href="gutschein-weihnachten.html"><b></b><span class="nb-long"></span><span class="nb-short"></span><span class="newsbar-go"></span></a>';
        n.parentNode.insertBefore(band, n);
      }
    }
    if (!band) return;
    a = band.querySelector('a'); if (!a) return;
    apply(msgs[0]); start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
