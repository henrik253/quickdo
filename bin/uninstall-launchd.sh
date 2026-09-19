#!/usr/bin/env bash
# Remove the Quickdo launchd login agent. Data (~/quickdo-data) and config (~/.config/quickdo) stay.
set -euo pipefail

LABEL="io.github.henrik253.quickdo"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL"
  echo "stopped and unloaded $LABEL"
else
  echo "$LABEL was not loaded"
fi
if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "removed $PLIST"
fi
echo "logs kept in $HOME/Library/Logs/quickdo/ (delete them yourself if you like)"
