#!/usr/bin/env bash
# Tests for scripts/check-no-pii.sh. Run: bash scripts/check-no-pii.test.sh   (no bats needed)
# Each case builds a throwaway git repo; nothing outside $TMPDIR is touched.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/check-no-pii.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/quickdo-pii.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export QUICKDO_HOME="$TMP/home"
mkdir -p "$QUICKDO_HOME"
pass=0
fail=0

new_repo() {
  local dir="$TMP/$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  echo "$dir"
}

# expect_fail <name> <repo> <expected-substring>
expect_fail() {
  local name="$1" repo="$2" want="$3" out rc=0
  git -C "$repo" add -A
  out="$("$SCRIPT" "$repo" 2>&1)" || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -qF -- "$want"; then
    echo "ok   $name"
    pass=$((pass + 1))
  else
    echo "FAIL $name (rc=$rc, wanted '$want')"
    printf '%s\n' "$out" | sed 's/^/     /'
    fail=$((fail + 1))
  fi
}

expect_pass() {
  local name="$1" repo="$2" out rc=0
  git -C "$repo" add -A
  out="$("$SCRIPT" "$repo" 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "ok   $name"
    pass=$((pass + 1))
  else
    echo "FAIL $name (rc=$rc)"
    printf '%s\n' "$out" | sed 's/^/     /'
    fail=$((fail + 1))
  fi
}

# Bad shapes, assembled from fragments so this test file stays clean itself.
GOOG="calendar.goo"
HEX="0123456789abcdef"
GOOG="${GOOG}gle.com/calendar/ical/alice%40example.com/private-${HEX}${HEX}/basic.ics"
OUTL="https://out"
OUTL="${OUTL}look.office365.com/owa/calendar/abc/reachcalendar.ics"
TOK="ghp"
TOK="${TOK}_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
PAT="github_"
PAT="${PAT}pat_11AAAAAA0abcdef"
USERS="/Us"
USERS="${USERS}ers/alice/quickdo"
MAIL="alice@uni"
MAIL="${MAIL}versity.example.org"

# --- [F-026] a clean tree passes ---------------------------------------------------------------
r="$(new_repo clean)"
cat >"$r/README.md" <<TXT
Contact alice@example.com or bob@mail.example.com. Data lives in ~/quickdo-data. Token: \$GITHUB_TOKEN.
TXT
printf '\x89PNG\r\n\x1a\n\0\0%s' "$USERS" >"$r/icon.png"   # binary files (NUL bytes) are skipped
cat >"$r/GUIDE.md" <<TXT
The guard (check-no-pii) rejects $USERS and $PAT shapes.   # documenting the guard is exempt
Token shapes like $TOK are also rejected. pii:allow
TXT
expect_pass "[F-026] clean tree with example.com emails, ~ paths and a binary passes" "$r"

# --- [F-026] each bad shape fails with the offending line ---------------------------------------
r="$(new_repo google)"; echo "url: $GOOG" >"$r/x.txt"
expect_fail "[F-026] Google ICS URL is caught" "$r" "x.txt:1"

r="$(new_repo outlook)"; echo "url: $OUTL" >"$r/x.txt"
expect_fail "[F-026] Outlook ICS URL is caught" "$r" "x.txt:1"

r="$(new_repo token)"; echo "token = $TOK" >"$r/x.txt"
expect_fail "[F-026] classic GitHub token is caught" "$r" "x.txt:1"

r="$(new_repo pat)"; echo "token = $PAT" >"$r/x.txt"
expect_fail "[F-026] fine-grained GitHub token is caught" "$r" "x.txt:1"

r="$(new_repo users)"; echo "cd $USERS" >"$r/x.txt"
expect_fail "[F-026] absolute home path is caught" "$r" "x.txt:1"

r="$(new_repo mail)"; echo "mail $MAIL" >"$r/x.txt"
expect_fail "[F-026] email outside example.com is caught" "$r" "x.txt:1:$MAIL"

# --- [F-026] untracked files are ignored --------------------------------------------------------
r="$(new_repo untracked)"; echo "ok" >"$r/a.txt"; git -C "$r" add -A; echo "token = $TOK" >"$r/scratch.txt"
out="$("$SCRIPT" "$r" 2>&1)" && { echo "ok   [F-026] untracked files are ignored"; pass=$((pass + 1)); } \
  || { echo "FAIL [F-026] untracked files are ignored"; printf '%s\n' "$out"; fail=$((fail + 1)); }

# --- [F-026] the local deny list adds patterns --------------------------------------------------
mkdir -p "$QUICKDO_HOME/.config/quickdo"
printf '# local identifiers\nLecture Hall 42\n' >"$QUICKDO_HOME/.config/quickdo/pii-denylist.txt"
r="$(new_repo deny)"; echo "meet at Lecture Hall 42" >"$r/x.txt"
expect_fail "[F-026] local deny list pattern is caught" "$r" "denylist"
rm -f "$QUICKDO_HOME/.config/quickdo/pii-denylist.txt"

# --- [F-026] the real repo is clean --------------------------------------------------------------
expect_pass "[F-026] this repository is clean" "$(cd "$HERE/.." && pwd)"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
