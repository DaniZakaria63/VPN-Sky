import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connect as nativeConnect,
  disconnect as nativeDisconnect,
  getState,
  getStatistics,
  getVersion,
  isVpnAuthorized,
  isVpnSupported,
  loadClientConf,
  onVpnStateChange,
  requestVpnPermission,
  VpnStatistics,
} from '../native/vpn';

export type VpnUiState =
  | { kind: 'Disconnected' }
  | { kind: 'Connecting' }
  | { kind: 'Disconnecting' }
  | { kind: 'Connected'; rxBytes: number; txBytes: number }
  | { kind: 'PermissionRequired' }
  | { kind: 'Error'; message: string; reason?: string };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface VpnController {
  status: VpnUiState;
  vpnVersion: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isBusy: boolean;
}

export function useVpn(): VpnController {
  const [status, setStatus] = useState<VpnUiState>({ kind: 'Disconnected' });
  const [vpnVersion, setVpnVersion] = useState<string | null>(null);
  const connectingRef = useRef(false);
  const disconnectingRef = useRef(false);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyStats = useCallback((s: VpnStatistics) => {
    setStatus(prev =>
      prev.kind === 'Connected'
        ? { kind: 'Connected', rxBytes: s.rxBytes, txBytes: s.txBytes }
        : prev,
    );
  }, []);

  const stopStatsPolling = useCallback(() => {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
  }, []);

  const startStatsPolling = useCallback(() => {
    stopStatsPolling();
    statsTimerRef.current = setInterval(async () => {
      try {
        const stats = await getStatistics();
        if (stats) applyStats(stats);
      } catch {
        // Tunnel state events remain authoritative when statistics are unavailable.
      }
    }, 2000);
  }, [applyStats, stopStatsPolling]);

  const syncNativeState = useCallback(async () => {
    const state = await getState();
    if (state === 'Connected') {
      setStatus({ kind: 'Connected', rxBytes: 0, txBytes: 0 });
      startStatsPolling();
    } else {
      setStatus({ kind: 'Disconnected' });
      stopStatsPolling();
    }
  }, [startStatsPolling, stopStatsPolling]);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const version = await getVersion();
        if (!disposed) setVpnVersion(version);
        if (isVpnSupported) await syncNativeState();
      } catch (e) {
        if (!disposed) {
          setStatus({
            kind: 'Error',
            message: (e as { message?: string }).message ?? 'VPN initialization failed',
          });
        }
      }
    })();

    const unsubscribe = onVpnStateChange(state => {
      if (state === 'Connected') {
        connectingRef.current = false;
        disconnectingRef.current = false;
        setStatus(prev => ({
          kind: 'Connected',
          rxBytes: prev.kind === 'Connected' ? prev.rxBytes : 0,
          txBytes: prev.kind === 'Connected' ? prev.txBytes : 0,
        }));
        startStatsPolling();
      } else if (state === 'Disconnected') {
        connectingRef.current = false;
        disconnectingRef.current = false;
        stopStatsPolling();
        setStatus({ kind: 'Disconnected' });
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
      stopStatsPolling();
    };
  }, [startStatsPolling, stopStatsPolling, syncNativeState]);

  const connect = useCallback(async () => {
    if (connectingRef.current) {
      return;
    }
    connectingRef.current = true;

    if (!isVpnSupported) {
      connectingRef.current = false;
      setStatus({ kind: 'Error', message: 'WireGuard is unavailable on this build.' });
      return;
    }

    setStatus({ kind: 'Connecting' });

    let conf: string | null = null;
    try {
      conf = await loadClientConf();
    } catch {
      conf = null;
    }
    if (!conf) {
      connectingRef.current = false;
      setStatus({ kind: 'Error', message: 'No VPN config found. Missing client.conf in app assets.' });
      return;
    }

    try {
      if (!(await isVpnAuthorized())) {
        setStatus({ kind: 'PermissionRequired' });
        const granted = await requestVpnPermission();
        if (!granted) {
          connectingRef.current = false;
          setStatus({ kind: 'Error', message: 'VPN permission was not granted.' });
          return;
        }
        setStatus({ kind: 'Connecting' });
      }
    } catch (e) {
      connectingRef.current = false;
      setStatus({
        kind: 'Error',
        message: (e as { message?: string }).message ?? 'VPN permission request failed',
      });
      return;
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await nativeConnect(conf);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt < 3) {
          await sleep(500);
        }
      }
    }

    connectingRef.current = false;
    if (lastError) {
      const err = lastError as { code?: string; message?: string };
      setStatus({
        kind: 'Error',
        message: err.message ?? 'Connection failed',
        reason: err.code,
      });
    } else {
      setStatus({ kind: 'Connected', rxBytes: 0, txBytes: 0 });
      startStatsPolling();
    }
  }, [startStatsPolling]);

  const disconnect = useCallback(async () => {
    if (disconnectingRef.current) return;
    disconnectingRef.current = true;
    setStatus({ kind: 'Disconnecting' });
    if (!isVpnSupported) {
      stopStatsPolling();
      disconnectingRef.current = false;
      setStatus({ kind: 'Disconnected' });
      return;
    }
    try {
      await nativeDisconnect();
    } catch (e) {
      disconnectingRef.current = false;
      setStatus({
        kind: 'Error',
        message: (e as { message?: string }).message ?? 'Disconnect failed',
      });
      return;
    }
    stopStatsPolling();
    disconnectingRef.current = false;
    setStatus({ kind: 'Disconnected' });
  }, [stopStatsPolling]);

  return {
    status,
    vpnVersion,
    connect,
    disconnect,
    isBusy:
      status.kind === 'Connecting' ||
      status.kind === 'Disconnecting' ||
      status.kind === 'PermissionRequired',
  };
}
