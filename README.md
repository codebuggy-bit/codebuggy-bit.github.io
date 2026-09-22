# Portfolio and writing

Personal portfolio and essays. Static HTML, CSS and vanilla JavaScript.

No build step. No framework. No dependencies. No trackers, no analytics, and no
third-party requests of any kind: every graphic is inline SVG or CSS, so the
only outbound links are the ones in the text.

## Structure

```
index.html          portfolio: about, skills, experience, selected work, contact
blog/               index plus three essays
resume/             downloadable resume (PDF, DOCX, plain text)
styles.css          all styling, dark and light themes
main.js             theme toggle, mobile nav, terminal typing effect
ui.js               command palette, scroll progress, live terminal, ToC, filter
matrix.js           Matrix rain background (every page)
vault.js            client-side decryption for the private contact details
robots.txt          keeps /resume/ out of search results
sitemap.xml         for Search Console
```

## The rain

`matrix.js` paints a Matrix rain field behind every page. It reads its colours
from the CSS custom properties, so it is coral on the dark theme and deep red on
the light one, and it re-reads them when the theme is toggled.

Four things keep it from being a distraction:

- **A real gaussian blur** via `filter: blur(var(--rain-blur))`. That is what
  turns the glyphs into texture, and it also hides the canvas being rendered at
  half resolution and upscaled.
- **A quiet variant.** `<body class="rain-quiet">` dials the opacity down and the
  blur up. The portfolio and the 404 use it, because they are dense with text
  edge to edge; the essays have wide prose margins and run at full strength.
- **A bright leading glyph.** Each column's head is drawn in `--bold-color` and
  demoted to the trail colour behind it. That contrast is the detail that makes
  it read as the films rather than as generic falling text.
- **A top mask** so the rain emerges from under the sticky header instead of
  starting abruptly beneath it. If a browser ignores the mask the canvas simply
  paints unmasked, so the failure mode is a lost gradient, not lost rain.

It is cheap on purpose: half-resolution render, roughly 18fps, paused when the
tab is hidden, and `<body>` rebuilds only when the viewport *width* changes so
that a mobile URL bar hiding does not re-randomise the field mid-scroll. With
`prefers-reduced-motion` it draws one static frame and never animates.

## Interactive layer

`ui.js` adds the interactive behaviour. Everything in it is progressive
enhancement: it creates its own markup, and with JavaScript off the pages render
exactly as before.

- **Command palette** on `Ctrl`/`Cmd`+`K`, or `/`, or the *search* button in the
  nav. Fuzzy-matches sections, essays and actions (toggle theme, copy email,
  download resume) and is driven entirely from the keyboard.
- **Live terminal** in the hero. Once the intro finishes typing, the prompt
  accepts real input: `help`, `whoami`, `stack`, `experience`, `certs`,
  `contact`, `resume`, `blog`, `theme`, `clear`, plus `sudo` and `matrix`.
  Arrow keys walk the command history.
- **Scroll progress bar** and a **scroll spy** that marks the current section in
  the nav, without reflowing it.
- **Table of contents** on every essay, generated from the `h2` elements at
  runtime, with heading anchors and the current section tracked as you read.
- **Writing filter** on the blog index, matching title and summary.
- **Copy-to-clipboard** for the email address, with a toast confirmation.
- **Back to top** button, appearing once you are past the first screen.

Reduced-motion is honoured (smooth scrolling is disabled, transitions are
flattened) and all of it is hidden in print.

## Testing

`tools/smoke_ui.js` loads the real pages in jsdom and exercises the palette,
terminal, filter and table of contents:

```bash
cd ../tools && node smoke_ui.js
python3 check_links.py          # crawls the local server for broken links
```

Both need the local server running on port 8000.

## Local preview

```bash
python3 serve.py
```

Then open <http://127.0.0.1:8000>. `serve.py` is a stock `http.server` plus
exactly one behaviour: it resolves extensionless URLs, so `/blog/matrix` serves
`blog/matrix.html` the way the CDN does.

**Do not use `python -m http.server` for this site.** The canonical URLs have no
`.html` extension (Cloudflare Pages 308-redirects the `.html` form), so the stock
server makes every internal link 404.

Do not open the files directly from disk either: `vault.js` needs a secure
context, which means https or localhost.

## Deploying

The live site is **Cloudflare Pages**, proxied by Cloudflare DNS on
`akashraj.ca`. `.github/workflows/deploy-pages.yml` builds nothing and publishes
the repository root to the `akashraj` Pages project on every push to `main`, so
a push is a deploy. The workflow needs two repository secrets,
`CLOUDFLARE_API_TOKEN` (Pages edit only) and `CLOUDFLARE_ACCOUNT_ID`.

There is no build step. The `rsync` step in the workflow exists only to keep
`.git` and `.github` out of the upload.

GitHub Pages is still enabled on this repository and still builds, but it no
longer serves the domain. It is what made the repository able to stay public:
Cloudflare Pages is used instead because GitHub Pages needs a paid plan to serve
from a private repository.

