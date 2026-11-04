/* API destination for the NEW test backend.
   After creating the separate Render service, replace the placeholder below
   with that service's assigned https://....onrender.com URL.
   Do not use the old website's Render service URL here. */
(() => {
  const localHosts = new Set(['localhost', '127.0.0.1']);
  const isLocal = localHosts.has(window.location.hostname);
  const testApi = 'https://REPLACE-WITH-NEW-RENDER-SERVICE.onrender.com';
  window.AIO_API_BASE = isLocal ? '' : testApi;
})();
