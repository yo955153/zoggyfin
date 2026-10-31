# Zoggyfin website

The static pages for `zoggyfin.zog-tech.com`. The App Store listing links to them.

| Path | File |
|---|---|
| `/` | `public/index.html` |
| `/download` | `public/download/index.html` (Mac DMG, TV APK, TestFlight) |
| `/tv.apk` | a 302 to the newest Android TV APK (`public/_redirects`), the short address to type on a TV |
| `/join` | `public/join/index.html` (invite links; see below) |
| `/.well-known/apple-app-site-association` | iOS universal links for `/join*` |
| `/.well-known/assetlinks.json` | Android App Links (release signing certificate) |
| `/privacy` | `public/privacy/index.html` |
| `/support` | `public/support/index.html` |
| any other path | `public/404.html` |

All pages use the one stylesheet `public/style.css` (tokens from `docs/design/theme.ts`,
dark and light from `prefers-color-scheme`, a toggle that `public/theme.js` and
`public/site.js` keep in `localStorage`). The pages are plain HTML: no build step and no
external requests. Fonts are self-hosted (`public/fonts/`, Inter, SIL OFL; used only where
the system font is not SF). Screenshots are in `public/img/` as AVIF and WebP at two widths
each; they show only public demo content (Blender films, demo music). `public/img/og.jpg`
is the 1200 x 630 social card. `robots.txt`, `sitemap.xml` and `site.webmanifest` are in
`public/`. Scripts come from the same origin only. `public/download/download.js` reads
`/download/latest.json` and shows the newest Mac version and its notes. nginx serves that
file from the update feed (`https://releases.zog-tech.com/zoggyfin/latest.json`). The TV section
reads `/download/tv-latest.json` the same way, from the Android TV feed
(`https://releases.zog-tech.com/zoggyfin/android-tv/latest.json`, written by
`scripts/release-android-tv.sh`). So the
page needs no change for a new release. The Content-Security-Policy in `nginx.conf` allows
scripts and requests from the same origin only. Add a page as
`public/<name>/index.html`; nginx serves it at `/<name>`.

The `/join` page reads the invite from the URL fragment in the browser and sends
nothing. `public/join/join-core.js` has the logic and has unit tests
(`src/invite/__tests__/join-page.test.ts`).

`public/config.js` is the one place for store and download links on every page (`/`,
`/download`, `/join`). Set `appStoreUrl` when the App Store listing exists, and `androidUrl`
when an Android build exists. `tvApkUrl` is the stable link of the newest TV APK; set `tvPlayUrl` when
the Google Play listing of the TV app exists, and the page shows its button. Links in the HTML default to TestFlight and "coming soon", so
the pages work without the file. `public/join/qrcode.js`
is qrcode-generator (MIT). `public/_headers` (and `nginx.conf`) serve the two
`.well-known` files as `application/json` with no redirect.

Rules: no personal names or personal domains. The owner is Zog Tech, Inc. The contact is
admin@zog-tech.com.

## Run and deploy

The site moves from a self-hosted nginx to Cloudflare Pages (project `zoggyfin-site`).
Until the switch, the old nginx files (`nginx.conf`, `docker-compose.yml`) stay here.

- `wrangler.toml` names the Pages project. `public/` is the output folder; there is no build.
- `public/_headers` sets the security headers, the cache rules and the JSON type of the
  `.well-known` files. `public/_redirects` serves `/download`, `/join`, `/privacy` and
  `/support` with status 200 and no redirect to a trailing slash. Add a line there for a new page.
- `functions/download/latest.json.js` serves the Mac update feed at `/download/latest.json`, and
  `functions/download/tv-latest.json.js` the Android TV feed at `/download/tv-latest.json`.
- Local: `pnpm dlx wrangler@4.151.2 pages dev` in this folder serves the site on port 8788.
- Deploy on push: `.github/workflows/site.yml` deploys when a push to `main` changes `site/`.
  It uses the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Manual deploy: `pnpm site:deploy`. It reads the token from
  `~/.config/zoggyfin-site/cloudflare.env` (`CLOUDFLARE_API_TOKEN=...` and
  `CLOUDFLARE_ACCOUNT_ID=...`, not in git). The first deploy creates the project.
- The token needs the permission Account > Cloudflare Pages > Edit.
