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

   Rate limits. abuse.ch asks not to be fetched more often than every five
   minutes, which is how often it regenerates its dumps. So each source is
   revalidated at most once a minute and only downloads a body when the
   publisher says it has changed (If-None-Match / 304, about 200 bytes). The
   2.6MB URLhaus CSV and the 1.7MB KEV file therefore transfer roughly once per
   five minutes instead of on every refresh, which is what the limit exists to
   prevent - and the panel still notices a new dump within a minute of it being
   published.

     ransomware.live          no published limit; asked to be reasonable.
                              Sends no ETag, so it is fetched in full, but it
                              is 77KB
     abuse.ch (Feodo, URLhaus) no key; dumps regenerated every 5 minutes.
                              Revalidated, not re-downloaded
     CISA KEV                 a static file on a CDN, no limit, sends an ETag
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
const CACHE_VERSION = 9;
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

/* Conditional GET. abuse.ch generates its dumps every five minutes and asks
   not to be fetched more often than that; CISA and Feodo are CDN-cached for the
   same kind of window. Polling the full 2.6MB URLhaus CSV and the 1.7MB KEV
   file every twenty seconds was 4.3MB a refresh for data that had not changed,
   which is exactly the load those limits exist to prevent.

   Sending If-None-Match costs about 200 bytes and returns 304 when the
   publisher has nothing new, so the refresh can stay frequent - which keeps the
   panel as current as the publishers allow - without transferring anything. */
async function getBody(url, etag) {
  const headers = { "user-agent": "akashraj.ca threat radar (+https://akashraj.ca/)" };
  if (etag) headers["if-none-match"] = etag;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });

  if (response.status === 304) return { notModified: true, etag };
  if (!response.ok) throw new Error(`${response.status}`);

  return {
    notModified: false,
    etag: response.headers.get("etag") || "",
    age: upstreamAge(response),
    maxAge: maxAgeOf(response),
    response,
  };
}

/* How long the publisher says its own copy is good for. Used only to decide
   whether to bother revalidating, so the cap keeps a silly header from parking
   a feed for a day. */
