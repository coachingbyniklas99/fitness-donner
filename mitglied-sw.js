/* Dienst-Worker des Mitgliederbereichs: zeigt Mitteilungen an (mehr macht er nicht). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Fitness Donner', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/favicon-96x96.png',
    data: { url: d.url || '/mitglied.html' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/mitglied.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf('/mitglied') !== -1 && 'focus' in c) {
        if ('navigate' in c) return c.navigate(url).then(function (x) { return (x || c).focus(); }).catch(function () { return c.focus(); });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
