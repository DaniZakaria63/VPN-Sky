package com.wingsheep.vpn.model

import com.wireguard.config.Config
import com.wireguard.config.InetEndpoint
import com.wireguard.config.InetNetwork
import com.wireguard.config.Interface
import com.wireguard.config.Peer
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import java.io.InputStream
import java.net.InetAddress

data class VpnConfig(
    val tunnelName: String = "VPNSky",
    val privateKey: String,
    val address: String,
    val dnsServers: List<String> = emptyList(),
    val serverPublicKey: String,
    val endpoint: String,
    val allowedIps: List<String> = listOf("0.0.0.0/0", "::/0"),
    val preSharedKey: String? = null,
    val persistentKeepalive: Int? = null,
    val mtu: Int? = null,
    val listenPort: Int? = null
) {
    fun toWireguardConfig(): Config {
        val interfaceBuilder = Interface.Builder()
            .setKeyPair(KeyPair(Key.fromBase64(privateKey)))

        for (addr in address.split(",")) {
            interfaceBuilder.addAddress(InetNetwork.parse(addr.trim()))
        }

        for (dns in dnsServers) {
            interfaceBuilder.addDnsServer(InetAddress.getByName(dns))
        }

        mtu?.let { interfaceBuilder.setMtu(it) }
        listenPort?.let { interfaceBuilder.setListenPort(it) }

        val peerBuilder = Peer.Builder()
            .setPublicKey(Key.fromBase64(serverPublicKey))

        if (endpoint.isNotEmpty()) {
            peerBuilder.setEndpoint(InetEndpoint.parse(endpoint))
        }

        for (ip in allowedIps) {
            peerBuilder.addAllowedIp(InetNetwork.parse(ip))
        }

        preSharedKey?.let { peerBuilder.setPreSharedKey(Key.fromBase64(it)) }
        persistentKeepalive?.let { peerBuilder.setPersistentKeepalive(it) }

        return Config.Builder()
            .setInterface(interfaceBuilder.build())
            .addPeer(peerBuilder.build())
            .build()
    }

    fun toConfString(): String {
        val sb = StringBuilder()
        sb.append("[Interface]\n")
        sb.append("PrivateKey = $privateKey\n")
        sb.append("Address = $address\n")
        if (dnsServers.isNotEmpty()) {
            sb.append("DNS = ${dnsServers.joinToString(", ")}\n")
        }
        listenPort?.let { sb.append("ListenPort = $it\n") }
        mtu?.let { sb.append("MTU = $it\n") }

        sb.append("\n[Peer]\n")
        sb.append("PublicKey = $serverPublicKey\n")
        if (endpoint.isNotEmpty()) {
            sb.append("Endpoint = $endpoint\n")
        }
        sb.append("AllowedIPs = ${allowedIps.joinToString(", ")}\n")
        preSharedKey?.let { sb.append("PreSharedKey = $it\n") }
        persistentKeepalive?.let { sb.append("PersistentKeepalive = $it\n") }

        return sb.toString()
    }

    companion object {
        fun generateKeyPair(): Pair<String, String> {
            val keyPair = KeyPair()
            return Pair(keyPair.privateKey.toBase64(), keyPair.publicKey.toBase64())
        }

        fun parseFromConf(input: InputStream): VpnConfig {
            val config = Config.parse(input)
            val iface = config.getInterface()
            val peer = config.peers.first()

            return VpnConfig(
                tunnelName = "VPNSky",
                privateKey = iface.keyPair.privateKey.toBase64(),
                address = iface.addresses.joinToString(", ") { it.toString() },
                dnsServers = iface.dnsServers.mapNotNull { it.hostAddress }.toList(),
                serverPublicKey = peer.publicKey.toBase64(),
                endpoint = peer.endpoint.orElse(null)?.toString() ?: "",
                allowedIps = peer.allowedIps.map { it.toString() }.toList(),
                preSharedKey = peer.preSharedKey.orElse(null)?.toBase64(),
                persistentKeepalive = peer.persistentKeepalive.orElse(null),
                mtu = iface.mtu.orElse(null),
                listenPort = iface.listenPort.orElse(null)
            )
        }
    }
}
