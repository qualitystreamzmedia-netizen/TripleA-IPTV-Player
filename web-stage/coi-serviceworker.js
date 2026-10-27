if (typeof window === 'undefined') {
  // --- service worker --------------------------------------------------------
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    // Live TV is an endless response. Wrapping it here buffers until the
    // station hangs up, so the picture never starts and the player restarts.
    let path = '';
    try { path = new URL(req.url).pathname; } catch (e) { path = ''; }
    if (path === '/api/media' || path.indexOf('/api/media/') === 0) return;
    event.respondWith((async () => {
      const res = await fetch(req);
      if (res.status === 0) return res; // opaque: cannot be modified
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      // credentialless lets cross-origin images/media load without CORP headers.
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    })().catch(() => fetch(req)));
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator) {
  // --- page --------------------------------------------------------------------
  const key = 'libvlc-wasm-coi-reloaded';
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    const reload = () => {
      // Only once: if isolation still fails (e.g. an extension strips headers),
      // do not loop.
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      location.reload();
    };
    if (reg.active && !navigator.serviceWorker.controller) reload();
    else reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', (e) => { if (e.target.state === 'activated') reload(); });
    });
  }).catch((e) => console.warn('libvlc-wasm: could not register the isolation service worker', e));
} else if (window.crossOriginIsolated) {
  try { sessionStorage.removeItem('libvlc-wasm-coi-reloaded'); } catch (e) { /* storage blocked */ }
  // The installed player serves isolation headers itself. A worker left over
  // from an older build still sits on the stream and makes the channel restart.
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      const ours = regs.filter((reg) => (reg.active && reg.active.scriptURL.indexOf('coi-serviceworker') !== -1) || (reg.installing && reg.installing.scriptURL.indexOf('coi-serviceworker') !== -1));
      if (!ours.length) return Promise.resolve();
      return Promise.all(ours.map((reg) => reg.unregister())).then(() => {
        if (sessionStorage.getItem('triplea-sw-dropped')) return;
        sessionStorage.setItem('triplea-sw-dropped', '1');
        location.reload();
      });
    }).catch(() => undefined);
  }
}