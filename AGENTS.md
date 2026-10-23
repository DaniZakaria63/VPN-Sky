# AGENTS.md — VPNSky

Android VPN client app rebuilt as a **React Native** project. WireGuard tunnel runs in a thin Kotlin native module (Android only); all UI is TypeScript/React Native.

## Layout

| Path | Purpose |
|------|---------|
| `App.tsx` | RN app root (entry `index.js`, component name `VPNSky`) |
| `src/screens/HomeScreen.tsx` | VPN screen chrome: header, telemetry, action button, About sheet |
| `src/components/RocketScene.tsx` | Flight-scene animation (rocket, stars, earth, exhaust); owns its styles |
| `src/hooks/useVpn.ts` | state machine mirroring the old `VpnViewModel` |
| `src/native/vpn.ts` | bridge to native module `VpnConnectManager`; validates state payloads |
| `src/theme.ts` | Material palette (ported from Compose `Color.kt`/`Theme.kt`) |
| `scripts/jev_safety_audit.mjs` | TypeSafe/Jev thread- and runtime-safety report (`npm run audit:safety`) |
| `android/app/.../vpn/` | **Android-only native module**: `VpnSkyVpnModule`, `WireguardManager`, `WireguardKeys`, `WireguardTunnel`, `VpnForegroundService`, `VpnActionReceiver`, `VpnPackage` |
| `ios/` | iOS shell (no VPN; UI shows "unsupported", `isVpnSupported === false`) |

## Stack

- React Native `0.86.2`, React `19.2`, TypeScript, new architecture (`newArchEnabled=true`)
- Native module is a **legacy `ReactContextBaseJavaModule`** — works via interop layer with TurboModules, no codegen spec needed
- WireGuard: `com.wireguard.android:tunnel:1.0.20260102` (Maven Central), core library desugaring enabled (`desugar_jdk_libs:2.1.5`)
- Kotlin 2.1.20, AGP 8.12, Gradle 9.3.1 (root `android/`)
- minSdk 24, targetSdk 36, JDK 17 target; namespace/applicationId `com.wingsheep.vpnsky`

## Build

```bash
# JDK: no system Java. Use Android Studio JBR:
export JAVA_HOME=/home/dani/opt/android-studio/jbr
export ANDROID_HOME=/home/dani/Android/Sdk

cd android

./gradlew :app:assembleDebug       # APK at android/app/build/outputs/apk/debug/
./gradlew :app:compileDebugKotlin  # quick native-compile check
```

JS checks (from repo root):

```bash
npx tsc --noEmit     # typecheck
npm run lint         # eslint
npm test             # jest
npm run android      # CLI: build+install to device/emulator
npm run audit:safety # Jev thread/runtime safety report (needs TYPESAFE_API_KEY)
```

Release builds are R8-minified (`enableProguardInReleaseBuilds = true`) and refuse to build without
release credentials unless `-PallowDebugReleaseSigning=true` is passed explicitly. R8 rules live in
`android/app/proguard-rules.pro`; React Native, Firebase and WireGuard ship their own consumer rules.

```bash
# Play-valid signed APK + AAB: put KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD in
# ~/.config/vpnsky/signing.env (chmod 600, template at signing.env.example), then:
npm run build:apk:signed

# Small arm64-only APK for sideloading (~20 MB vs ~63 MB universal):
npm run build:apk:arm64

# Local universal APK signed with the debug key (NOT uploadable to Play):
npm run build:apk
```

CI lives in `.github/workflows/`:

- `lint.yml`: pull requests into `master` or `dev` run `tsc`, ESLint, and Jest only. It never builds
  or signs, so a dev PR cannot publish anything.
- `build-release.yml`: **`v*` tags or manual dispatch**. It is the only workflow that publishes to
  Play. Dispatch computes the next semver from the latest tag/`android/version.properties`, bumps
  `version.properties`, `package.json` and `package-lock.json`, commits the bump, builds, uploads
  the AAB, verifies the versionCode is on the requested track, then creates the tag and GitHub
  release. Pushing a `v1.2.3` tag is the recovery path and builds that exact version.
- `build-master.yml`: **push to `master` only**. It builds the R8-minified, upload-key-signed APK
  and AAB and attaches them to a GitHub release. It does not upload to Play and shows the version as
  `<committed version>-ci.<run number>`.
- Versioning: `android/version.properties` is the single source of truth (Gradle reads it).
  `scripts/version.mjs` computes the next semver and a `versionCode` of
  `max(seconds since 2025-01-01, previous code + 1)`, so Play uploads always increase even when a
  run is retried. `scripts/play_verify.mjs` reads the Play track back after upload.
- Optional repository variables: `PLAY_TRACK` (`internal` by default) and `PLAY_RELEASE_STATUS`
  (`completed` by default) control tag-triggered releases. Manual dispatch has its own selectors.
- The dispatch path pushes the bump commit with the repository `GITHUB_TOKEN`; `master` must allow
  GitHub Actions to push (or give the bot a bypass), otherwise the run fails before uploading.

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `KEYSTORE_FILE` | `base64 -w0 android/keystore/vpnsky.jks` (single line) |
| `KEYSTORE_PASSWORD` | store password for that JKS |
| `KEY_ALIAS` | `vpnsky` (the only alias in the JKS) |
| `KEY_PASSWORD` | key password for that alias |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Console service-account JSON (release workflow only) |

