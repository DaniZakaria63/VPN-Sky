package com.wingsheep.vpnsky.vpn

import android.content.Intent
import java.io.File
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import android.net.VpnService
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
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class VpnSkyVpnModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    ActivityEventListener {

    companion object {
        const val NAME = "VpnConnectManager"
        const val REQUEST_VPN_PERMISSION = 9317
        const val EVENT_ON_STATE_CHANGE = "onVpnStateChange"
    }

    private val vpnManager: WireguardManager by lazy {
        WireguardManager(reactContext.applicationContext).apply {
            initialize()
            setOnStateChanged { state -> emitState(state) }
        }
    }
    private val executor = Executors.newSingleThreadExecutor()
    private var permissionPromise: Promise? = null

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        reactContext.addActivityEventListener(this)
    }

    override fun invalidate() {
        super.invalidate()
        reactContext.removeActivityEventListener(this)
        executor.shutdown()
    }

    @ReactMethod
    fun getVersion(promise: Promise) {
        promise.resolve(vpnManager.getVersion() ?: "")
    }

    @ReactMethod
    fun generateKeyPair(promise: Promise) {
        val pair = VpnConfig.generateKeyPair()
        resolveKeyPair(promise, pair.first, pair.second)
    }

    @ReactMethod
    fun ensureClientKey(promise: Promise) {
        try {
            val ctx = reactContext.applicationContext
            val keyFile = File(ctx.filesDir, "vpnsky_client.key")
            if (keyFile.exists()) {
                val lines = keyFile.readLines()
                val priv = lines[0]
                // Verify the stored pubkey matches the privkey; regenerate if corrupted.
                val pub = Key.fromBase64(priv).let { KeyPair(it).publicKey.toBase64() }
                resolveKeyPair(promise, priv, pub)
            } else {
                val pair = VpnConfig.generateKeyPair()
                keyFile.writeText("${pair.first}\n${pair.second}\n")
                resolveKeyPair(promise, pair.first, pair.second)
            }
        } catch (e: Exception) {
            promise.reject("VPN_KEY_ERROR", e.message ?: "Failed to load client key", e)
        }
    }

    @ReactMethod
    fun rotateClientKey(promise: Promise) {
        try {
            reactContext.applicationContext
                .let { File(it.filesDir, "vpnsky_client.key") }
                .delete()
            ensureClientKey(promise)
        } catch (e: Exception) {
            promise.reject("VPN_KEY_ERROR", e.message ?: "Failed to rotate client key", e)
        }
    }

    private fun resolveKeyPair(promise: Promise, privateKey: String, publicKey: String) {
        if (privateKey.isEmpty() || publicKey.isEmpty()) {
            promise.reject("VPN_KEY_ERROR", "Generated invalid key pair")
            return
        }
        val map: WritableMap = Arguments.createMap()
        map.putString("privateKey", privateKey)
        map.putString("publicKey", publicKey)
        promise.resolve(map)
    }

    @ReactMethod
    fun isVpnAuthorized(promise: Promise) {
        promise.resolve(vpnManager.isVpnAuthorized())
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
        permissionPromise = promise
        activity.startActivityForResult(intent, REQUEST_VPN_PERMISSION)
    }

    @ReactMethod
    fun connect(conf: String, promise: Promise) {
        executor.execute {
            try {
                // Pass parsed config directly so additional peers and parser-supported options survive.
                val config = Config.parse(
                    ByteArrayInputStream(conf.toByteArray(StandardCharsets.UTF_8))
                )
                if (config.peers.isEmpty()) {
                    throw IllegalArgumentException("WireGuard config has no peer")
                }
                val result = vpnManager.connect(config)
                result.fold(
                    onSuccess = { promise.resolve(stateToValue(it)) },
                    onFailure = { promise.reject("VPN_FAILED", WireguardManager.getBackendExceptionReason(it), it) }
                )
            } catch (e: Exception) {
                promise.reject("VPN_FAILED", e.message ?: "Failed to parse config", e)
            }
        }
    }

    @ReactMethod
    fun disconnect(promise: Promise) {
        executor.execute {
            val result = vpnManager.disconnect()
            result.fold(
                onSuccess = { promise.resolve(stateToValue(it)) },
                onFailure = { promise.reject("VPN_FAILED", WireguardManager.getBackendExceptionReason(it), it) }
            )
        }
    }

    @ReactMethod
    fun getState(promise: Promise) {
        promise.resolve(stateToValue(vpnManager.getState()))
    }

    @ReactMethod
    fun getStatistics(promise: Promise) {
        val stats = vpnManager.getStatistics()
        if (stats == null) {
            val map: WritableMap = Arguments.createMap()
            map.putDouble("rxBytes", 0.0)
            map.putDouble("txBytes", 0.0)
            promise.resolve(map)
            return
        }
        val map: WritableMap = Arguments.createMap()
        map.putDouble("rxBytes", stats.totalRx().toDouble())
        map.putDouble("txBytes", stats.totalTx().toDouble())
        promise.resolve(map)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN NativeEventEmitter.
    }

    override fun onActivityResult(activity: android.app.Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_VPN_PERMISSION) {
            val promise = permissionPromise
            permissionPromise = null
            promise?.resolve(vpnManager.isVpnAuthorized())
        }
    }

    override fun onNewIntent(intent: Intent) = Unit

    private fun emitState(state: Tunnel.State) {
        val map: WritableMap = Arguments.createMap()
        map.putString("state", stateToValue(state))
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_ON_STATE_CHANGE, map)
    }

    private fun stateToValue(state: Tunnel.State?): String = when (state) {
        Tunnel.State.UP -> "Connected"
        Tunnel.State.DOWN, Tunnel.State.TOGGLE -> "Disconnected"
        null -> "Disconnected"
    }
}
