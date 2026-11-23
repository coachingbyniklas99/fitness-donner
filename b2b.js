/* B2B-Seiten (Firmenfitness, Kooperationen): FAQ-Akkordeon und Ablauf-Balken. */
(function () {
  'use strict';

  /* FAQ */
  var fq = document.getElementById('fq');
  if (fq) {
    var host = fq.closest('.fq');
    if (host) host.classList.add('fq-on');
    var items = [].slice.call(fq.querySelectorAll('.fq-i'));
    items.forEach(function (it) {
      var b = it.querySelector('.fq-q');
      b.addEventListener('click', function () {
        var was = it.classList.contains('on');
        items.forEach(function (o) {
          o.classList.remove('on');
          o.querySelector('.fq-q').setAttribute('aria-expanded', 'false');
        });
        if (!was) { it.classList.add('on'); b.setAttribute('aria-expanded', 'true'); }
      });
    });
  }

  /* Ablauf-Balken fuellt sich beim Hineinscrollen */
  var bar = document.getElementById('sabBar');
  if (bar) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (e) {
        if (e[0].isIntersecting) { bar.classList.add('on'); io.disconnect(); }
      }, { threshold: .5 });
      io.observe(bar);
    } else { bar.classList.add('on'); }
  }

})();
