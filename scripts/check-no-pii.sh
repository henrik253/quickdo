#!/usr/bin/env bash
# Privacy guard (docs/PLAN.md §4): fail if any tracked file contains a shape that only personal data has.
#   - Google / Outlook private ICS URLs
#   - GitHub tokens (classic and fine-grained)
#   - absolute home paths (docs must write ~/quickdo)
#   - e-mail addresses outside example.com
#   - anything in the optional, git-ignored local deny list ~/.config/quickdo/pii-denylist.txt
# Usage: scripts/check-no-pii.sh [repo-dir]      exit 1 and print the offending lines on a hit.
#
# The patterns are assembled from fragments so this script never matches itself. A line that documents
# the guard (it names `check-no-pii`) or carries the marker `pii:allow` is exempt — for pattern descriptions
# in docs, never for real data.
set -euo pipefail

REPO="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$REPO"
HOME_DIR="${QUICKDO_HOME:-$HOME}"
DENYLIST="$HOME_DIR/.config/quickdo/pii-denylist.txt"

g="calendar.google"
o="outlook"
users_root="/Us"
users_root="${users_root}ers/"
tok_classic="gh"
tok_classic="${tok_classic}p_"
tok_fine="github_"
tok_fine="${tok_fine}pat_"

PATTERNS=(
  "${g}\.com/calendar/ical"
  "${o}\.office365\.com/owa"
  "${o}\.live\.com/owa"
  "private-[0-9a-f]{32}"
  "${tok_classic}[A-Za-z0-9]{20,}"
  "${tok_fine}"
  "${users_root}[a-z]+/"
)
EMAIL='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
ALLOWED_EMAIL='@([A-Za-z0-9-]+\.)*example\.com$'
EXEMPT='check-no-pii|pii:allow'

# Tracked files only; binaries are skipped by grep -I. package-lock.json carries registry URLs, not PII.
files=()
while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  case "$f" in package-lock.json) continue ;; esac
  files+=("$f")
done < <(git ls-files -z)

if [ "${#files[@]}" -eq 0 ]; then
  echo "check-no-pii: no tracked files"
  exit 0
fi

hits=0
report() {
  # $1 = label, $2 = "file:line:match" lines (may be empty)
  local label="$1" out="$2" line
  [ -n "$out" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    printf 'PII (%s): %s\n' "$label" "$line"
    hits=$((hits + 1))
  done <<<"$out"
}

for p in "${PATTERNS[@]}"; do
  report "$p" "$(grep -HInE -- "$p" "${files[@]}" 2>/dev/null | grep -vE -- "$EXEMPT" || true)"
done

email_hits=""
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  loc="${hit%%:*}"
  rest="${hit#*:}"
  ln="${rest%%:*}"
  content="${rest#*:}"
  bad="$(printf '%s' "$content" | grep -oE -- "$EMAIL" | grep -vE -- "$ALLOWED_EMAIL" | tr '\n' ' ' || true)"
  [ -n "$bad" ] && email_hits="${email_hits}${loc}:${ln}:${bad% }"$'\n'
done <<<"$(grep -HInE -- "$EMAIL" "${files[@]}" 2>/dev/null | grep -vE -- "$EXEMPT" || true)"
report "email outside example.com" "$email_hits"

if [ -f "$DENYLIST" ]; then
  while IFS= read -r p || [ -n "$p" ]; do
    [ -n "$p" ] || continue
    case "$p" in '#'*) continue ;; esac
    report "denylist" "$(grep -HInE -- "$p" "${files[@]}" 2>/dev/null | grep -vE -- "$EXEMPT" || true)"
  done <"$DENYLIST"
fi

if [ "$hits" -gt 0 ]; then
  echo "check-no-pii: $hits hit(s) — remove the personal data before committing"
  exit 1
fi
echo "check-no-pii: clean (${#files[@]} tracked files)"
