#!/usr/bin/env bash
# Build + install + launch onto a chosen Android target.
# Picks the device the same way dev.sh does:
#   * an explicitly booted/connected emulator if one is present
#   * otherwise the connected physical device
#
# Usage:
#   bash scripts/run_android.sh            # auto-pick target
#   bash scripts/run_android.sh <serial>   # force a serial/AVD serial
#   DEVICE=<serial> bash scripts/run_android.sh

set -euo pipefail

SDK="${ANDROID_HOME:-/home/dani/Android/Sdk}"
ADB="$SDK/platform-tools/adb"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${RN_METRO_PORT:-8081}"

export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"

"$ADB" start-server >/dev/null 2>&1 || true

DEV="${1:-${DEVICE:-}}"

list_serials() { "$ADB" devices | awk 'NR>1 && $2=="device" {print $1}'; }
is_physical() { [[ "$1" != emulator-* ]]; }

if [[ -n "$DEV" ]]; then
  TARGET="$DEV"
else
  TARGET=""
  EMU=""
  for s in $(list_serials); do
    if [[ -z "$EMU" && "$s" == emulator-* ]]; then EMU="$s"; fi
    if is_physical "$s"; then TARGET="$s"; fi
  done
  # Prefer a physical device; else fall back to the emulator.
  TARGET="${TARGET:-$EMU}"
fi

if [[ -z "$TARGET" ]]; then
  echo "ERROR: no Android device/emulator available. adb devices:" >&2
  "$ADB" devices -l >&2 || true
  exit 1
fi

echo "Target: $TARGET"

# Make localhost:8081 on the target reach Metro on the host.
"$ADB" -s "$TARGET" reverse tcp:"$PORT" tcp:"$PORT" || true

cd "$ROOT"
"$ROOT/node_modules/.bin/react-native" run-android --device "$TARGET" --port "$PORT"