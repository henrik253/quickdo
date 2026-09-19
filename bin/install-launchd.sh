#!/usr/bin/env bash
# Install Quickdo as a launchd login agent (docs/CONTRACTS.md §5, docs/SETUP.md).
# usage: bin/install-launchd.sh [checkout-path]   (default: the repo this script lives in)
set -euo pipefail

LABEL="io.github.henrik253.quickdo"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT="$(cd "${1:-$SCRIPT_DIR/..}" && pwd)"
TEMPLATE="$CHECKOUT/launchd/$LABEL.plist.template"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/quickdo"
DOMAIN="gui/$(id -u)"

if [ "$(uname)" != "Darwin" ]; then
  echo "launchd is macOS only" >&2
  exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "template not found: $TEMPLATE" >&2
  exit 1
fi
if [ ! -f "$CHECKOUT/bin/run.sh" ]; then
  echo "not a Quickdo checkout: $CHECKOUT (bin/run.sh missing)" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node is not on PATH; install Node 20.19 (nvm install) and run this again" >&2
  exit 1
fi
NODE="$(cd "$(dirname "$NODE")" && pwd)/$(basename "$NODE")"
NODE_DIR="$(dirname "$NODE")"
AGENT_PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

case "$CHECKOUT" in
  "$HOME/Documents/"* | "$HOME/Desktop/"* | "$HOME/Downloads/"*)
    echo "warning: $CHECKOUT is under a TCC-protected folder; launchd agents get silent permission errors there." >&2
    echo "         Prefer ~/quickdo (see docs/SETUP.md)." >&2
    ;;
esac

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

# Render the template. sed with a delimiter that cannot appear in the paths (|), and escape any & in them.
esc() { printf '%s' "$1" | sed -e 's/[&|]/\\&/g'; }
sed \
  -e "s|__CHECKOUT__|$(esc "$CHECKOUT")|g" \
  -e "s|__NODE__|$(esc "$NODE")|g" \
  -e "s|__PATH__|$(esc "$AGENT_PATH")|g" \
  -e "s|__HOME__|$(esc "$HOME")|g" \
  -e "s|__LOG_DIR__|$(esc "$LOG_DIR")|g" \
  "$TEMPLATE" >"$PLIST"

plutil -lint "$PLIST" >/dev/null

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "unloading the previous agent"
  launchctl bootout "$DOMAIN/$LABEL" || true
  sleep 1
fi
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || true

cat <<MSG
installed $LABEL
  plist     $PLIST
  checkout  $CHECKOUT
  node      $NODE
  logs      $LOG_DIR/quickdo.log  and  $LOG_DIR/quickdo.err.log

check:      launchctl print $DOMAIN/$LABEL | head -20
            tail -f $LOG_DIR/quickdo.log
            curl -s http://127.0.0.1:7777/api/health
uninstall:  $CHECKOUT/bin/uninstall-launchd.sh
MSG
