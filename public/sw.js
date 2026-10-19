/* Minimal compatibility worker. It intentionally avoids caching legal pages,
   dashboards, API responses, or customer documents. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
