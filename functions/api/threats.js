/* =========================================================================
   GET /api/threats - Cloudflare Pages Function

   Live open-source threat intelligence for the radar on the home page.

   Everything third-party is fetched here, on the server, and held at the edge
   for ten minutes. The visitor's browser talks only to this origin, which is
   what lets the page keep its "no third-party scripts" promise and the CSP
   keep connect-src 'self'. Nothing about the visitor is sent upstream: these
   are plain GETs for public data, with no identifiers of any kind.

   Sources, all free and none needing an API key:

     ransomware.live   recent victims with a country  -> radar blips
     abuse.ch Feodo    botnet C2 servers with a country -> more blips
     abuse.ch URLhaus  recent malicious URLs           -> the IOC ticker

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

const CACHE_SECONDS = 600;
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
};

// How many rows of the big CSV to look at. The file is 13,000 lines and 2.4MB;
// parsing all of it would blow the CPU budget for no benefit, since the ticker
// shows the newest handful.
const URLHAUS_ROWS = 120;
const MAX_BLIPS = 260;

const cap = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

async function getJSON(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "akashraj.ca threat radar (+https://akashraj.ca/)" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "akashraj.ca threat radar (+https://akashraj.ca/)" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.text();
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
  const [ransom, c2, urlhaus] = await Promise.allSettled([
    getJSON(FEEDS.ransom.url),
    getJSON(FEEDS.c2.url),
    getText(FEEDS.urlhaus.url),
  ]);

  const sources = [];
  let blips = [];
  let groups = new Map();
  let iocs = [];

  if (ransom.status === "fulfilled") {
    const r = parseRansomware(Array.isArray(ransom.value) ? ransom.value : []);
    blips = blips.concat(r.blips);
    groups = r.groups;
    sources.push({ ...FEEDS.ransom, ok: true, count: r.blips.length });
  } else {
    sources.push({ ...FEEDS.ransom, ok: false, error: String(ransom.reason).slice(0, 60) });
  }

  if (c2.status === "fulfilled") {
    const b = parseC2(Array.isArray(c2.value) ? c2.value : []);
    blips = blips.concat(b);
    sources.push({ ...FEEDS.c2, ok: true, count: b.length });
  } else {
    sources.push({ ...FEEDS.c2, ok: false, error: String(c2.reason).slice(0, 60) });
  }

  if (urlhaus.status === "fulfilled") {
    iocs = parseUrlhaus(urlhaus.value);
    sources.push({ ...FEEDS.urlhaus, ok: true, count: iocs.length });
  } else {
    sources.push({ ...FEEDS.urlhaus, ok: false, error: String(urlhaus.reason).slice(0, 60) });
  }

  // Newest first, then trimmed, so a burst from one feed cannot crowd the map.
  blips.sort((a, b) => String(b.when).localeCompare(String(a.when)));
  blips = blips.slice(0, MAX_BLIPS);

  return {
    generated: new Date().toISOString(),
    sources: sources.map(({ label, home, ok, count, error }) =>
      ({ label, home, ok, count: count ?? 0, ...(error ? { error } : {}) })),
    counts: summarise(blips),
    blips,
    iocs,
    topGroups: [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, n]) => ({ name, n })),
  };
}

export async function onRequestGet(context) {
  const cache = caches.default;
  const key = new Request(new URL("/api/threats", context.request.url), { method: "GET" });

  const hit = await cache.match(key);
  if (hit) {
    const body = await hit.text();
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${CACHE_SECONDS}`,
        "x-radar-cache": "hit",
      },
    });
  }

  let payload;
  try {
    payload = await build();
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err).slice(0, 120) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const body = JSON.stringify(payload);
  const response = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "x-radar-cache": "miss",
    },
  });

  // Store a copy so the next visitor in this colo does not refetch upstream.
  context.waitUntil(cache.put(key, response.clone()));
  return response;
}
