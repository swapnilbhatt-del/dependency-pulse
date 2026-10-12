#!/usr/bin/env bash
# Copies secrets from .env into the linked Vercel project (Production + Preview)
# without echoing any value. Requires: `vercel login` and `vercel link`.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env file"; exit 1; }
KEYS=(DATABASE_URL GITHUB_TOKEN GEMINI_API_KEY RESEND_API_KEY ADMIN_PASSWORD SESSION_SECRET CRON_SECRET DIGEST_RECIPIENTS)
for key in "${KEYS[@]}"; do
  val=$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- || true)
  if [ -z "$val" ]; then echo "skip  $key (empty in .env)"; continue; fi
  for target in production preview; do
    vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$val" | vercel env add "$key" "$target" --sensitive >/dev/null 2>&1 \
      || printf '%s' "$val" | vercel env add "$key" "$target" >/dev/null
  done
  echo "set   $key (production, preview)"
done
