package com.wingsheep.vpnsky.vpn

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Bridge between React Native and [WireguardManager].
 *
 * Threading contract:
 *  - Tunnel work (connect/disconnect/getState/getStatistics/getVersion) is owned by
 *    [WireguardManager] and runs on its single daemon thread. GoBackend.setState() blocks until
 *    the tunnel transitions, so it must never run on the JS/bridge thread or the UI thread.
 *  - Key-file work runs on this module's own single daemon thread; the two domains never share
 *    mutable state.
 *  - The permission dialog must be launched from the UI thread, so that one hop is explicit. Its
 *    promise is settled exactly once: by onActivityResult, by invalidate(), or by a launch failure.
 */
class VpnSkyVpnModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    ActivityEventListener {

    companion object {
        const val NAME = "VpnConnectManager"
        const val REQUEST_VPN_PERMISSION = 9317
        const val REQUEST_NOTIFICATION_PERMISSION = 9318
        const val EVENT_ON_STATE_CHANGE = "onVpnStateChange"
        private const val KEY_FILE_NAME = "vpnsky_client.key"
    }

    private val vpnManagerDelegate = lazy {
        WireguardManager.getInstance(reactContext.applicationContext).apply {
            initialize()
            setOnStateChanged { state -> onBackendState(state) }
        }
    }
    private val vpnManager: WireguardManager by vpnManagerDelegate

