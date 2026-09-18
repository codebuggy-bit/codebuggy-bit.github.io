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
     The initial theme is applied by a tiny inline script in <head> so there is
     no flash of the wrong colours. This only wires up the button. */
  var toggle = document.getElementById("themeToggle");
  if (toggle) {
    var animTimer = 0;
    toggle.addEventListener("click", function () {
      var isLight = root.getAttribute("data-theme") === "light";
      var next = isLight ? "dark" : "light";

      /* Turn colour transitions on only for the moment of the switch. Leaving
         them on permanently would make every hover and focus change feel
         sluggish, and the rain canvas needs the same treatment as the text. */
      root.classList.add("theme-anim");
      window.clearTimeout(animTimer);
      animTimer = window.setTimeout(function () {
        root.classList.remove("theme-anim");
      }, 320);

      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
      toggle.setAttribute("aria-label", "Switch to " + (next === "light" ? "dark" : "light") + " theme");
    });
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
