import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVpn, VpnStateKind, VpnUiState } from '../hooks/useVpn';
import { isVpnSupported } from '../native/vpn';
import { accentColors, AppTheme } from '../theme';

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

function statusColor(state: VpnUiState): string {
  switch (state.kind) {
    case VpnStateKind.Connected:
      return accentColors.green;
    case VpnStateKind.Connecting:
    case VpnStateKind.Disconnecting:
      return accentColors.connecting;
    case VpnStateKind.Error:
      return accentColors.error;
    default:
      return '#8EA0BA';
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

function RocketScene({ state }: { state: VpnUiState }) {
  // motion: 0 = grounded & zoomed-in, 1 = in space & zoomed-out.
  const motion = useRef(new Animated.Value(0)).current;
  const heading = useRef(new Animated.Value(0)).current;
  const earthSpin = useRef(new Animated.Value(0)).current;
  const flame = useRef(new Animated.Value(0.65)).current;
  const burn = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    Animated.timing(burn, {
      toValue: state.kind === VpnStateKind.Error ? 1 : 0,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [burn, state.kind]);

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
        <Animated.View
          style={[styles.burnCloud, { opacity: burn, transform: [{ scale: burn }] }]}
        />
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
        <View style={[styles.statusPill, { borderColor: statusColor(status) }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor(status) }]} />
          <Text style={styles.statusPillText}>{statusLabel(status)}</Text>
        </View>
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
  statusPill: {
    maxWidth: '55%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: 'rgba(11, 31, 54, 0.88)',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillText: { color: '#DCEAFF', fontSize: 11, fontWeight: '700', flexShrink: 1 },
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
  burnCloud: {
    position: 'absolute',
    top: 40,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#E84726',
    shadowColor: '#FFB000',
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 10,
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
});
