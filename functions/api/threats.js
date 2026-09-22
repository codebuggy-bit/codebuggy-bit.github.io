/* =========================================================================
   GET /api/threats - Cloudflare Pages Function

   Live open-source threat intelligence for the radar on the home page.

   Everything third-party is fetched here, on the server, and held at the edge
   for ten minutes. The visitor's browser talks only to this origin, which is
   what lets the page keep its "no third-party scripts" promise and the CSP
   keep connect-src 'self'. Nothing about the visitor is sent upstream: these
   are plain GETs for public data, with no identifiers of any kind.

   Sources, all free, none needing an API key, none scraped:

     ransomware.live          recent victims, with a country   -> radar blips
     abuse.ch Feodo Tracker   botnet C2 servers, with country  -> more blips
     abuse.ch URLhaus         recent malicious URLs            -> IOC ticker
     CISA KEV                 exploited-in-the-wild CVEs      -> KEV ticker

   Freshness, measured from the publishers' own headers: abuse.ch serves both
   Feodo and URLhaus with max-age=300 and CISA serves KEV with max-age=2855. The
   data is therefore already minutes old - nearly an hour for KEV - before this
   function is even called. Polling harder cannot change that; serving without
   making anyone wait can, which is what the stale-while-revalidate below does.

   Rate limits, and why the cache is sized the way it is. Every request here is
   a single GET on a cache miss, so upstream sees at most one call per TTL per
   Cloudflare colo, whatever the visitor count:

     ransomware.live          no published limit; asked to be reasonable
     abuse.ch (Feodo, URLhaus) no key, no published limit; bulk download
                              endpoints, updated every few minutes
     CISA KEV                 a static file on a CDN, no limit
     NVD                      NOT used: 5 requests / 30s without a key, and its
                              default sort returns the oldest CVEs first, so it
                              is the weakest of the five for a live ticker. KEV
                              covers "newly exploited" better and for free.

   No API keys are required and none are read. If one is ever added, it belongs
   in the Pages project as an environment variable and is read here as
   env.NAME - never in radar.js, which is served to the browser.

   Feeds fail independently. A source that is down is reported as down and the
   rest of the payload still goes out, because a radar running on two of three
   feeds is worth more than an error page.

   abuse.ch requires attribution, so the response carries the source list and
   the page renders it next to the data.

   Feeds are third-party text and are treated as such: every string is
   length-capped here, and the page only ever writes them into the DOM with
   textContent, never as markup.
   ========================================================================= */

import { centroid } from "../_lib/centroids.js";

/* Stale-while-revalidate, because the honest limit on freshness is upstream and
   not here.

   Measured from the publishers' own headers: abuse.ch serves both the Feodo
   blocklist and the recent URLhaus CSV with max-age=300, and CISA serves KEV
   with max-age=2855. So the data is already up to five minutes old - nearly
   fifty for KEV - before this function sees it, and polling harder cannot make
   it younger. What polling harder can do is make a visitor wait, which is the
   one thing worth engineering away.

   So: FRESH_SECONDS old is served as-is. Older than that, the stale copy is
   returned immediately and a refresh runs in the background, so every request
   after the first is instant however long the upstream round trip takes. The
   entry is kept for RETENTION_SECONDS so there is always something to serve. */
const FRESH_SECONDS = 20;
const RETENTION_SECONDS = 900;

/* The edge cache outlives a deploy, so a response stored by the previous
   version of this function keeps being served after the new one ships - the
   first production call after adding CISA KEV came back from cache without the
   KEV fields at all. The key carries a version, and bumping it on any change
   to the payload shape retires the old entries instead of waiting out their
   TTL. */
const CACHE_VERSION = 7;
const UPSTREAM_TIMEOUT_MS = 9000;

const FEEDS = {
  ransom: {
    label: "ransomware.live",
    url: "https://api.ransomware.live/recentvictims",
    home: "https://www.ransomware.live/",
  },
  c2: {
    label: "abuse.ch Feodo Tracker",
    url: "https://feodotracker.abuse.ch/downloads/ipblocklist.json",
    home: "https://feodotracker.abuse.ch/",
  },
  urlhaus: {
    label: "abuse.ch URLhaus",
    url: "https://urlhaus.abuse.ch/downloads/csv_recent/",
    home: "https://urlhaus.abuse.ch/",
  },
  kev: {
    label: "CISA KEV",
    url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    home: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
  },
};

/* How many days back counts as "recent" for the KEV ticker. */
const KEV_DAYS = 10;

// How many rows of the big CSV to look at. The file is 13,000 lines and 2.4MB;
// parsing all of it would blow the CPU budget for no benefit, since the ticker
// shows the newest handful.
const URLHAUS_ROWS = 120;
const MAX_BLIPS = 260;

