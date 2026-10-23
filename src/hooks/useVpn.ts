import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { buildVpnConfig, loadAppConfig } from '../config';
import { lookupServerLocation } from '../geo';
import {
  connect as nativeConnect,
  disconnect as nativeDisconnect,
  getAssignedAddress,
  getState,
  getStatistics,
  getVersion,
  isVpnAuthorized,
  isVpnSupported,
  onVpnStateChange,
  requestVpnPermission,
  VpnStatistics,
} from '../native/vpn';

export enum VpnStateKind {
  Disconnected = 'Disconnected',
  Connecting = 'Connecting',
  Disconnecting = 'Disconnecting',
  Connected = 'Connected',
  PermissionRequired = 'PermissionRequired',
  Error = 'Error',
}

/**
 * What we actually know about the live tunnel. Every field here comes from the
 * registry response or Remote Config — nothing is invented, so the UI can show
 * an empty state instead of a plausible-looking lie.
 */
export interface VpnSession {
  /** Tunnel address assigned to this install, e.g. 10.0.0.5/32. */
  address: string;
  /** Endpoint written into the conf, e.g. 51.79.x.x:15221. */
  serverEndpoint: string;
  /** Operator-supplied location label; empty when unconfigured. */
  serverLocation: string;
}

export type VpnUiState =
  | { kind: VpnStateKind.Disconnected }
  | { kind: VpnStateKind.Connecting }
  | { kind: VpnStateKind.Disconnecting }
  | {
      kind: VpnStateKind.Connected;
      rxBytes: number;
      txBytes: number;
      /** Null when the app attached to an already-running tunnel it did not set up. */
      session: VpnSession | null;
    }
  | { kind: VpnStateKind.PermissionRequired }
  | { kind: VpnStateKind.Error; message: string; reason?: string };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const PERMISSION_TIMEOUT_MS = 120_000;
const STATS_INTERVAL_MS = 2000;

