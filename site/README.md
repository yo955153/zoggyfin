# Zoggyfin website

The static pages for `zoggyfin.zog-tech.com`. The App Store listing links to them.

| Path | File |
|---|---|
| `/` | `public/index.html` |
| `/privacy` | `public/privacy/index.html` |
| `/support` | `public/support/index.html` |
| any other path | `public/404.html` |

All pages use the one stylesheet `public/style.css`. The pages are plain HTML: no build
step, no scripts, no external requests. The Content-Security-Policy in `nginx.conf` blocks
scripts and external files, so change it if a page needs more. Add a page as
`public/<name>/index.html`; nginx serves it at `/<name>`.

Rules: no personal names or personal domains. The owner is Zog Tech, Inc. The contact is
admin@zog-tech.com.

## Run and deploy

- Local: `docker compose up -d` in this folder serves the pages with nginx on port 8798.
- Production: the server has a checkout of this repository, registered as the app
  `zoggyfin-site` of the `zog` deploy CLI (compose file `site/docker-compose.yml`, project
  `zoggyfin-site`). Push to `main`, then run `zog deploy zoggyfin-site` on the server.
  The container mounts `public/` and `nginx.conf` read-only, so a deploy needs no image build.
  After a change to `nginx.conf`, also run `docker restart zoggyfin-site`.
- The Cloudflare tunnel sends `zoggyfin.zog-tech.com` to port 8798 on the server.
