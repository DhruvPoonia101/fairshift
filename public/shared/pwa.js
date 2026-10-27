/** Registers the static-asset service worker where supported (secure contexts only). */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline caching is an extra; the app works the same without it.
    });
  });
}