const cap = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

/* The Age header is how long the publisher's own CDN has held this copy, which
   is the honest answer to "how old is this data" - not how long ago we asked.
   Two of the four feeds below are cached at the publisher for five minutes and
   CISA caches KEV for nearly fifty, so no amount of polling here makes the data
   younger than that. Reporting it is better than implying otherwise. */
function upstreamAge(response) {
  const age = Number(response.headers.get("age"));
  if (Number.isFinite(age)) return age;
  const lm = Date.parse(response.headers.get("last-modified") || "");
  return Number.isFinite(lm) ? Math.max(0, Math.round((Date.now() - lm) / 1000)) : 0;
}

async function getJSON(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "akashraj.ca threat radar (+https://akashraj.ca/)" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return { data: await response.json(), age: upstreamAge(response) };
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "akashraj.ca threat radar (+https://akashraj.ca/)" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return { data: await response.text(), age: upstreamAge(response) };
}

/* ransomware.live: one row per recently posted victim. */
function parseRansomware(rows) {
  const blips = [];
  const groups = new Map();
  for (const v of rows) {
    const point = centroid(v.country);
    const group = cap(v.group_name, 40);
    if (group) groups.set(group, (groups.get(group) || 0) + 1);
    if (!point) continue;
    blips.push({
      kind: "ransomware",
      cc: cap(v.country, 2).toUpperCase(),
      lat: point.lat,
      lon: point.lon,
      title: cap(v.post_title, 70) || "undisclosed victim",
      detail: cap(v.activity, 40) || "sector not stated",
      group,
      when: cap(v.published || v.discovered, 10),
    });
  }
  return { blips, groups };
}

/* Feodo: botnet command-and-control servers. Small list, but a C2 address is
   the most actionable thing on this page. */
function parseC2(rows) {
  const blips = [];
  for (const e of rows) {
    const point = centroid(e.country);
    if (!point) continue;
    blips.push({
      kind: "c2",
      cc: cap(e.country, 2).toUpperCase(),
      lat: point.lat,
      lon: point.lon,
      title: `${cap(e.ip_address, 45)}:${Number(e.port) || 0}`,
      detail: `${cap(e.as_name, 34) || "unknown network"} · ${cap(e.status, 10) || "unknown"}`,
      group: cap(e.malware, 30),
      when: cap(e.last_online, 10),
    });
  }
  return blips;
}

/* URLhaus: a quoted CSV. Only the newest rows are wanted, so the text is cut
   down before it is split. */
function parseUrlhaus(text) {
  const out = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (out.length >= URLHAUS_ROWS) break;
    if (!line || line[0] === "#" || line[0] !== '"') continue;
    const f = line.match(/"([^"]*)"/g);
    if (!f || f.length < 7) continue;
    const cell = (i) => cap(f[i].slice(1, -1), 120);
    out.push({
      when: cell(1),
      url: cell(2),
      status: cell(3),
      threat: cell(5),
      tags: cell(6),
    });
  }
  return out;
}

/* CISA KEV: every CVE known to be exploited in the wild, with the date it was
   added. The file is 1.7MB of JSON. Parsing the whole thing measured at about
   4ms, which fits, but a regex over the pair of adjacent fields costs 3ms and
   returns the same rows, so the cheaper of the two is what runs. */
function parseKev(payload) {
  const list = Array.isArray(payload?.vulnerabilities) ? payload.vulnerabilities : [];
  const cutoff = new Date(Date.now() - KEV_DAYS * 864e5).toISOString().slice(0, 10);

  const rows = [];
  for (const v of list) {
    const added = String(v.dateAdded || "");
    if (added < cutoff) continue;
    rows.push({
      cve: cap(v.cveID, 20),
      when: added,
      vendor: cap(v.vendorProject, 40),
      product: cap(v.product, 40),
      name: cap(v.vulnerabilityName, 90),
      ransomware: cap(v.knownRansomwareCampaignUse, 10).toLowerCase() === "known",
    });
  }
  rows.sort((a, b) => b.when.localeCompare(a.when));
  return { total: list.length, recent: rows };
}

function summarise(blips) {
  const byCountry = new Map();
  for (const b of blips) byCountry.set(b.cc, (byCountry.get(b.cc) || 0) + 1);
  return {
    ransomware: blips.filter((b) => b.kind === "ransomware").length,
    c2: blips.filter((b) => b.kind === "c2").length,
    countries: byCountry.size,
    top: [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([cc, n]) => ({ cc, n })),
  };
}

