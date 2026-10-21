#!/usr/bin/env bash
#
# Build a Play-valid signed release without putting secrets in the repo or in shell history.
#
#   1. Create ~/.config/vpnsky/signing.env (chmod 600) containing:
#        KEYSTORE_PASSWORD='...'
#        KEY_ALIAS='...'
#        KEY_PASSWORD='...'
#   2. Run: npm run build:apk:signed
#
# The keystore itself is android/keystore/vpnsky.jks. Gradle reads the three variables from the
# environment; --no-daemon guarantees the daemon cannot serve a stale environment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${VPNSKY_SIGNING_ENV:-$HOME/.config/vpnsky/signing.env}"
KEYSTORE="$ROOT/android/keystore/vpnsky.jks"

if [[ ! -f "$ENV_FILE" ]]; then
  cat >&2 <<EOF
Missing signing credentials: $ENV_FILE

Create it with:

  mkdir -p "\$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<'CREDS'
  KEYSTORE_PASSWORD='your-store-password'
  KEY_ALIAS='your-key-alias'
  KEY_PASSWORD='your-key-password'
CREDS
  chmod 600 "$ENV_FILE"

Then run this script again.
EOF
  exit 2
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

: "${KEYSTORE_PASSWORD:?KEYSTORE_PASSWORD is not set in $ENV_FILE}"
: "${KEY_ALIAS:?KEY_ALIAS is not set in $ENV_FILE}"
: "${KEY_PASSWORD:?KEY_PASSWORD is not set in $ENV_FILE}"

if [[ ! -f "$KEYSTORE" ]]; then
  echo "Keystore not found: $KEYSTORE" >&2
  exit 2
fi

export JAVA_HOME="${JAVA_HOME:-/home/dani/opt/android-studio/jbr}"
export ANDROID_HOME="${ANDROID_HOME:-/home/dani/Android/Sdk}"
VERSION_NAME="${APP_VERSION_NAME:-1.0.0}"
DEFAULT_CODE=$(( $(date +%s) - 1735689600 ))
if [ "$DEFAULT_CODE" -lt 1 ]; then DEFAULT_CODE=1; fi
VERSION_CODE="${APP_VERSION_CODE:-$DEFAULT_CODE}"

cd "$ROOT/android"
./gradlew --no-daemon :app:bundleRelease :app:assembleRelease \
  -PappVersionName="$VERSION_NAME" \
  -PappVersionCode="$VERSION_CODE" \
  --console=plain

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
AAB="$ROOT/android/app/build/outputs/bundle/release/app-release.aab"
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner"

if [[ ! -x "$APKSIGNER" ]]; then
  APKSIGNER="$(find "$ANDROID_HOME/build-tools" -name apksigner -type f | sort -V | tail -1)"
fi

CERT="$("$APKSIGNER" verify --print-certs "$APK")"
if grep -q "CN=Android Debug" <<<"$CERT"; then
  echo "Refusing to report success: the APK is still signed with the debug certificate." >&2
  exit 1
fi

echo
echo "Signed release built:"
echo "  APK  $APK  ($(du -h "$APK" | cut -f1))"
echo "  AAB  $AAB  ($(du -h "$AAB" | cut -f1))"
echo
echo "$CERT" | sed -n '1,4p'
