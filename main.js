/* =========================================================================
   Akash Raj - portfolio behaviour

   Deliberately small. The shellsharks aesthetic is flat and static, so there
   are no scroll animations, no reveal effects and no scroll listeners.
   Every feature degrades safely with JavaScript off.
   ========================================================================= */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- Theme toggle ------------------------------------------------
     Five palettes, cycled in order. The first one is applied by the inline
     script in <head> so there is no flash of the wrong colours; this wires up
     the button and keeps it labelled with the theme in use, because a control
     that only says "toggle theme" makes you press it to find out where you
     are. */
  var THEMES = ["dark", "light", "matrix", "cyberpunk", "umbrella"];
  var toggle = document.getElementById("themeToggle");
  if (toggle) {
    var animTimer = 0;

    /* data-theme is only set once a choice has been made. Until then the
       effective theme is whatever the system prefers, and the cycle has to
       start from there rather than from "dark". */
    function current() {
      var set = root.getAttribute("data-theme");
      if (set) return set;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light" : "dark";
    }
    function after(name) {
      var i = THEMES.indexOf(name);
      return THEMES[(i < 0 ? 0 : i + 1) % THEMES.length];
    }
    /* The browser's own chrome - the address bar on a phone - is coloured from
       <meta name="theme-color">, which is a static tag in the head. With five
       palettes it has to be told, or a green theme gets a charcoal status bar. */
    function syncChrome() {
      var bg = getComputedStyle(root).getPropertyValue("--background-color").trim();
      if (!bg) return;
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", bg);
    }

    /* The visible name is drawn by CSS from data-theme. This only supplies the
       accessible label and the tooltip, so the two can never disagree. */
    function describe(name) {
      toggle.setAttribute("aria-label", "Colour theme: " + name + ". Activate for " + after(name) + ".");
      toggle.setAttribute("title", "Switch to " + after(name));
    }

    toggle.addEventListener("click", function () {
      var next = after(current());

      /* Colour transitions on only for the moment of the switch. Leaving them
         on permanently would make every hover and focus change feel sluggish,
         and the rain canvas needs the same treatment as the text. */
      root.classList.add("theme-anim");
      window.clearTimeout(animTimer);
      animTimer = window.setTimeout(function () {
        root.classList.remove("theme-anim");
      }, 320);

      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
      describe(next);
      syncChrome();
    });

    describe(current());
    syncChrome();
  }

  /* ---------- Mobile navigation ------------------------------------------ */
  var navToggle = document.getElementById("navToggle");
  var nav = document.getElementById("siteNav");

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open navigation");
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });

    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") closeNav();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });

    document.addEventListener("click", function (e) {
      if (!nav.contains(e.target) && !navToggle.contains(e.target)) closeNav();
    });
  }

  /* ---------- Email links -------------------------------------------------
     Assembled at runtime so a plain-text harvest of the HTML does not turn up
     a usable address. This stops naive scrapers. It does not stop a human
     reading the rendered page. */
  var emailLinks = document.querySelectorAll("[data-user][data-domain]");
  Array.prototype.forEach.call(emailLinks, function (el) {
    var user = el.getAttribute("data-user");
    var domain = el.getAttribute("data-domain");
    if (!user || !domain) return;
    var address = user + "@" + domain;
    el.setAttribute("href", "mailto:" + address);
    el.removeAttribute("rel");
    var label = el.querySelector(".email-label");
    if (label) label.textContent = address;
    else el.textContent = address;
  });

  /* ---------- Terminal typing effect --------------------------------------
     The full text already exists in the markup, so with JavaScript disabled or
     reduced motion enabled the terminal just renders complete. Otherwise every
     text node is blanked and revealed character by character, which preserves
     the <span> styling inside the <pre>. */
  var term = document.getElementById("termBody");
  if (term) {
    var noMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var alreadyTyped = false;
    try { alreadyTyped = sessionStorage.getItem("typed") === "1"; } catch (e) { /* private mode */ }

    /* Tell ui.js the intro is done so it can hand over to a real prompt.
       It also sets an attribute, because when the typing is skipped this fires
       while main.js is still executing and a listener would not be attached
       yet. */
    var signalReady = function () {
      term.setAttribute("data-ready", "1");
      term.dispatchEvent(new CustomEvent("terminalready"));
    };

    if (!noMotion && !alreadyTyped) {
      var walker = document.createTreeWalker(term, NodeFilter.SHOW_TEXT, null, false);
      var nodes = [], node;
      while ((node = walker.nextNode())) {
        nodes.push({ node: node, text: node.nodeValue });
        node.nodeValue = "";
      }

      var ni = 0, ci = 0;
      var type = function () {
        if (ni >= nodes.length) { signalReady(); return; }
        var cur = nodes[ni];
        ci++;
        cur.node.nodeValue = cur.text.slice(0, ci);
        var delay = 11;
        if (ci >= cur.text.length) {
          ni++; ci = 0;
          delay = cur.text.indexOf("\n") !== -1 ? 75 : 22;
        }
        window.setTimeout(type, delay);
      };
      window.setTimeout(type, 320);
      try { sessionStorage.setItem("typed", "1"); } catch (e) { /* private mode */ }
    } else {
      signalReady();
    }
  }

  /* ---------- Footer year ----------------------------------------------- */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
