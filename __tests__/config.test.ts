import {
  isEndpoint,
  isTunnelAddress,
  isWireguardKey,
  loadAppConfig,
} from '../src/config';

const KEY = `${'A'.repeat(43)}=`;

describe('remote-config validation', () => {
  it('accepts IPv4 and IPv6 tunnel addresses', () => {
    expect(isTunnelAddress('10.0.0.5/32')).toBe(true);
    expect(isTunnelAddress('10.0.0.5')).toBe(true);
    expect(isTunnelAddress('fd00::5/128')).toBe(true);
    expect(isTunnelAddress('::1')).toBe(true);
  });

  it('rejects conf-injection and out-of-range addresses', () => {
    expect(isTunnelAddress('10.0.0.5/32\n[Peer]')).toBe(false);
    expect(isTunnelAddress('999.0.0.5/32')).toBe(false);
    expect(isTunnelAddress('10.0.0.5/33')).toBe(false);
    expect(isTunnelAddress('')).toBe(false);
  });

  it('accepts only well-formed host:port endpoints', () => {
    expect(isEndpoint('51.79.212.34:15221')).toBe(true);
    expect(isEndpoint('[2001:db8::1]:51820')).toBe(true);
    expect(isEndpoint('vpn.example.com:51820')).toBe(true);
    expect(isEndpoint('vpn.example.com')).toBe(false);
    expect(isEndpoint('vpn.example.com:0')).toBe(false);
    expect(isEndpoint('vpn.example.com:70000')).toBe(false);
    expect(isEndpoint('vpn.example.com:51820\n[Peer]')).toBe(false);
  });

  it('accepts a 32-byte base64 WireGuard key and nothing shorter', () => {
    expect(isWireguardKey(KEY)).toBe(true);
    expect(isWireguardKey(KEY.slice(0, -1))).toBe(false);
    expect(isWireguardKey(`${KEY}\n`)).toBe(false);
  });
});

describe('loadAppConfig', () => {
  it('defaults to a full tunnel when vpn_allowed_ips is unset', async () => {
    const config = await loadAppConfig();
    expect(config.allowedIps).toEqual(['0.0.0.0/0', '::/0']);
    expect(config.persistentKeepalive).toBeNull();
    expect(config.serverEndpoint).toBe('');
  });
});
