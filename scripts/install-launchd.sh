#!/usr/bin/env bash
# Arm (or disarm) the twice-daily evolve cycle (08:00 and 20:00) as a macOS LaunchAgent.
#   scripts/install-launchd.sh            # install / update
#   scripts/install-launchd.sh --remove   # uninstall
# If the Mac is asleep at a run time, launchd runs the job when it wakes. A cycle that's
# still running when the next one fires makes the new one exit (evolve.lock).
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
  <array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$HOME/beobeo-sim/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/beobeo-sim/logs/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>HOME</key><string>$HOME</string></dict>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Armed $LABEL — 08:00 and 20:00 daily. Check: launchctl print gui/$(id -u)/$LABEL | head"
