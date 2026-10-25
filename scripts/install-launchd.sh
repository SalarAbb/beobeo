#!/usr/bin/env bash
# Arm (or disarm) the daily 08:00 evolve cycle as a macOS LaunchAgent.
#   scripts/install-launchd.sh            # install / update
#   scripts/install-launchd.sh --remove   # uninstall
# If the Mac is asleep at 08:00, launchd runs the job when it wakes.
set -euo pipefail
LABEL="dev.beobeo.evolve"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--remove" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"; echo "Removed $LABEL"; exit 0
fi

mkdir -p "$HOME/beobeo-sim/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$REPO/scripts/evolve.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/beobeo-sim/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/beobeo-sim/logs/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>HOME</key><string>$HOME</string></dict>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Armed $LABEL — daily 08:00. Check: launchctl print gui/$(id -u)/$LABEL | head"