    /** Key-file and permission work only; tunnel work lives on WireguardManager's own thread. */
    private val keyExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "vpnsky-keys").apply { isDaemon = true }
    }

    /** Guards [permissionPromise]; also documents that only one dialog may be in flight. */
    private val permissionLock = Any()
    private var permissionPromise: Promise? = null

    /** Guards the client key file. Executor serialises work, this also covers direct calls. */
    private val clientKeyLock = Any()

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        reactContext.addActivityEventListener(this)
    }

    override fun invalidate() {
        super.invalidate()
        reactContext.removeActivityEventListener(this)
        val orphan = synchronized(permissionLock) {
            permissionPromise.also { permissionPromise = null }
        }
        orphan?.resolve(false)
        // Keep key work from outliving this React context, but do NOT stop the tunnel or the
        // foreground keep-alive service: invalidate() also runs when the task is swiped away, and
        // the VPN must survive that. WireguardManager is a process singleton so a recreated module
        // reattaches to the live tunnel.
        keyExecutor.shutdown()
    }

    @ReactMethod
    fun getVersion(promise: Promise) {
        vpnManager.getVersion { version -> promise.resolve(version ?: "") }
    }

    @ReactMethod
    fun generateKeyPair(promise: Promise) {
        runOnKeyExecutor(promise) {
            val pair = WireguardKeys.generateKeyPair()
            keyPairMap(pair.first, pair.second)
        }
    }

    @ReactMethod
    fun ensureClientKey(promise: Promise) {
        runOnKeyExecutor(promise) { keyPairMap(loadOrCreateClientKey()) }
    }

    @ReactMethod
    fun rotateClientKey(promise: Promise) {
        runOnKeyExecutor(promise) {
            synchronized(clientKeyLock) {
                val keyFile = keyFile()
                if (keyFile.exists() && !keyFile.delete()) {
                    throw IllegalStateException("Could not delete the existing client key")
                }
            }
            keyPairMap(loadOrCreateClientKey())
        }
    }

    @ReactMethod
    fun isVpnAuthorized(promise: Promise) {
        runOnKeyExecutor(promise) { vpnManager.isVpnAuthorized() }
    }

    @ReactMethod
    fun requestVpnPermission(promise: Promise) {
        if (vpnManager.isVpnAuthorized()) {
            promise.resolve(true)
            return
        }
        val intent = VpnService.prepare(reactContext.applicationContext)
        if (intent == null) {
            promise.resolve(true)
            return
        }
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }

        val previous = synchronized(permissionLock) {
            permissionPromise.also { permissionPromise = promise }
        }
        // A second request while the dialog is open: settle the orphan instead of leaking it.
        previous?.resolve(false)

        reactContext.runOnUiQueueThread {
            try {
                activity.startActivityForResult(intent, REQUEST_VPN_PERMISSION)
            } catch (e: Exception) {
                clearPermissionPromise(promise)
                promise.reject(
                    "VPN_PERMISSION_ERROR",
                    e.message ?: "Could not launch the VPN permission dialog",
                    e,
                )
            }
        }
    }

    @ReactMethod
    fun connect(conf: String, promise: Promise) {
        val config = try {
            Config.parse(ByteArrayInputStream(conf.toByteArray(StandardCharsets.UTF_8)))
        } catch (e: Exception) {
            promise.reject("VPN_CONFIG_INVALID", e.message ?: "Failed to parse VPN config", e)
            return
        }
        if (config.peers.isEmpty()) {
            promise.reject("VPN_CONFIG_INVALID", "WireGuard config has no peer")
            return
        }
        // Raise the process to foreground before the blocking setState(UP); this is what keeps the
        // tunnel alive if the user swipes the task away while the tunnel is coming up.
        requestNotificationPermissionIfNeeded()
        VpnForegroundService.start(reactContext.applicationContext, connected = false)
        vpnManager.connect(config) { result ->
            result.fold(
                onSuccess = { state ->
                    VpnForegroundService.update(reactContext.applicationContext, state == Tunnel.State.UP)
                    promise.resolve(stateToValue(state))
                },
                onFailure = {
                    VpnForegroundService.stop(reactContext.applicationContext)
                    rejectBackend(promise, it)
                },
            )
        }
    }

    @ReactMethod
    fun disconnect(promise: Promise) {
        vpnManager.disconnect { result ->
            result.fold(
                onSuccess = {
                    VpnForegroundService.stop(reactContext.applicationContext)
                    promise.resolve(stateToValue(it))
                },
                onFailure = { rejectBackend(promise, it) },
            )
        }
    }

    @ReactMethod
    fun getState(promise: Promise) {
        vpnManager.getState { state -> promise.resolve(stateToValue(state)) }
    }

    @ReactMethod
    fun getAssignedAddress(promise: Promise) {
        vpnManager.getAssignedAddress { address -> promise.resolve(address ?: "") }
    }

    @ReactMethod
    fun getStatistics(promise: Promise) {
        vpnManager.getStatistics { stats ->
            val map = Arguments.createMap()
            map.putDouble("rxBytes", stats?.totalRx()?.toDouble() ?: 0.0)
            map.putDouble("txBytes", stats?.totalTx()?.toDouble() ?: 0.0)
            promise.resolve(map)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN NativeEventEmitter.
    }

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) {
        if (requestCode != REQUEST_VPN_PERMISSION) {
            return
        }
        val pending = synchronized(permissionLock) {
            permissionPromise.also { permissionPromise = null }
        }
        // The dialog result can be misleading on some OEMs; the actual authorization is the
        // authoritative answer and VpnService.prepare() is cheap.
        pending?.resolve(vpnManager.isVpnAuthorized())
    }

    override fun onNewIntent(intent: Intent) = Unit

    /**
     * Android 13+ hides the foreground-service notification without this permission. Requesting
     * it is best-effort: the FGS still runs and keeps the tunnel alive when it is denied.
     */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }
        val activity = reactContext.currentActivity ?: return
        if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        reactContext.runOnUiQueueThread {
            try {
                activity.requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQUEST_NOTIFICATION_PERMISSION,
                )
            } catch (_: Exception) {
                // Best effort; connect must not fail because the prompt could not be shown.
            }
        }
    }

    private fun clearPermissionPromise(promise: Promise) {
        synchronized(permissionLock) {
            if (permissionPromise === promise) {
                permissionPromise = null
            }
        }
    }

    /** Runs a short operation off the bridge thread and settles the promise once. */
    private fun <T> runOnKeyExecutor(promise: Promise, block: () -> T) {
        keyExecutor.executeSafely(promise) {
            promise.resolve(block())
        }
    }

    private fun rejectBackend(promise: Promise, error: Throwable) {
        if (error is RejectedExecutionException) {
            promise.reject("VPN_UNAVAILABLE", "VPN module is no longer available", error)
        } else {
            promise.reject("VPN_FAILED", WireguardManager.getBackendExceptionReason(error), error)
        }
    }

    /**
     * Submits work, turning a shut-down executor into a rejection rather than an uncaught
     * RejectedExecutionException.
     */
    private fun ExecutorService.executeSafely(promise: Promise, block: () -> Unit) {
        try {
            execute {
                try {
                    block()
                } catch (e: Exception) {
                    promise.reject("VPN_FAILED", e.message ?: "VPN operation failed", e)
                }
            }
        } catch (e: RejectedExecutionException) {
            promise.reject("VPN_UNAVAILABLE", "VPN module is no longer available", e)
        }
    }

    private fun keyFile(): File = File(reactContext.applicationContext.filesDir, KEY_FILE_NAME)

    private fun keyPairMap(privateKey: String, publicKey: String): WritableMap =
        Arguments.createMap().apply {
            putString("privateKey", privateKey)
            putString("publicKey", publicKey)
        }

    private fun keyPairMap(pair: Pair<String, String>): WritableMap =
        keyPairMap(pair.first, pair.second)

    /**
     * Loads the persisted Curve25519 keypair, recreating it when the file is missing, empty, or
     * corrupt. Writes atomically so a process death mid-write cannot leave a truncated key.
     */
    private fun loadOrCreateClientKey(): Pair<String, String> = synchronized(clientKeyLock) {
        val file = keyFile()
        if (file.exists()) {
            val stored = runCatching {
                val privateKey = file.readLines().firstOrNull()?.trim().orEmpty()
                require(privateKey.isNotEmpty()) { "empty key file" }
                val publicKey = WireguardKeys.publicKeyFor(privateKey)
                Pair(privateKey, publicKey)
            }.getOrNull()
            if (stored != null) {
                return@synchronized stored
            }
            // Corrupt key: fall through to a clean regeneration instead of failing forever.
            file.delete()
        }

        val pair = WireguardKeys.generateKeyPair()
        val temp = File(file.parentFile, "$KEY_FILE_NAME.tmp")
        temp.writeText("${pair.first}\n${pair.second}\n")
        if (!temp.renameTo(file)) {
            // renameTo can fail across filesystems; fall back to a direct write.
            file.writeText("${pair.first}\n${pair.second}\n")
            temp.delete()
        }
        pair
    }

    /**
     * Single funnel for backend state changes: keep the foreground notification truthful and
     * notify JS when a live React instance still exists. The manager outlives the module, so this
     * may run with a stale React context; the foreground-service calls only use the app context.
     */
    private fun onBackendState(state: Tunnel.State) {
        when (state) {
            Tunnel.State.UP -> VpnForegroundService.update(reactContext.applicationContext, connected = true)
            Tunnel.State.TOGGLE -> VpnForegroundService.update(reactContext.applicationContext, connected = false)
            Tunnel.State.DOWN -> VpnForegroundService.stop(reactContext.applicationContext)
        }
        emitState(state)
    }

    private fun emitState(state: Tunnel.State) {
        if (!reactContext.hasActiveReactInstance()) {
            return
        }
        val map: WritableMap = Arguments.createMap()
        map.putString("state", stateToValue(state))
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_ON_STATE_CHANGE, map)
        } catch (_: Exception) {
            // The JS context can go away between the check and the emit; a dropped event is fine.
        }
    }

    private fun stateToValue(state: Tunnel.State?): String = when (state) {
        Tunnel.State.UP -> "Connected"
        // TOGGLE is the backend's transitional state; reporting Disconnected here makes the UI
        // flash offline while the tunnel is actually coming up.
        Tunnel.State.TOGGLE -> "Connecting"
        Tunnel.State.DOWN -> "Disconnected"
        null -> "Disconnected"
    }
}
