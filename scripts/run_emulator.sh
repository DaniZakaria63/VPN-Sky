#!/usr/bin/env bash
# Launch the Android emulator, wait until fully booted, and (optionally) install the app.
#
# Usage:
#   ./scripts/run_emulator.sh [avd_name] [-a]
# Examples:
#   ./scripts/run_emulator.sh                 # default AVD Pixel_9_Pro
#   ./scripts/run_emulator.sh Pixel_Tablet    # specific AVD, boot only
#   ./scripts/run_emulator.sh -a              # boot then `npm run android`
#   ./scripts/run_emulator.sh Pixel_9_Pro -a  # boot then install app too

set -euo pipefail

SDK="${ANDROID_HOME:-/home/dani/Android/Sdk}"
EMULATOR="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"
LOG="${TMPDIR:-/tmp}/vpnsky-emulator.log"

AVD="Pixel_9_Pro"
RUN_APP=0
for arg in "$@"; do
  case "$arg" in
    -a) RUN_APP=1 ;;
    *)  AVD="$arg" ;;
  esac
done

if [[ ! -x "$EMULATOR" ]]; then
  echo "ERROR: emulator binary not found at $EMULATOR" >&2
  exit 1
fi

if ! "$EMULATOR" -list-avds | grep -qx "$AVD"; then
  echo "ERROR: AVD '$AVD' not found. Available:" >&2
  "$EMULATOR" -list-avds >&2
  exit 1
fi

# Kill any live emulator processes left behind by a previous crash.
pkill -f "qemu-system.*$AVD" >/dev/null 2>&1 || true
sleep 1

"$ADB" start-server >/dev/null 2>&1 || true

# Clear stale offline/unresponsive emulator entries so ADB does not report
# an orphaned socket as "device offline". This is what previously caused
# `:app:installDebug` to fail with "Device is OFFLINE".
"$ADB" disconnect >/dev/null 2>&1 || true
for dev in "$($ADB devices | awk '/^emulator-/{print $1}' )"; do
  [[ -z "$dev" ]] && continue
  "$ADB" -s "$dev" emu kill >/dev/null 2>&1 || true
done

# Remove stale runtime locks left by a crashed process so cold boot can start.
AVD_DIR="$HOME/.android/avd/$AVD.avd"
if [[ -d "$AVD_DIR" ]]; then
  rm -f "$AVD_DIR"/*.lock "$AVD_DIR"/multiinstance.lock \
        "$AVD_DIR"/snapshot.trace "$AVD_DIR"/read-snapshot.txt || true
fi

is_booted() {
  [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]
}

if "$ADB" devices | grep -q "^emulator-.*[[:space:]]device$" && is_booted; then
  echo "Emulator already running (booted)."
else
  echo "Booting emulator (no-snapshot): $AVD"
  # Log to file so a failed boot can be diagnosed instead of swallowed by /dev/null.
  # setsid detaches the emulator into its own session so it survives when the
  # launcher's parent shell exits (otherwise background children get reaped).
  setsid "$EMULATOR" -avd "$AVD" -no-snapshot -no-boot-anim \
    -debug-all </dev/null >>"$LOG" 2>&1 &
  disown 2>/dev/null || true
fi

echo -n "Waiting for emulator to come online"
until "$ADB" devices | grep -qE "^emulator-.*[[:space:]]device$"; do
  sleep 5
  echo -n "."
  if ! pgrep -f "qemu-system.*$AVD" >/dev/null; then
    echo ""
    echo "ERROR: emulator process exited during boot. Last log lines:" >&2
    tail -n 30 "$LOG" 2>/dev/null || true
    exit 1
  fi
done
echo ""

echo -n "Waiting for full boot (cold start can take 1-2 min)"
until is_booted; do
  sleep 2
  echo -n "."
  if ! pgrep -f "qemu-system.*$AVD" >/dev/null; then
    echo ""
    echo "ERROR: emulator exited before boot completed. Last log lines:" >&2
    tail -n 30 "$LOG" 2>/dev/null || true
    exit 1
  fi
done
echo ""
echo "Booted:"
"$ADB" devices
echo "Model: $("$ADB" shell getprop ro.product.model)"

if [[ "$RUN_APP" -eq 1 ]]; then
  EMU_SERIAL=$("$ADB" devices | awk '$1 ~ /^emulator-/ && $2=="device" {print $1; exit}')
  echo "→ npm run android (target emulator $EMU_SERIAL)"
  (cd "$(dirname "$0")/.." && npm run android -- "$EMU_SERIAL")
fi