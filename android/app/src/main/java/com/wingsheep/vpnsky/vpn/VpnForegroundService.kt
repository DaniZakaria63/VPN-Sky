package com.wingsheep.vpnsky.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import com.wingsheep.vpnsky.MainActivity
import com.wingsheep.vpnsky.R

/**
 * Keeps the process (and therefore the WireGuard `GoBackend$VpnService`) alive while a tunnel is
 * active.
 *
 * The tunnel library starts a plain background service. Without a foreground component, Android —
 * and especially OEM task cleaners such as Transsion's — may kill the whole process as soon as the
 * app is swiped out of recents, which tears the VPN down. This service raises the process to
 * foreground importance and posts the required ongoing notification.
 *
 * It never owns tunnel state: [VpnSkyVpnModule] starts it before a connect, updates it on state
 * events, and stops it when the tunnel goes down. The notification exposes a Disconnect action so
 * the tunnel can be closed without reopening the app.
 */
class VpnForegroundService : Service() {

    companion object {
        private const val TAG = "VpnForegroundService"
        private const val CHANNEL_ID = "vpn_status"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_UPDATE = "com.wingsheep.vpnsky.action.VPN_FOREGROUND_UPDATE"
        const val ACTION_DISCONNECT = "com.wingsheep.vpnsky.action.VPN_DISCONNECT"
        private const val EXTRA_CONNECTED = "connected"

        /** Starts or re-prompts the foreground service. Safe to call repeatedly. */
        fun start(context: Context, connected: Boolean) {
            val intent = Intent(context, VpnForegroundService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_CONNECTED, connected)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                // Background-start restrictions must not make connect() fail. The tunnel still
                // works; it just loses the foreground protection on this attempt.
                android.util.Log.w(TAG, "Unable to start VPN foreground service", e)
            }
        }

        /**
         * Updates the existing notification without starting the service again. Used from tunnel
         * state callbacks, which can run while the app is in the background.
         */
        fun update(context: Context, connected: Boolean) {
            try {
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(NOTIFICATION_ID, buildNotification(context, connected))
            } catch (e: Exception) {
                android.util.Log.w(TAG, "Unable to update VPN notification", e)
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, VpnForegroundService::class.java))
            } catch (_: Exception) {
                // Nothing to stop.
            }
            try {
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.cancel(NOTIFICATION_ID)
            } catch (_: Exception) {
                // Notification may not exist.
            }
        }

        private fun buildNotification(context: Context, connected: Boolean): Notification {
            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val contentIntent = PendingIntent.getActivity(
                context,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            val disconnectIntent = Intent(context, VpnActionReceiver::class.java).apply {
                action = ACTION_DISCONNECT
            }
            val disconnectPending = PendingIntent.getBroadcast(
                context,
                1,
                disconnectIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            @Suppress("DEPRECATION")
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(context, CHANNEL_ID)
            } else {
                Notification.Builder(context)
            }
            builder
                .setSmallIcon(R.drawable.ic_stat_vpn)
                .setContentTitle(
                    context.getString(
                        if (connected) R.string.vpn_notification_connected
                        else R.string.vpn_notification_connecting,
                    ),
                )
                .setContentText(context.getString(R.string.vpn_notification_text))
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(
                    Notification.Action.Builder(
                        Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel),
                        context.getString(R.string.vpn_notification_disconnect),
                        disconnectPending,
                    ).build(),
                )
            return builder.build()
        }
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.vpn_notification_channel),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.vpn_notification_channel_description)
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            // START_NOT_STICKY: never advertise a connected tunnel we cannot restore.
            stopSelf()
            return START_NOT_STICKY
        }
        val connected = intent.getBooleanExtra(EXTRA_CONNECTED, false)
        val notification = buildNotification(this, connected)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "startForeground failed; stopping keep-alive service", e)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Keep the foreground service and the tunnel alive when the task is swiped away.
        android.util.Log.i(TAG, "Task removed; VPN foreground service stays up")
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
