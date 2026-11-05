
/* API destination for the new All-in-One Branding Shop backend. */
(() => {
  const localHosts = new Set(['localhost', '127.0.0.1']);
  const isLocal = localHosts.has(window.location.hostname);

  const testApi = 'https://all-in-one-branding-shop-v2.onrender.com';

  window.AIO_API_BASE = isLocal ? '' : testApi;
})();
