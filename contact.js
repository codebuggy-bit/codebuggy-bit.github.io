/* =========================================================================
   Contact page behaviour

   Small on purpose. The form itself is a plain POST that works with
   JavaScript off, so nothing here is load-bearing: it only adds a character
   counter, a double-submit guard, and turns the ?sent / ?error query string
   the function redirects with into a readable message.

   Deliberately no fetch(). Submitting with fetch would need connect-src in the
   Content Security Policy, and the page works fine without it.
   ========================================================================= */
(function () {
  "use strict";

  var doc = document;

  /* ---------- Result message from the redirect --------------------------- */
  var MESSAGES = {
    sent: ["ok", "Message sent. Thanks - I'll reply to the address you gave."],
    invalid: ["error", "Something was missing. Name, a valid email and a message are all required."],
    rejected: ["error", "That message did not get through. Email me directly instead."],
    failed: ["error", "The send failed on my end, not yours. Email me directly and I'll sort it out."],
    bot: ["error", "That submission was discarded."]
  };

  var status = doc.getElementById("formStatus");
  if (status) {
    var key = null;
    try {
      key = new URLSearchParams(window.location.search).get("status");
    } catch (e) { /* very old browser, just show nothing */ }

    if (key && MESSAGES[key]) {
      status.textContent = MESSAGES[key][1];
      status.className = "form-status is-" + MESSAGES[key][0];
      status.hidden = false;
      status.setAttribute("role", MESSAGES[key][0] === "ok" ? "status" : "alert");

      // Keep the message on screen but drop it from the URL, so a refresh does
      // not re-announce a result that already happened.
      if (window.history && history.replaceState) {
        history.replaceState(null, "", window.location.pathname + "#contactForm");
      }
      status.scrollIntoView({ block: "nearest" });
    }
  }

  /* ---------- Character counter ------------------------------------------ */
  var message = doc.getElementById("cf-message");
  var count = doc.getElementById("cf-count");
  if (message && count) {
    var update = function () {
      count.textContent = String(message.value.length);
    };
    message.addEventListener("input", update);
    update();
  }

  /* ---------- Double-submit guard ---------------------------------------- */
  var form = doc.getElementById("contactForm");
  var submit = doc.getElementById("cf-submit");
  if (form && submit) {
    form.addEventListener("submit", function () {
      // A second click before the browser navigates would send a second copy.
      submit.disabled = true;
      submit.textContent = "Sending...";
      window.setTimeout(function () {
        submit.disabled = false;
        submit.textContent = "Send message";
      }, 8000);
    });
  }
})();
