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
matrix.js           Matrix rain background (blog pages only)
vault.js            client-side decryption for the private contact details
robots.txt          keeps /resume/ out of search results
sitemap.xml         for Search Console
```

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
```

It needs the local server running on port 8000.

## Local preview

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Do not open the files directly from disk:
`vault.js` needs a secure context, which means https or localhost.

## Deploying

GitHub Pages serves this repository root directly. There is no build step, so a
push is a deploy. `.nojekyll` is present so that Jekyll does not process or
exclude any files.

## Accessibility and performance

Semantic landmarks, a skip link, visible focus rings, 44px touch targets on
touch devices, `prefers-reduced-motion` respected throughout, `prefers-contrast`
support, and a print stylesheet. The rain animation pauses when the tab is
hidden and renders at half resolution.

## Notes on privacy

The contact area includes a password-protected block containing details that are
not published in plain text. It is encrypted with AES-256-GCM using a
600,000-round PBKDF2 key derived from a password that is not stored in this
repository, and decryption happens in the browser. Because the ciphertext is
public, the strength of that section is the strength of the password.

## Licence

Text and writing: all rights reserved. The site code may be referenced for
learning, but please do not republish the written content as your own.
