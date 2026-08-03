import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVpn, VpnStateKind, VpnUiState } from '../hooks/useVpn';
import { isVpnSupported } from '../native/vpn';
import { AppTheme } from '../theme';

interface Props {
  theme: AppTheme;
}

function statusLabel(state: VpnUiState): string {
  switch (state.kind) {
    case VpnStateKind.Connected:
      return 'Orbit secured';
    case VpnStateKind.Connecting:
      return 'Launching secure tunnel';
    case VpnStateKind.Disconnecting:
      return 'Returning to base';
    case VpnStateKind.PermissionRequired:
      return 'Launch clearance required';
    case VpnStateKind.Error:
      return 'Launch failed';
    default:
      return 'Ready at base';
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function FireBurn({ size, style }: { size: number; style?: object }) {
  const flicker = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0, duration: 190, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0.7, duration: 150, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [flicker]);

  const scale = flicker.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] });
  const lean = flicker.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '5deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLabel="Animated fire"
      style={[styles.fireBurn, { width: size, height: size * 1.18 }, style, { transform: [{ scale }, { rotate: lean }] }]}
    >
      <View style={[styles.fireOuter, { borderRadius: size * 0.45 }]} />
      <View style={[styles.fireInner, { width: size * 0.46, height: size * 0.68, borderRadius: size * 0.3 }]} />
      <View style={[styles.fireCore, { width: size * 0.2, height: size * 0.4, borderRadius: size * 0.16 }]} />
    </Animated.View>
  );
}