Never commit the keystore, its base64, or the passwords; `android/keystore/` is gitignored and the
local copy of the credentials belongs in `~/.config/vpnsky/signing.env` (mode 600).

## Native module API (`VpnConnectManager`)

`src/native/vpn.ts` wraps `NativeModules.VpnConnectManager`. Promises only (no callbacks). Methods: `initialize` (implicit via lazy), `getVersion`, `isVpnAuthorized`, `requestVpnPermission` (launches `VpnService.prepare` + `startActivityForResult`, resolves granted bool), `connect(conf)`, `disconnect`, `getState`, `getAssignedAddress` (tunnel address recovered after task removal), `getStatistics` (`{rxBytes,txBytes}`), `ensureClientKey` (generates/loads a persistent Curve25519 keypair from app-private `vpnsky_client.key`; private key never ships), `rotateClientKey` (rotation helper; deletes persisted key), `generateKeyPair` (one-shot ephemeral, for diagnostics). Emits `onVpnStateChange` via `NativeEventEmitter`.

`@react-native-firebase/remote-config` is initialized via `src/config.ts`, which fetches `BASE_API_URL` (`base_api_url`), and WireGuard server params (`vpn_dns`, `vpn_allowed_ips`, `vpn_server_public_key`, `vpn_endpoint`, `vpn_persistent_keepalive`). The **client private key is generated and persisted** at runtime via `ensureClientKey`; the client registers its per-install public key to `<base_api_url>/register` (header `X-Registry-Token: <registry_token>`) and is handed a unique tunnel address — no address/IP is baked in. Defaults are embedded for offline boots; no secret material (no WG private keys, no PSK) is ever shipped.

The matching auto-provisioning service (`wg-registry`) and its `deploy.sh` live in a separate project: **VPN-Sky-Backend** (https://github.com/DaniZakaria63/VPN-Sky-Backend, checked out at `~/PycharmProjects/vpnsky-backend`). This repo is the client only — it must never need that server's source to build.

Connection flow (JS, `useVpn.ts` + `src/config.ts`):
1. `buildVpnConfig()` → fetches Remote Config (`base_api_url`, `registry_token`), loads stable per-install client key via `ensureClientKey()`, POSTs its pubkey to `<base_api_url>/register` (header `X-Registry-Token`), then assembles a `.conf` with `[Interface]/PrivateKey` + assigned `Address` held in app-private storage — no IP baked in.
2. `isVpnAuthorized()` → if false `requestVpnPermission()` (system dialog)
3. `connect(conf)` retried 3× with 500 ms pause; native parses the `.conf` directly into `Config` → `GoBackend.setState(UP)`

## Native lifecycle notes

- `WireguardManager` owns the single daemon tunnel thread (`vpnsky-tunnel`) and exposes only
  callback-based operations: `GoBackend.setState` blocks until the tunnel transitions, so it must
  never touch the JS/bridge or UI thread. Key-file work runs on `VpnSkyVpnModule`'s separate
  `vpnsky-keys` thread; the two domains share no mutable state.
- `WireguardTunnel.onStateChanged` is `@Volatile` because the backend invokes it from its own
  thread.
- `WireguardManager` is a process-wide singleton. React-context teardown (`invalidate()`, task
  removal) must never stop the tunnel; a recreated module reattaches to the same manager, and
  `getAssignedAddress` lets the UI recover the tunnel IP.
- `VpnForegroundService` is the keep-alive: a `specialUse` foreground service with an ongoing
  notification, started before connect and stopped on disconnect/tunnel DOWN. The WireGuard
  library's own VpnService is only a background service, which OEM task cleaners kill. The
  notification action is handled by `VpnActionReceiver` without needing the React context.
- The Play Console submission must declare the `specialUse` foreground-service type; Android 13+
  requests notification permission when connecting.
- Every promise settles exactly once: a shut-down executor rejects (`VPN_UNAVAILABLE`), a permission
  dialog is settled by `onActivityResult`, by `invalidate()`, or by a launch failure.
- `GoBackend$VpnService` declared in `android/app/src/main/AndroidManifest.xml` with `BIND_VPN_SERVICE`.
- Tunnel lib enum gained `TUNNEL_STATE.TOGGLE` — keep `when` expressions exhaustive (add else/`TOGGLE`)
  if the lib bumps; `TOGGLE` maps to `Connecting`, not `Disconnected`.
- No Hilt/Dagger in the RN port — plain constructor wiring in `VpnPackage`.
- Add new native modules by appending to `PackageList(this).packages` in `MainApplication.kt`.

## Conventions

- TypeScript strict (RN `@react-native/typescript-config`), ESLint RN preset + Prettier.
- State typed as discriminated unions (`VpnUiState`): `Disconnected | Connecting | Disconnecting | Connected | PermissionRequired | Error`.
- iOS shows a "VPN requires Android" notice — do not add fake VPN tunnels there.
- Git branches: `feat/vpn` for active work, `main` stable.