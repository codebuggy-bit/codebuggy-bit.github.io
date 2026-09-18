/* =========================================================================
   POST /api/contact - Cloudflare Pages Function

   Receives the contact form and forwards it by email using Cloudflare's Email
   Sending REST API. There is no Workers binding here because Pages Functions do
   not support the send_email binding; the REST API is the supported route and
   works from any backend.

   Secrets come from the Pages project environment, never from this file:
     CF_EMAIL_API_TOKEN  token with Email Sending permission
     CONTACT_TO          destination address (a verified destination address,
                         which is free to send to on every plan)
     CONTACT_FROM        sender, must be on a domain onboarded for sending

   Design notes:
     - No third-party service and no client-side CAPTCHA. Spam is handled with a
       honeypot field: a bot fills it, a person never sees it.
     - Every failure path redirects back to the form with a short status code
       rather than rendering an error page, so the back button behaves.
     - Nothing is logged that contains the message body, and nothing is stored.
   ========================================================================= */

const LIMITS = {
  name: 100,
  email: 254,
  org: 100,
  reason: 40,
  message: 5000
};

const REASONS = new Set(["role", "contract", "question", "other"]);

// Deliberately permissive. The address is only used to reply to, and a strict
// regex rejects valid addresses often enough to lose real mail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function redirect(request, status) {
  const url = new URL("/contact", request.url);
  url.searchParams.set("status", status);
  // 303 so the browser follows with GET and the POST is not repeated on refresh.
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

export async function onRequestPost(context) {
  const { request, env } = context;

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return redirect(request, "invalid");
  }

  // Honeypot. Report success to the bot so it does not retry or learn the rule,
  // but send nothing.
  if (clean(form.get("website"), 100)) return redirect(request, "sent");

  const name = clean(form.get("name"), LIMITS.name);
  const email = clean(form.get("email"), LIMITS.email);
  const org = clean(form.get("org"), LIMITS.org);
  const message = clean(form.get("message"), LIMITS.message);
  const reason = clean(form.get("reason"), LIMITS.reason);

  const problem =
    !name ? "name" :
    !email || !EMAIL_RE.test(email) ? "email" :
    !message ? "message" :
    null;

  if (problem) return redirect(request, "invalid");

  if (!env.CF_EMAIL_API_TOKEN || !env.CONTACT_TO || !env.CONTACT_FROM) {
    // Configuration problem, not the sender's fault. Say so plainly rather than
    // pretending the message was delivered.
    console.error("contact: missing CF_EMAIL_API_TOKEN, CONTACT_TO or CONTACT_FROM");
    return redirect(request, "failed");
  }

  const label = REASONS.has(reason) ? reason : "other";
  const subject = `[akashraj.ca] ${label} - ${name}${org ? " (" + org + ")" : ""}`;

  const text =
    `From:     ${name} <${email}>\n` +
    `Company:  ${org || "-"}\n` +
    `About:    ${label}\n` +
    `Sent:     ${new Date().toISOString()}\n` +
    `\n${message}\n`;

  // reply_to is the sender, so hitting reply in the mail client goes straight
  // back to them rather than to the noreply-ish sending address.
  const html =
    `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>` +
    `<p>Company: ${escapeHtml(org || "-")}<br>About: ${escapeHtml(label)}<br>` +
    `Sent: ${escapeHtml(new Date().toISOString())}</p>` +
    `<hr><pre style="white-space:pre-wrap;font:inherit">${escapeHtml(message)}</pre>`;

  try {
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
          reply_to: email,
          subject,
          text,
          html
        })
      }
    );

    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.success === false) {
      // Log the code only. Never the message body.
      console.error("contact: send rejected", response.status, JSON.stringify(body && body.errors));
      return redirect(request, "failed");
    }
  } catch (e) {
    console.error("contact: send threw", e && e.message);
    return redirect(request, "failed");
  }

  return redirect(request, "sent");
}

// Anything that is not a POST. The form only ever POSTs here.
export async function onRequestGet(context) {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "POST" }
  });
}
