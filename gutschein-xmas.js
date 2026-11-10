/* Nikolaus-/Weihnachtsdesign fuer die Gutscheinseite (Vorlage).
   - aktiv vom 1. November bis 24. Dezember, danach macht das Skript nichts mehr
   - bis 6.12. 18 Uhr (Berliner Zeit) "nik" (rot), danach Weihnachten (gruen)
   - window.XM_PREF = 'xmas' (Weihnachtsseite) zeigt schon im November das gruene Design
   - Vorschau erzwingen: ?xm=nik oder ?xm=xmas, abschalten: ?xm=off */
(function () {
  var root = document.documentElement, now = new Date();
  var force = (window.XM_FORCE || (location.search.match(/[?&]xm=(\w+)/) || [])[1] || '');
  /* Datum und Uhrzeit immer nach Berliner Zeit */
  var bl = now;
  try { bl = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' })); if (isNaN(bl)) bl = now; } catch (e) { bl = now; }
  var m = bl.getMonth(), d = bl.getDate(), y = bl.getFullYear(), hh = bl.getHours();
  var auto = (m === 10) || (m === 11 && d <= 24);
  var nikPhase = (m === 10) || (m === 11 && (d < 6 || (d === 6 && hh < 18)));
  if (force === 'nik') nikPhase = true; else if (force === 'xmas') nikPhase = false;
  var mode = force ? (force === 'off' ? '' : force) : (auto ? (nikPhase ? 'nik' : 'xmas') : '');
  if (!force && auto && window.XM_PREF === 'xmas') mode = 'xmas';
  if (!mode) return;
  root.classList.add('xmas');
  if (mode === 'nik') root.classList.add('nik');
  var NIK = mode === 'nik';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Einzug: Die Seite startet im Normalzustand (xm-pre) und wechselt nach kurzer Pause in ca. 3 Sekunden ins Festtagsdesign.
     Abschalten: ?xmintro=off oder window.XM_INTRO = false. Tempo: window.XM_SPEED (1 = normal, kleiner = schneller). */
  var intro = !reduce && window.XM_INTRO !== false && !/[?&]xmintro=off/.test(location.search);
  if (window.XM_SPEED) root.style.setProperty('--xs', window.XM_SPEED);
  if (intro) root.classList.add('xm-pre', 'xm-now');
  var xs = parseFloat(getComputedStyle(root).getPropertyValue('--xs')) || 1;

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  /* Tage bis zu einem Datum (volle Kalendertage) */
  function daysTo(mo, da) {
    var a = new Date(y, bl.getMonth(), bl.getDate()), b = new Date(y, mo, da);
    return Math.round((b - a) / 864e5);
  }

  ready(function () {
    var hero = document.querySelector('.page-hero');
    var strip = document.querySelector('.gs-strip.gs-auto');
    var stripFx = null;

    /* Streifen: Farbe und Text nach Datum */
    if (strip) {
      strip.classList.remove('gs-xmas', 'gs-nik');
      strip.classList.add(NIK ? 'gs-nik' : 'gs-xmas');
      var b = strip.querySelector('b');
      var stripTxt = NIK ? 'Frohen Nikolaus am 6. Dezember' : 'Zu Weihnachten schenken';
      if (b) {
        if (intro) {
          var stripOrig = b.textContent;
          stripFx = {
            reset: function () { b.textContent = stripOrig; b.classList.remove('xm-swap'); },
            run: function () { var k = parseFloat(getComputedStyle(root).getPropertyValue('--xs')) || 1; setTimeout(function () { b.textContent = stripTxt; b.classList.remove('xm-swap'); void b.offsetWidth; b.classList.add('xm-swap'); }, 900 * k); }
          };
        } else b.textContent = stripTxt;
      }
    }

    /* Figuren: Weihnachtsmann (Nikolaus mit Bischofsmuetze), Muetze am Logo, Socke an der Ueberschrift */
    function face(nik) {
      var top = nik
        ? '<path d="M11 21 L13 5 L20 10 L27 5 L29 21Z" fill="#C8323A"/><path d="M20 10 V21 M15 15 H25" stroke="#F5D061" stroke-width="2.2"/><rect x="9" y="19.5" width="22" height="4" rx="2" fill="#F5D061"/>'
        : '<path d="M7 22 C6 8 19 3 29 10 C33 13 35 18 34 22Z" fill="#C8323A"/><circle cx="33" cy="9" r="4.2" fill="#F3EEE3"/><rect x="5" y="19" width="30" height="6.5" rx="3.2" fill="#F3EEE3"/>';
      return '<svg viewBox="0 0 40 40" aria-hidden="true">' + top +
        '<ellipse cx="20" cy="27" rx="9.5" ry="7" fill="#F1C9A5"/>' +
        '<path d="M8.5 26 C7 38 15 40 20 40 C25 40 33 38 31.5 26 C27 31 13 31 8.5 26Z" fill="#F3EEE3"/>' +
        '<circle cx="16.3" cy="26.2" r="1.2" fill="#2A2D33"/><circle cx="23.7" cy="26.2" r="1.2" fill="#2A2D33"/>' +
        '<ellipse cx="20" cy="29.4" rx="4.6" ry="2.2" fill="#F3EEE3"/><circle cx="20" cy="28" r="1.7" fill="#E58C84"/></svg>';
    }
    if (strip) {
      var sb = strip.querySelector('b');
      if (sb && !strip.querySelector('.xm-face')) { var fc = document.createElement('span'); fc.className = 'xm-face'; fc.innerHTML = face(NIK); sb.parentNode.insertBefore(fc, sb); }
    }
    var logo = document.querySelector('nav .nav-inner>a');
    if (logo) {
      var hat = document.createElement('span');
      hat.className = 'xm-hat'; hat.setAttribute('aria-hidden', 'true');
      hat.innerHTML = '<svg viewBox="0 0 52 40" width="100%" height="100%"><path d="M6 36 C4 14 24 2 40 12 C46 16 48 26 46 34Z" fill="#C8323A"/><path d="M6 36 C14 30 36 30 46 34 L46 38 L6 38Z" fill="#F3EEE3"/><circle cx="43" cy="9" r="6" fill="#F3EEE3"/></svg>';
      logo.appendChild(hat);
    }
    var h1 = hero && hero.querySelector('h1');
    if (h1 && h1.innerHTML.indexOf('Socken.') > -1) {
      h1.innerHTML = h1.innerHTML.replace('Socken.', '<span class="xm-sock">Socken.</span>') +
        '';
      var sock = h1.querySelector('.xm-sock');
      var st = document.createElement('span'); st.className = 'xm-stock'; st.setAttribute('aria-hidden', 'true');
      st.innerHTML = '<svg viewBox="0 0 30 44" width="100%" height="100%"><path d="M7 3H23V21C23 25 29 28 29 34C29 40 22 42 17 40C12 38 7 34 7 28Z" fill="#C8323A"/><rect x="5" y="1" width="20" height="8" rx="3" fill="#F3EEE3"/><path d="M19 33C23 33 26 35 27 37 L24 40C22 38 20 36 19 36Z" fill="#F3EEE3"/><path d="M7 20H23" stroke="#F3EEE3" stroke-width="2" stroke-dasharray="3 2"/></svg>';
      sock.appendChild(st);
    }

    /* Countdown-Chip */
    var pills = document.querySelector('.gs-pills');
    if (pills) {
      var dn = daysTo(11, 6), dx = daysTo(11, 24), txt;
      if (NIK && dn > 0) txt = 'Noch <b>' + dn + (dn === 1 ? ' Tag' : ' Tage') + '</b> bis Nikolaus';
      else if (NIK && dn === 0) txt = '<b>Heute</b> ist Nikolaus';
      else if (dx > 0) txt = 'Noch <b>' + dx + (dx === 1 ? ' Tag' : ' Tage') + '</b> bis Heiligabend';
      else txt = '<b>Heute</b> ist Heiligabend';
      var c = document.createElement('span'); c.className = 'xm-count'; c.innerHTML = txt;
      pills.insertBefore(c, pills.firstChild);
    }

    /* Gutschein als Geschenkpaket: goldene Schleife mit Aufdruck */
    var card = document.querySelector('.gs-v');
    if (card) {
      var rb = document.createElement('div');
      rb.className = 'xm-ribbon'; rb.setAttribute('aria-hidden', 'true');
      rb.innerHTML = '<span class="xm-rt">' + (NIK ? 'Frohen Nikolaus' : 'Frohe Weihnachten') + ' &middot; Fitness Donner</span>' +
        '<svg class="xm-bow" viewBox="0 0 150 96"><defs><linearGradient id="xmG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBE59A"/><stop offset=".55" stop-color="#F5D061"/><stop offset="1" stop-color="#C99A2E"/></linearGradient></defs>' +
        '<path d="M66 64 L50 94 L66 88 L74 66Z" fill="#C99A2E"/><path d="M84 64 L100 94 L84 88 L76 66Z" fill="#B8902B"/>' +
        '<path d="M75 60 C54 14 12 4 9 36 C7 62 46 70 75 60Z" fill="url(#xmG)" stroke="#B8902B" stroke-width="1.5"/>' +
        '<path d="M75 60 C94 14 138 4 141 36 C143 62 104 70 75 60Z" fill="url(#xmG)" stroke="#B8902B" stroke-width="1.5"/>' +
        '<path d="M70 58 C52 38 32 28 20 34 M80 58 C98 38 118 28 130 34" fill="none" stroke="#B8902B" stroke-width="1.4" opacity=".7"/>' +
        '<rect x="62" y="48" width="26" height="22" rx="6" fill="url(#xmG)" stroke="#B8902B" stroke-width="1.5"/></svg>';
      card.appendChild(rb);
      /* Foto im Gutschein: Studiowand, laeuft nach unten in die Kartenfarbe aus */
      var cimg = card.querySelector('.gs-v-bg');
      if (cimg) {
        cimg.dataset.orig = cimg.getAttribute('src');
        cimg.src = window.XM_CARD || 'newforge-rack.webp';
      }
    }

    /* Foto: das Aussenfoto hat blauen Sommerhimmel, im Winterdesign kommt das Studio */
    var himg = hero && hero.querySelector('.fade-img img');
    if (himg) {
      var heroSrc = window.XM_HERO || 'newforge-studio.webp';
      var fig = himg.closest('.fade-img');
      if (intro && fig) {
        /* zweites Bild liegt darueber und blendet ein, das Aussenfoto bleibt darunter */
        var im2 = new Image();
        im2.className = 'xm-img2'; im2.alt = 'Das Forged Studio in Solingen-Ohligs'; im2.decoding = 'async';
        im2.style.setProperty('--pos', '58% 50%'); im2.style.setProperty('--posm', '52% 50%');
        im2.src = heroSrc; fig.appendChild(im2);
        /* Foto vorab dekodieren, damit das Einblenden nicht beim ersten Bild stockt */
        window.__xmDecode = im2.decode ? im2.decode().catch(function () {}) : null;
      } else {
        himg.src = heroSrc;
        himg.alt = 'Das Forged Studio in Solingen-Ohligs';
        if (fig) { fig.style.setProperty('--pos', '58% 50%'); fig.style.setProperty('--posm', '52% 50%'); }
      }
    }

    /* Auswahl: Gutschein im Nikolaus-Design (nur bis 6.12. 18 Uhr), im Weihnachts-Design oder ohne Saison-Design */
    var occ = document.getElementById('gsOcc');
    var cur = NIK ? 'nik' : 'xmas';
    var imgOf = function (k) { return k === 'std' ? null : (window.XM_CARD || 'newforge-rack.webp'); };
    function setDesign(k) {
      cur = k;
      if (!card) return;
      card.classList.toggle('xm-plain', k === 'std');
      card.classList.toggle('xm-v-nik', k === 'nik');
      card.classList.toggle('xm-v-xmas', k === 'xmas');
      var rt = card.querySelector('.xm-rt');
      if (rt) rt.innerHTML = (k === 'nik' ? 'Frohen Nikolaus' : 'Frohe Weihnachten') + ' &middot; Fitness Donner';
      var ci = card.querySelector('.gs-v-bg');
      if (ci && ci.dataset.orig) ci.src = (k === 'std') ? ci.dataset.orig : imgOf(k);
    }
    window.fdDesign = function () { return cur === 'std' ? '' : cur; };
    /* Bastelkarte: Klappkarte zum Selbstausdrucken, nur im Fest-Design und nur bei "An mich" (Feld liegt im Käufer-Bereich) */
    (function () {
      var ex = document.getElementById('gsBuyerExtra'); if (!ex) return;
      var row = document.createElement('div'); row.className = 'gs-check'; row.id = 'bastelRow'; row.style.marginTop = '12px';
      row.innerHTML = '<input type="checkbox" id="optBastel"><label for="optBastel"><b style="color:#ECE9E2">Zus&auml;tzlich als Bastelkarte</b> &ndash; eine festliche Klappkarte zum Selbstausdrucken (PDF im Anhang). Auf A4 quer beidseitig drucken, in der Mitte falten, fertig.</label>';
      ex.appendChild(row);
      var cb = row.querySelector('input');
      window.fdSyncBastel = function () { var off = !window.fdDesign || !window.fdDesign(); row.hidden = off; if (off) cb.checked = false; };
      window.fdSyncBastel();
    })();
    if (occ && card) {
      var dw = document.createElement('div'); dw.className = 'xm-design';
      var opts = '';
      if (nikPhase) opts += '<button type="button" class="gs-opt' + (cur === 'nik' ? ' on' : '') + '" data-d="nik"><b>Nikolaus-Design</b><span>Mit Schleife und Schnee</span></button>';
      opts += '<button type="button" class="gs-opt' + (cur === 'xmas' ? ' on' : '') + '" data-d="xmas"><b>Weihnachts-Design</b><span>Mit Schleife und Schnee</span></button>';
      opts += '<button type="button" class="gs-opt" data-d="std"><b>Standard</b><span>Das klassische Fitness-Donner-Design</span></button>';
      dw.innerHTML = '<span class="gs-lab">Design des Gutscheins</span><div class="gs-opts' + (nikPhase ? ' xm-three' : '') + '" id="xmDesign">' + opts + '</div>';
      occ.parentNode.insertBefore(dw, occ.nextSibling);
      dw.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        dw.querySelectorAll('.gs-opt').forEach(function (x) { x.classList.toggle('on', x === b); });
        setDesign(b.dataset.d); if (window.fdSyncBastel) window.fdSyncBastel();
      });
      setDesign(cur);
    }

    /* Schnellwahl fuer Nikolaus (nur bis einschliesslich 5.12., weil der Versand frueh am Morgen laeuft) */
    var xb = document.getElementById('gsXmas'), sd = document.getElementById('sendDate');
    if (NIK && xb && sd && daysTo(11, 6) > 0) {
      var nb = document.createElement('button');
      nb.type = 'button'; nb.className = 'gs-quick xm-nikbtn'; nb.textContent = 'Am 6.12. morgens verschicken';
      xb.parentNode.insertBefore(nb, xb);
      nb.addEventListener('click', function () {
        var gift = document.querySelector('#gsMode button[data-mode="gift"]');
        if (gift) gift.click();
        sd.value = y + '-12-06';
        sd.dispatchEvent(new Event('input', { bubbles: true }));
        sd.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    /* Lichterkette unter dem Streifen und ueber dem Abschluss */
    var lightsHosts = [];
    if (hero) lightsHosts.push(hero);
    var cta = document.querySelector('section.cta'); if (cta) lightsHosts.push(cta);
    var palette = NIK ? ['#F5D061', '#C8323A', '#FFF6E6', '#F5D061'] : ['#C8323A', '#F5D061', '#3FAE7A', '#FFF6E6'];
    function lights(host) {
      var el = host.querySelector(':scope>.xm-lights');
      if (!el) { el = document.createElement('div'); el.className = 'xm-lights'; el.setAttribute('aria-hidden', 'true'); host.insertBefore(el, host.firstChild); }
      var W = host.clientWidth || 1000, step = W < 600 ? 46 : 62, n = Math.ceil(W / step) + 1, H = 58, sag = W < 600 ? 14 : 18;
      var wire = 'M-10 4', bulbs = '', i;
      for (i = 0; i <= n; i++) {
        var x = i * step - step / 2, x2 = x + step;
        wire += ' Q' + (x + step / 2) + ' ' + (4 + sag * 2) + ' ' + x2 + ' 4';
      }
      for (i = 0; i < n; i++) {
        var cx = i * step, col = palette[i % palette.length];
        var cy = 4 + sag + 6;
        bulbs += '<g class="b" style="--i:' + i + ';--gd:' + (-(i * 0.37 % 2.6)).toFixed(2) + 's">' +
          '<rect x="' + (cx - 2.5) + '" y="' + (cy - 14) + '" width="5" height="6" fill="#2A2D33"/>' +
          '<ellipse cx="' + cx + '" cy="' + (cy + 2) + '" rx="5.5" ry="8" fill="' + col + '"/>' +
          '<ellipse cx="' + cx + '" cy="' + (cy + 2) + '" rx="12" ry="14" fill="' + col + '" opacity=".18"/></g>';
      }
      el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMin slice"><path d="' + wire + '" fill="none" stroke="#2A2D33" stroke-width="2"/>' + bulbs + '</svg>';
    }
    function allLights() { lightsHosts.forEach(lights); }
    allLights();
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(allLights, 200); });

    /* Schnee */
    var hosts = [];
    if (hero) hosts.push(hero);
    var gv = document.querySelector('section.gv'); if (gv) hosts.push(gv);
    if (cta) hosts.push(cta);
    hosts.forEach(snow);

    /* Einzug starten: kurze Pause im Normalzustand, dann gestaffelter Wechsel. Unterer Teil folgt beim Hinscrollen. */
    var waits = [];
    if (intro) {
      [card, document.querySelector('.gs-cfg .gs-pay'), document.querySelector('section.gv'), cta].forEach(function (e) {
        if (!e) return;
        e.classList.add('xm-w');
        if (e !== card) { e.classList.add('xm-cs'); }
        waits.push(e);
      });
      var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting && !root.classList.contains('xm-pre')) { en.target.classList.add('xm-in'); io.unobserve(en.target); } });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }) : null;
      var arm = function () { waits.forEach(function (e) { if (io) io.observe(e); else e.classList.add('xm-in'); }); };
      var go = function () { root.classList.remove('xm-pre'); if (stripFx) stripFx.run(); arm(); };
      window.fdXmReplay = function () {
        clearTimeout(window.__xmT);
        waits.forEach(function (e) { e.classList.remove('xm-in'); if (io) io.unobserve(e); });
        if (stripFx) stripFx.reset(); root.classList.add('xm-pre', 'xm-now'); void root.offsetWidth; root.classList.remove('xm-now');
        window.scrollTo(0, 0);
        window.__xmT = setTimeout(go, 700);
      };
      var kick = function () {
        var dec = window.__xmDecode ? Promise.race([window.__xmDecode, new Promise(function (r) { setTimeout(r, 1500); })]) : Promise.resolve();
        dec.then(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove('xm-now'); window.__xmT = setTimeout(go, 600); }); }); });
      };
      if (document.readyState === 'complete') kick(); else window.addEventListener('load', kick);
    }

    /* Rueckweg: Beim Verlassen der Gutschein-Seite wechselt das Festtagsdesign sanft (ca. 1 Sekunde) zurueck in den Normalzustand, danach geht es zur Zielseite. */
    if (!reduce && window.XM_OUTRO !== false) {
      var leaving = false;
      document.addEventListener('click', function (e) {
        if (leaving || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
        var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
        if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return;
        var f = u.pathname.split('/').pop();
        if (/^gutschein/.test(f)) return;
        if (u.pathname === location.pathname && u.search === location.search) return;
        e.preventDefault(); leaving = true;
        clearTimeout(window.__xmT);
        root.style.setProperty('--xs', '0.3');
        root.classList.remove('xm-now'); root.classList.add('xm-pre');
        setTimeout(function () { location.href = a.href; }, window.XM_OUTRO_MS || 1200);
      });
      window.addEventListener('pageshow', function (e) {
        if (e.persisted && leaving) { leaving = false; root.style.setProperty('--xs', String(xs)); root.classList.add('xm-now'); root.classList.remove('xm-pre'); void root.offsetWidth; root.classList.remove('xm-now'); }
      });
    }

    function snow(host) {
      var cv = document.createElement('canvas'); cv.className = 'xm-snow'; cv.setAttribute('aria-hidden', 'true');
      host.appendChild(cv);
      var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2), flakes = [], run = false, raf = 0;
      function size() {
        W = host.clientWidth; H = host.clientHeight;
        cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.min(110, Math.round(W * H / (W < 600 ? 12000 : 9000)));
        flakes = [];
        for (var i = 0; i < n; i++) { var r = .8 + Math.random() * 2.4; flakes.push({ x: Math.random() * W, y: Math.random() * H, r: r, b: Math.min(3, Math.floor((r - .8) / .6)), v: .25 + Math.random() * .8, p: Math.random() * 6.28, s: .004 + Math.random() * .012 }); }
        if (reduce) draw();
      }
      function draw() {
        ctx.clearRect(0, 0, W, H);
        /* Flocken in vier Helligkeitsgruppen: vier Zeichenaufrufe statt einer pro Flocke (ruhiger, gleiche Optik) */
        ctx.fillStyle = '#FFFFFF';
        for (var b = 0; b < 4; b++) {
          ctx.globalAlpha = Math.min(.95, .35 + (.8 + (b + .5) * .6) * .22);
          ctx.beginPath();
          for (var i = 0; i < flakes.length; i++) {
            var f = flakes[i];
            if (f.b !== b) continue;
            ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, 6.2832);
          }
          ctx.fill();
        }
      }
      function tick() {
        for (var i = 0; i < flakes.length; i++) {
          var f = flakes[i];
          f.y += f.v * (f.r * .55 + .4); f.p += f.s; f.x += Math.sin(f.p) * .45;
          if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
          if (f.x > W + 4) f.x = -4; else if (f.x < -4) f.x = W + 4;
        }
        draw();
        if (run) raf = requestAnimationFrame(tick);
      }
      size();
      var rs; window.addEventListener('resize', function () { clearTimeout(rs); rs = setTimeout(size, 200); });
      if (reduce) return;
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
          var on = es[0].isIntersecting;
          if (on && !run) { run = true; raf = requestAnimationFrame(tick); }
          else if (!on) { run = false; cancelAnimationFrame(raf); }
        }, { threshold: 0 }).observe(host);
      } else { run = true; tick(); }
    }
  });
})();
