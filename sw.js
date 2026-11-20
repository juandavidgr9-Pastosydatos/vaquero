// Guarda Vaquero en el equipo para que abra sin internet.
// Los datos de los animales NO pasan por aquí: viven en IndexedDB ("vaquero").
// Regla del dominio compartido con Corral: solo se borran cachés que empiecen por "vaquero-".
const CACHE = 'vaquero-v1.1.0';
const FILES = ['./', './index.html', './app.js', './mapa.js', './styles.css', './vendor/xlsx.mini.min.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const llenar = () => caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'}))));
// Cachés de otras apps: no se borran; solo se quitan los archivos guardados con la dirección de Vaquero
// (quedaron ahí cuando por error se publicó Corral en el enlace de Vaquero). Los de Corral no se tocan.
const limpiarAjena = k => caches.open(k).then(c => c.keys().then(rs =>
  Promise.all(rs.filter(r => r.url.startsWith(self.registration.scope)).map(r => c.delete(r)))));
self.addEventListener('install', e => { e.waitUntil(llenar().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.map(k => k.startsWith('vaquero-') ? (k !== CACHE ? caches.delete(k) : null) : limpiarAjena(k))))
    .catch(() => {})
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data === 'skip') self.skipWaiting();
  // Si otra app del mismo dominio borró la caché de Vaquero, se vuelve a llenar.
  if (e.data === 'revisar') e.waitUntil(caches.has(CACHE).then(ok => ok || llenar()).catch(() => {}));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true, cacheName: CACHE}).then(hit => hit || fetch(e.request).catch(() =>
      e.request.mode === 'navigate' ? caches.match('./index.html', {cacheName: CACHE}) : Response.error()))
  );
});
