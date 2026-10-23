package com.wingsheep.vpnsky.vpn

import android.content.Context
import android.net.VpnService
import com.wireguard.android.backend.BackendException
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Statistics
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Owns the GoBackend, the single logical tunnel, and the one thread allowed to touch them.
 *
 * `GoBackend.setState()` blocks until the tunnel transitions and `getStatistics()` crosses the
 * binder, so none of that work may run on the JS/bridge or UI thread. Exposing only
 * callback-based operations (instead of public blocking methods) makes that confinement a
 * property of this class rather than something every caller has to remember.
 *
 * Serialising all tunnel work on one daemon thread also removes races between a connect and a
 * concurrent disconnect.
 *
 * This is a process-wide singleton on purpose. Swiping the task away destroys the React context
 * and its native modules but must not destroy the tunnel; the foreground keep-alive service keeps
 * the process alive, and a recreated module must reattach to the same manager. Never shut the
 * executor down while the process lives.
 */
class WireguardManager private constructor(private val context: Context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "vpnsky-tunnel").apply { isDaemon = true }
    }

    @Volatile
    private var backend: GoBackend? = null

    @Volatile
    private var tunnel: WireguardTunnel? = null

    /** Tunnel address from the active config, e.g. 10.0.0.12/32. Survives React-context recreation. */
    @Volatile
    private var assignedAddress: String? = null

    val isInitialized: Boolean get() = backend != null && tunnel != null

    @Synchronized
    fun initialize(tunnelName: String = "VPNSky") {
        if (backend != null && tunnel != null) return
        backend = GoBackend(context)
        tunnel = WireguardTunnel(tunnelName).apply {
            onStateChanged = { }
        }
    }

    @Synchronized
    fun setOnStateChanged(listener: (Tunnel.State) -> Unit) {
        tunnel?.onStateChanged = listener
    }

    fun isVpnAuthorized(): Boolean {
        return VpnService.prepare(context) == null
    }

    fun connect(config: Config, callback: (Result<Tunnel.State>) -> Unit) {
        val address = config.getInterface().getAddresses().firstOrNull()?.toString()
        submit(callback) {
            val b = backend ?: throw IllegalStateException("Backend not initialized")
            val t = tunnel ?: throw IllegalStateException("Tunnel not initialized")
            val state = b.setState(t, Tunnel.State.UP, config)
            assignedAddress = address
            state
        }
    }

    fun disconnect(callback: (Result<Tunnel.State>) -> Unit) {
        submit(callback) {
            val b = backend ?: throw IllegalStateException("Backend not initialized")
            val t = tunnel ?: throw IllegalStateException("Tunnel not initialized")
            val state = b.setState(t, Tunnel.State.DOWN, null)
            assignedAddress = null
            state
        }
    }

    fun getAssignedAddress(callback: (String?) -> Unit) {
        callback(assignedAddress)
    }

    fun getState(callback: (Tunnel.State?) -> Unit) {
        submit(
            callback = { result -> callback(result.getOrNull()) },
            block = {
                val b = backend
                val t = tunnel
                if (b == null || t == null) null else b.getState(t)
            },
        )
    }

    fun getStatistics(callback: (Statistics?) -> Unit) {
        submit(
            callback = { result -> callback(result.getOrNull()) },
            block = {
                val b = backend
                val t = tunnel
                if (b == null || t == null) null else b.getStatistics(t)
            },
        )
    }

    fun getVersion(callback: (String?) -> Unit) {
        submit({ result -> callback(result.getOrNull()) }, { backend?.getVersion() })
    }

    private fun <T> submit(callback: (Result<T>) -> Unit, block: () -> T) {
        try {
            executor.execute {
                callback(runCatching(block))
            }
        } catch (e: RejectedExecutionException) {
            callback(Result.failure(e))
        }
    }

    companion object {
        @Volatile
        private var instance: WireguardManager? = null

        fun getInstance(context: Context): WireguardManager =
            instance ?: synchronized(this) {
                instance ?: WireguardManager(context.applicationContext).also { instance = it }
            }

        fun getBackendExceptionReason(e: Throwable): String {
            return when (e) {
                is BackendException -> e.reason.toString()
                else -> e.message ?: "Unknown error"
            }
        }
    }
}
