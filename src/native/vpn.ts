import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type VpnState = 'Disconnected' | 'Connecting' | 'Connected' | 'Error';

export interface VpnStatistics {
  rxBytes: number;
  txBytes: number;
}

interface VpnNativeModule {
  getVersion(): Promise<string>;
  isVpnAuthorized(): Promise<boolean>;
  requestVpnPermission(): Promise<boolean>;
  connect(conf: string): Promise<string>;
  disconnect(): Promise<string>;
  getState(): Promise<string>;
  getStatistics(): Promise<VpnStatistics>;
  loadClientConf(): Promise<string>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const MODULE_NAME = 'VpnConnectManager';
const STATE_EVENT = 'onVpnStateChange';

const native: VpnNativeModule | null =
  Platform.OS === 'android' ? (NativeModules[MODULE_NAME] as VpnNativeModule | undefined) ?? null : null;

const stateEmitter = native
  ? new NativeEventEmitter(native as never)
  : null;

export const isVpnSupported = native !== null;

export function getVersion(): Promise<string> {
  if (!native) {
    return Promise.resolve('Unavailable (iOS)');
  }
  return native.getVersion();
}

export function isVpnAuthorized(): Promise<boolean> {
  if (!native) {
    return Promise.resolve(false);
  }
  return native.isVpnAuthorized();
}

export function requestVpnPermission(): Promise<boolean> {
  if (!native) {
    return Promise.resolve(false);
  }
  return native.requestVpnPermission();
}

export function connect(conf: string): Promise<void> {
  if (!native) {
    return Promise.reject(new Error('VPN is not supported on this platform'));
  }
  return native.connect(conf).then(() => undefined);
}

export function disconnect(): Promise<void> {
  if (!native) {
    return Promise.resolve();
  }
  return native.disconnect().then(() => undefined);
}

export function getState(): Promise<VpnState | null> {
  if (!native) {
    return Promise.resolve(null);
  }
  return native.getState() as Promise<VpnState>;
}

export function getStatistics(): Promise<VpnStatistics | null> {
  if (!native) {
    return Promise.resolve(null);
  }
  return native.getStatistics();
}

export function loadClientConf(): Promise<string | null> {
  if (!native) {
    return Promise.resolve(null);
  }
  return native.loadClientConf();
}

export function onVpnStateChange(listener: (state: VpnState) => void): () => void {
  if (!stateEmitter) {
    return () => {};
  }
  const sub = stateEmitter.addListener(STATE_EVENT, payload => {
    listener(payload.state as VpnState);
  });
  return () => sub.remove();
}