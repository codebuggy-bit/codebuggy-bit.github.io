/* =========================================================================
   Akash Raj - interactive layer

   Loaded with `defer` after main.js, on every page. Every feature here is
   progressive enhancement: the page is complete and readable without it, and
   nothing runs unless its markup is present.

   Contents
     1.  helpers (base URL, toast, clipboard, escape)
     2.  scroll progress bar
     3.  scroll spy for the main navigation
     4.  back-to-top button
     5.  command palette (Ctrl/Cmd-K)
     6.  interactive terminal
     7.  copy-to-clipboard for the email address
     8.  article table of contents
     9.  writing filter
   ========================================================================= */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* =======================================================================
     1. Helpers
     ======================================================================= */

  /* Absolute site root, taken from this script's own URL. That keeps the same
     links working from / and from /blog/ without hardcoding either depth. */
  function siteBase() {
    var list = doc.getElementsByTagName("script");
    for (var i = 0; i < list.length; i++) {
      var src = list[i].src || "";
      if (/\/ui\.js(\?|$)/.test(src)) return src.replace(/ui\.js.*$/, "");
    }
    return "";
  }
  var BASE = siteBase();

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var toastEl = null, toastTimer = 0;
  function toast(message) {
    if (!toastEl) {
      toastEl = doc.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastEl.classList.remove("is-on"); }, 2400);
  }

  /* The async clipboard API needs a secure context. Serving from file:// or
     plain http falls back to the old selection trick rather than failing. */
  function copyText(text, okMessage) {
    if (!text) { toast("Nothing to copy"); return; }
    function fallback() {
      var area = doc.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      doc.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
      doc.body.removeChild(area);
      toast(ok ? okMessage : "Copy failed: " + text);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(okMessage); }, fallback);
    } else {
      fallback();
    }
  }

  function emailAddress() {
    var link = doc.querySelector("[data-user][data-domain]");
    if (!link) return "";
    return link.getAttribute("data-user") + "@" + link.getAttribute("data-domain");
  }

  function scrollToId(id) {
    var target = doc.getElementById(id);
    if (!target) return false;
    // The sticky header would otherwise cover the heading we just jumped to.
    var header = doc.querySelector(".site-header");
    var offset = header ? header.offsetHeight + 8 : 0;
    var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
    return true;
  }

  function slug(text) {
    var s = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    // These ids end up in the address bar when someone links to a section, so
    // cut at a word boundary rather than mid-word.
    if (s.length > 60) {
      s = s.slice(0, 60);
      var boundary = s.lastIndexOf("-");
      if (boundary > 24) s = s.slice(0, boundary);
    }
    return s || "section";
  }

  /* =======================================================================
     2. Scroll progress
     ======================================================================= */

  var progress = doc.createElement("div");
  progress.className = "progress";
  progress.setAttribute("aria-hidden", "true");
  doc.body.appendChild(progress);

  /* =======================================================================
     3. Scroll spy for the main navigation
     ======================================================================= */

  var navItems = [];
  Array.prototype.forEach.call(doc.querySelectorAll(".site-nav a[href*='#']"), function (link) {
    var href = link.getAttribute("href") || "";
    var hash = href.indexOf("#");
    if (hash < 0) return;
    var id = href.slice(hash + 1);
    // Only spy on sections that exist on this page. On the blog pages none do,
    // so the whole thing quietly does nothing.
    if (id && doc.getElementById(id)) navItems.push({ id: id, link: link });
  });

  (function spy() {
    if (!navItems.length || !("IntersectionObserver" in window)) return;
    var live = {};

    function setCurrent(id) {
      for (var i = 0; i < navItems.length; i++) {
        var on = navItems[i].id === id;
        navItems[i].link.classList.toggle("is-current", on);
        if (on) navItems[i].link.setAttribute("aria-current", "true");
        else navItems[i].link.removeAttribute("aria-current");
      }
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) live[entry.target.id] = entry.boundingClientRect.top;
        else delete live[entry.target.id];
      });
      var ids = Object.keys(live);
      if (!ids.length) return;
      // Several sections can sit in the band at once; the one nearest the top
      // is the one the reader is actually in.
      ids.sort(function (a, b) { return live[a] - live[b]; });
      setCurrent(ids[0]);
    }, { rootMargin: "-8% 0px -78% 0px", threshold: 0 });

    for (var i = 0; i < navItems.length; i++) observer.observe(doc.getElementById(navItems[i].id));
  })();

  /* =======================================================================
     4. Back to top
     ======================================================================= */

  var toTop = doc.createElement("button");
  toTop.type = "button";
  toTop.className = "to-top";
  toTop.setAttribute("aria-label", "Back to top");
  toTop.innerHTML = "<span aria-hidden='true'>&uarr;</span> top";
  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
  doc.body.appendChild(toTop);

  /* One rAF-throttled scroll handler drives both the bar and the button. */
  var ticking = false;
  function onScrollFrame() {
    ticking = false;
    var y = window.pageYOffset || root.scrollTop || 0;
    var max = root.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    progress.style.transform = "scaleX(" + ratio + ")";
    toTop.classList.toggle("is-on", y > 700);
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(onScrollFrame);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  onScrollFrame();

  /* =======================================================================
     5. Command palette
     ======================================================================= */

  var COMMANDS = [
    { title: "About",                    kind: "Section", href: "#about",       kw: "bio background story purple team cyber defence" },
    { title: "Skills",                   kind: "Section", href: "#skills",      kw: "tools stack sentinel defender falcon purple team adversary emulation detection engineering cymulate" },
    { title: "Experience",               kind: "Section", href: "#experience",  kw: "jobs work history intact" },
    { title: "Selected work",            kind: "Section", href: "#work",        kw: "projects outcomes metrics bas pentest retest validation" },
    { title: "Certifications and education", kind: "Section", href: "#credentials", kw: "az-500 cysa az-104 qualys conestoga" },
    { title: "Contact",                  kind: "Section", href: "#contact",     kw: "email reach hire" },
    { title: "Writing",                  kind: "Page",    href: "blog/",        kw: "blog essays posts index" },
    { title: "There Is No Spoon",        kind: "Post",    href: "blog/matrix",
      hint: "The Matrix, philosophy and security", kw: "matrix neo trinity spoon essay" },
    { title: "This Was a Warning Shot",  kind: "Post",    href: "blog/agi-cybersecurity",
      hint: "1,200 agents, one package registry", kw: "ai agents openai hugging face swarm intrusion" },
    { title: "No Fate But What We Make", kind: "Post",    href: "blog/ai-eschatology",
      hint: "Eschatology and dark prophecy", kw: "religion eschatology terminator prophecy basilisk" },
    { title: "Toggle light or dark theme", kind: "Action", action: "theme",    kw: "dark light mode colour" },
    { title: "Copy email address",       kind: "Action",  action: "email",      kw: "mail contact clipboard" },
    { title: "Download resume (PDF)",    kind: "Action",  href: "resume/Akash_Raj_Resume.pdf", kw: "cv download pdf" },
    { title: "LinkedIn profile",         kind: "Action",  href: "https://www.linkedin.com/in/akashraj235",
      external: true, kw: "social connect" }
  ];

  var palette = null, paletteInput = null, paletteList = null;
  var paletteHits = [], paletteIndex = 0, paletteReturnFocus = null;

  function matchScore(item, query) {
    if (!query) return 0;
    var hay = (item.title + " " + (item.kind || "") + " " + (item.kw || "")).toLowerCase();
    var at = hay.indexOf(query);
    if (at === 0) return 0;
    if (at > 0) return 1 + at;
    // Fall back to a subsequence match so "wg" finds "Writing".
    var cursor = 0, gaps = 0;
    for (var i = 0; i < query.length; i++) {
      var found = hay.indexOf(query.charAt(i), cursor);
      if (found < 0) return -1;
      gaps += found - cursor;
      cursor = found + 1;
    }
    return 100 + gaps;
  }

  function buildPalette() {
    palette = doc.createElement("div");
    palette.className = "palette";
    palette.hidden = true;
    palette.innerHTML =
      '<div class="palette-backdrop" data-palette-close></div>' +
      '<div class="palette-panel" role="dialog" aria-modal="true" aria-label="Search and commands">' +
        '<input class="palette-input" id="paletteInput" type="text" role="combobox" ' +
               'aria-expanded="true" aria-controls="paletteList" aria-autocomplete="list" ' +
               'autocomplete="off" spellcheck="false" ' +
               'placeholder="Search sections, writing, and actions">' +
        '<ul class="palette-list" id="paletteList" role="listbox" aria-label="Results"></ul>' +
        '<p class="palette-hint">' +
          '<kbd>&uarr;</kbd><kbd>&darr;</kbd> move &nbsp; <kbd>Enter</kbd> open &nbsp; <kbd>Esc</kbd> close' +
        '</p>' +
      '</div>';
    doc.body.appendChild(palette);

    paletteInput = palette.querySelector(".palette-input");
    paletteList = palette.querySelector(".palette-list");

    paletteInput.addEventListener("input", function () { renderPalette(paletteInput.value); });
    paletteInput.addEventListener("keydown", onPaletteKey);
    palette.addEventListener("click", function (event) {
      if (event.target.hasAttribute && event.target.hasAttribute("data-palette-close")) closePalette();
    });
    paletteList.addEventListener("click", function (event) {
      var li = event.target.closest ? event.target.closest("li[data-index]") : null;
      if (li) runCommand(paletteHits[Number(li.getAttribute("data-index"))].item);
    });
  }

  function renderPalette(query) {
    var q = String(query || "").trim().toLowerCase();
    var scored = [];
    for (var i = 0; i < COMMANDS.length; i++) {
      var score = matchScore(COMMANDS[i], q);
      if (score >= 0) scored.push({ item: COMMANDS[i], score: score, order: i });
    }
    scored.sort(function (a, b) { return a.score - b.score || a.order - b.order; });
    paletteHits = scored;
    paletteIndex = 0;

    if (!scored.length) {
      paletteList.innerHTML = '<li class="palette-empty" role="presentation">No matches</li>';
      paletteInput.removeAttribute("aria-activedescendant");
      return;
    }

    var html = "";
    for (var j = 0; j < scored.length; j++) {
      var item = scored[j].item;
      html += '<li id="palette-opt-' + j + '" role="option" data-index="' + j + '"' +
              (j === 0 ? ' aria-selected="true"' : ' aria-selected="false"') + '>' +
              '<span class="palette-kind">' + escapeHtml(item.kind) + '</span>' +
              '<span class="palette-title">' + escapeHtml(item.title) + '</span>' +
              (item.hint ? '<span class="palette-sub">' + escapeHtml(item.hint) + '</span>' : '') +
              '</li>';
    }
    paletteList.innerHTML = html;
    paletteInput.setAttribute("aria-activedescendant", "palette-opt-0");
  }

  function highlightPalette() {
    var options = paletteList.querySelectorAll("li[data-index]");
    for (var i = 0; i < options.length; i++) {
      var on = i === paletteIndex;
      options[i].setAttribute("aria-selected", on ? "true" : "false");
      if (on) {
        paletteInput.setAttribute("aria-activedescendant", options[i].id);
        if (options[i].scrollIntoView) options[i].scrollIntoView({ block: "nearest" });
      }
    }
  }

  function onPaletteKey(event) {
    var count = paletteHits.length;
    if (event.key === "Escape") { event.preventDefault(); closePalette(); return; }
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      paletteIndex = (paletteIndex + 1) % count;
      highlightPalette();
      return;
    }
    if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      paletteIndex = (paletteIndex + count - 1) % count;
      highlightPalette();
      return;
    }
    if (event.key === "Enter" && count) {
      event.preventDefault();
      runCommand(paletteHits[paletteIndex].item);
    }
  }

  function openPalette() {
    if (!palette) buildPalette();
    paletteReturnFocus = doc.activeElement;
    palette.hidden = false;
    paletteInput.value = "";
    renderPalette("");
    paletteInput.focus();
    doc.body.classList.add("palette-open");
  }

  function closePalette() {
    if (!palette || palette.hidden) return;
    palette.hidden = true;
    doc.body.classList.remove("palette-open");
    // Blur before restoring focus. Otherwise focus stays on an input inside a
    // hidden element, and the "/" shortcut below thinks the reader is typing.
    if (paletteInput) paletteInput.blur();
    if (paletteReturnFocus && paletteReturnFocus.focus) paletteReturnFocus.focus();
  }

  function runCommand(item) {
    if (!item) return;
    if (item.action === "theme") {
      closePalette();
      var toggle = doc.getElementById("themeToggle");
      if (toggle) { toggle.click(); toast("Theme switched"); }
      return;
    }
    if (item.action === "email") {
      closePalette();
      copyText(emailAddress(), "Email address copied");
      return;
    }
    closePalette();
    if (!item.href) return;
    if (item.external) { window.open(item.href, "_blank", "noopener"); return; }
    if (item.href.charAt(0) === "#" && scrollToId(item.href.slice(1))) {
      if (history.replaceState) history.replaceState(null, "", item.href);
      return;
    }
    window.location.href = BASE + item.href;
  }

  /* A visible trigger, because a keyboard shortcut nobody knows about is not
     discoverable. Injected rather than hardcoded so it lands in the nav menu
     on small screens without editing every page. */
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  var nav = doc.getElementById("siteNav");
  if (nav) {
    var searchBtn = doc.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "search-btn";
    searchBtn.setAttribute("aria-label", "Search this site");
    searchBtn.innerHTML = 'search <kbd>' + (isMac ? "&#8984;K" : "Ctrl K") + '</kbd>';
    searchBtn.addEventListener("click", openPalette);
    var themeBtn = nav.querySelector("#themeToggle");
    if (themeBtn) nav.insertBefore(searchBtn, themeBtn);
    else nav.appendChild(searchBtn);
  }

  doc.addEventListener("keydown", function (event) {
    var key = event.key ? event.key.toLowerCase() : "";
    if ((event.metaKey || event.ctrlKey) && key === "k") {
      event.preventDefault();
      if (palette && !palette.hidden) closePalette(); else openPalette();
      return;
    }
    if (key === "escape" && palette && !palette.hidden) {
      event.preventDefault();
      closePalette();
      return;
    }
    // "/" is the convention on documentation sites. Ignore it while the reader
    // is typing into something, or it eats real keystrokes.
    if (key === "/" && (!palette || palette.hidden)) {
      var active = doc.activeElement;
      var tag = (active && active.tagName) || "";
      var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
                   !!(active && active.isContentEditable);
      if (!typing) {
        event.preventDefault();
        openPalette();
      }
    }
  });

  /* =======================================================================
     6. Interactive terminal
     ======================================================================= */

  (function terminal() {
    var term = doc.getElementById("termBody");
    if (!term) return;
    var figure = term.closest ? term.closest(".terminal") : null;
    if (!figure) return;
    var codeEl = term.querySelector("code") || term;

    var row = doc.createElement("div");
    row.className = "term-row";
    var sigil = doc.createElement("span");
    sigil.className = "prompt";
    sigil.setAttribute("aria-hidden", "true");
    sigil.textContent = "$";
    var input = doc.createElement("input");
    input.type = "text";
    input.className = "term-input";
    input.setAttribute("aria-label", "Terminal command input. Type help for the list of commands.");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("autocapitalize", "off");
    input.placeholder = "type help";
    input.disabled = true;
    row.appendChild(sigil);
    row.appendChild(input);
    figure.appendChild(row);

    function emit(text, cls) {
      var span = doc.createElement("span");
      if (cls) span.className = cls;
      span.textContent = "\n" + text;
      codeEl.appendChild(span);
      term.scrollTop = term.scrollHeight;
    }

    function echo(commandText) {
      var sig = doc.createElement("span");
      sig.className = "prompt";
      sig.textContent = "\n$ ";
      var cmd = doc.createElement("span");
      cmd.className = "cmd";
      cmd.textContent = commandText;
      codeEl.appendChild(sig);
      codeEl.appendChild(cmd);
    }

    function link(label, href, external) {
      return { text: label, href: href, external: external };
    }

    var TERM = {
      help: { desc: "list the commands", run: function () {
        return [
          "commands: whoami, focus, stack, experience, certs, contact, resume, blog, theme, clear",
          "aliases: ls -> stack, cat focus.txt -> focus, writing -> blog"
        ];
      } },
      whoami: { desc: "who is this", run: function () {
        return ["akash raj", "security analyst ii, cyber defense", "niagara region, ontario"];
      } },
      focus: { desc: "what I work on", run: function () {
        return ["detection engineering | threat hunting | adversary emulation | incident response"];
      } },
      stack: { desc: "tools I use", run: function () {
        return [
          "sentinel  defender-xdr  crowdstrike-falcon  azure",
          "qualys-vmdr  cymulate  rapid7  jira  confluence",
          "powershell  python  bash"
        ];
      } },
      experience: { desc: "where I have worked", run: function () {
        return [
          "2026-     security analyst ii, cyber defense   intact",
          "2025-2025 security analyst, cyber defense      intact",
          "2022-2025 it security analyst                  intact public entities",
          "2021-2022 technical support analyst l2         cineplex digital media",
          "2017-2019 web developer                        b-ghud academy"
        ];
      } },
      certs: { desc: "certifications", run: function () {
        return [
          "az-500  azure security engineer associate",
          "cysa+   comptia cs0-003",
          "az-104  azure administrator associate",
          "qualys  vmdr / patch management / csam"
        ];
      } },
      contact: { desc: "how to reach me", run: function () {
        var out = [link("linkedin.com/in/akashraj235", "https://www.linkedin.com/in/akashraj235", true)];
        var address = emailAddress();
        if (address) out.push(link(address, "mailto:" + address));
        return out;
      } },
      resume: { desc: "download the PDF", run: function () {
        return [link("open resume/Akash_Raj_Resume.pdf", BASE + "resume/Akash_Raj_Resume.pdf")];
      } },
      blog: { desc: "list the writing", run: function () {
        return [
          "there is no spoon          blog/matrix",
          "this was a warning shot    blog/agi-cybersecurity",
          "no fate but what we make   blog/ai-eschatology"
        ];
      } },
      theme: { desc: "flip light/dark", run: function () {
        var toggle = doc.getElementById("themeToggle");
        if (toggle) toggle.click();
        return ["theme switched"];
      } },
      matrix: { desc: "?", run: function () {
        return ["wake up... follow the white rabbit.", "(there is a whole essay about this, try: blog)"];
      } },
      sudo: { desc: "nice try", run: function () {
        return ["akash is not in the sudoers file. this incident has been logged."];
      } },
      clear: { desc: "clear the screen", run: function () { return null; } }
    };

    var ALIASES = {
      "ls": "stack", "cat focus.txt": "focus", "writing": "blog", "posts": "blog",
      "certifications": "certs", "email": "contact", "cv": "resume", "?": "help",
      "man": "help", "dir": "stack", "jobs": "experience"
    };

    var history = [], historyAt = 0;

    function run(raw) {
      var text = String(raw || "").trim();
      if (!text) return;
      history.push(text);
      historyAt = history.length;
      echo(text);

      var key = text.toLowerCase();
      if (ALIASES[key]) key = ALIASES[key];

      var entry = TERM[key];
      if (!entry) {
        emit("command not found: " + text + "  (try: help)", "term-err");
        return;
      }
      var lines = entry.run();
      if (lines === null) { codeEl.textContent = ""; return; }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line && typeof line === "object" && line.href) {
          var span = doc.createElement("span");
          span.textContent = "\n";
          var anchor = doc.createElement("a");
          anchor.href = line.href;
          if (line.external) { anchor.target = "_blank"; anchor.rel = "noopener"; }
          anchor.textContent = line.text;
          codeEl.appendChild(span);
          codeEl.appendChild(anchor);
          term.scrollTop = term.scrollHeight;
        } else {
          emit(line);
        }
      }
    }

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        run(input.value);
        input.value = "";
        return;
      }
      // Shell-style history, because people will try it.
      if (event.key === "ArrowUp" && history.length) {
        event.preventDefault();
        historyAt = Math.max(0, historyAt - 1);
        input.value = history[historyAt] || "";
        return;
      }
      if (event.key === "ArrowDown" && history.length) {
        event.preventDefault();
        historyAt = Math.min(history.length, historyAt + 1);
        input.value = history[historyAt] || "";
      }
    });

    function enable() {
      if (!input.disabled) return;
      // The markup ends with a decorative "$ <cursor>" line. The real input
      // replaces it, otherwise every command would sit under two prompts.
      var cursor = term.querySelector(".cursor");
      if (cursor) {
        var promptEl = cursor.previousElementSibling;
        if (promptEl && promptEl.classList.contains("prompt")) {
          var before = promptEl.previousSibling;
          if (before && before.nodeType === 3) before.nodeValue = before.nodeValue.replace(/\s+$/, "");
          promptEl.parentNode.removeChild(promptEl);
        }
        cursor.parentNode.removeChild(cursor);
      }
      input.disabled = false;
      term.setAttribute("data-interactive", "1");
    }

    // main.js types the intro out first. It flags completion on the element so
    // this works whether or not the typing actually ran this session.
    if (term.getAttribute("data-ready") === "1") enable();
    else term.addEventListener("terminalready", enable);
  })();

  /* =======================================================================
     7. Copy the email address
     ======================================================================= */

  Array.prototype.forEach.call(doc.querySelectorAll("[data-user][data-domain]"), function (link) {
    var button = doc.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = "copy";
    button.setAttribute("aria-label", "Copy email address to clipboard");
    button.addEventListener("click", function () {
      copyText(emailAddress(), "Email address copied");
    });
    if (link.parentNode) link.parentNode.insertBefore(button, link.nextSibling);
  });

  /* =======================================================================
     8. Article table of contents
     ======================================================================= */

  (function articleToc() {
    var article = doc.querySelector(".article");
    if (!article) return;
    var headings = article.querySelectorAll("h2");
    if (headings.length < 3) return;

    var used = {};
    var entries = [];

    Array.prototype.forEach.call(headings, function (heading, i) {
      var id = heading.id || slug(heading.textContent);
      while (used[id] || (doc.getElementById(id) && doc.getElementById(id) !== heading)) {
        id = slug(heading.textContent) + "-" + (++i);
      }
      used[id] = true;
      heading.id = id;
      entries.push({ id: id, heading: heading, text: heading.textContent });

      // A visible anchor makes any heading linkable, which is what people
      // expect from a long essay.
      var anchor = doc.createElement("a");
      anchor.className = "heading-anchor";
      anchor.href = "#" + id;
      anchor.setAttribute("aria-label", "Link to this section");
      anchor.textContent = "#";
      heading.appendChild(anchor);
    });

    var toc = doc.createElement("details");
    toc.className = "toc";
    toc.open = true;

    var summary = doc.createElement("summary");
    summary.textContent = "On this page";
    toc.appendChild(summary);

    var list = doc.createElement("ol");
    var links = [];
    entries.forEach(function (entry) {
      var li = doc.createElement("li");
      var a = doc.createElement("a");
      a.href = "#" + entry.id;
      a.textContent = entry.text;
      a.addEventListener("click", function (event) {
        event.preventDefault();
        scrollToId(entry.id);
        if (history.replaceState) history.replaceState(null, "", "#" + entry.id);
      });
      li.appendChild(a);
      list.appendChild(li);
      links.push({ id: entry.id, link: a });
    });
    toc.appendChild(list);

    var header = article.querySelector(".article-header");
    if (header && header.nextSibling) article.insertBefore(toc, header.nextSibling);
    else article.insertBefore(toc, article.firstChild);

    if (!("IntersectionObserver" in window)) return;
    var live = {};
    var observer = new IntersectionObserver(function (batch) {
      batch.forEach(function (entry) {
        if (entry.isIntersecting) live[entry.target.id] = entry.boundingClientRect.top;
        else delete live[entry.target.id];
      });
      var ids = Object.keys(live);
      if (!ids.length) return;
      ids.sort(function (a, b) { return live[a] - live[b]; });
      var current = ids[0];
      links.forEach(function (item) {
        var on = item.id === current;
        item.link.classList.toggle("is-current", on);
        if (on) item.link.setAttribute("aria-current", "true");
        else item.link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-8% 0px -75% 0px", threshold: 0 });

    links.forEach(function (item) { observer.observe(doc.getElementById(item.id)); });
  })();

  /* =======================================================================
     9. Writing filter
     ======================================================================= */

  (function writingFilter() {
    var list = doc.querySelector(".post-list");
    if (!list) return;
    var posts = list.querySelectorAll("li");
    if (posts.length < 2) return;

    var box = doc.createElement("div");
    box.className = "filter";
    box.innerHTML =
      '<label class="filter-label" for="postFilter">Filter writing</label>' +
      '<input class="filter-input" id="postFilter" type="search" autocomplete="off" ' +
             'placeholder="matrix, agents, prophecy...">' +
      '<p class="filter-count" id="postFilterCount" role="status" aria-live="polite"></p>';

    list.parentNode.insertBefore(box, list);

    var input = box.querySelector("#postFilter");
    var count = box.querySelector("#postFilterCount");

    // Cache the searchable text once instead of reading the DOM on each key.
    var index = [];
    Array.prototype.forEach.call(posts, function (post) {
      index.push({ node: post, text: post.textContent.toLowerCase().replace(/\s+/g, " ") });
    });

    function apply() {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      index.forEach(function (entry) {
        var match = !q || entry.text.indexOf(q) !== -1;
        entry.node.hidden = !match;
        if (match) shown++;
      });
      count.textContent = !q ? "" : (shown === 1 ? "1 post" : shown + " posts");
      list.classList.toggle("is-filtered", !!q);
    }

    input.addEventListener("input", apply);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { input.value = ""; apply(); }
    });
  })();

  /* =======================================================================
     10. Scroll reveals, metric bars and counters

     One observer drives all three. Everything here is additive: with
     JavaScript off, or with reduced motion, the content is simply already
     there. The .reveal styles are scoped to html.js so a script failure cannot
     leave the page invisible, and this unsticks them anyway if the browser has
     no IntersectionObserver at all.
     ======================================================================= */

  (function motion() {
    var reveals = doc.querySelectorAll(".reveal");
    var metrics = doc.querySelectorAll(".metrics");
    var counters = doc.querySelectorAll("[data-count]");
    if (!reveals.length && !metrics.length && !counters.length) return;

    function show(el) { el.classList.add("is-revealed"); }

    function countUp(el) {
      if (el.getAttribute("data-counted") === "1") return;
      el.setAttribute("data-counted", "1");

      var target = parseInt(el.getAttribute("data-count"), 10);
      if (isNaN(target)) return;

      var prefix = el.getAttribute("data-prefix") || "";
      var suffix = el.getAttribute("data-suffix") || "";
      // The markup already holds the final value, so reduced motion just leaves
      // it alone rather than animating to the same number.
      if (reduceMotion) return;

      var duration = 900, start = 0;
      var frame = function (now) {
        if (!start) start = now;
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 3);          // easeOutCubic
        el.textContent = prefix + Math.round(target * eased) + suffix;
        if (t < 1) window.requestAnimationFrame(frame);
        else el.textContent = prefix + target + suffix;
      };
      el.textContent = prefix + "0" + suffix;
      window.requestAnimationFrame(frame);
    }

    // No observer: reveal everything at once and leave the numbers alone.
    if (!("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(reveals, show);
      Array.prototype.forEach.call(metrics, show);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (el.classList.contains("reveal") || el.classList.contains("metrics")) show(el);
        if (el.hasAttribute("data-count")) countUp(el);
        observer.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.1 });

    Array.prototype.forEach.call(reveals, function (el) { observer.observe(el); });
    Array.prototype.forEach.call(metrics, function (el) { observer.observe(el); });
    Array.prototype.forEach.call(counters, function (el) { observer.observe(el); });
  })();

  /* =======================================================================
     Footer year, in case main.js did not run
     ======================================================================= */

  var year = doc.getElementById("year");
  if (year && !year.textContent.trim()) year.textContent = String(new Date().getFullYear());
})();