/** A native permission dialog that never answers must not strand the UI forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(message) as Error & { code?: string };
      error.code = 'VPN_PERMISSION_TIMEOUT';
      reject(error);
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface VpnController {
  status: VpnUiState;
  vpnVersion: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isBusy: boolean;
}

export function useVpn(): VpnController {
  const [status, setStatus] = useState<VpnUiState>({ kind: VpnStateKind.Disconnected });
  const [vpnVersion, setVpnVersion] = useState<string | null>(null);
  const connectingRef = useRef(false);
  const disconnectingRef = useRef(false);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsInFlightRef = useRef(false);
  const sessionRef = useRef<VpnSession | null>(null);
  const mountedRef = useRef(true);
  const lifecycleRef = useRef(0);
  /** When the UI last entered Connected; protects a fresh tunnel from a queued double-tap. */
  const connectedAtRef = useRef(0);
  /** Increments whenever the user starts an action, so stale async results can be discarded. */
  const actionSeqRef = useRef(0);
  // Remote Config alone tells us where the server is, so the card can still say
  // something true when the app reattaches to a tunnel it did not dial itself.
  const [configEndpoints, setConfigEndpoints] = useState<{
    serverEndpoint: string;
    serverLocation: string;
  } | null>(null);
  // Resolved by IP lookup; only used when no explicit location is configured.
  const [geoLocation, setGeoLocation] = useState<string | null>(null);

  const setStatusSafe = useCallback((next: VpnUiState) => {
    if (mountedRef.current) {
      setStatus(next);
    }
  }, []);

  const applyStats = useCallback((s: VpnStatistics) => {
    if (!mountedRef.current) {
      return;
    }
    setStatus(prev =>
      prev.kind === VpnStateKind.Connected
        ? { ...prev, rxBytes: s.rxBytes, txBytes: s.txBytes }
        : prev,
    );
  }, []);

  const stopStatsPolling = useCallback(() => {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
  }, []);

  const pollStats = useCallback(async () => {
    // A slow native call must not stack up one request per interval tick.
    if (statsInFlightRef.current) {
      return;
    }
    statsInFlightRef.current = true;
    try {
      const stats = await getStatistics();
      if (stats) applyStats(stats);
    } catch {
      // Tunnel state events remain authoritative when statistics are unavailable.
    } finally {
      statsInFlightRef.current = false;
    }
  }, [applyStats]);

  const startStatsPolling = useCallback(() => {
    stopStatsPolling();
    pollStats().catch(() => {});
    statsTimerRef.current = setInterval(() => {
      // No polling while backgrounded: the tunnel keeps running, the UI does not need bytes.
      if (AppState.currentState !== 'active') {
        return;
      }
      pollStats().catch(() => {});
    }, STATS_INTERVAL_MS);
  }, [pollStats, stopStatsPolling]);

  const syncNativeState = useCallback(async () => {
    const gen = lifecycleRef.current;
    const seq = actionSeqRef.current;
    const state = await getState().catch(() => null);
    if (state === 'Connected' && !sessionRef.current) {
      // A tunnel created before the React context was recreated has no JS-side session. Ask the
      // native singleton for the address from the live config instead of showing a blank IP.
      const address = await getAssignedAddress().catch(() => null);
      if (address) {
        sessionRef.current = { address, serverEndpoint: '', serverLocation: '' };
      }
    }
    if (!mountedRef.current || lifecycleRef.current !== gen || actionSeqRef.current !== seq) {
      return;
    }
    if (state === 'Connected') {
      connectedAtRef.current = Date.now();
      setStatusSafe({
        kind: VpnStateKind.Connected,
        rxBytes: 0,
        txBytes: 0,
        session: sessionRef.current,
      });
      startStatsPolling();
    } else {
      setStatusSafe({ kind: VpnStateKind.Disconnected });
      stopStatsPolling();
    }
  }, [setStatusSafe, startStatsPolling, stopStatsPolling]);

  useEffect(() => {
    mountedRef.current = true;
    const gen = lifecycleRef.current + 1;
    lifecycleRef.current = gen;
    const alive = () => mountedRef.current && lifecycleRef.current === gen;

    loadAppConfig()
      .then((c) => {
        if (alive()) {
          setConfigEndpoints({ serverEndpoint: c.serverEndpoint, serverLocation: c.serverLocation });
        }
      })
      .catch(() => {
        // Offline or unconfigured: the card falls back to empty states.
      });

    (async () => {
      try {
        const version = await getVersion();
        if (alive()) setVpnVersion(version);
        if (isVpnSupported) await syncNativeState();
      } catch (e) {
        if (alive()) {
          setStatus({
            kind: VpnStateKind.Error,
            message: (e as { message?: string }).message ?? 'VPN initialization failed',
          });
        }
      }
    })();

    const unsubscribe = onVpnStateChange(state => {
      if (!alive()) {
        return;
      }
      if (state === 'Connected') {
        connectingRef.current = false;
        disconnectingRef.current = false;
        connectedAtRef.current = Date.now();
        setStatus(prev => ({
          kind: VpnStateKind.Connected,
          rxBytes: prev.kind === VpnStateKind.Connected ? prev.rxBytes : 0,
          txBytes: prev.kind === VpnStateKind.Connected ? prev.txBytes : 0,
          session: sessionRef.current,
        }));
        startStatsPolling();
      } else if (state === 'Disconnected') {
        // Ignore the backend's transitional DOWN while a connect is still settling; the connect
        // promise either recovers or reports the failure, and a late DOWN must not fake success.
        if (connectingRef.current) {
          return;
        }
        connectingRef.current = false;
        disconnectingRef.current = false;
        stopStatsPolling();
        sessionRef.current = null;
        setStatus({ kind: VpnStateKind.Disconnected });
      }
    });

    // Returning from background should refresh immediately rather than wait for the next tick.
    const appStateSub = AppState.addEventListener('change', next => {
      if (next === 'active' && alive()) {
        pollStats().catch(() => {});
      }
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
      appStateSub.remove();
      stopStatsPolling();
    };
  }, [pollStats, startStatsPolling, stopStatsPolling, syncNativeState]);

  const connect = useCallback(async () => {
    if (connectingRef.current || disconnectingRef.current) {
      return;
    }
    connectingRef.current = true;
    const seq = actionSeqRef.current + 1;
    actionSeqRef.current = seq;
    const stillCurrent = () => mountedRef.current && actionSeqRef.current === seq;

    if (!isVpnSupported) {
      connectingRef.current = false;
      setStatusSafe({ kind: VpnStateKind.Error, message: 'WireGuard is unavailable on this build.' });
      return;
    }

    setStatusSafe({ kind: VpnStateKind.Connecting });

    let prepared;
    try {
      prepared = await buildVpnConfig();
    } catch (e) {
      if (stillCurrent()) {
        sessionRef.current = null;
        const err = e as { message?: string; code?: string };
        setStatusSafe({
          kind: VpnStateKind.Error,
          message: err.message ?? 'No VPN config found. Remote config is missing or unreachable.',
          reason: err.code,
        });
      }
      connectingRef.current = false;
      return;
    }

    if (!stillCurrent()) {
      connectingRef.current = false;
      return;
    }

    sessionRef.current = {
      address: prepared.address,
      serverEndpoint: prepared.serverEndpoint,
      serverLocation: prepared.serverLocation,
    };

    try {
      if (!(await isVpnAuthorized())) {
        if (stillCurrent()) {
          setStatusSafe({ kind: VpnStateKind.PermissionRequired });
        }
        const granted = await withTimeout(
          requestVpnPermission(),
          PERMISSION_TIMEOUT_MS,
          'VPN permission request timed out.',
        );
        if (!stillCurrent()) {
          connectingRef.current = false;
          return;
        }
        if (!granted) {
          sessionRef.current = null;
          connectingRef.current = false;
          setStatusSafe({ kind: VpnStateKind.Error, message: 'VPN permission was not granted.' });
          return;
        }
        setStatusSafe({ kind: VpnStateKind.Connecting });
      }
    } catch (e) {
      if (stillCurrent()) {
        sessionRef.current = null;
        const err = e as { message?: string; code?: string };
        setStatusSafe({
          kind: VpnStateKind.Error,
          message: err.message ?? 'VPN permission request failed',
          reason: err.code,
        });
      }
      connectingRef.current = false;
      return;
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await nativeConnect(prepared.conf);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt < 3) {
          await sleep(500);
        }
      }
    }

    if (!stillCurrent()) {
      connectingRef.current = false;
      return;
    }

    if (lastError) {
      // The backend can report failure after it has actually brought the tunnel up (or the
      // first attempt succeeded and a retry failed). Trust the backend's state over the error.
      const liveState = await getState().catch(() => null);
      if (!stillCurrent()) {
        connectingRef.current = false;
        return;
      }
      if (liveState !== 'Connected') {
        sessionRef.current = null;
        connectingRef.current = false;
        const err = lastError as { code?: string; message?: string };
        setStatusSafe({
          kind: VpnStateKind.Error,
          message: err.message ?? 'Connection failed',
          reason: err.code,
        });
        return;
      }
    }

    connectingRef.current = false;
    connectedAtRef.current = Date.now();
    setStatusSafe({
      kind: VpnStateKind.Connected,
      rxBytes: 0,
      txBytes: 0,
      session: sessionRef.current,
    });
    startStatsPolling();
  }, [setStatusSafe, startStatsPolling]);

  const disconnect = useCallback(async () => {
    if (disconnectingRef.current) return;
    // A fast double-tap can deliver the second tap just after the tunnel came up. Refuse to tear
    // down a connection that is younger than this settling window; a deliberate later tap works.
    if (Date.now() - connectedAtRef.current < 1200) return;
    disconnectingRef.current = true;
    const seq = actionSeqRef.current + 1;
    actionSeqRef.current = seq;
    const stillCurrent = () => mountedRef.current && actionSeqRef.current === seq;

    setStatusSafe({ kind: VpnStateKind.Disconnecting });
    if (!isVpnSupported) {
      stopStatsPolling();
      disconnectingRef.current = false;
      sessionRef.current = null;
      setStatusSafe({ kind: VpnStateKind.Disconnected });
      return;
    }

    try {
      await nativeDisconnect();
    } catch (e) {
      // Same principle as connect: a failed promise does not prove the tunnel is still up.
      const liveState = await getState().catch(() => null);
      if (liveState !== 'Disconnected' && stillCurrent()) {
        disconnectingRef.current = false;
        setStatusSafe({
          kind: VpnStateKind.Error,
          message: (e as { message?: string }).message ?? 'Disconnect failed',
        });
        return;
      }
    }

    disconnectingRef.current = false;
    if (!stillCurrent()) {
      return;
    }
    stopStatsPolling();
    sessionRef.current = null;
    setStatusSafe({ kind: VpnStateKind.Disconnected });
  }, [setStatusSafe, stopStatsPolling]);

  // A live session always wins; otherwise fill in what Remote Config knows (no
  // assigned address in that case).
  const baseSession =
    status.kind === VpnStateKind.Connected
      ? {
          address: status.session?.address || '',
          serverEndpoint:
            status.session?.serverEndpoint || configEndpoints?.serverEndpoint || '',
          serverLocation:
            status.session?.serverLocation || configEndpoints?.serverLocation || '',
        }
      : null;
  const resolvedEndpoint = baseSession?.serverEndpoint ?? '';
  const configuredLocation = baseSession?.serverLocation ?? '';
  const wantGeoLookup = !!resolvedEndpoint && !configuredLocation;

  // Only runs once the tunnel is up, so the lookup leaves through the VPN
  // rather than advertising the handset's own address to the geo service.
  useEffect(() => {
    if (!wantGeoLookup) {
      return;
    }
    let cancelled = false;
    lookupServerLocation(resolvedEndpoint).then((label) => {
      if (!cancelled && mountedRef.current && label) {
        setGeoLocation(label);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wantGeoLookup, resolvedEndpoint]);

  const effectiveStatus: VpnUiState =
    status.kind === VpnStateKind.Connected && baseSession
      ? {
          ...status,
          session: {
            ...baseSession,
            serverLocation: configuredLocation || geoLocation || '',
          },
        }
      : status;

  return {
    status: effectiveStatus,
    vpnVersion,
    connect,
    disconnect,
    isBusy:
      status.kind === VpnStateKind.Connecting ||
      status.kind === VpnStateKind.Disconnecting ||
      status.kind === VpnStateKind.PermissionRequired,
  };
}
