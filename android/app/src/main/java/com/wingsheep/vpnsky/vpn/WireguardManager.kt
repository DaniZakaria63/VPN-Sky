package com.wingsheep.vpnsky.vpn

import android.content.Context
import android.net.VpnService
import com.wireguard.android.backend.BackendException
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Statistics
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config

class WireguardManager(private val context: Context) {
    private var backend: GoBackend? = null
    private var tunnel: WireguardTunnel? = null

    val isInitialized: Boolean get() = backend != null && tunnel != null

    fun initialize(tunnelName: String = "VPNSky") {
        if (backend != null) return
        backend = GoBackend(context)
        tunnel = WireguardTunnel(tunnelName).apply {
            onStateChanged = { }
        }
    }

    fun setOnStateChanged(listener: (Tunnel.State) -> Unit) {
        tunnel?.onStateChanged = listener
    }

    fun isVpnAuthorized(): Boolean {
        return VpnService.prepare(context) == null
    }

    fun connect(config: Config): Result<Tunnel.State> = runCatching {
        val b = backend ?: throw IllegalStateException("Backend not initialized")
        val t = tunnel ?: throw IllegalStateException("Tunnel not initialized")
        b.setState(t, Tunnel.State.UP, config)
    }

    fun disconnect(): Result<Tunnel.State> = runCatching {
        val b = backend ?: throw IllegalStateException("Backend not initialized")
        val t = tunnel ?: throw IllegalStateException("Tunnel not initialized")
        b.setState(t, Tunnel.State.DOWN, null)
    }

    fun getState(): Tunnel.State? {
        val b = backend ?: return null
        val t = tunnel ?: return null
        return b.getState(t)
    }

    fun getStatistics(): Statistics? {
        val b = backend ?: return null
        val t = tunnel ?: return null
        return b.getStatistics(t)
    }

    fun getVersion(): String? = runCatching {
        backend?.getVersion()
    }.getOrNull()

    companion object {
        fun getBackendExceptionReason(e: Throwable): String {
            return when (e) {
                is BackendException -> e.reason.toString()
                else -> e.message ?: "Unknown error"
            }
        }
    }
}