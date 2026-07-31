package com.wingsheep.vpn.model

sealed class VpnState {
    data object Disconnected : VpnState()
    data object Connecting : VpnState()
    data object Connected : VpnState()
    data class Error(val message: String, val reason: String? = null) : VpnState()
}
