import { endpointHost, lookupServerLocation } from '../src/geo';

const realFetch = globalThis.fetch;

type Route = (url: string) => unknown | null;

/** Routes requests by URL so the two-hop (DoH -> geo) flow can be asserted. */
function mockRoutes(route: Route) {
  const calls: string[] = [];
  const fn = jest.fn(async (url: string) => {
    calls.push(String(url));
    const body = route(String(url));
    return { ok: body !== null, json: async () => body };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { calls, fn };
}

const geoOk = { success: true, city: 'Singapore', country_code: 'SG' };
const dohOk = { Status: 0, Answer: [{ type: 1, data: '139.99.88.23' }] };

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('endpointHost', () => {
  it('strips the port from an IPv4 endpoint', () => {
    expect(endpointHost('51.79.212.34:15221')).toBe('51.79.212.34');
  });

  it('keeps a hostname intact', () => {
    expect(endpointHost('vpn.example.com:51820')).toBe('vpn.example.com');
  });

  it('unwraps a bracketed IPv6 literal', () => {
    expect(endpointHost('[2001:db8::1]:51820')).toBe('2001:db8::1');
  });

  it('tolerates an empty endpoint', () => {
    expect(endpointHost('   ')).toBe('');
  });
});

describe('lookupServerLocation', () => {
  it('looks a bare IPv4 up directly, skipping DNS', async () => {
    const { calls } = mockRoutes((url) => (url.includes('ipwho.is') ? geoOk : null));
    await expect(lookupServerLocation('51.79.212.34:15221')).resolves.toBe('Singapore, SG');
    expect(calls).toEqual(['https://ipwho.is/51.79.212.34']);
  });

  it('resolves a hostname over DoH first, then looks up the IP', async () => {
    const { calls } = mockRoutes((url) => {
      if (url.startsWith('https://dns.google/resolve')) return dohOk;
      if (url.includes('ipwho.is')) return geoOk;
      return null;
    });
    await expect(lookupServerLocation('vpn.dream-team.works:15221')).resolves.toBe(
      'Singapore, SG',
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('name=vpn.dream-team.works');
    expect(calls[1]).toBe('https://ipwho.is/139.99.88.23');
  });

  it('gives up when the hostname does not resolve', async () => {
    const { calls } = mockRoutes(() => null);
    await expect(lookupServerLocation('vpn.nowhere.example:15221')).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('falls back to the region when no city is reported', async () => {
    mockRoutes(() => ({ success: true, region: 'Central Singapore', country_code: 'SG' }));
    await expect(lookupServerLocation('51.79.212.35:15221')).resolves.toBe(
      'Central Singapore, SG',
    );
  });

  it('caches a hit instead of re-querying', async () => {
    const { calls } = mockRoutes(() => geoOk);
    await lookupServerLocation('51.79.212.36:15221');
    await lookupServerLocation('51.79.212.36:15221');
    expect(calls).toHaveLength(1);
  });

  it('returns null when the service reports failure', async () => {
    mockRoutes(() => ({ success: false, message: 'reserved range' }));
    await expect(lookupServerLocation('10.0.0.9:15221')).resolves.toBeNull();
  });

  it('returns null instead of throwing when the network fails', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(lookupServerLocation('51.79.212.37:15221')).resolves.toBeNull();
  });
});
