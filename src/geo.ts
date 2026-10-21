/**
 * Best-effort server location from the endpoint.
 *
 * The WireGuard conf carries either "ip:port" or "host:port". React Native has
 * no DNS API, so a hostname is resolved over DNS-over-HTTPS (Google's JSON
 * endpoint) before the IP is looked up.
 *
 * Deliberate constraints:
 *  - HTTPS only. The manifest sets `usesCleartextTraffic` from a build
 *    placeholder, so the HTTP-only free geo APIs (ip-api.com) would fail on a
 *    release build.
 *  - Arbitrary hostnames are not sent to the geo service — that API only speaks
 *    IPs, and the ISP-issued reverse DNS name is not a location anyway (an OVH
 *    Singapore box can still report a `*.vps.ovh.ca` hostname).
 *  - Successes are cached; failures are not, so a flaky network recovers on a
 *    later connect.
 *  - Called only once the tunnel is up, so these queries egress through the VPN
 *    instead of advertising the handset's own address.
 */

const TIMEOUT_MS = 4000;
const CACHE_LIMIT = 32;
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const geoCache = new Map<string, string>();
const dnsCache = new Map<string, string>();

/**
 * Bounded insertion-order cache. A long-lived process can cycle through many endpoints, so an
 * unbounded map would be a slow memory leak for a value that is only a display label.
 */
function remember(cache: Map<string, string>, key: string, value: string) {
  if (cache.size >= CACHE_LIMIT && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, value);
}


interface GeoResponse {
  success?: boolean;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
}

interface DohResponse {
  Status?: number;
  Answer?: { type?: number; data?: string }[];
}

/** "1.2.3.4:51820" -> "1.2.3.4"; "[2001:db8::1]:51820" -> "2001:db8::1". */
export function endpointHost(endpoint: string): string {
  const value = endpoint.trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : '';
  }
  const colon = value.lastIndexOf(':');
  return colon > 0 ? value.slice(0, colon) : value;
}

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve an A record over DoH. Returns null when there is no usable answer. */
async function resolveHost(host: string): Promise<string | null> {
  const hit = dnsCache.get(host);
  if (hit) {
    return hit;
  }
  const body = await getJson<DohResponse>(
    `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`,
  );
  const answer = body?.Answer?.find((a) => a.type === 1 && a.data && IPV4.test(a.data));
  if (!answer?.data) {
    return null;
  }
  remember(dnsCache, host, answer.data);
  return answer.data;
}

function label(body: GeoResponse): string | null {
  const place = body.city?.trim() || body.region?.trim() || body.country?.trim();
  const area = body.country_code?.trim().toUpperCase();
  if (!place) {
    return null;
  }
  return area && area !== place.toUpperCase() ? `${place}, ${area}` : place;
}

/**
 * Returns "Singapore, SG" or null. Never throws — a failed lookup must not
 * affect the tunnel or the rest of the UI.
 */
export async function lookupServerLocation(endpoint: string): Promise<string | null> {
  let host = endpointHost(endpoint);
  if (!host) {
    return null;
  }

  if (!IPV4.test(host)) {
    if (!HOSTNAME.test(host)) {
      return null;
    }
    const resolved = await resolveHost(host);
    if (!resolved) {
      return null;
    }
    host = resolved;
  }

  const hit = geoCache.get(host);
  if (hit) {
    return hit;
  }

  const body = await getJson<GeoResponse>(`https://ipwho.is/${host}`);
  if (!body?.success) {
    return null;
  }
  const text = label(body);
  if (text) {
    remember(geoCache, host, text);
  }
  return text;
}
