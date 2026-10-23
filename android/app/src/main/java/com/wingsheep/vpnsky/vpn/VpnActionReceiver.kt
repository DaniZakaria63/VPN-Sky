package com.wingsheep.vpnsky.vpn

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles the "Disconnect" action on the VPN foreground notification. It talks to the process-wide
 * [WireguardManager] directly, so the tunnel can be closed even when the React context is gone
 * (for example after the task was swiped away).
 */
class VpnActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != VpnForegroundService.ACTION_DISCONNECT) {
            return
        }
        WireguardManager.getInstance(context.applicationContext).disconnect { result ->
            if (result.isSuccess) {
                VpnForegroundService.stop(context)
            }
        }
    }
}
