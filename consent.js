/* Fitness Donner – Cookie-Einwilligung + Google-Ads-Conversion-Messung
   Basis-Variante des Google Consent Mode: Das Google-Tag wird erst NACH der Zustimmung geladen.
   Ohne Zustimmung geht nichts an Google, es werden keine Cookies gesetzt.
   Gespeichert wird nur die Entscheidung selbst (localStorage "fd_consent"), das ist technisch notwendig. */
(function () {
  'use strict';

  /* ---- Konfiguration: Google-Ads-Tag und Conversion-Labels ---- */
  var GADS_ID = '';            // z. B. 'AW-123456789' – solange leer, ist alles aus und es erscheint kein Banner
  var LABELS = {               // Conversion-Labels aus Google Ads (Teil nach dem Schrägstrich)
    gutschein: '',             // Gutschein gekauft
    termin: '',                // Probetraining / Einzeltermin gebucht und bezahlt
    karte: '',                 // PT-Karte gekauft
    kurs: ''                   // Kurs gebucht
  };
  var KEY = 'fd_consent', MAX_AGE_DAYS = 365;

  function lesen() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!v || !v.t || (Date.now() - v.t) > MAX_AGE_DAYS * 864e5) return null;
      return v.ads === true ? 'ja' : 'nein';
    } catch (e) { return null; }
  }
  function speichern(ja) {
    try { localStorage.setItem(KEY, JSON.stringify({ ads: !!ja, t: Date.now(), v: 1 })); } catch (e) {}
  }

  /* ---- Google-Tag (nur nach Zustimmung) ---- */
  var geladen = false, warteschlange = [];
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  function ladeTag() {
    if (geladen || !GADS_ID) return;
    geladen = true;
    gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'denied' });
    gtag('js', new Date());
    gtag('config', GADS_ID, { allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GADS_ID);
    document.head.appendChild(s);
    warteschlange.splice(0).forEach(function (f) { f(); });
  }

  /* Conversion melden: fdConversion('gutschein', '119,00 €' | 119 | {cents:11900}, 'Transaktions-ID') */
  function betrag(x) {
    if (x == null) return undefined;
    if (typeof x === 'number') return x;
    if (typeof x === 'object' && x.cents != null) return Number(x.cents) / 100;
    var n = parseFloat(String(x).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    return isNaN(n) ? undefined : n;
  }
  window.fdConversion = function (art, wert, id) {
    if (!GADS_ID || !LABELS[art] || lesen() !== 'ja') return;
    var f = function () {
      var p = { send_to: GADS_ID + '/' + LABELS[art], currency: 'EUR' };
      var w = betrag(wert); if (w != null) p.value = w;
      if (id) p.transaction_id = String(id);
      gtag('event', 'conversion', p);
    };
    if (geladen) f(); else { warteschlange.push(f); ladeTag(); }
  };

  /* ---- Banner ---- */
  var CSS = ''
    + '#fdcb{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:760px;margin:0 auto;background:#1C1F26;color:#ECE9E2;'
    + 'border:1px solid rgba(236,233,226,.14);border-left:3px solid #EFB92E;box-shadow:0 14px 40px rgba(0,0,0,.5);padding:14px 16px;'
    + "display:flex;align-items:center;gap:16px;font-family:'Archivo',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45}"
    + '#fdcb p{margin:0;flex:1;color:#C9CBD0}#fdcb a{color:#ECE9E2;text-decoration:underline}'
    + '#fdcb .fdcb-b{display:flex;gap:8px;flex:none}#fdcb button{min-height:40px;min-width:118px;cursor:pointer;font:inherit;font-weight:700;'
    + 'background:#ECE9E2;color:#15171C;border:2px solid #ECE9E2;padding:8px 14px}'
    + '#fdcb button:hover{background:#EFB92E;border-color:#EFB92E}#fdcb button:focus-visible{outline:3px solid #EFB92E;outline-offset:2px}'
    + '@media(max-width:600px){#fdcb{left:10px;right:10px;bottom:10px;flex-direction:column;align-items:stretch;gap:12px}#fdcb button{flex:1;min-width:0}}';

  function banner() {
    if (!GADS_ID || document.getElementById('fdcb')) return;
    if (!document.getElementById('fdcb-css')) {
      var st = document.createElement('style'); st.id = 'fdcb-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var d = document.createElement('div');
    d.id = 'fdcb'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-live', 'polite'); d.setAttribute('aria-label', 'Cookie-Hinweis');
    d.innerHTML = '<p>Ich nutze Cookies von Google Ads, um zu sehen, ob meine Werbung wirkt. <a href="datenschutz.html#cookies">Mehr erfahren</a></p>'
      + '<div class="fdcb-b"><button type="button" data-w="nein">Ablehnen</button><button type="button" data-w="ja">Akzeptieren</button></div>';
    d.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-w]'); if (!b) return;
      var ja = b.getAttribute('data-w') === 'ja';
      var vorher = lesen();
      speichern(ja);
      d.remove();
      if (ja) ladeTag();
      else if (vorher === 'ja' || geladen) location.reload();   // Widerruf: Tag sofort entladen
    });
    document.body.appendChild(d);
  }
  window.fdCookieEinstellungen = function () { var alt = document.getElementById('fdcb'); if (alt) alt.remove(); banner(); };

  function footerLink() {
    var l = document.querySelector('footer .legal');
    if (!l || l.querySelector('.fdcb-link')) return;
    var a = document.createElement('a');
    a.href = '#cookie-einstellungen'; a.className = 'fdcb-link'; a.textContent = 'Cookie-Einstellungen';
    a.addEventListener('click', function (e) { e.preventDefault(); window.fdCookieEinstellungen(); });
    var dz = l.querySelector('a[href^="datenschutz"]');
    if (dz && dz.nextSibling) l.insertBefore(a, dz.nextSibling); else l.appendChild(a);
  }

  function start() {
    if (!GADS_ID) return;
    footerLink();
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href$="#cookie-einstellungen"]'); if (!a || a.classList.contains('fdcb-link')) return;
      e.preventDefault(); window.fdCookieEinstellungen();
    });
    var w = lesen();
    if (w === 'ja') ladeTag();
    else if (w === null) banner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
