import {
  fetchAndActivate,
  getRemoteConfig,
  getValue,
} from '@react-native-firebase/remote-config';
import { ensureClientKey, rotateClientKey } from './native/vpn';

export { rotateClientKey };

export interface AppConfig {
  baseUrl: string;
  registryToken: string;
  dns: string[];
  allowedIps: string[];
  serverPublicKey: string;
  serverEndpoint: string;
  /** Human label for where the server sits; Remote Config has no way to infer it. */
  serverLocation: string;
  persistentKeepalive: number | null;
}

export interface AssignedConfig {
  address: string;
  serverPublicKey: string;
  serverEndpoint: string;
  dns: string[];
  allowedIps: string[];
  persistentKeepalive: number | null;
}

export interface PreparedConfig {
  readonly conf: string;
  readonly clientPublicKey: string;
  /** Tunnel address this install was assigned by the registry, e.g. 10.0.0.5/32. */
  readonly address: string;
  /** Endpoint actually written into the conf — the truth about where traffic goes. */
  readonly serverEndpoint: string;
  /** Human label from Remote Config; empty when unset. */
  readonly serverLocation: string;
}

const DEFAULTS: Record<string, string> = {
  base_api_url: '',
  registry_token: '',
  vpn_dns: '',
  vpn_allowed_ips: '',
  vpn_server_public_key: '',
  vpn_endpoint: '',
  vpn_server_location: '',
  vpn_persistent_keepalive: '',
};

/** A VPN that routes nothing is worse than an explicit failure; default to full tunnel. */
const DEFAULT_ALLOWED_IPS = ['0.0.0.0/0', '::/0'];
const REGISTER_TIMEOUT_MS = 15_000;
const REGISTER_ATTEMPTS = 2;

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const IPV4_CIDR = new RegExp(`^${OCTET}(\\.${OCTET}){3}(/(3[0-2]|[12]?\\d))?$`);
/** Deliberately conservative: enough to stop conf injection, not a full IPv6 grammar. */
const IPV6_CIDR = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}(\/(12[0-8]|1[01]\d|[1-9]?\d))?$/i;
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const ENDPOINT = /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?):(\d{1,5})$/i;
const WG_KEY = /^[A-Za-z0-9+/]{43}=$/;

type CodedError = Error & { code?: string };

function fail(message: string, code: string): never {
  const error = new Error(message) as CodedError;
  error.code = code;
  throw error;
}

export function isTunnelAddress(value: string): boolean {
  return IPV4_CIDR.test(value) || IPV6_CIDR.test(value);
}

export function isWireguardKey(value: string): boolean {
  return WG_KEY.test(value);
}

export function isEndpoint(value: string): boolean {
  const match = ENDPOINT.exec(value);
  if (!match) {
    return false;
  }
  const port = Number(match[3]);
  return port > 0 && port <= 65535;
}

export async function loadAppConfig(): Promise<AppConfig> {
  const rc = getRemoteConfig();
  rc.defaultConfig = DEFAULTS;
  try {
    await fetchAndActivate(rc);
  } catch (e) {
    if (__DEV__) {
      console.warn('Remote config fetch failed, using cached/defaults:', e);
    }
  }
  const allowedIps = parseList(getValue(rc, 'vpn_allowed_ips').asString()).filter(isTunnelAddress);
  return {
    baseUrl: getValue(rc, 'base_api_url').asString().trim(),
    registryToken: getValue(rc, 'registry_token').asString().trim(),
    dns: parseList(getValue(rc, 'vpn_dns').asString()).filter(isHostOrIp),
    allowedIps: allowedIps.length ? allowedIps : [...DEFAULT_ALLOWED_IPS],
    serverPublicKey: getValue(rc, 'vpn_server_public_key').asString().trim(),
    serverEndpoint: getValue(rc, 'vpn_endpoint').asString().trim(),
    serverLocation: getValue(rc, 'vpn_server_location').asString().trim(),
    persistentKeepalive: toKeepalive(
      getValue(rc, 'vpn_persistent_keepalive').asString(),
    ),
  };
}

/**
 * Registers this install's public key and returns the tunnel address the registry assigned.
 *
 * The response is untrusted input that is spliced into a WireGuard configuration, so the address
 * is validated before it can reach the native parser. A hung TCP connection must not leave the
 * UI in "Connecting" forever, hence the per-attempt timeout.
 */
