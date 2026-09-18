/* =========================================================================
   POST /api/contact - Cloudflare Pages Function

   Receives the contact form, validates it, and forwards it by email.

   Sender order, first one configured wins:

     1. Web3Forms   - free forever, 250 submissions/month, no card. The access
                      key is designed to be public, but it is kept server-side
                      here so the browser never talks to a third party and the
                      Content Security Policy can stay form-action 'self'.
     2. Cloudflare  - the Email Sending REST API. Kept because it works and is
                      free when sending to a verified destination address, so
                      if that ever gets verified this needs no code change.

   Neither configured is not a crash: the function says so and redirects back,
   rather than telling a visitor their message was sent when it was not.

   Spam is handled with a honeypot field, so there is no CAPTCHA and no
   third-party script.

   Environment (Pages project, production):
     WEB3FORMS_ACCESS_KEY   free key from web3forms.com
     CF_EMAIL_API_TOKEN     Cloudflare token with Email Sending permission
     CONTACT_TO             where the mail goes
     CONTACT_FROM           sender address
     CLOUDFLARE_ACCOUNT_ID  needed only by the Cloudflare sender
   ========================================================================= */

const LIMITS = { name: 100, email: 254, org: 100, reason: 40, message: 5000 };
const REASONS = new Set(["role", "contract", "question", "other"]);

// Permissive on purpose. The address is only used to reply to, and strict
// patterns reject valid addresses often enough to lose real mail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function redirect(request, status) {
  const url = new URL("/contact", request.url);
  url.searchParams.set("status", status);
  // 303 so the browser follows with GET and a refresh does not repost.
  return Response.redirect(url.toString(), 303);
}

function clean(value, max) {
  return String(value == null ? "" : value).replace(/\r\n/g, "\n").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ---------- senders ---------------------------------------------------- */

async function sendWithWeb3Forms(env, fields) {
  const response = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      access_key: env.WEB3FORMS_ACCESS_KEY,
      subject: fields.subject,
      from_name: "akashraj.ca contact form",
      // replyto makes hitting reply in the inbox go back to the sender.
      replyto: fields.email,
      name: fields.name,
      email: fields.email,
      company: fields.org || "-",
      about: fields.reason,
      message: fields.message
    })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.success === false) {
    console.error("contact: web3forms rejected", response.status, JSON.stringify(body && body.message));
    return false;
  }
  return true;
}

async function sendWithCloudflare(env, fields) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_EMAIL_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: env.CONTACT_TO,
        from: env.CONTACT_FROM,
        reply_to: fields.email,
        subject: fields.subject,
        text: fields.text,
        html: fields.html
      })
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.success === false) {
    console.error("contact: cloudflare rejected", response.status, JSON.stringify(body && body.errors));
    return false;
  }
  return true;
}

/* ---------- handler ---------------------------------------------------- */

export async function onRequestPost(context) {
  const { request, env } = context;

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return redirect(request, "invalid");
  }

  // Honeypot: report success so a bot does not retry or learn the rule, but
  // send nothing.
  if (clean(form.get("website"), 100)) return redirect(request, "sent");

  const name = clean(form.get("name"), LIMITS.name);
  const email = clean(form.get("email"), LIMITS.email);
  const org = clean(form.get("org"), LIMITS.org);
  const message = clean(form.get("message"), LIMITS.message);
  const reasonRaw = clean(form.get("reason"), LIMITS.reason);
  const reason = REASONS.has(reasonRaw) ? reasonRaw : "other";

  if (!name || !email || !EMAIL_RE.test(email) || !message) {
    return redirect(request, "invalid");
  }

  const subject = `[akashraj.ca] ${reason} - ${name}${org ? " (" + org + ")" : ""}`;
  const stamp = new Date().toISOString();

  const fields = {
    name, email, org, reason, message, subject,
    text: `From:    ${name} <${email}>\nCompany: ${org || "-"}\nAbout:   ${reason}\nSent:    ${stamp}\n\n${message}\n`,
    html: `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>` +
          `<p>Company: ${escapeHtml(org || "-")}<br>About: ${escapeHtml(reason)}<br>Sent: ${escapeHtml(stamp)}</p>` +
          `<hr><pre style="white-space:pre-wrap;font:inherit">${escapeHtml(message)}</pre>`
  };

  try {
    if (env.WEB3FORMS_ACCESS_KEY) {
      return redirect(request, (await sendWithWeb3Forms(env, fields)) ? "sent" : "failed");
    }
    if (env.CF_EMAIL_API_TOKEN && env.CONTACT_TO && env.CONTACT_FROM) {
      return redirect(request, (await sendWithCloudflare(env, fields)) ? "sent" : "failed");
    }
  } catch (e) {
    console.error("contact: send threw", e && e.message);
    return redirect(request, "failed");
  }

  console.error("contact: no sender configured (WEB3FORMS_ACCESS_KEY or Cloudflare credentials)");
  return redirect(request, "failed");
}

export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
