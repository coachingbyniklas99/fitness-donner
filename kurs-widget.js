/* Kurs-Widget zum Einbetten auf anderen Seiten (z. B. später Katharinas Website oder New Forge).
 *
 *   <div data-fd-kurse data-anbieterin="niklas"></div>
 *   <script src="https://fitnessdonner.de/kurs-widget.js" async></script>
 *
 * data-anbieterin: niklas | katharina | alle   (alle = gemeinsamer Kursplan, für New Forge)
 * data-kurs:       optional, nur ein bestimmter Kurs
 *
 * Die Buchung läuft in einem iframe von fitnessdonner.de – die einbettende Seite braucht
 * dafür keine Freigabe im Worker. Zur Zahlung wechselt das ganze Fenster zu Stripe.
 */
(function () {
  var BASIS = (document.currentScript && document.currentScript.src)
    ? new URL('.', document.currentScript.src).href
    : 'https://fitnessdonner.de/';
  var boxen = document.querySelectorAll('[data-fd-kurse]');
  Array.prototype.forEach.call(boxen, function (box) {
    if (box.getAttribute('data-fd-geladen')) return;
    box.setAttribute('data-fd-geladen', '1');
    var q = '?embed=1&p=' + encodeURIComponent(box.getAttribute('data-anbieterin') || 'niklas');
    if (box.getAttribute('data-kurs')) q += '&k=' + encodeURIComponent(box.getAttribute('data-kurs'));
    var f = document.createElement('iframe');
    f.src = BASIS + 'kurs-buchen.html' + q;
    f.title = 'Kurse buchen';
    f.loading = 'lazy';
    f.style.cssText = 'width:100%;border:0;min-height:560px;display:block;background:transparent';
    f.setAttribute('allow', 'payment');
    box.appendChild(f);
    window.addEventListener('message', function (e) {
      if (e.source !== f.contentWindow || !e.data || !e.data.fdKurse) return;
      var h = Number(e.data.fdKurse.hoehe);
      if (h > 200 && h < 20000) f.style.height = h + 'px';
    });
  });
})();
