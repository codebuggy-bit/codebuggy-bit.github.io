/* =========================================================================
   THREAT RADAR AND CONNECTION PANEL

   Two things on the home page, both fed by Pages Functions on this origin:

     /api/whoami   what the edge knows about this request
     /api/threats  open-source threat intelligence, fetched and cached server
                   side so this page never contacts a third party

   Nothing here writes feed text as markup. Every value out of a feed goes into
   the DOM with textContent, because a threat feed is third-party input and the
   page would otherwise be rendering whatever a stranger put in a CSV cell.

   Bearing is exact. Distance is square-root scaled rather than linear, because
   a linear scale puts every North American record inside the first 8% of the
   radius - 1,500km is small against a 20,000km antipode - and the near field
   is the part a reader actually cares about. The rings mark 5,000, 10,000,
   15,000 and 20,000km at their scaled radii, so a dot can still be read back
   to a real distance.
   ========================================================================= */

(function () {
  "use strict";

  var doc = document;
  var SVG = "http://www.w3.org/2000/svg";

  var SWEEP_SECONDS = 6;      // must match the .scope-sweep animation
  var PING_PEAK = 0.04;       // must match the 4% keyframe in blip-ping
  var MAX_KM = 20000;         // antipode, so the whole world fits
  var RING_PX = 180;          // outer radius in the 400x400 viewBox
  var CENTRE = 200;
  var REFRESH_MS = 5 * 60 * 1000;

  // Used when the edge has no coordinates for a visitor, so the radar still
  // draws and the caption says plainly what it is centred on instead.
  var FALLBACK = { lat: 43.09, lon: -79.24, label: "Niagara, Ontario" };

  var RAD = Math.PI / 180;

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    var node = doc.createElementNS(SVG, tag);
    for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    return node;
  }

  /* Great-circle distance in kilometres. */
  function distance(a, b) {
    var dLat = (b.lat - a.lat) * RAD;
    var dLon = (b.lon - a.lon) * RAD;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  /* Initial bearing in degrees clockwise from north. */
  function bearing(a, b) {
    var dLon = (b.lon - a.lon) * RAD;
    var y = Math.sin(dLon) * Math.cos(b.lat * RAD);
    var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
            Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(dLon);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  function ago(iso) {
    var t = Date.parse(iso);
    if (!t) return "";
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    return Math.round(s / 3600) + "h ago";
  }

  function clock(stamp) {
    var m = String(stamp || "").match(/(\d{2}:\d{2})/);
    return m ? m[1] : "";
  }

  /* ---------------------------------------------------------------- whoami */

  function renderConnection(data) {
    var panel = doc.getElementById("connPanel");
    var list = doc.getElementById("connRows");
    if (!panel || !list) return;

    var place = [data.city, data.region, data.country].filter(Boolean).join(", ");
    var rows = [
      ["Address", data.ip || "not exposed"],
      ["Network", [data.asn ? "AS" + data.asn : "", data.org].filter(Boolean).join("  ") || "unknown"],
      ["Location", place || "unknown"],
      ["Edge", [data.colo, data.protocol, data.tls].filter(Boolean).join("  ") || "unknown"],
    ];
    if (data.timezone) rows.push(["Timezone", data.timezone]);
    if (data.clientTcpRtt != null) rows.push(["Latency", data.clientTcpRtt + " ms to " + (data.colo || "the edge")]);

    list.textContent = "";
    rows.forEach(function (pair) {
      var row = el("div", "conn-row");
      row.appendChild(el("dt", null, pair[0]));
      row.appendChild(el("dd", null, pair[1]));
      list.appendChild(row);
    });

    panel.hidden = false;
    return data;
  }

  /* ----------------------------------------------------------------- radar */

  function drawBlips(blips, origin) {
    var layer = doc.getElementById("scopeBlips");
    if (!layer) return 0;
    layer.textContent = "";

    var plotted = 0;
    blips.forEach(function (b) {
      var to = { lat: b.lat, lon: b.lon };
      var km = distance(origin, to);
      // Square-root scale. Must match the ring radii in index.html.
      var r = RING_PX * Math.sqrt(Math.min(km / MAX_KM, 1));
      var theta = bearing(origin, to);

      // Placed by rotating the ring point, so the geometry and the sweep agree.
      var rad = (theta - 90) * RAD;
      var cx = CENTRE + r * Math.cos(rad);
      var cy = CENTRE + r * Math.sin(rad);

      var dot = svg("circle", {
        cx: cx.toFixed(1),
        cy: cy.toFixed(1),
        r: b.kind === "c2" ? 3.4 : 2.6,
        class: "blip blip-" + (b.kind === "c2" ? "c2" : "ransomware"),
        tabindex: "0",
        role: "img",
      });

      // Peak the ping as the sweep crosses this bearing.
      var phase = ((theta / 360) * SWEEP_SECONDS) - PING_PEAK * SWEEP_SECONDS;
      if (phase < 0) phase += SWEEP_SECONDS;
      dot.style.setProperty("--phase", (-phase).toFixed(2) + "s");

      var label = [b.title, b.group, b.detail, b.when].filter(Boolean).join(" - ");
      var title = svg("title", null);
      title.textContent = label;
      dot.appendChild(title);
      dot.setAttribute("aria-label", label);

      layer.appendChild(dot);
      plotted++;
    });
    return plotted;
  }

  function renderStats(counts, topGroups, generated) {
    var box = doc.getElementById("scopeStats");
    if (!box) return;
    box.textContent = "";

    var lead = topGroups && topGroups[0];
    var stats = [
      [String(counts.ransomware || 0), "ransomware victims listed"],
      [String(counts.c2 || 0), "botnet C2 servers"],
      [String(counts.countries || 0), "countries involved"],
      [lead ? lead.name : "-", lead ? "most active group (" + lead.n + ")" : "no group data"],
    ];
    stats.forEach(function (pair) {
      var cell = el("div", "scope-stat");
      cell.appendChild(el("dt", null, pair[0]));
      cell.appendChild(el("dd", null, pair[1]));
      box.appendChild(cell);
    });
  }

  function renderFeed(iocs) {
    var list = doc.getElementById("feedList");
    var count = doc.getElementById("feedCount");
    if (!list) return;
    list.textContent = "";
    if (count) count.textContent = iocs.length ? iocs.length + " shown" : "";

    iocs.slice(0, 9).forEach(function (ioc) {
      var row = el("li", "feed-row");
      row.appendChild(el("span", "feed-when", clock(ioc.when)));

      var what = el("span", "feed-what");
      what.appendChild(el("span", "feed-threat", ioc.threat || "unknown"));
      what.appendChild(el("span", null, ioc.url || ""));
      if (ioc.tags) what.appendChild(el("span", "feed-tags", ioc.tags));
      row.appendChild(what);

      list.appendChild(row);
    });
  }

  function renderSources(sources, generated) {
    var box = doc.getElementById("scopeSources");
    if (!box) return;
    box.textContent = "";

    box.appendChild(doc.createTextNode("Sources: "));
    sources.forEach(function (src, i) {
      if (i) box.appendChild(doc.createTextNode(" · "));
      if (src.ok) {
        var a = el("a", null, src.label);
        a.href = src.home;
        a.target = "_blank";
        a.rel = "noopener";
        box.appendChild(a);
        box.appendChild(doc.createTextNode(" (" + src.count + ")"));
      } else {
        box.appendChild(doc.createTextNode(src.label + " unavailable"));
      }
    });
    box.appendChild(doc.createTextNode(
      ". Fetched server-side and cached for ten minutes; your browser only ever talks to this site. " +
      "Read " + ago(generated) + "."));
  }

  function caption(origin, plotted, isYou) {
    var cap = doc.getElementById("scopeCaption");
    if (!cap) return;
    cap.textContent =
      plotted + " records plotted at their true bearing from " +
      (isYou ? "your location" : origin.label) +
      ". North is up. Distance is square-root scaled so the near field is readable; " +
      "the rings mark 5,000 to 20,000 km.";
  }

  /* ------------------------------------------------------------------ boot */

  var origin = FALLBACK;
  var isYou = false;

  function load() {
    Promise.all([
      fetch("api/whoami", { headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
      fetch("api/threats", { headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; }),
    ]).then(function (out) {
      var who = out[0];
      var threats = out[1];

      if (who) {
        renderConnection(who);
        if (who.coords) {
          origin = { lat: who.coords.lat, lon: who.coords.lon, label: "you" };
          isYou = true;
        }
      }

      if (!threats || !threats.blips) {
        var cap = doc.getElementById("scopeCaption");
        if (cap) {
          cap.textContent = "The feed is unavailable right now. It is fetched server-side, so this " +
            "page has nothing to show offline.";
        }
        var src = doc.getElementById("scopeSources");
        if (src) src.textContent = "No sources reachable.";
        return;
      }

      var plotted = drawBlips(threats.blips, origin);
      renderStats(threats.counts || {}, threats.topGroups || [], threats.generated);
      renderFeed(threats.iocs || []);
      renderSources(threats.sources || [], threats.generated);
      caption(origin, plotted, isYou);
    });
  }

  if (!doc.getElementById("scopeBlips") && !doc.getElementById("connPanel")) return;

  // No fetch, no feed. Say so in the same words the failure path uses instead
  // of throwing and taking the rest of the page's scripts down with it.
  if (typeof fetch !== "function") {
    var cap = doc.getElementById("scopeCaption");
    if (cap) cap.textContent = "This browser cannot fetch the feed. It is read server-side, so there is nothing to show here.";
    return;
  }

  load();

  // Refresh while the tab is visible; a background tab should not be polling.
  setInterval(function () {
    if (!doc.hidden) load();
  }, REFRESH_MS);
})();
