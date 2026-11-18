// Guarda Vaquero en el equipo para que abra sin internet.
// Los datos de los animales NO pasan por aquí: viven en IndexedDB ("vaquero").
// Regla del dominio compartido con Corral: solo se tocan cachés que empiecen por "vaquero-".
const CACHE = 'vaquero-v1.0.0';
const FILES = ['./', './index.html', './app.js', './styles.css', './vendor/xlsx.mini.min.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const llenar = () => caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'}))));
self.addEventListener('install', e => { e.waitUntil(llenar().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('vaquero-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data === 'skip') self.skipWaiting();
  // Corral 5.2.0 borra cachés ajenas al actualizarse: si falta la de Vaquero, se vuelve a llenar.
  if (e.data === 'revisar') e.waitUntil(caches.has(CACHE).then(ok => ok || llenar()).catch(() => {}));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true, cacheName: CACHE}).then(hit => hit || fetch(e.request).catch(() =>
      e.request.mode === 'navigate' ? caches.match('./index.html', {cacheName: CACHE}) : Response.error()))
  );
});
