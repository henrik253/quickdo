#!/usr/bin/env bash
# launchd entry point for Quickdo (docs/CONTRACTS.md §5, docs/PLAN.md D13).
#
#   1. cd to the checkout
#   2. if the working tree is clean: fetch origin/stable (best effort, 15 s) and fast-forward to it
#   3. npm ci only when package-lock.json changed since the last recorded build
#   4. build into dist.next/ and swap into dist/ only on success (previous build kept as dist.prev/)
#   5. exec node dist/server.js  — exit code 75 from the server means "restart me"; launchd's
#      KeepAlive does exactly that, which is how a merged PR reaches the running app.
#
# Every update step is best effort: whatever fails, the old dist/ keeps serving.
set -euo pipefail

cd "$(dirname "$0")/.."
CHECKOUT="$(pwd)"
NODE="${QUICKDO_NODE:-node}"
STATE_DIR="${QUICKDO_STATE_DIR:-${QUICKDO_HOME:-$HOME}/.local/state/quickdo}"
BUILT_SHA_FILE="$STATE_DIR/built-sha"
BRANCH="${QUICKDO_STABLE_BRANCH:-stable}"
export GIT_TERMINAL_PROMPT=0

log() { printf '{"ts":"%s","level":"info","msg":"run.sh: %s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { printf '{"ts":"%s","level":"warn","msg":"run.sh: %s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

# `timeout` is not on macOS by default; run a command with a deadline using a background watchdog.
with_timeout() {
  local secs="$1"
  shift
  "$@" &
  local pid=$!
  (
    sleep "$secs"
    kill "$pid" 2>/dev/null || true
  ) &
  local watchdog=$!
  local rc=0
  wait "$pid" || rc=$?
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  return "$rc"
}

mkdir -p "$STATE_DIR"

# ---- 2. pull stable (only on a clean tree, only fast-forward) --------------------------------
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [ "${QUICKDO_NO_PULL:-0}" != "1" ]; then
  if [ -z "$(git status --porcelain)" ]; then
    if with_timeout 15 git fetch --quiet origin "$BRANCH" 2>/dev/null; then
      local_sha="$(git rev-parse HEAD)"
      remote_sha="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")"
      if [ -n "$remote_sha" ] && [ "$remote_sha" != "$local_sha" ] && git merge-base --is-ancestor "$local_sha" "$remote_sha"; then
        log "origin/$BRANCH is ahead (${local_sha:0:7} -> ${remote_sha:0:7}), pulling"
        if git pull --ff-only --quiet origin "$BRANCH"; then
          log "now at $(git rev-parse --short HEAD)"
        else
          warn "git pull --ff-only failed; keeping ${local_sha:0:7}"
        fi
      fi
    else
      warn "git fetch origin $BRANCH failed or timed out; staying on the current commit"
    fi
  else
    log "working tree is dirty; skipping pull"
  fi
fi

# ---- 3./4. build when the code changed since the last recorded build ------------------------
head_sha="$(git rev-parse HEAD 2>/dev/null || echo "no-git")"
built_sha="$(cat "$BUILT_SHA_FILE" 2>/dev/null || echo "")"

if [ ! -f dist/server.js ] || [ "$head_sha" != "$built_sha" ] || [ "${QUICKDO_FORCE_BUILD:-0}" = "1" ]; then
  log "building ${head_sha:0:7} (last built: ${built_sha:0:7})"
  need_ci=0
  if [ ! -d node_modules ]; then
    need_ci=1
  elif [ -n "$built_sha" ] && [ "$head_sha" != "no-git" ] && git cat-file -e "$built_sha" 2>/dev/null; then
    if ! git diff --quiet "$built_sha" "$head_sha" -- package-lock.json; then need_ci=1; fi
  fi
  build_ok=1
  if [ "$need_ci" = "1" ]; then
    log "package-lock.json changed, running npm ci"
    if ! npm ci --no-audit --no-fund; then
      warn "npm ci failed"
      build_ok=0
    fi
  fi
  if [ "$build_ok" = "1" ]; then
    rm -rf dist.next
    if npm run build:web -- --outDir dist.next/web \
      && npm run build:server -- --outfile=dist.next/server.js; then
      rm -rf dist.prev
      if [ -d dist ]; then mv dist dist.prev; fi
      mv dist.next dist
      printf '%s\n' "$head_sha" >"$BUILT_SHA_FILE"
      log "build ok, swapped into dist/ (previous kept as dist.prev/)"
    else
      warn "build failed; keeping the previous dist/"
      rm -rf dist.next
    fi
  fi
fi

if [ ! -f dist/server.js ]; then
  warn "no dist/server.js to run; run 'npm run build' by hand"
  exit 1
fi

# ---- 5. run --------------------------------------------------------------------------------
log "starting $NODE $CHECKOUT/dist/server.js"
exec "$NODE" dist/server.js
