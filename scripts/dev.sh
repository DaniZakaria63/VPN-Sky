#!/usr/bin/env bash
# One-command dev runner: ensure Metro is up (detached), enable adb reverse,
# then boot the emulator and install/launch the app.
#
# Usage:
#   bash scripts/dev.sh
#   bash scripts/dev.sh [avd_name]

set -euo pipefail

SDK="${ANDROID_HOME:-/home/dani/Android/Sdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${TMPDIR:-/tmp}/vpnsky-metro.log"
PORT="${RN_METRO_PORT:-8081}"

AVD="${1:-}"
if [[ -z "$AVD" ]]; then
  AVD="Pixel_9_Pro"
fi

if ! curl -s -m 2 "http://localhost:$PORT/status" >/dev/null 2>&1; then
  echo "Metro not running on :$PORT — starting it detached."
  setsid nohup npx react-native start --port "$PORT" \
    >"$LOG" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  echo -n "Waiting for Metro"
  until curl -s -m 2 "http://localhost:$PORT/status" >/dev/null 2>&1; do
    sleep 2
    echo -n "."
  done
  echo ""
else
  echo "Metro already running on :$PORT."
fi

"$SDK/platform-tools/adb" reverse tcp:"$PORT" tcp:"$PORT"
echo "adb reverse set for :$PORT."

echo "→ run_emulator.sh $AVD -a"
cd "$ROOT"
bash scripts/run_emulator.sh "$AVD" -a