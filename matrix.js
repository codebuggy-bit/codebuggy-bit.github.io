/* =========================================================================
   Matrix rain background

   Design constraints, in priority order:
     1. Never hurt readability. It sits behind the text at low opacity with a
        CSS blur, and the site's own sections stay legible on top of it.
     2. Match the theme. Colours are read from the CSS custom properties, so
        the rain is coral in dark mode and deep red in light mode, and it
        re-reads them when you flip the toggle.
     3. Stay cheap. The canvas renders at half resolution and is upscaled by
        CSS, animation is capped at roughly 18fps, and it stops entirely when
        the tab is hidden.
     4. Respect the user. With prefers-reduced-motion it draws a single static
        frame and never animates.
   ========================================================================= */
(function () {
  "use strict";

  var canvas = document.getElementById("matrixRain");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  /* Half-width katakana, digits and symbols: what the films actually use. */
  var GLYPHS = "\uFF71\uFF72\uFF73\uFF74\uFF75\uFF76\uFF77\uFF78\uFF79\uFF7A" +
               "\uFF7B\uFF7C\uFF7D\uFF7E\uFF7F\uFF80\uFF81\uFF82\uFF83\uFF84" +
               "\uFF85\uFF86\uFF87\uFF88\uFF89\uFF8A\uFF8B\uFF8C\uFF8D\uFF8E" +
               "\uFF8F\uFF90\uFF91\uFF92\uFF93\uFF94\uFF95\uFF96\uFF97\uFF98" +
               "\uFF99\uFF9A\uFF9B\uFF9C\uFF9D" +
               "0123456789:\u30FB.\"=*+-<>|\u00A6";

  var FONT_SIZE = 16;    /* recomputed in resize(); canvas units */
  var MAX_COLS  = 120;   /* hard ceiling so an ultrawide does not overdraw */
  var SCALE     = 0.5;   /* render small, let CSS scale it up: cheaper and softer */
  var FRAME_MS  = 55;    /* ~18fps. The films' rain is not smooth. */
  var FADE      = 0.09;  /* trail persistence */

  var w = 0, h = 0, cols = 0;
  var rows = [], acc = [], speed = [];
  var headColor = "#FA7575", bgRgb = "23,24,25";
  var lastFrame = 0, rafId = 0, running = false;

  var motionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  /* ---------- theme ---------- */
  function parseRgb(input) {
    var s = (input || "").trim();
    var m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      var n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      return [
        parseInt(m[1][0] + m[1][0], 16),
        parseInt(m[1][1] + m[1][1], 16),
        parseInt(m[1][2] + m[1][2], 16)
      ];
    }
    m = /rgba?\(([^)]+)\)/i.exec(s);
    if (m) {
      var p = m[1].split(",");
      return [parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0, parseInt(p[2], 10) || 0];
    }
    return [23, 24, 25];
  }

  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    headColor = (cs.getPropertyValue("--accent-color") || "#FA7575").trim();
    bgRgb = parseRgb(cs.getPropertyValue("--background-color")).join(",");
  }

  /* ---------- setup ---------- */
  function resize() {
    w = Math.max(1, Math.floor(window.innerWidth * SCALE));
    h = Math.max(1, Math.floor(window.innerHeight * SCALE));
    canvas.width = w;
    canvas.height = h;

    /* The canvas is displayed at 1/SCALE of its backing size, so a glyph drawn
       at N canvas units renders at N / SCALE CSS pixels. Derive the font size
       from a target on-screen size instead of hardcoding it, otherwise a phone
       gets 32px glyphs and about ten columns. */
    var targetCss = window.innerWidth < 700 ? 18 : 22;
    FONT_SIZE = Math.max(7, Math.round(targetCss * SCALE));

    ctx.font = FONT_SIZE + "px 'Courier New', Courier, monospace";
    ctx.textBaseline = "top";

    cols = Math.min(MAX_COLS, Math.max(6, Math.ceil(w / FONT_SIZE)));
    rows = new Array(cols);
    acc = new Array(cols);
    speed = new Array(cols);

    for (var i = 0; i < cols; i++) {
      /* Stagger the start so columns do not all fall in lockstep. */
      rows[i] = -Math.floor(Math.random() * (h / FONT_SIZE));
      acc[i] = Math.random();
      speed[i] = 0.35 + Math.random() * 0.75;
    }

    /* Paint the base colour so the first frames are not transparent. */
    ctx.fillStyle = "rgb(" + bgRgb + ")";
    ctx.fillRect(0, 0, w, h);
  }

  function reset(i) {
    rows[i] = -Math.floor(Math.random() * 12) - 1;
    speed[i] = 0.35 + Math.random() * 0.75;
  }

  function glyph() {
    return GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
  }

  /* ---------- drawing ---------- */
  function step() {
    /* The translucent wash is what creates the falling trail. */
    ctx.fillStyle = "rgba(" + bgRgb + "," + FADE + ")";
    ctx.fillRect(0, 0, w, h);

    ctx.font = FONT_SIZE + "px 'Courier New', Courier, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = headColor;

    for (var i = 0; i < cols; i++) {
      acc[i] += speed[i];
      if (acc[i] < 1) continue;
      acc[i] -= 1;

      rows[i]++;
      var y = rows[i] * FONT_SIZE;

      if (y > h) {
        if (Math.random() > 0.94) reset(i);
        continue;
      }

      ctx.fillText(glyph(), i * FONT_SIZE, y);
    }
  }

  /* A single frozen frame for reduced-motion users: texture without movement. */
  function drawStatic() {
    ctx.fillStyle = "rgb(" + bgRgb + ")";
    ctx.fillRect(0, 0, w, h);
    ctx.font = FONT_SIZE + "px 'Courier New', Courier, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = headColor;
    ctx.globalAlpha = 0.5;

    for (var i = 0; i < cols; i++) {
      var len = 3 + ((Math.random() * 7) | 0);
      var start = Math.floor(Math.random() * (h / FONT_SIZE));
      for (var k = 0; k < len; k++) {
        ctx.globalAlpha = 0.5 * (1 - k / len);
        ctx.fillText(glyph(), i * FONT_SIZE, (start + k) * FONT_SIZE);
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    rafId = window.requestAnimationFrame(loop);
    if (now - lastFrame < FRAME_MS) return;
    lastFrame = now;
    step();
  }

  function start() {
    if (running || (motionQuery && motionQuery.matches)) return;
    running = true;
    lastFrame = 0;
    rafId = window.requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ---------- wiring ---------- */
  readTheme();
  resize();

  if (motionQuery && motionQuery.matches) {
    drawStatic();
  } else {
    start();
  }

  /* Pause when the tab is not visible. Nobody is watching. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  /* Re-read colours when the theme toggle changes data-theme. */
  if (window.MutationObserver) {
    new MutationObserver(function () {
      readTheme();
      if (!running) drawStatic();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
  }

  /* Rebuild on resize, debounced.
     Only a width change rebuilds the field, because that is what determines the
     column count. Height-only changes happen constantly on mobile as the URL bar
     shows and hides, and rebuilding on those would re-randomise the rain while
     the user is scrolling. Orientation change always rebuilds. */
  var lastWidth = window.innerWidth;
  var resizeTimer = 0;

  function rebuild(delay) {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      lastWidth = window.innerWidth;
      resize();
      if (!running) drawStatic();
    }, delay);
  }

  window.addEventListener("resize", function () {
    if (Math.abs(window.innerWidth - lastWidth) < 2) return;
    rebuild(180);
  });
  window.addEventListener("orientationchange", function () { rebuild(300); });

  /* React if the user changes their motion preference mid-session. */
  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener("change", function (e) {
      if (e.matches) { stop(); drawStatic(); }
      else { resize(); start(); }
    });
  }
})();
