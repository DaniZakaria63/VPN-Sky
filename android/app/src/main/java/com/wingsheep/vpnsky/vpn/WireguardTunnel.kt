package com.wingsheep.vpnsky.vpn

import com.wireguard.android.backend.Tunnel

class WireguardTunnel(private val name: String) : Tunnel {
    private var state: Tunnel.State = Tunnel.State.DOWN
    var onStateChanged: ((Tunnel.State) -> Unit)? = null

    override fun getName(): String = name

    override fun onStateChange(newState: Tunnel.State) {
        state = newState
        onStateChanged?.invoke(newState)
    }
}