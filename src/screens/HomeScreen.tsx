import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVpn, VpnUiState } from '../hooks/useVpn';
import { accentColors, AppTheme } from '../theme';

interface Props {
  theme: AppTheme;
}

function statusLabel(state: VpnUiState): string {
  switch (state.kind) {
    case 'Connected':
      return 'Status: Connected';
    case 'Connecting':
      return 'Status: Connecting...';
    case 'PermissionRequired':
      return 'Status: Permission required';
    case 'Error':
      return `Status: Error - ${state.message}`;
    default:
      return 'Status: Disconnected';
  }
}

function statusColor(state: VpnUiState): string {
  switch (state.kind) {
    case 'Connected':
      return accentColors.green;
    case 'Connecting':
      return accentColors.connecting;
    case 'Error':
      return accentColors.error;
    default:
      return '#9E9E9E';
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

export function HomeScreen({ theme }: Props) {
  const insets = useSafeAreaInsets();
  const { status, vpnVersion, connect, disconnect, isBusy } = useVpn();

  const connectEnabled =
    status.kind === 'Disconnected' ||
    status.kind === 'Error' ||
    status.kind === 'PermissionRequired';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 },
      ]}>
      <View style={styles.statusCard}>
        <View
          style={[styles.statusDot, { backgroundColor: statusColor(status) }]}
        />
        <Text
          style={[styles.statusText, { color: theme.onSurface }]}
          accessibilityLiveRegion="polite">
          {statusLabel(status)}
        </Text>
      </View>

      {status.kind === 'Connected' && (
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: theme.onSurface }]}>
              {formatBytes(status.rxBytes)}
            </Text>
            <Text style={[styles.statLabel, { color: theme.onSurfaceVariant }]}>
              Received
            </Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: theme.onSurface }]}>
              {formatBytes(status.txBytes)}
            </Text>
            <Text style={[styles.statLabel, { color: theme.onSurfaceVariant }]}>
              Sent
            </Text>
          </View>
        </View>
      )}

      <Pressable
        onPress={connect}
        disabled={!connectEnabled || isBusy}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: theme.primary,
            opacity: pressed || !connectEnabled || isBusy ? 0.6 : 1,
          },
        ]}>
        <Text style={styles.buttonLabel}>
          {status.kind === 'PermissionRequired'
            ? 'Grant Permission'
            : isBusy
            ? 'Connecting...'
            : 'Connect'}
        </Text>
      </Pressable>

      <Pressable
        onPress={disconnect}
        disabled={status.kind !== 'Connected'}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: theme.surfaceVariant,
            opacity: pressed ? 0.6 : status.kind === 'Connected' ? 1 : 0.35,
          },
        ]}>
        <Text style={[styles.buttonLabel, { color: theme.onSurface }]}>
          Disconnect
        </Text>
      </Pressable>

      {status.kind === 'Error' && status.reason ? (
        <Text style={[styles.errorDetail, { color: theme.onSurfaceVariant }]}>
          Reason: {status.reason}
        </Text>
      ) : null}

      {vpnVersion ? (
        <Text style={[styles.version, { color: theme.onSurfaceVariant }]}>
          WireGuard {vpnVersion}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 12,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  button: {
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  errorDetail: {
    fontSize: 12,
    textAlign: 'center',
  },
  version: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    fontSize: 12,
  },
});