function RocketScene({ state }: { state: VpnUiState }) {
  // motion: 0 = grounded & zoomed-in, 1 = in space & zoomed-out.
  const motion = useRef(new Animated.Value(0)).current;
  const heading = useRef(new Animated.Value(0)).current;
  const earthSpin = useRef(new Animated.Value(0)).current;
  const flame = useRef(new Animated.Value(0.65)).current;

  const launching = state.kind === VpnStateKind.Connecting;
  const flying = state.kind === VpnStateKind.Connected;
  const blasting = launching || flying || state.kind === VpnStateKind.Disconnecting;
  const grounded = !launching && !flying && state.kind !== VpnStateKind.Disconnecting;

  // Advance the rocket between grounded/zoomed-in and flying/zoomed-out.
  useEffect(() => {
    // toValue 1 = flying/zoomed-out (Connecting climbs, Connected stays up).
    // Disconnecting, idle, error, permission all return to base.
    const goUp =
      state.kind === VpnStateKind.Connecting || state.kind === VpnStateKind.Connected;
    Animated.timing(motion, {
      toValue: goUp ? 1 : 0,
      duration:
        state.kind === VpnStateKind.Connecting
          ? 2100
          : state.kind === VpnStateKind.Disconnecting
          ? 1700
          : 1500,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [motion, state.kind]);

  // Stay upright during launch, then turn into horizontal flight once connected.
  useEffect(() => {
    Animated.timing(heading, {
      toValue: flying ? 1 : 0,
      duration: flying ? 900 : 550,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [flying, heading]);

  // Earth spins only during connected flight. Keep base orientation stable while idle.
  useEffect(() => {
    if (!flying) {
      earthSpin.stopAnimation();
      earthSpin.setValue(0);
      return;
    }
    const earthLoop = Animated.loop(
      Animated.timing(earthSpin, {
        toValue: 1,
        duration: 7000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    earthLoop.start();
    return () => earthLoop.stop();
  }, [earthSpin, flying]);

  // Thrust plume flickers while consuming fuel; fades out when grounded.
  useEffect(() => {
    const flameLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flame, { toValue: 1, duration: 130, useNativeDriver: true }),
        Animated.timing(flame, { toValue: 0.5, duration: 110, useNativeDriver: true }),
      ]),
    );
    if (blasting) {
      flameLoop.start();
    } else {
      flame.stopAnimation();
      flame.setValue(0.65);
    }
    return () => flameLoop.stop();
  }, [flame, blasting]);

  // Camera + ramp: base is a close-up; launch pulls back to normal scene size.
  const zoom = motion.interpolate({ inputRange: [0, 1], outputRange: [1.38, 1] });
  // Rocket rests on Earth's upper rim at base, then climbs and turns horizontal.
  const rocketY = motion.interpolate({ inputRange: [0, 1], outputRange: [-24, -112] });
  const rocketRotate = heading.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });
  const earthRotation = earthSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-360deg'],
  });

  const connectionStatus =
    state.kind === VpnStateKind.Connected
      ? 'CONNECTED'
      : state.kind === VpnStateKind.Connecting
      ? 'CONNECTING'
      : state.kind === VpnStateKind.Disconnecting
      ? 'DISCONNECTING'
      : 'READY';

  return (
    <View style={styles.space} accessibilityLabel={statusLabel(state)}>
      <View style={styles.starField} pointerEvents="none">
        {[
          [12, 18, 3], [27, 39, 2], [45, 14, 2], [62, 31, 4], [78, 12, 2],
          [89, 42, 3], [18, 68, 2], [72, 66, 2], [92, 78, 2],
        ].map(([left, top, size]) => (
          <View
            key={`${left}-${top}`}
            style={[styles.star, { left: `${left}%`, top: `${top}%`, width: size, height: size }]}
          />
        ))}
      </View>

      <View style={styles.connectionOverlay} pointerEvents="none">
        <View style={styles.connectionHeader}>
          <View
            style={[
              styles.connectionIndicator,
              state.kind === VpnStateKind.Connected && styles.connectionIndicatorLive,
              state.kind === VpnStateKind.Connecting && styles.connectionIndicatorActive,
            ]}
          />
          <Text style={styles.connectionStatus}>{connectionStatus}</Text>
        </View>
        {state.kind === VpnStateKind.Connected ? (
          <View style={styles.connectionDetails}>
            <View>
              <Text style={styles.connectionLabel}>SERVER LOCATION</Text>
              <Text style={styles.connectionValue}>Jakarta, Indonesia</Text>
            </View>
            <View>
              <Text style={styles.connectionLabel}>DEVICE IP</Text>
              <Text style={styles.connectionValue}>10.0.0.3</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.connectionMessage}>
            {state.kind === VpnStateKind.Connecting
              ? 'Establishing secure route...'
              : state.kind === VpnStateKind.Disconnecting
              ? 'Closing secure route...'
              : 'Secure route offline'}
          </Text>
        )}
      </View>

      <Animated.View
        style={[
          styles.rocketWrap,
          {
            transform: [
              { scale: zoom },
              { translateY: rocketY },
              { rotate: rocketRotate },
            ],
          },
        ]}>
        {state.kind === VpnStateKind.Error ? (
          <>
            <FireBurn size={70} style={styles.fireBottom} />
            <FireBurn size={27} style={styles.fireTopRight} />
            <FireBurn size={31} style={styles.fireMiddleLeft} />
          </>
        ) : null}
        <View style={styles.rocketNose} />
        <View style={styles.rocketBody}>
          <View style={styles.rocketWindow} />
        </View>
        <View style={styles.rocketFins}>
          <View style={[styles.fin, styles.finLeft]} />
          <View style={[styles.fin, styles.finRight]} />
        </View>
        {blasting && !grounded ? (
          <Animated.View
            style={[
              styles.flame,
              launching && styles.flameLaunching,
              flying && styles.flameFlying,
              { transform: [{ scaleY: flame }] },
            ]}>
            <View style={styles.flameCore} />
          </Animated.View>
        ) : null}
      </Animated.View>

      <View style={styles.baseGlow} />
      <Animated.View
        style={[
          styles.earth,
          { transform: [{ scale: zoom }, { rotate: earthRotation }] },
        ]}>
        <View style={[styles.land, styles.landOne]} />
        <View style={[styles.land, styles.landTwo]} />
        <View style={[styles.land, styles.landThree]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.earthShade,
          { transform: [{ scale: zoom }] },
        ]}
      />
    </View>
  );
}