export async function registerClient(
  publicKey: string,
  config: AppConfig,
): Promise<string> {
  const { baseUrl, registryToken } = config;
  if (!baseUrl) {
    fail('No server URL configured in Remote Config (base_api_url is empty)', 'VPN_CONFIG_MISSING');
  }
  if (!isWireguardKey(publicKey)) {
    fail('Native module returned an invalid client public key', 'VPN_KEY_INVALID');
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= REGISTER_ATTEMPTS; attempt += 1) {
    try {
      return await registerOnce(baseUrl, registryToken, publicKey);
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      const retryable = status === undefined || status >= 500;
      if (!retryable || attempt === REGISTER_ATTEMPTS) {
        break;
      }
      await sleep(400 * attempt);
    }
  }
  throw lastError;
}

async function registerOnce(
  baseUrl: string,
  registryToken: string,
  publicKey: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/register`, {
      method: 'POST',
      headers: {
        'X-Registry-Token': registryToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ public_key: publicKey }),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      fail('VPN registration timed out', 'VPN_REGISTER_TIMEOUT');
    }
    fail('VPN registration failed: network unreachable', 'VPN_REGISTER_NETWORK');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    const error = new Error(
      `Registration failed: ${res.status} ${detail.slice(0, 200)}`,
    ) as CodedError & { status?: number };
    error.code = 'VPN_REGISTER_FAILED';
    error.status = res.status;
    throw error;
  }

  let body: { address?: unknown };
  try {
    body = (await res.json()) as { address?: unknown };
  } catch {
    fail('Registry returned a malformed response', 'VPN_REGISTER_INVALID');
  }
  const address = String(body.address ?? '').trim();
  if (!address) {
    fail('Registry returned no tunnel address', 'VPN_REGISTER_INVALID');
  }
  if (!isTunnelAddress(address)) {
    fail('Registry returned an invalid tunnel address', 'VPN_REGISTER_INVALID');
  }
  return address;
}

function parseList(v: string[] | string | undefined): string[] {
  if (!v) return [];
  const raw = Array.isArray(v) ? v.map(String) : String(v).split(',');
  return Array.from(
    new Set(
      raw
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/[\r\n]/.test(s)),
    ),
  );
}

function isHostOrIp(value: string): boolean {
  return IPV4.test(value) || HOST.test(value) || IPV6_CIDR.test(value);
}

function toKeepalive(v: number | string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) {
    return null;
  }
  return Math.trunc(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertConnectable(config: AppConfig): void {
  if (!isWireguardKey(config.serverPublicKey)) {
    fail(
      'Remote Config is missing a valid vpn_server_public_key',
      'VPN_CONFIG_MISSING',
    );
  }
  if (!isEndpoint(config.serverEndpoint)) {
    fail('Remote Config is missing a valid vpn_endpoint', 'VPN_CONFIG_MISSING');
  }
}

function buildConf(cfg: AssignedConfig, clientPrivateKey: string): string {
  if (!isWireguardKey(clientPrivateKey)) {
    fail('Native module returned an invalid client private key', 'VPN_KEY_INVALID');
  }
  if (!isTunnelAddress(cfg.address)) {
    fail('Refusing to write an invalid tunnel address', 'VPN_CONFIG_INVALID');
  }

  const lines: string[] = ['[Interface]', `PrivateKey = ${clientPrivateKey}`];
  lines.push(`Address = ${cfg.address}`);
  if (cfg.dns.length) lines.push(`DNS = ${cfg.dns.join(', ')}`);
  lines.push('', '[Peer]');
  lines.push(`PublicKey = ${cfg.serverPublicKey}`);
  lines.push(`Endpoint = ${cfg.serverEndpoint}`);
  if (cfg.allowedIps.length) {
    lines.push(`AllowedIPs = ${cfg.allowedIps.join(', ')}`);
  }
  if (cfg.persistentKeepalive != null) {
    lines.push(`PersistentKeepalive = ${cfg.persistentKeepalive}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function buildVpnConfig(): Promise<PreparedConfig> {
  const config = await loadAppConfig();
  // Fail before touching the network or the key store when Remote Config is incomplete.
  assertConnectable(config);

  const keyPair = await ensureClientKey();
  if (!keyPair) {
    return Promise.reject(new Error('VPN is not supported on this platform'));
  }
  const address = await registerClient(keyPair.publicKey, config);
  return {
    conf: buildConf(
      {
        address,
        serverPublicKey: config.serverPublicKey,
        serverEndpoint: config.serverEndpoint,
        dns: config.dns,
        allowedIps: config.allowedIps,
        persistentKeepalive: config.persistentKeepalive,
      },
      keyPair.privateKey,
    ),
    clientPublicKey: keyPair.publicKey,
    address,
    serverEndpoint: config.serverEndpoint,
    serverLocation: config.serverLocation,
  };
}