### Two things the CDN does that will bite you

Cloudflare proxies this site, and by default it does two things that have both
caused real breakage here:

1. **It caches CSS and JS for four hours.** A deploy updates `styles.css`, the
   HTML picks it up immediately, and returning visitors keep the old stylesheet
   for the rest of the window. That is why every `<link>` and `<script>` carries
   a `?v=` query string: **bump that number whenever you change an asset**, or
   the change will not reach anyone who has already loaded the page. This is
   what left the terminal prompt disabled after the interactive layer shipped.
2. **Email Address Obfuscation rewrites anything that looks like an address.**
   It turned `root@10.2.4.1` in the Matrix transcript into `[email protected]`
   and injected a decode script into the page. That setting is now **off** at
   the zone (Security > Settings > Client-side abuse), which fixes it at the
   source. The transcript is additionally wrapped in
   `<!--email_off-->`/`<!--/email_off-->` as a belt-and-braces measure in case
   the setting is ever switched back on. The feature was never useful here:
   the real address is assembled in JavaScript, so Cloudflare only ever saw the
   HTML and never the address itself.

## Accessibility and performance

Semantic landmarks, a skip link, visible focus rings, 44px touch targets on
touch devices, `prefers-reduced-motion` respected throughout, `prefers-contrast`
support, and a print stylesheet. The rain animation pauses when the tab is
hidden and renders at half resolution.

## Security

`_headers` carries the security headers, because Pages runs no server. The
notable choices:

- **Content Security Policy with no `'unsafe-inline'` anywhere.** The single
  inline script (the pre-paint theme bootstrap, identical on every page) is
  allowed by SHA-256 hash, and every inline `style=""` attribute was moved into
  `styles.css` so `style-src` can stay strict.
  **If you edit that inline script, or add an inline style, the CSP will block
  it** and the failure is silent. Recompute the hash and update `_headers`. The
  commands are in the comment there.
