// 1. Päivitysten nopeutus ja välimuistin ohitus
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 2. Push-ilmoituksen vastaanotto ja näyttäminen
self.addEventListener('push', function (event) {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'Uusi ilmoitus saatavilla',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🎯 Työpaikkavahti', options)
  );
});

// 3. Toiminto, kun ilmoitusta klikataan puhelimessa
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Jos sovellus on jo auki taustalla, tuodaan se etualalle ja siirrytään linkkiin
      for (let client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Muussa tapauksessa avataan uusi ikkuna/näkymä
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});