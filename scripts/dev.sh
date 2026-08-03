#!/usr/bin/env bash
# One-command dev runner. Auto-detects targets:
#   * A physical device over USB  -> adb reverse + build/install/launch on it.
#   * No physical device          -> boot the emulator (default AVD) and run there.
#
# Usage:
#   bash scripts/dev.sh                      # auto: physical if connected, else emulator
#   bash scripts/dev.sh <avd_name>          # force emulator (AVD name)
#   bash scripts/dev.sh <serial>            # force a specific device serial
#   DEVICE=<serial> bash scripts/dev.sh     # force device via env

set -euo pipefail

SDK="${ANDROID_HOME:-/home/dani/Android/Sdk}"
ADB="$SDK/platform-tools/adb"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${TMPDIR:-/tmp}/vpnsky-metro.log"
PORT="${RN_METRO_PORT:-8081}"

export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"

DEFAULT_AVD="Pixel_9_Pro"
ARG="${1:-${DEVICE:-}}"

"$ADB" start-server >/dev/null 2>&1 || true

# --- device detection -------------------------------------------------------
list_serials() { "$ADB" devices | awk 'NR>1 && $2=="device" {print $1}'; }

is_physical() { [[ "$1" != emulator-* ]]; }

pick_physical() {
  local target=""
  for s in $(list_serials); do
    if is_physical "$s"; then target="$s"; break; fi
  done
  printf '%s' "$target"
}

# Determine the target device/serial up front.
TARGET=""
MODE=""
if [[ -n "$ARG" ]]; then
  # Explicit argument: is it an AVD name or a serial?
  if ! "$SDK/emulator/emulator" -list-avds 2>/dev/null | grep -qx "$ARG"; then
    TARGET="$ARG"
    MODE="physical"
  else
    MODE="emulator"
  fi
else
  TARGET="$(pick_physical)"
  if [[ -n "$TARGET" ]]; then
    MODE="physical"
  else
    MODE="emulator"
  fi
fi

if [[ "$MODE" == "physical" ]]; then
  if [[ -z "$TARGET" ]]; then
    echo "ERROR: no physical device found. Connect a device via USB (with debugging on)." >&2
    exit 1
  fi
  echo "Target: physical device $TARGET"
else
  AVD="${ARG:-$DEFAULT_AVD}"
  echo "Target: emulator AVD '$AVD'"
fi

# --- Metro --------------------------------------------------------------------

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

# --- reverse ------------------------------------------------------------------

if [[ "$MODE" == "physical" ]]; then
  echo "Waiting for physical device to be ready..."
  "$ADB" -s "$TARGET" wait-for-device
  "$ADB" -s "$TARGET" reverse tcp:"$PORT" tcp:"$PORT"
  echo "adb reverse set on $TARGET for :$PORT."

  echo "→ build + install + launch on $TARGET"
  cd "$ROOT"
  "$ROOT/node_modules/.bin/react-native" run-android --device "$TARGET" --port "$PORT"
else
  echo "→ run_emulator.sh $AVD -a"
  cd "$ROOT"
  bash scripts/run_emulator.sh "$AVD" -a
fi