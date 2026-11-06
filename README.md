# 🕸️ webcatcher

Capturador de enlaces al estilo LinkGrabber de JDownloader 2, en el navegador. Pegas URLs de páginas, el Worker las lee y devuelve los enlaces; filtras por hoster y tipo, seleccionas, copias o exportas `.txt`.

- Sitio: https://cipinzas-hash.github.io/webcatcher/
- Worker: `worker/` (Cloudflare, plan gratuito). Se despliega solo al tocar `worker/**` (secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`).
- Hosters: constante `HOSTERS` en `index.html`.

Límites: no lee páginas que arman enlaces con JavaScript, ni con login/captcha. Algunos sitios bloquean peticiones de servidores. Para los hosters, el tipo de archivo casi siempre es desconocido.
