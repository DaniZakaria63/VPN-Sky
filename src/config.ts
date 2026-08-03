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
}

const DEFAULTS: Record<string, string> = {
  base_api_url: '',
  registry_token: '',
  vpn_dns: '',
  vpn_allowed_ips: '',
  vpn_server_public_key: '',
  vpn_endpoint: '',
  vpn_persistent_keepalive: '',
};

export async function loadAppConfig(): Promise<AppConfig> {
  const rc = getRemoteConfig();
  rc.defaultConfig = DEFAULTS;
  await fetchAndActivate(rc);
  return {
    baseUrl: getValue(rc, 'base_api_url').asString().trim(),
    registryToken: getValue(rc, 'registry_token').asString().trim(),
    dns: parseList(getValue(rc, 'vpn_dns').asString()),
    allowedIps: parseList(getValue(rc, 'vpn_allowed_ips').asString()),
    serverPublicKey: getValue(rc, 'vpn_server_public_key').asString().trim(),
    serverEndpoint: getValue(rc, 'vpn_endpoint').asString().trim(),
    persistentKeepalive: toInt(
      getValue(rc, 'vpn_persistent_keepalive').asString(),
    ),
  };
}

export async function registerClient(
  publicKey: string,
  config: AppConfig,
): Promise<string> {
  const { baseUrl, registryToken } = config;
  if (!baseUrl) {
    return Promise.reject(new Error('No base API URL configured'));
  }
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/register`, {
    method: 'POST',
    headers: {
      'X-Registry-Token': registryToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ public_key: publicKey }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = JSON.stringify(await res.json());
    } catch {}
    const err = new Error(`Registration failed: ${res.status} ${detail}`) as Error & {
      code?: string;
    };
    err.code = 'VPN_REGISTER_FAILED';
    return Promise.reject(err);
  }
  const body = (await res.json()) as { address?: string };
  const address = String(body.address ?? '').trim();
  if (!address) {
    return Promise.reject(new Error('Registry returned no tunnel address'));
  }
  return address;
}

function parseList(v: string[] | string | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function toInt(v: number | string | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function buildConf(cfg: AssignedConfig, clientPrivateKey: string): string {
  const lines: string[] = ['[Interface]', `PrivateKey = ${clientPrivateKey}`];
  if (cfg.address) lines.push(`Address = ${cfg.address}`);
  if (cfg.dns && cfg.dns.length) lines.push(`DNS = ${cfg.dns.join(', ')}`);
  lines.push('', '[Peer]');
  lines.push(`PublicKey = ${cfg.serverPublicKey}`);
  if (cfg.serverEndpoint) lines.push(`Endpoint = ${cfg.serverEndpoint}`);
  if (cfg.allowedIps && cfg.allowedIps.length) {
    lines.push(`AllowedIPs = ${cfg.allowedIps.join(', ')}`);
  }
  if (cfg.persistentKeepalive != null) {
    lines.push(`PersistentKeepalive = ${cfg.persistentKeepalive}`);
  }
  return lines.join('\n');
}

export async function buildVpnConfig(): Promise<PreparedConfig> {
  const config = await loadAppConfig();
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
  };
}
