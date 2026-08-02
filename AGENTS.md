# AGENTS.md — VPNSky

Android VPN client app rebuilt as a **React Native** project. WireGuard tunnel runs in a thin Kotlin native module (Android only); all UI is TypeScript/React Native.

## Layout

| Path | Purpose |
|------|---------|
| `App.tsx` | RN app root (entry `index.js`, component name `VPNSky`) |
| `src/screens/HomeScreen.tsx` | VPN screen: status, connect/disconnect, stats |
| `src/hooks/useVpn.ts` | state machine mirroring the old `VpnViewModel` |
| `src/native/vpn.ts` | bridge to native module `VpnConnectManager` |
| `src/theme.ts` | Material palette (ported from Compose `Color.kt`/`Theme.kt`) |
| `android/app/.../vpn/` | **Android-only native module**: `VpnSkyVpnModule`, `WireguardManager`, `VpnConfig`, `WireguardTunnel`, `VpnPackage` |
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
```

## Native module API (`VpnConnectManager`)

`src/native/vpn.ts` wraps `NativeModules.VpnConnectManager`. Promises only (no callbacks). Methods: `initialize` (implicit via lazy), `getVersion`, `isVpnAuthorized`, `requestVpnPermission` (launches `VpnService.prepare` + `startActivityForResult`, resolves granted bool), `connect(conf)`, `disconnect`, `getState`, `getStatistics` (`{rxBytes,txBytes}`), `ensureClientKey` (generates/loads a persistent Curve25519 keypair from app-private `vpnsky_client.key`; private key never ships), `rotateClientKey` (rotation helper; deletes persisted key), `generateKeyPair` (one-shot ephemeral, for diagnostics). Emits `onVpnStateChange` via `NativeEventEmitter`.

`@react-native-firebase/remote-config` is initialized via `src/config.ts`, which fetches WireGuard server params (`vpn_address`, `vpn_dns`, `vpn_allowed_ips`, `vpn_server_public_key`, `vpn_endpoint`, `vpn_persistent_keepalive`). Defaults are embedded for offline boots; no secret material (no WG private keys, no PSK) is ever shipped.

Connection flow (JS, `useVpn.ts` + `src/config.ts`):
1. `buildVpnConfig()` → fetches Remote Config, then loads the stable per-install client key via `ensureClientKey()`, returning a `.conf` with `[Interface]/PrivateKey` assembled at runtime from a key held in app-private storage.
2. `isVpnAuthorized()` → if false `requestVpnPermission()` (system dialog)
3. `connect(conf)` retried 3× with 500 ms pause; native parses `.conf` → `VpnConfig.toWireguardConfig()` → `GoBackend.setState(UP)`

## Native lifecycle notes

- `WireguardManager` runs GoBackend on a single-thread executor (must not block JS thread; `setState` blocks until tunnel up).
- `GoBackend$VpnService` declared in `android/app/src/main/AndroidManifest.xml` with `BIND_VPN_SERVICE`.
- Tunnel lib enum gained `TUNNEL_STATE.TOGGLE` — keep `when` expressions exhaustive (add else/`TOGGLE`) if the lib bumps.
- No Hilt/Dagger in the RN port — plain constructor wiring in `VpnPackage`.
- Add new native modules by appending to `PackageList(this).packages` in `MainApplication.kt`.

## Conventions

- TypeScript strict (RN `@react-native/typescript-config`), ESLint RN preset + Prettier.
- State typed as discriminated unions (`VpnUiState`): `Disconnected | Connecting | Connected | PermissionRequired | Error`.
- iOS shows a "VPN requires Android" notice — do not add fake VPN tunnels there.
- Git branches: `feat/vpn` for active work, `main` stable.