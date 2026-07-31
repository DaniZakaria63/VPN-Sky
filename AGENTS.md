# AGENTS.md — VPNSky

Android VPN client app (Kotlin, Jetpack Compose). Multi-module Gradle project.

## Modules

| Module | Purpose | Entry point |
|--------|---------|-------------|
| `:app` | Main application | `com.wingsheep.vpnsky.MainActivity` |
| `:vpn` | VPN library (WireGuard integration) | `com.wingsheep.vpn.WireguardManager` |

## Build

```bash
# JDK: no system Java. Use Android Studio JBR:
export JAVA_HOME=/home/dani/opt/android-studio/jbr

# Compile
./gradlew :vpn:compileDebugKotlin     # vpn module
./gradlew :app:compileDebugKotlin     # app module
./gradlew compileDebugKotlin          # both

# Run tests
./gradlew testDebugUnitTest

# Assemble APK
./gradlew assembleDebug
```

## Known Issues

- **No system Java**: `JAVA_HOME` must point to a JDK (Android Studio JBR at `/home/dani/opt/android-studio/jbr` works).
- **Configuration cache**: `org.gradle.configuration-cache=true` in `gradle.properties`. If stale, run `./gradlew --no-configuration-cache <task>`.
- **AGP 9 + KSP workaround**: `android.disallowKotlinSourceSets=false` in `gradle.properties` (required for KSP with AGP 9 built-in Kotlin).

## Architecture

- **Clean architecture**: `:vpn` is a library module with no Android framework dependencies beyond `VpnService`. App layer (`:app`) depends on `:vpn`.
- **Dependency injection**: Hilt (`com.google.dagger:hilt.android:2.60`) with KSP (`2.2.10-2.0.2`). `@HiltAndroidApp` on `VpnSkyApplication`, `@AndroidEntryPoint` on activities, `@HiltViewModel` on ViewModels, `@Singleton @Inject` on injectable classes.
- **State management**: Use Kotlin `StateFlow` / `LiveData` for reactive UI. WireGuard tunnel state flows through `WireguardManager` → ViewModel → Compose UI.

## WireGuard Integration

Library: `com.wireguard.android:tunnel:1.0.20260102` (Maven Central, official WireGuard Android tunnel library)

Key classes in `:vpn` module:
- `WireguardManager` — wraps `GoBackend`, manages connect/disconnect lifecycle
- `WireguardTunnel` — implements `com.wireguard.android.backend.Tunnel`
- `VpnConfig` — data class; `toWireguardConfig()` converts to library `Config`; `parseFromConf()` parses `.conf` files
- `VpnState` — sealed class: `Disconnected`, `Connecting`, `Connected`, `Error`

Required manifest entries:
- `GoBackend$VpnService` declared in `vpn/AndroidManifest.xml` with `BIND_VPN_SERVICE` permission
- `INTERNET` + `ACCESS_NETWORK_STATE` permissions in `app/AndroidManifest.xml`

Connection flow:
1. Call `WireguardManager.initialize()` (loads `wg-go` native lib)
2. Call `isVpnAuthorized()` → if false, launch `VpnService.prepare()` intent
3. Call `connect(config)` on background thread (blocks until tunnel established)
4. `GoBackend.setState()` internally calls `VpnService.prepare()`, builds TUN interface, calls native `wgTurnOn()`

## Conventions

- Kotlin DSL Gradle (`build.gradle.kts`), version catalog (`gradle/libs.versions.toml`)
- Kotlin 2.2.10, AGP 9.3.1, Compose BOM 2026.02.01
- Hilt 2.60, KSP 2.2.10-2.0.2
- minSdk 24, targetSdk 36, compileSdk 37.1
- Java 17 source/target compatibility with desugaring (`isCoreLibraryDesugaringEnabled = true`)
- Kotlin code style: `official` (`kotlin.code.style=official` in `gradle.properties`)
- Git branch: `feat/vpn` for VPN work; `main` for stable
