package com.wingsheep.vpnsky.vpn

import com.wireguard.android.backend.Tunnel

/**
 * Minimal [Tunnel] implementation. The WireGuard backend invokes [onStateChange] from its own
 * worker thread, so the callback reference is volatile: it is replaced at startup from another
 * thread and read from the backend thread.
 */
class WireguardTunnel(private val name: String) : Tunnel {
    @Volatile
    var onStateChanged: ((Tunnel.State) -> Unit)? = null

    override fun getName(): String = name

    override fun onStateChange(newState: Tunnel.State) {
        onStateChanged?.invoke(newState)
    }
}
