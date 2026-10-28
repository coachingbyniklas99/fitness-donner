/* Mitteilungen aufs Handy: Anmelden, Testen, Ausschalten (Dienst-Worker: admin-sw.js) */
(function () {
  var A = window.FD_ADMIN;
  var box = document.getElementById('pushBox');
  if (!A || !box) return;

  var reg = null, serverKey = '';

  function b64uToBytes(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sameKey(buf, bytes) {
    if (!buf) return false;
    var a = new Uint8Array(buf);
    if (a.length !== bytes.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  }

  function show(html) { box.innerHTML = html; box.hidden = false; }
  function link(id, text) { return '<button type="button" class="ad-pushlink" id="' + id + '">' + text + '</button>'; }

  function renderUnsupported() {
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    show('<span>Mitteilungen gehen nur in der App auf dem Home-Bildschirm' + (ios ? ' (Safari: Teilen → „Zum Home-Bildschirm“).' : '.') + '</span>');
  }
  function renderOff() {
    show(link('pushOn', 'Mitteilungen einschalten') + '<span class="ad-pushhint">Du bekommst eine Meldung bei neuer Buchung, Verschiebung, Verkauf und Widerruf.</span>');
    document.getElementById('pushOn').onclick = einschalten;
  }
  function renderDenied() {
    show('<span>Mitteilungen sind blockiert. iPhone: Einstellungen → Mitteilungen → „FD Verwaltung“ → Mitteilungen erlauben.</span>');
  }
  function renderOn() {
    show('<span class="ad-pushon">Mitteilungen an</span>' + link('pushTest', 'Test senden') + link('pushOff', 'Ausschalten'));
    document.getElementById('pushTest').onclick = testen;
    document.getElementById('pushOff').onclick = ausschalten;
  }

  function senden(sub) {
    return A.api('push/subscribe', { body: { subscription: sub.toJSON(), ua: navigator.userAgent } });
  }

  function einschalten() {
    var b = document.getElementById('pushOn');
    if (b) { b.disabled = true; b.textContent = 'Moment …'; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { A.note('Ohne Erlaubnis gibt es keine Mitteilungen.', true); return pruefen(); }
      return reg.pushManager.getSubscription().then(function (old) {
        return old ? old : reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(serverKey) });
      }).then(senden).then(function () {
        A.note('Mitteilungen sind an. Ich schicke dir gleich eine Testmeldung.');
        renderOn();
        return A.api('push/test', { body: {} });
      });
    }).catch(function (e) {
      A.note('Das hat nicht geklappt: ' + (e && e.message ? e.message : e), true);
      pruefen();
    });
  }

  function testen() {
    A.api('push/test', { body: {} }).then(function (r) {
      A.note(r.gesendet ? 'Testmeldung ist unterwegs.' : 'Kein Gerät erreicht. Schalte die Mitteilungen aus und wieder ein.', !r.gesendet);
    }).catch(function (e) { A.note(e.message, true); });
  }

  function ausschalten() {
    reg.pushManager.getSubscription().then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return A.api('push/unsubscribe', { body: { endpoint: ep } }); });
    }).then(function () { A.note('Mitteilungen sind aus.'); pruefen(); })
      .catch(function (e) { A.note(e.message, true); });
  }

  function pruefen() {
    if (Notification.permission === 'denied') return renderDenied();
    reg.pushManager.getSubscription().then(function (sub) {
      if (sub && Notification.permission === 'granted') {
        if (!sameKey(sub.options && sub.options.applicationServerKey, b64uToBytes(serverKey))) {
          // Server-Schlüssel hat sich geändert: altes Abo verwerfen
          return sub.unsubscribe().then(renderOff);
        }
        senden(sub).catch(function () {});   // Server auf dem Laufenden halten
        return renderOn();
      }
      renderOff();
    });
  }

  function init() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return renderUnsupported();
    navigator.serviceWorker.register('/admin-sw.js').then(function () {
      return navigator.serviceWorker.ready;
    }).then(function (r) {
      reg = r;
      return A.api('push/key');
    }).then(function (d) {
      serverKey = d.key;
      pruefen();
    }).catch(function (e) {
      if (e && e.message === 'abgemeldet') return;
      show('<span>Mitteilungen sind gerade nicht verfügbar (' + (e && e.message ? e.message : 'unbekannter Fehler') + ').</span>' + link('pushRetry', 'Nochmal versuchen'));
      document.getElementById('pushRetry').onclick = init;
    });
  }

  window.FDPush = { init: init };
  // Schon angemeldet (Token gespeichert)? Dann läuft start() vor diesem Skript.
  var app = document.getElementById('app');
  if (app && !app.hidden) init();
})();
