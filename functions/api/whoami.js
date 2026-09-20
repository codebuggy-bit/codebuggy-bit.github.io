/* =========================================================================
   GET /api/whoami - Cloudflare Pages Function

   The "your connection" panel: what the edge can already see about the
   request that just arrived.

   This is deliberately not an IP geolocation API. Cloudflare terminates the
   connection, so it already knows the address, the network it belongs to and
   a city-level location; request.cf carries all of it. Reading it here means
   the panel costs no third-party request, works with connect-src 'self', and
   introduces nothing that could be called a tracker.

   Nothing is logged and nothing is stored. The values are handed straight back
   to the person they describe and then forgotten, which is the only reason
   showing somebody their own IP address is not a privacy problem.

   Fields are individually optional. request.cf varies by plan and by how much
   Cloudflare knows about an address, so every one of these can be absent and
   the page is built to render around the gaps.
   ========================================================================= */

const cap = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);

export async function onRequestGet(context) {
  const { request } = context;
  const cf = request.cf || {};

  const coords =
    typeof cf.latitude === "string" && typeof cf.longitude === "string"
      ? { lat: parseFloat(cf.latitude), lon: parseFloat(cf.longitude) }
      : null;

  const payload = {
    // The visitor's own address, shown back to them.
    ip: cap(request.headers.get("CF-Connecting-IP"), 45),
    // Set by Cloudflare when it has a network name for the address.
    asn: typeof cf.asn === "number" ? cf.asn : null,
    org: cap(cf.asOrganization, 80),
    city: cap(cf.city, 60),
    region: cap(cf.region, 60),
    country: cap(cf.country, 2),
    continent: cap(cf.continent, 2),
    postalCode: cap(cf.postalCode, 12),
    timezone: cap(cf.timezone, 40),
    colo: cap(cf.colo, 8),
    // Connection facts, which are the honest part: these are certain, where
    // a city derived from an IP is an inference.
    protocol: cap(cf.httpProtocol, 10),
    tls: cap(cf.tlsVersion, 10),
    tlsCipher: cap(cf.tlsCipher, 40),
    clientTcpRtt: typeof cf.clientTcpRtt === "number" ? cf.clientTcpRtt : null,
    coords: Number.isFinite(coords?.lat) && Number.isFinite(coords?.lon) ? coords : null,
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Per-visitor, so it must never be cached anywhere.
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