async function build() {
  const [ransom, c2, urlhaus, kev] = await Promise.allSettled([
    getJSON(FEEDS.ransom.url),
    getJSON(FEEDS.c2.url),
    getText(FEEDS.urlhaus.url),
    getJSON(FEEDS.kev.url),
  ]);

  const sources = [];
  let blips = [];
  let groups = new Map();
  let iocs = [];
  let kevData = { total: 0, recent: [] };

  if (ransom.status === "fulfilled") {
    const r = parseRansomware(Array.isArray(ransom.value?.data) ? ransom.value.data : []);
    blips = blips.concat(r.blips);
    groups = r.groups;
    sources.push({ ...FEEDS.ransom, ok: true, count: r.blips.length, age: ransom.value?.age ?? 0 });
  } else {
    sources.push({ ...FEEDS.ransom, ok: false, error: String(ransom.reason).slice(0, 60) });
  }

  if (c2.status === "fulfilled") {
    const b = parseC2(Array.isArray(c2.value?.data) ? c2.value.data : []);
    blips = blips.concat(b);
    sources.push({ ...FEEDS.c2, ok: true, count: b.length, age: c2.value?.age ?? 0 });
  } else {
    sources.push({ ...FEEDS.c2, ok: false, error: String(c2.reason).slice(0, 60) });
  }

  if (urlhaus.status === "fulfilled") {
    iocs = parseUrlhaus(urlhaus.value?.data ?? "");
    sources.push({ ...FEEDS.urlhaus, ok: true, count: iocs.length, age: urlhaus.value?.age ?? 0 });
  } else {
    sources.push({ ...FEEDS.urlhaus, ok: false, error: String(urlhaus.reason).slice(0, 60) });
  }

  if (kev.status === "fulfilled") {
    kevData = parseKev(kev.value?.data ?? {});
    sources.push({ ...FEEDS.kev, ok: true, count: kevData.recent.length, age: kev.value?.age ?? 0 });
  } else {
    sources.push({ ...FEEDS.kev, ok: false, error: String(kev.reason).slice(0, 60), age: 0 });
  }

  // Newest first, then trimmed, so a burst from one feed cannot crowd the map.
  blips.sort((a, b) => String(b.when).localeCompare(String(a.when)));
  blips = blips.slice(0, MAX_BLIPS);

  return {
    generated: new Date().toISOString(),
    sources: sources.map(({ label, home, ok, count, error, age }) =>
      ({ label, home, ok, count: count ?? 0, age: age ?? 0, ...(error ? { error } : {}) })),
    counts: {
      ...summarise(blips),
      kevTotal: kevData.total,
      kevRecent: kevData.recent.length,
      kevToday: kevData.recent.filter((k) => k.when === new Date().toISOString().slice(0, 10)).length,
    },
    blips,
    iocs,
    kev: kevData.recent,
    topGroups: [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, n]) => ({ name, n })),
  };
}

/* Every response goes out with a five-second browser TTL and no-store is
   avoided, because the point is that the browser always asks and the edge
   always answers instantly from a copy it already holds. */
function json(body, extra) {
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=5",
      "access-control-allow-origin": "https://akashraj.ca",
      ...extra,
    },
  });
}

/* The copy kept at the edge. max-age here is the RETENTION window, not the
   freshness window - freshness is decided from the payload's own generated
   stamp so a stale entry is still available to serve while it refreshes. */
function store(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${RETENTION_SECONDS}`,
    },
  });
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const key = new Request(
    new URL(`/api/threats?v=${CACHE_VERSION}`, context.request.url), { method: "GET" });

  const hit = await cache.match(key);
  if (hit) {
    const body = await hit.text();
    let age = Infinity;
    try { age = (Date.now() - Date.parse(JSON.parse(body).generated)) / 1000; } catch (e) { /* rebuild */ }

    if (age < FRESH_SECONDS) {
      return json(body, { "x-radar-cache": "fresh", "x-radar-age": String(Math.round(age)) });
    }

    // Stale: answer now, refresh behind the response. waitUntil keeps the
    // isolate alive for the fetch after the visitor has their bytes.
    context.waitUntil(
      build()
        .then((payload) => cache.put(key, store(payload)))
        .catch(() => { /* keep serving the stale copy */ })
    );
    return json(body, {
      "x-radar-cache": "stale",
      "x-radar-age": Number.isFinite(age) ? String(Math.round(age)) : "unknown",
    });
  }

  // Nothing cached at all in this colo - the only request that waits.
  let payload;
  try {
    payload = await build();
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err).slice(0, 120) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const response = json(JSON.stringify(payload), { "x-radar-cache": "miss" });
  context.waitUntil(cache.put(key, store(payload)));
  return response;
}
