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
 * concurrent disconnect. Operations submitted after [shutdown] fail their callback instead of
 * throwing from an executor that no longer accepts work.
 */
class WireguardManager(private val context: Context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "vpnsky-tunnel").apply { isDaemon = true }
    }

    @Volatile
    private var backend: GoBackend? = null

    @Volatile
    private var tunnel: WireguardTunnel? = null

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
        submit(callback) {
            val b = backend ?: throw IllegalStateException("Backend not initialized")
            val t = tunnel ?: throw IllegalStateException("Tunnel not initialized")
            b.setState(t, Tunnel.State.UP, config)
        }
    }

    fun disconnect(callback: (Result<Tunnel.State>) -> Unit) {
        submit(callback) {
            val b = backend ?: throw IllegalStateException("Backend not initialized")
            val t = tunnel ?: throw IllegalStateException("Tunnel not initialized")
            b.setState(t, Tunnel.State.DOWN, null)
        }
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

    fun shutdown() {
        executor.shutdown()
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
        fun getBackendExceptionReason(e: Throwable): String {
            return when (e) {
                is BackendException -> e.reason.toString()
                else -> e.message ?: "Unknown error"
            }
        }
    }
}
