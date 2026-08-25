const VERSION = 'recibos-pocket-v2';
const FILES = ['./index.html','./app.js','./printer.js','./manifest.json'];

self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)));
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==VERSION).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  e.respondWith(
    fetch(e.request).catch(()=>caches.match(e.request))
  );
});
