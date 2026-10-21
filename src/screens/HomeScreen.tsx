import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RocketScene } from '../components/RocketScene';
import { useVpn, VpnStateKind } from '../hooks/useVpn';
import { isVpnSupported } from '../native/vpn';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [aboutVisible, setAboutVisible] = useState(false);
  const { status, vpnVersion, connect, disconnect, isBusy } = useVpn();
  const connected = status.kind === VpnStateKind.Connected;
  const lastActionAtRef = useRef(0);

  // A connect can finish in a few hundred milliseconds. Without this gate, the second tap of a
  // fast double-tap lands on the freshly rendered "RETURN TO BASE" state and tears the tunnel
  // straight back down (observed on device as UP -> DOWN -> UP). Ignore taps while the previous
  // action is still settling; a deliberate later tap behaves normally.
  const onPrimaryPress = useCallback(() => {
    const now = Date.now();
    if (now - lastActionAtRef.current < 1000) {
      return;
    }
    lastActionAtRef.current = now;
    if (connected) {
      disconnect().catch(() => {});
    } else {
      connect().catch(() => {});
    }
  }, [connected, connect, disconnect]);
  const connectEnabled =
    isVpnSupported &&
    (status.kind === VpnStateKind.Disconnected ||
      status.kind === VpnStateKind.Error ||
      status.kind === VpnStateKind.PermissionRequired);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 14 }]}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>SECURE FLIGHT CONTROL</Text>
          <Text style={styles.title}>VPNSky</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open About"
          onPress={() => setAboutVisible(true)}
          style={({ pressed }) => [styles.aboutButton, pressed && styles.aboutButtonPressed]}>
          <Text style={styles.aboutButtonText}>ABOUT</Text>
          <Text style={styles.aboutButtonArrow}>›</Text>
        </Pressable>
      </View>

      <RocketScene state={status} />

      <View style={styles.telemetry}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>DOWNLINK</Text>
          <Text style={styles.statValue}>
            {connected ? formatBytes(status.rxBytes) : '--'}
          </Text>
        </View>
        <View style={styles.telemetryDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>UPLINK</Text>
          <Text style={styles.statValue}>
            {connected ? formatBytes(status.txBytes) : '--'}
          </Text>
        </View>
      </View>

      {status.kind === VpnStateKind.Error ? (
        <Text style={styles.errorDetail} numberOfLines={2}>
          {status.message}{status.reason ? ` (${status.reason})` : ''}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={connected ? 'Disconnect VPN' : 'Connect VPN'}
        onPress={onPrimaryPress}
        disabled={connected ? isBusy : !connectEnabled || isBusy}
        style={({ pressed }) => [
          styles.button,
          connected && styles.disconnectButton,
          (pressed || isBusy || (!connected && !connectEnabled)) && styles.buttonPressed,
        ]}>
        <Text style={styles.buttonLabel}>
          {status.kind === VpnStateKind.PermissionRequired
            ? 'GRANT CLEARANCE'
            : status.kind === VpnStateKind.Connecting
            ? 'LAUNCHING...'
            : status.kind === VpnStateKind.Disconnecting
            ? 'RETURNING...'
            : connected
            ? 'RETURN TO BASE'
            : isVpnSupported
            ? 'LAUNCH SECURE TUNNEL'
            : 'VPN UNAVAILABLE'}
        </Text>
      </Pressable>

      <Text style={styles.version}>
        {vpnVersion ? `ENGINE ${vpnVersion}` : 'WIREGUARD FLIGHT ENGINE'}
      </Text>

      <Modal
        animationType="fade"
        transparent
        visible={aboutVisible}
        onRequestClose={() => setAboutVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAboutVisible(false)}>
          <Pressable
            accessibilityViewIsModal
            onPress={event => event.stopPropagation()}
            style={[styles.aboutPanel, { paddingBottom: Math.max(insets.bottom, 22) }]}>
            <View style={styles.aboutPanelHeader}>
              <View>
                <Text style={styles.aboutEyebrow}>MISSION INFORMATION</Text>
                <Text style={styles.aboutTitle}>About VPNSky</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close About"
                hitSlop={10}
                onPress={() => setAboutVisible(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.aboutButtonPressed]}>
                <Text style={styles.closeButtonText}>×</Text>
              </Pressable>
            </View>

            <View style={styles.aboutSection}>
              <Text style={styles.aboutSectionNumber}>01</Text>
              <View style={styles.aboutSectionBody}>
                <Text style={styles.aboutSectionTitle}>DEVELOPER</Text>
                <Text style={styles.aboutSectionText}>
                  VPNSky is an Android VPN client built with React Native and a native Kotlin tunnel
                  engine.
                </Text>
              </View>
            </View>

            <View style={styles.aboutSection}>
              <Text style={styles.aboutSectionNumber}>02</Text>
              <View style={styles.aboutSectionBody}>
                <Text style={styles.aboutSectionTitle}>PROTOCOL</Text>
                <Text style={styles.aboutSectionText}>
                  WireGuard provides modern encrypted tunneling with a compact protocol and
                  cryptographic key-based authentication.
                </Text>
              </View>
            </View>

            <View style={styles.aboutSection}>
              <Text style={styles.aboutSectionNumber}>03</Text>
              <View style={styles.aboutSectionBody}>
                <Text style={styles.aboutSectionTitle}>PRIVACY POLICY</Text>
                <Text style={styles.aboutSectionText}>
                  VPNSky does not include advertising or analytics SDKs. VPN traffic is handled by
                  the configured WireGuard server. Connection statistics shown here remain on your
                  device.
                </Text>
              </View>
            </View>

            <Text style={styles.aboutVersion}>
              {vpnVersion ? `WireGuard engine ${vpnVersion}` : 'WireGuard flight engine'}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#071426',
    paddingHorizontal: 20,
    paddingTop: 18,
  },

  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  eyebrow: {
    color: '#54D6FF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.7,
  },

  title: {
    color: '#F6FAFF',
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -1,
  },

  aboutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: 'rgba(11, 31, 54, 0.88)',
    borderColor: '#2B7199',
  },

  aboutButtonPressed: { opacity: 0.55 },

  aboutButtonText: { color: '#DCEAFF', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },

  aboutButtonArrow: { color: '#54D6FF', fontSize: 18, lineHeight: 18, fontWeight: '500' },

  telemetry: {
    flexDirection: 'row',
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#0B1F36',
    borderWidth: 1,
    borderColor: '#183A5C',
  },

  telemetryDivider: { width: 1, marginVertical: 13, backgroundColor: '#244564' },

  statBox: { flex: 1, alignItems: 'center', paddingVertical: 12 },

  statLabel: { color: '#7093B8', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },

  statValue: { color: '#F6FAFF', fontSize: 18, fontWeight: '700', marginTop: 3 },

  errorDetail: { color: '#FF8B80', textAlign: 'center', fontSize: 11, marginTop: 8 },

  button: {
    marginTop: 14,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    backgroundColor: '#1CBCEB',
    shadowColor: '#20C6F5',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },

  disconnectButton: { backgroundColor: '#EF5D62', shadowColor: '#EF5D62' },

  buttonPressed: { opacity: 0.5, transform: [{ scale: 0.99 }] },

  buttonLabel: { color: '#04131F', fontSize: 13, fontWeight: '900', letterSpacing: 1.1 },

  version: { color: '#547597', textAlign: 'center', fontSize: 9, letterSpacing: 1.2, marginTop: 9 },

  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
    backgroundColor: 'rgba(1, 8, 19, 0.78)',
  },

  aboutPanel: {
    borderRadius: 28,
    paddingTop: 22,
    paddingHorizontal: 20,
    backgroundColor: '#0A1C32',
    borderWidth: 1,
    borderColor: '#24527A',
  },

  aboutPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  aboutEyebrow: {
    color: '#54D6FF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.6,
  },

  aboutTitle: { color: '#F6FAFF', fontSize: 25, fontWeight: '800', marginTop: 3 },

  closeButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: '#112E4B',
    borderWidth: 1,
    borderColor: '#285579',
  },

  closeButtonText: { color: '#CFE8FA', fontSize: 25, lineHeight: 27, fontWeight: '300' },

  aboutSection: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: '#173956',
  },

  aboutSectionNumber: {
    color: '#3FCBF5',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 1,
  },

  aboutSectionBody: { flex: 1 },

  aboutSectionTitle: {
    color: '#DDEEFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
  },

  aboutSectionText: { color: '#91ABC3', fontSize: 12, lineHeight: 18, marginTop: 5 },

  aboutVersion: {
    color: '#547999',
    fontSize: 9,
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: 3,
  },
});
