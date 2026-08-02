import {
  fetchAndActivate,
  getRemoteConfig,
  getValue,
  Value,
} from '@react-native-firebase/remote-config';
import { ensureClientKey, rotateClientKey } from './native/vpn';

export { rotateClientKey }

export interface AppConfig {
  vpnAddress: string;
  vpnDns: string[];
  vpnAllowedIps: string[];
  vpnServerPublicKey: string;
  vpnEndpoint: string;
  vpnPersistentKeepalive: number | null;
}

export interface PreparedConfig {
  readonly conf: string;
  readonly clientPublicKey: string;
}

const DEFAULTS: Record<string, string> = {
  vpn_address: '',
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

  const read = (key: string): Value => getValue(rc, key);

  const dns = read('vpn_dns')
    .asString()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowedIps = read('vpn_allowed_ips')
    .asString()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const pka = read('vpn_persistent_keepalive').asString().trim();

  return {
    vpnAddress: read('vpn_address').asString().trim(),
    vpnDns: dns,
    vpnAllowedIps: allowedIps,
    vpnServerPublicKey: read('vpn_server_public_key').asString().trim(),
    vpnEndpoint: read('vpn_endpoint').asString().trim(),
    vpnPersistentKeepalive: pka ? parseInt(pka, 10) : null,
  };
}

function buildConf(config: AppConfig, clientPrivateKey: string): string {
  const lines: string[] = ['[Interface]', `PrivateKey = ${clientPrivateKey}`];
  if (config.vpnAddress) lines.push(`Address = ${config.vpnAddress}`);
  if (config.vpnDns.length) lines.push(`DNS = ${config.vpnDns.join(', ')}`);
  lines.push('', '[Peer]');
  lines.push(`PublicKey = ${config.vpnServerPublicKey}`);
  if (config.vpnEndpoint) lines.push(`Endpoint = ${config.vpnEndpoint}`);
  if (config.vpnAllowedIps.length) {
    lines.push(`AllowedIPs = ${config.vpnAllowedIps.join(', ')}`);
  }
  if (config.vpnPersistentKeepalive != null) {
    lines.push(`PersistentKeepalive = ${config.vpnPersistentKeepalive}`);
  }
  return lines.join('\n');
}

export async function buildVpnConfig(remote?: AppConfig): Promise<PreparedConfig> {
  const config = remote ?? (await loadAppConfig());
  const keyPair = await ensureClientKey();
  if (!keyPair) {
    return Promise.reject(new Error('VPN is not supported on this platform'));
  }
  return {
    conf: buildConf(config, keyPair.privateKey),
    clientPublicKey: keyPair.publicKey,
  };
}