function maxAgeOf(response) {
  const m = /max-age=(\d+)/.exec(response.headers.get("cache-control") || "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 60;
}

async function getJSON(url, etag) {
  const r = await getBody(url, etag);
  if (r.notModified) return r;
  return { ...r, data: await r.response.json() };
}

async function getText(url, etag) {
  const r = await getBody(url, etag);
  if (r.notModified) return r;
  return { ...r, data: await r.response.text() };
}

function clean(r) {
  if (!r) return r;
  const { response, ...rest } = r;
  return rest;
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

/* build(prev) takes the per-source state from the previous payload so an
   unchanged feed can be reused without being parsed again. Each source keeps
   its own ETag and its own parsed rows, so one publisher changing does not
   force the other three to be refetched. */
async function build(prev) {
  const parts = { ...(prev || {}) };
  const now = Date.now();

  /* Revalidate a source when its window has elapsed, and never sooner. The
     window is the publisher's own max-age capped at a minute: often enough that
     a new dump is picked up within 60s, rare enough that the 2.6MB URLhaus CSV
     and the 1.7MB KEV file are only transferred when they have actually
     changed. A source that sends no ETag cannot be revalidated, so its window
     is what keeps it from being downloaded in full on every single build. */
  const REVALIDATE_MS = 60 * 1000;
  const want = (name) => {
    const p = parts[name];
    if (!p || p.rows === undefined) return true;
    return now >= (p.nextCheckAt || 0);
  };
  const etagOf = (name) => (want(name) ? parts[name]?.etag : undefined);

  const [ransom, c2, urlhaus, kev] = await Promise.allSettled([
    want("ransom") ? getJSON(FEEDS.ransom.url, etagOf("ransom")) : null,
    want("c2") ? getJSON(FEEDS.c2.url, etagOf("c2")) : null,
    want("urlhaus") ? getText(FEEDS.urlhaus.url, etagOf("urlhaus")) : null,
    want("kev") ? getJSON(FEEDS.kev.url, etagOf("kev")) : null,
  ]);

  const sources = [];

  /* One shape for every feed: reuse if the publisher said 304 or if there was
     nothing cached to revalidate against, otherwise parse the new body. A
     failure keeps the rows already held so the panel never loses a feed it has
     already shown, and shortens the next attempt rather than waiting a full
     publisher window. */
  function settle(name, result, parse) {
    const held = parts[name] || {};
    // A skipped source is passed as a bare null, which allSettled wraps as a
    // fulfilled promise whose value is null - not as null itself.
    if (result === null || (result.status === "fulfilled" && result.value === null)) {
      if (held.rows === undefined) {
        sources.push({ ...FEEDS[name], ok: false, error: "not yet loaded", age: 0 });
        return [];
      }
      sources.push({ ...FEEDS[name], ok: true, count: held.rows.length, age: held.age ?? 0, reused: true });
      return held.rows;
    }
    if (result.status !== "fulfilled") {
      parts[name] = { ...held, nextCheckAt: now + 30000, error: String(result.reason).slice(0, 60) };
      sources.push({ ...FEEDS[name], ok: false, error: parts[name].error, age: 0 });
      return held.rows || [];
    }

    const value = clean(result.value);
    if (value.notModified || value.data === undefined) {
      parts[name] = { ...held, etag: value.etag || held.etag, age: value.age ?? held.age ?? 0,
                      nextCheckAt: now + Math.min(value.maxAge || 60, REVALIDATE_MS / 1000) * 1000 };
      sources.push({ ...FEEDS[name], ok: true, count: (held.rows || []).length,
                     age: parts[name].age, reused: true });
      return held.rows || [];
    }

    // The entry exists before parsing: a parser that wants to record something
    // extra alongside the rows (the KEV total, the ransomware group tally) has
    // nowhere to put it otherwise.
    parts[name] = { etag: value.etag, age: value.age, rows: [],
                    nextCheckAt: now + Math.min(value.maxAge || 60, REVALIDATE_MS / 1000) * 1000 };
    parts[name].rows = parse(value.data);
    sources.push({ ...FEEDS[name], ok: true, count: parts[name].rows.length, age: value.age });
    return parts[name].rows;
  }

  const ransomRows = settle("ransom", ransom, (d) => {
    const r = parseRansomware(Array.isArray(d) ? d : []);
    parts.ransom.groups = [...r.groups.entries()];
    return r.blips;
  });
  const c2Rows = settle("c2", c2, (d) => parseC2(Array.isArray(d) ? d : []));
  const urlhausRows = settle("urlhaus", urlhaus, (d) => parseUrlhaus(d ?? ""));
  const kevRows = settle("kev", kev, (d) => {
    const parsed = parseKev(d ?? {});
    parts.kev.total = parsed.total;
    return parsed.recent;
  });

  let blips = ransomRows.concat(c2Rows);
  const groups = new Map(parts.ransom?.groups || []);
  const iocs = urlhausRows;
  const kevData = { total: parts.kev?.total || 0, recent: kevRows };

  // Newest first, then trimmed, so a burst from one feed cannot crowd the map.
  blips.sort((a, b) => String(b.when).localeCompare(String(a.when)));
  blips = blips.slice(0, MAX_BLIPS);

  // FEEDS is keyed differently from the state names; give each an explicit key.
  const payload = {
    generated: new Date().toISOString(),
    sources: sources.map(({ label, home, ok, count, error, age, reused }) =>
      ({ label, home, ok, count: count ?? 0, age: age ?? 0, ...(reused ? { reused: true } : {}),
         ...(error ? { error } : {}) })),
    counts: {
      ...summarise(blips),
      kevTotal: parts.kev?.total ?? 0,
      kevRecent: kevRows.length,
      kevToday: kevRows.filter((k) => k.when === new Date().toISOString().slice(0, 10)).length,
    },
    blips,
    iocs,
    kev: kevRows,
  };
  return { payload, parts };
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
function store(payload, parts) {
  return new Response(JSON.stringify({ ...payload, _parts: parts }), {
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
    const stored = await hit.text();
    let age = Infinity;
    let body = stored;
    let prev = null;
    try {
      const parsed = JSON.parse(stored);
      age = (Date.now() - Date.parse(parsed.generated)) / 1000;
      // The per-source state is ours, not the reader's: tens of kilobytes of
      // ETags and a second copy of every row, on every single poll.
      prev = parsed._parts || null;
      delete parsed._parts;
      body = JSON.stringify(parsed);
    } catch (e) { /* serve whatever is there */ }

    if (age < FRESH_SECONDS) {
      return json(body, { "x-radar-cache": "fresh", "x-radar-age": String(Math.round(age)) });
    }

    // Stale: answer now, refresh behind the response. waitUntil keeps the
    // isolate alive for the fetch after the visitor has their bytes.
    // (prev is read above)
    context.waitUntil(
      build(prev)
        .then(({ payload, parts }) => cache.put(key, store(payload, parts)))
        // Swallowing this silently made a failing refresh look identical to a
        // working one: the stale copy keeps being served either way.
        .catch((err) => console.log("radar refresh failed:", String(err).slice(0, 160)))
    );
    return json(body, {
      "x-radar-cache": "stale",
      "x-radar-age": Number.isFinite(age) ? String(Math.round(age)) : "unknown",
    });
  }

  // Nothing cached at all in this colo - the only request that waits.
  let built;
  try {
    built = await build(null);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err).slice(0, 120) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const response = json(JSON.stringify(built.payload), { "x-radar-cache": "miss" });
  context.waitUntil(cache.put(key, store(built.payload, built.parts)));
  return response;
}
