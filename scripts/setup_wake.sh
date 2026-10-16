#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# setup_wake.sh — generate the launchd plist for the daily 21:00 scan and
# print (but do NOT run) the pmset commands needed to wake the Mac.
#
# This script ONLY writes a plist file and echoes instructions.
# It never loads/launches launchd and never executes pmset.
# ---------------------------------------------------------------------------
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PLIST="$HERE/com.auryxn.homeworkhub.plist"
LABEL="com.auryxn.homeworkhub"
SCAN="$HERE/daily_scan.sh"
NODE_BIN="/usr/local/bin/node"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCAN}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT}</string>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>21</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>${ROOT}/data/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT}/data/logs/launchd.err.log</string>

  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST_EOF

echo "Wrote plist: $PLIST"
echo
echo "Install (run manually when ready — NOT done by this script):"
echo "  cp \"$PLIST\" ~/Library/LaunchAgents/${LABEL}.plist"
echo "  launchctl load ~/Library/LaunchAgents/${LABEL}.plist"
echo "  launchctl list | grep homeworkhub"
echo
echo "Uninstall:"
echo "  launchctl unload ~/Library/LaunchAgents/${LABEL}.plist"
echo "  rm ~/Library/LaunchAgents/${LABEL}.plist"
echo
echo "Schedule a daily wake so the Mac is awake at 21:00 (run manually, needs sudo):"
echo "  sudo pmset repeat wakeorpoweron MTWRFSU 20:58:00   # wake every day 20:58"
echo "  pmset -g sched            # verify"
echo "  sudo pmset repeat cancel  # cancel"
echo
echo "Tip: the 21:00 job only works if the OpenClaw browser (Teams) is running."
exit 0
