/**
 * URL validation for anything the agent is about to fetch.
 *
 * A sourcing agent takes URLs from users and from search results, then asks a
 * server to retrieve them. That is a server-side request forgery primitive
 * unless it is fenced off. We allow only http(s) to public hosts, and we
 * re-check after every redirect rather than trusting the first hop.
 */

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  normalized?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud instance metadata services. Reaching these from a fetcher leaks
  // credentials on most hosting platforms.
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

const BLOCKED_EXACT_IPS = new Set([
  '169.254.169.254', // AWS / Azure / GCP / DigitalOcean IMDS
  '100.100.100.200', // Alibaba Cloud
  '192.0.0.192', // Oracle Cloud
]);

export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Blocked scheme "${url.protocol}". Only http and https are fetched.` };
  }

  // Credentials in a URL are almost always an attempt to smuggle something.
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs containing credentials are not fetched.' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `Blocked host "${host}".` };
  }
  // A hostname with no dot cannot be a public DNS name.
  if (!host.includes('.') && !host.includes(':')) {
    return { ok: false, reason: `Blocked non-public hostname "${host}".` };
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, reason: `Blocked internal domain "${host}".` };
  }
  if (BLOCKED_EXACT_IPS.has(host)) {
    return { ok: false, reason: 'Blocked cloud metadata endpoint.' };
  }
  if (isPrivateIpLiteral(host)) {
    return { ok: false, reason: `Blocked private or reserved IP address "${host}".` };
  }

  return { ok: true, normalized: url.toString() };
}

/**
 * Detect private/reserved addresses written directly into the host position.
 *
 * This does not resolve DNS. A hostname that resolves to a private address is
 * still a hole; closing it properly requires resolving and pinning the socket,
 * which we cannot do through a third-party scraping API. That residual gap is
 * documented in the README under Known limitations. In practice the fetch is
 * performed by Anakin or Bright Data from their own infrastructure, not from
 * our network, which is what actually contains the risk here.
 */
export function isPrivateIpLiteral(host: string): boolean {
  // IPv4
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  // IPv6
  if (host.includes(':')) {
    const h = host.toLowerCase();
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fe80')) return true; // link-local
    if (/^f[cd]/.test(h)) return true; // unique local
    // IPv4-mapped, e.g. ::ffff:127.0.0.1
    const mapped = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIpLiteral(mapped[1]);
    return false;
  }

  return false;
}

/**
 * Follow-the-redirect guard. Every hop is re-validated, and we cap the chain so
 * a redirect loop cannot burn the run's time budget.
 */
export function checkRedirectChain(chain: string[]): UrlCheck {
  if (chain.length > 5) {
    return { ok: false, reason: 'Too many redirects.' };
  }
  for (const hop of chain) {
    const r = checkUrl(hop);
    if (!r.ok) return { ok: false, reason: `Redirect to a blocked target: ${r.reason}` };
  }
  return { ok: true };
}