- `frame-ancestors 'none'` (plus `X-Frame-Options` for older browsers),
  `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
- `connect-src 'none'`, since the site makes no network requests at all.
- **HSTS** is set on the zone, not here, so it also covers redirects:
  180 days with `includeSubDomains`, no preload.

Other layers, all verified:

- **DNS**: SPF (`v=spf1 -all`) at the apex, DMARC `p=quarantine`, TLS 1.0/1.1
  refused, and DNSSEC signing enabled.
- **CAA** is managed by Cloudflare and restricted to its five CA partners. The
  records do not appear in the DNS records API, so query the authoritative
  nameservers, not the dashboard, when checking them.
- **No third-party resources.** No fonts, no analytics, no CDN script. The only
  outbound links are the ones in the prose.
- **GitHub**: secret scanning and push protection enabled, Actions token
  permissions default to read.
- **No metadata leakage**: the PDF carries no `/Info` dictionary (no author,
  producer or tooling strings), and the DOCX has no `docProps/core.xml`.

`README.md` and `serve.py` are excluded from the deploy on purpose. They document
the deployment and should not be served from the live site.

## Contact form

`contact.html` posts to `functions/api/contact.js`, a Pages Function, which
validates the message and forwards it by email.

**Sending is free.** The function tries two senders in order and uses whichever
is configured:

1. **Web3Forms** — free forever, 250 submissions/month, no card. The access key
   is designed to be public, but it is kept server-side here so the browser
   never talks to a third party and the CSP can stay `form-action 'self'`.
2. **Cloudflare Email Sending** — kept because it works and is free when sending
   to a *verified destination address*. Note that onboarding the sending product
   itself is paid on the Workers Free plan, which is why Web3Forms is the
   default.

**Not the `send_email` binding** — Pages Functions do not support it. The
bindings available to them are KV, D1, Durable Objects, R2, Queues, Vectorize,
service bindings and Workers AI; email is not among them. That is why both
senders go over HTTP instead.

Environment variables on the Pages project:

| Variable | Purpose |
|---|---|
| `WEB3FORMS_ACCESS_KEY` | **Secret.** Free key from web3forms.com |
| `CF_EMAIL_API_TOKEN` | **Secret.** Cloudflare token with `Email Sending: Edit` |
| `CONTACT_TO` | Destination. Must be a **verified destination address** for the Cloudflare sender |
| `CONTACT_FROM` | Sender address for the Cloudflare sender |
| `CLOUDFLARE_ACCOUNT_ID` | Needed only by the Cloudflare sender |

If none are configured the function does not pretend to succeed: it logs the
problem and redirects back with `?status=failed`, and the page tells the visitor
to email directly.

Spam is handled with a honeypot field rather than a CAPTCHA, so the site keeps
its "no third-party scripts" property and the CSP keeps `script-src 'self'`.
Submissions that fill the honeypot get a success response and are silently
dropped.

`contact@akashraj.ca` forwards to Gmail through Cloudflare Email Routing, which
is free and unlimited on every plan including Workers Free. That is separate
from sending and needs no paid anything.

## Notes on privacy

The contact area includes a password-protected block containing details that are
not published in plain text. It is encrypted with AES-256-GCM using a
600,000-round PBKDF2 key derived from a password that is not stored in this
repository, and decryption happens in the browser. Because the ciphertext is
public, the strength of that section is the strength of the password.

## Licence

Text and writing: all rights reserved. The site code may be referenced for
learning, but please do not republish the written content as your own.

## The threat radar (`/radar`)

Live open-source threat intelligence, also embedded as a section on the home
page. Both render from `radar.js` and fetch from a single Pages Function.

### Sources

| Source | What it gives | Key | Rate limit |
|---|---|---|---|
| [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | CVEs known to be exploited in the wild, with the date added | none | none — static file on a CDN |
| [abuse.ch URLhaus](https://urlhaus.abuse.ch/) | Recent malicious URL submissions | none | none published; bulk download, updated every few minutes |
| [abuse.ch Feodo Tracker](https://feodotracker.abuse.ch/) | Botnet C2 servers, with country and malware family | none | none published |
| [ransomware.live](https://www.ransomware.live/) | Recent ransomware victims, with country and sector | none | none published; asked to be reasonable |

**No API key is required and none is read.** If one is ever needed, set it on
the Pages project as an environment variable and read it as `env.NAME` inside
`functions/api/threats.js`. Never in `radar.js` — that file is served to the
browser.

NVD was evaluated and rejected: the keyless tier allows 5 requests per 30s, and
its default ordering returns the oldest CVEs first, so it needs date-window
parameters to be useful at all. KEV covers "newly exploited" better and for
free.

### How fresh it can actually be

The honest ceiling is the publishers, not this site. Measured from their own
response headers:

| Source | Publisher `max-age` | So the data is already |
|---|---|---|
| abuse.ch Feodo Tracker | 300s | up to 5 minutes old |
| abuse.ch URLhaus | 300s | up to 5 minutes old |
| CISA KEV | 2855s | up to 48 minutes old |
| ransomware.live | not set | sent fresh each time |

So polling faster than about a minute cannot make the data younger — it would
only make visitors wait. What the function does instead is
**stale-while-revalidate**: a copy under `FRESH_SECONDS` (20) is served as-is;
older than that, the stale copy goes out immediately and the refresh runs
behind the response via `context.waitUntil`. Every request after the first is
therefore instant regardless of how slow the upstream round trip is — measured
at 0.9s cold against 0.009s warm.

The page polls every 10s, and the response carries `x-radar-cache` (`fresh` |
`stale` | `miss`) and `x-radar-age` so the behaviour is inspectable with curl.

The panel reports the publisher's own `Age` header rather than claiming
instantaneity: *"the publishers cache these feeds themselves, so the copies
behind this page are 3m old."* Each source is listed with its own age, so a
stale feed is attributable rather than a vague caveat.

### Why there is no Auth-Key, and what one would not buy

abuse.ch now requires a free `Auth-Key` for its API. It is **not** used here,
and it would not make anything faster:

- The dumps are *generated every five minutes* whether or not you authenticate.
  The key controls access to the dumps, not their freshness, and abuse.ch asks
  explicitly not to fetch them more often than that.
- The key is passed **in the URL path**
  (`/v2/files/exports/YOUR-AUTH-KEY/recent.csv`), so any error message that
  includes the URL would leak it.
- abuse.ch's one-minute feed is ClamAV signatures, which is not data that can be
  plotted.

The page's freshness is therefore bounded by the publishers, and the honest
thing is to say so rather than poll harder and imply otherwise.

### How it stays inside the limits

Every upstream call happens server-side in `functions/api/threats.js`, once per
cache miss, and the response is held at the edge for **two minutes**. So
upstream sees at most one request per two minutes per Cloudflare colo
regardless of visitor count — the number of visitors is irrelevant.

The page polls every **60 seconds**, which is why the cache is two minutes and
not ten: a longer cache would hand back byte-identical data for most polls and
the pulsing "live" indicator would be describing nothing. Polling pauses
entirely while the tab is hidden (`Page Visibility API`).

Feeds fail independently (`Promise.allSettled`). A source that is down is
reported as down and the rest of the payload still ships. If the client's own
fetch fails it keeps the last data it received and says when that was, rather
than blanking the panel.

### Nothing about the visitor leaves this site

The browser only ever calls `/api/threats` and `/api/whoami` on this origin, so
the Content Security Policy keeps `connect-src 'self'` and there is no
third-party request to audit. `/api/whoami` reads the visitor's own network
details out of Cloudflare's `request.cf` — it is deliberately not an IP
geolocation API. Nothing is logged and nothing is stored.

### Accessibility

- The stats row and both feed lists are `aria-live="polite"`.
- Reduced-motion turns off the sweep, the blip pings, the live dot and the
  "current role" pulse, leaving a static list that still refreshes.
- The ticker clamps to two lines with an ellipsis; the full entry is in the
  `title`, because a truncated CVE id is not worth reading.
