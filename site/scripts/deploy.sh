#!/usr/bin/env bash
# Deploy site/ to Cloudflare Pages (project zoggyfin-site). Used by `pnpm site:deploy` and CI.
# Needs CLOUDFLARE_API_TOKEN (Account > Cloudflare Pages > Edit) and CLOUDFLARE_ACCOUNT_ID.
# Locally they come from ~/.config/zoggyfin-site/cloudflare.env (not in git).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ZOGGYFIN_SITE_ENV:-$HOME/.config/zoggyfin-site/cloudflare.env}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN or create $ENV_FILE}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID or create $ENV_FILE}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

WRANGLER=(pnpm dlx wrangler@4.151.2)
PROJECT=zoggyfin-site

# The first deploy creates the project.
if ! "${WRANGLER[@]}" pages project list 2>/dev/null | grep -qw "$PROJECT"; then
  "${WRANGLER[@]}" pages project create "$PROJECT" --production-branch main
fi

"${WRANGLER[@]}" pages deploy public --project-name "$PROJECT" --branch main \
  --commit-dirty=true
