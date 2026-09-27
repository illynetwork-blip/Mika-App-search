/* Zoom-Zoom — service worker : appli disponible hors ligne + cartes déjà vues en cache */
const VERSION = 'mika-v37';
const SHELL = ['./', './index.html', './manifest.webmanifest', './logo.svg', './zz-icon-192.png', './zz-icon-512.png', './rome-dare.json', './rome-plus.json', './medieval-routes.json',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'];
const TILE_HOSTS = /data\.geopf\.fr\/wmts|tile\.openstreetmap\.org|arcgisonline\.com|dh\.gu\.se|opentopomap\.org|geoservices\.brgm\.fr|upload\.wikimedia\.org/;
const MAX_TILES = 300;
let trimT = null;
const NO_CORS = new Set();   // serveurs de cartes qui refusent la lecture « cors » : images affichées sans être gardées

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(VERSION) && k !== 'zz-offline').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// nettoyage groupé, 4 s après la dernière tuile (et pas à chaque tuile)
function trim(cache){
  clearTimeout(trimT);
  trimT = setTimeout(async () => { try { const keys = await cache.keys(); for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]); } catch (e) {} }, 4000);
}
// Chargement fluide, même avec un réseau faible sur le terrain :
//  · page de l'appli : réseau d'abord mais au plus 2,5 s, sinon la copie en cache (et mise à jour en arrière-plan) ;
//  · Leaflet (version figée) et polices : cache d'abord ;
//  · données (json, logo, icônes) : copie en cache tout de suite, rafraîchie en arrière-plan.
const IMMUTABLE = /cdnjs\.cloudflare\.com\/ajax\/libs\/|fonts\.(googleapis|gstatic)\.com/;
function put(req, r){ if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = req.url;
  if (TILE_HOSTS.test(url)) {           // tuiles : cache d'abord
    e.respondWith(caches.open(VERSION + '-tiles').then(async c => {
      const hit = await caches.match(req); if (hit) return hit;   // cache des cartes vues + zones gardées hors ligne
      // demande « cors » d'abord : une réponse lisible pèse son vrai poids dans le stockage
      // (une réponse opaque compte pour plusieurs Mo et remplirait l'appareil) ; sinon image affichée sans être gardée
      const host = new URL(url).host;
      if (!NO_CORS.has(host)) {
        try { const r = await fetch(req.url, {mode: 'cors', credentials: 'omit'}); if (r.ok) { c.put(req, r.clone()).then(() => trim(c), () => null); return r; } }
        catch (err) { NO_CORS.add(host); }
      }
      try { return await fetch(req); }
      catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  if (IMMUTABLE.test(url)) {
    e.respondWith(caches.match(req).then(h => h || fetch(req).then(r => put(req, r))));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(new Promise(res => {
      let done = false; const net = fetch(req).then(r => put(req, r));
      const fallback = () => caches.match(req, {ignoreSearch: true}).then(h => h || caches.match('./index.html')).then(h => { if (h && !done) { done = true; res(h); } return h; });
      const t = setTimeout(fallback, 2500);
      net.then(r => { clearTimeout(t); if (!done) { done = true; res(r); } })
         .catch(() => { clearTimeout(t); fallback().then(h => { if (!done) { done = true; res(h || Response.error()); } }); });
    }));
    return;
  }
  if (SHELL.some(s => url.endsWith(s.replace('./', '/')))) {
    e.respondWith(caches.match(req).then(h => { const net = fetch(req).then(r => put(req, r)).catch(() => h); return h || net; }));
  }
});