export function HomeScreen({ theme: _theme }: Props) {
  const insets = useSafeAreaInsets();
  const [aboutVisible, setAboutVisible] = useState(false);
  const { status, vpnVersion, connect, disconnect, isBusy } = useVpn();
  const connected = status.kind === VpnStateKind.Connected;
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
        onPress={connected ? disconnect : connect}
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
  space: {
    flex: 1,
    minHeight: 300,
    marginTop: 16,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#091B35',
    borderWidth: 1,
    borderColor: '#15365D',
  },
  starField: StyleSheet.absoluteFill,
  star: { position: 'absolute', borderRadius: 4, backgroundColor: '#D6F3FF', opacity: 0.8 },
  fireBurn: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-end',
    shadowColor: '#FF5A24',
    shadowOpacity: 0.9,
    shadowRadius: 14,
    elevation: 9,
  },
  fireBottom: { top: 68, left: -7, zIndex: -1 },
  fireTopRight: { top: 7, left: 46, zIndex: -1 },
  fireMiddleLeft: { top: 43, left: -24, zIndex: -1 },
  fireOuter: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: '86%',
    backgroundColor: '#F04425',
    transform: [{ rotate: '45deg' }],
  },
  fireInner: {
    position: 'absolute',
    bottom: 1,
    backgroundColor: '#FF9F1C',
    transform: [{ rotate: '45deg' }],
  },
  fireCore: {
    position: 'absolute',
    bottom: 2,
    backgroundColor: '#FFE69A',
    transform: [{ rotate: '45deg' }],
  },
  connectionOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    zIndex: 6,
    padding: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(5, 19, 39, 0.82)',
    borderWidth: 1,
    borderColor: '#1B5276',
  },
  connectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectionIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#71849B',
  },
  connectionIndicatorActive: { backgroundColor: '#FFC857' },
  connectionIndicatorLive: { backgroundColor: '#55E39B' },
  connectionStatus: {
    color: '#DCEAFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  connectionDetails: {
    flexDirection: 'row',
    gap: 28,
    marginTop: 10,
  },
  connectionLabel: {
    color: '#6D98BC',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  connectionValue: { color: '#F2F8FF', fontSize: 13, fontWeight: '700', marginTop: 3 },
  connectionMessage: { color: '#88A5C1', fontSize: 11, marginTop: 7 },
  rocketWrap: {
    position: 'absolute',
    zIndex: 4,
    // Align visible rocket base with earth top; wrapper has 33 px unused space below flame.
    bottom: 109,
    alignSelf: 'center',
    width: 58,
    height: 112,
    alignItems: 'center',
  },
  rocketNose: {
    width: 36,
    height: 29,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#F4F7FB',
  },
  rocketBody: {
    width: 36,
    height: 50,
    alignItems: 'center',
    backgroundColor: '#E5ECF5',
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
  },
  rocketWindow: {
    width: 17,
    height: 17,
    marginTop: 3,
    borderRadius: 9,
    backgroundColor: '#38C8F4',
    borderWidth: 3,
    borderColor: '#1C5273',
  },
  rocketFins: { position: 'absolute', top: 57, width: 58, flexDirection: 'row', justifyContent: 'space-between' },
  fin: { width: 14, height: 29, backgroundColor: '#FF5B58' },
  finLeft: { borderTopLeftRadius: 12, transform: [{ skewY: '-18deg' }] },
  finRight: { borderTopRightRadius: 12, transform: [{ skewY: '18deg' }] },
  flame: {
    width: 15,
    height: 31,
    marginTop: -2,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: '#FFB31A',
    borderTopWidth: 8,
    borderTopColor: '#FF6138',
  },
  flameLaunching: {
    height: 42,
    width: 19,
    marginTop: -4,
    borderTopWidth: 10,
  },
  flameFlying: {
    height: 20,
    width: 18,
    marginTop: 2,
    borderTopWidth: 3,
  },
  flameCore: {
    position: 'absolute',
    alignSelf: 'center',
    top: 2,
    width: 7,
    height: '78%',
    borderRadius: 6,
    backgroundColor: '#FFF3A1',
  },
  baseGlow: {
    position: 'absolute',
    bottom: 76,
    alignSelf: 'center',
    width: 180,
    height: 50,
    borderRadius: 90,
    backgroundColor: 'rgba(44, 188, 255, 0.12)',
  },
  earth: {
    position: 'absolute',
    bottom: -78,
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: 'hidden',
    backgroundColor: '#168FD1',
    borderWidth: 5,
    borderColor: '#47D8F5',
  },
  earthShade: {
    position: 'absolute',
    bottom: -72,
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderRightWidth: 42,
    borderRightColor: 'rgba(1, 30, 72, 0.38)',
  },
  land: { position: 'absolute', backgroundColor: '#62D397', borderRadius: 28 },
  landOne: { width: 82, height: 47, left: 20, top: 28, transform: [{ rotate: '17deg' }] },
  landTwo: { width: 63, height: 89, right: 18, top: 75, transform: [{ rotate: '-23deg' }] },
  landThree: { width: 48, height: 35, left: 32, bottom: 24 },
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
