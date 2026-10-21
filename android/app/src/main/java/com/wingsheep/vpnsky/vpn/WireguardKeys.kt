package com.wingsheep.vpnsky.vpn

import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair

/**
 * Curve25519 key material helpers.
 *
 * Tunnel configuration is parsed straight into `com.wireguard.config.Config` by the native module,
 * so this file deliberately has no `.conf` model, parser, or serializer: a second config code path
 * would be unused code that can drift from the real one.
 */
object WireguardKeys {
    /** Generates a fresh keypair. The private key is base64 (the WireGuard wire format). */
    fun generateKeyPair(): Pair<String, String> {
        val keyPair = KeyPair()
        return Pair(keyPair.privateKey.toBase64(), keyPair.publicKey.toBase64())
    }

    /** Derives the public key for a persisted private key; throws when the key is malformed. */
    fun publicKeyFor(privateKey: String): String =
        KeyPair(Key.fromBase64(privateKey)).publicKey.toBase64()
}
