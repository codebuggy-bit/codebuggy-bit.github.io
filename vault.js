/* =========================================================================
   Vault: client-side decryption for the private contact block.

   The ciphertext lives in a data attribute on the page. The password is never
   stored anywhere. Decryption uses Web Crypto: PBKDF2-SHA256 key derivation,
   then AES-256-GCM, which authenticates as well as decrypts, so a wrong
   password fails loudly instead of producing garbage.

   Two honest limitations, both stated in the UI as well:
     1. Anything encrypted on a public page is only as strong as the password,
        because the ciphertext itself is public.
     2. Web Crypto needs a secure context. It works on https and on localhost,
        and does not work when the file is opened directly from disk.
   ========================================================================= */
(function () {
  "use strict";

  var box = document.getElementById("vault");
  if (!box) return;

  var blob64 = box.getAttribute("data-vault") || "";
  var form = document.getElementById("vaultForm");
  var input = document.getElementById("vaultPw");
  var status = document.getElementById("vaultStatus");
  var out = document.getElementById("vaultOut");

  function say(msg, isError) {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle("is-error", !!isError);
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function render(data) {
    out.textContent = "";

    function row(label, value) {
      var dl = document.createElement("div");
      dl.className = "vault-item";
      var dt = document.createElement("span");
      dt.className = "vault-k";
      dt.textContent = label;
      var dd = document.createElement("span");
      dd.className = "vault-v";
      dd.textContent = value;
      dl.appendChild(dt);
      dl.appendChild(dd);
      out.appendChild(dl);
    }

    if (data.email) row("Email", data.email);
    if (data.phone) row("Phone", data.phone);
    if (data.credentials && data.credentials.length) {
      data.credentials.forEach(function (c) { row("Credential", c); });
    }

    out.hidden = false;
  }

  function unlock(password) {
    var bytes = b64ToBytes(blob64);

    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "VLT1") {
      say("This vault is not in a format this page understands.", true);
      return Promise.reject();
    }

    var view = new DataView(bytes.buffer);
    var iterations = view.getUint32(4, false);
    var salt = bytes.slice(8, 24);
    var iv = bytes.slice(24, 36);
    var rest = bytes.slice(36);
    var ct = rest.slice(0, rest.length - 16);
    var tag = rest.slice(rest.length - 16);
    var sealed = new Uint8Array(ct.length + tag.length);
    sealed.set(ct, 0);
    sealed.set(tag, ct.length);

    var enc = new TextEncoder();

    return crypto.subtle
      .importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"]
        );
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, sealed);
      })
      .then(function (plain) {
        render(JSON.parse(new TextDecoder().decode(plain)));
      });
  }

  /* Web Crypto is unavailable outside a secure context. Say so rather than
     failing silently when someone opens the file from disk. */
  if (!window.crypto || !window.crypto.subtle) {
    if (form) form.hidden = true;
    say("Decryption needs a secure context (https or localhost), so it is unavailable here.", true);
    return;
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = input ? input.value : "";
      if (!pw) return;
      say("Working...", false);
      unlock(pw).then(function () {
        say("Unlocked.", false);
        if (input) input.value = "";
      }).catch(function () {
        say("Incorrect password.", true);
      });
    });
  }
})();
