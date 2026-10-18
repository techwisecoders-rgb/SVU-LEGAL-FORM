# Asset and third-party licensing notes

- The visual website references two real-estate photographs from the Unsplash image CDN in CSS: `photo-1600585154340-be6161a56a0c` on the homepage and `photo-1600607687939-ce8a6c25118c` on service/knowledge detail pages. They are loaded remotely and are not bundled into the ZIP. Before public launch, verify the specific image pages and current license/terms, retain the source URL and proof of review, or replace them with imagery the company owns or has expressly licensed. Avoid hotlinking in production without reviewing provider terms, privacy disclosures and performance impact.
- Icons are from `lucide-react`; check the package's published license and retain required notice if its terms require it.
- Fonts are requested from Google Fonts using CSS and have local serif/sans-serif fallbacks; font files are not bundled.
- Brand icons (`apps/web/app/icon.svg`, `apps/web/public/favicon.ico`) are original simple SVU-inspired artwork made for this project. `apps/web/public/sw.js` intentionally has no caching logic and avoids caching legal pages, dashboards, API responses or customer documents.
- Do not add client property images, case files, scanned deeds or other user uploads to the public `public/` folder or to source control.
