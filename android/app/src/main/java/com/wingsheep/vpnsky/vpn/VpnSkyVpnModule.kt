package com.wingsheep.vpnsky.vpn

import android.content.Intent
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
    fun loadClientConf(promise: Promise) {
        runCatching {
            reactContext.assets.open("client.conf").bufferedReader().use { it.readText() }
        }.onSuccess { promise.resolve(it) }
            .onFailure {
                promise.reject("VPN_NO_CONF", "No client.conf found in app assets", it)
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
