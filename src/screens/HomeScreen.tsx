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
import { useVpn, VpnUiState } from '../hooks/useVpn';
import { isVpnSupported } from '../native/vpn';
import { accentColors, AppTheme } from '../theme';

interface Props {
  theme: AppTheme;
}

function statusLabel(state: VpnUiState): string {
  switch (state.kind) {
    case 'Connected':
      return 'Orbit secured';
    case 'Connecting':
      return 'Launching secure tunnel';
    case 'Disconnecting':
      return 'Returning to base';
    case 'PermissionRequired':
      return 'Launch clearance required';
    case 'Error':
      return 'Launch failed';
    default:
      return 'Ready at base';
  }
}

function statusColor(state: VpnUiState): string {
  switch (state.kind) {
    case 'Connected':
      return accentColors.green;
    case 'Connecting':
    case 'Disconnecting':
      return accentColors.connecting;
    case 'Error':
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
  const journey = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const earthSpin = useRef(new Animated.Value(0)).current;
  const flame = useRef(new Animated.Value(0.65)).current;
  const burn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const destination =
      state.kind === 'Connected' || state.kind === 'Disconnecting' ? 1 : 0;
    const duration = state.kind === 'Disconnecting' ? 1500 : 1800;
    Animated.timing(journey, {
      toValue: destination,
      duration,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [journey, state.kind]);

  useEffect(() => {
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: -8,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 8,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    if (state.kind === 'Connected') {
      bobLoop.start();
    } else {
      bob.stopAnimation();
      bob.setValue(0);
    }
    return () => bobLoop.stop();
  }, [bob, state.kind]);

  useEffect(() => {
    const earthLoop = Animated.loop(
      Animated.timing(earthSpin, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    earthLoop.start();
    return () => earthLoop.stop();
  }, [earthSpin]);

  useEffect(() => {
    const flameLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flame, {
          toValue: 1,
          duration: 130,
          useNativeDriver: true,
        }),
        Animated.timing(flame, {
          toValue: 0.55,
          duration: 110,
          useNativeDriver: true,
        }),
      ]),
    );
    if (state.kind === 'Connecting' || state.kind === 'Disconnecting') {
      flameLoop.start();
    } else {
      flame.stopAnimation();
      flame.setValue(0.65);
    }
    return () => flameLoop.stop();
  }, [flame, state.kind]);

  useEffect(() => {
    Animated.timing(burn, {
      toValue: state.kind === 'Error' ? 1 : 0,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [burn, state.kind]);

  const rocketTranslateY = Animated.add(
    journey.interpolate({ inputRange: [0, 1], outputRange: [72, -100] }),
    bob,
  );
  const rocketRotate = journey.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: ['0deg', '-5deg', '3deg'],
  });
  const earthRotation = earthSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const showFlame = state.kind === 'Connecting' || state.kind === 'Disconnecting';

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
          { transform: [{ translateY: rocketTranslateY }, { rotate: rocketRotate }] },
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
        {showFlame ? (
          <Animated.View
            style={[styles.flame, { transform: [{ scaleY: flame }] }]}
          />
        ) : null}
      </Animated.View>

      <View style={styles.baseGlow} />
      <Animated.View style={[styles.earth, { transform: [{ rotate: earthRotation }] }]}>
        <View style={[styles.land, styles.landOne]} />
        <View style={[styles.land, styles.landTwo]} />
        <View style={[styles.land, styles.landThree]} />
      </Animated.View>
      <View style={styles.earthShade} />
    </View>
  );
}

export function HomeScreen({ theme: _theme }: Props) {
  const insets = useSafeAreaInsets();
  const { status, vpnVersion, connect, disconnect, isBusy } = useVpn();
  const connected = status.kind === 'Connected';
  const connectEnabled =
    isVpnSupported &&
    (status.kind === 'Disconnected' ||
      status.kind === 'Error' ||
      status.kind === 'PermissionRequired');

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

      {status.kind === 'Error' ? (
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
          {status.kind === 'PermissionRequired'
            ? 'GRANT CLEARANCE'
            : status.kind === 'Connecting'
            ? 'LAUNCHING...'
            : status.kind === 'Disconnecting'
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
    top: '43%',
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
