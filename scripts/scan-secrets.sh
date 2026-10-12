#!/usr/bin/env bash
# Scans the working tree (tracked + untracked, excluding .env and node_modules) and
# the full git history for common credential patterns. Prints file/commit and
# pattern name only, never the matched value. Exit 1 if anything is found.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERNS=(
  'github_pat_[A-Za-z0-9_]{20,}'
  'gh[pousr]_[A-Za-z0-9]{30,}'
  'AIza[0-9A-Za-z_-]{30,}'
  're_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}'
  'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)
found=0
for p in "${PATTERNS[@]}"; do
  # Working tree
  if files=$(git ls-files -co --exclude-standard | grep -v -E '^(\.env|.*\.env\.local)$' | xargs -I{} grep -lE -- "$p" {} 2>/dev/null); then
    if [ -n "$files" ]; then echo "Working tree match for pattern '${p:0:16}…' in: $files"; found=1; fi
  fi
  # Full history (all refs)
  if commits=$(git log --all -G"$p" --format='%h' 2>/dev/null | sort -u | tr '\n' ' '); then
    if [ -n "${commits// /}" ]; then echo "History match for pattern '${p:0:16}…' in commits: $commits"; found=1; fi
  fi
done
if [ "$found" -eq 0 ]; then echo "No secrets found in the working tree or git history ($(git rev-list --all --count) commits scanned)."; fi
exit $found
