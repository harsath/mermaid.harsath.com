# mermaid.harsath.com

A mermaid editor with live side-by-side preview, export to SVG / PNG / JPEG / PDF, and end-to-end encrypted share links that expire after 3 days, 1 week, 1 month or 6 months. No account, no paywall.

## How it works

```
 browser                                         Supabase (free tier)
 ───────                                         ────────────────────
 type ─► mermaid.render() ─► preview
 export ─► SVG ─► canvas (PNG/JPEG) or svg2pdf (vector PDF)
 share: secret ─HKDF─► id + AES key
        encrypt ── rpc create_share(id, ciphertext, days) ─► Postgres: shares(id, data, expires_at)
 open #<secret> ── rpc get_share(id) ──────────────────────► ciphertext if not expired
        decrypt
                                                 pg_cron hourly ─► delete expired rows
```

- **Rendering:** [mermaid](https://github.com/mermaid-js/mermaid) runs in the browser. Your work-in-progress is autosaved to `localStorage`. Syntax highlighting is [Prism](https://prismjs.com)'s mermaid grammar, drawn in a `<pre>` behind a transparent `<textarea>`, so the editor is still a plain textarea.
- **Export:** diagrams are re-rendered with plain SVG text labels (no `<foreignObject>`), so they can be drawn to a canvas for PNG/JPEG and converted to a real vector PDF (selectable text) with jsPDF + svg2pdf.js. PNG has a transparent background, JPEG a white one.
- **Sharing:** the link is `/#<22-char secret>`. The secret (16 random bytes) never leaves the browser; the part of a URL after `#` isn't sent to any server. From it the browser derives (HKDF) the share id, which is sent, and an AES-256-GCM key, which isn't. Supabase stores only `base64url(iv || ciphertext)` (the table rejects anything else), the expiry and creation time. It can't read the diagram or turn an id back into a link.
- **Database:** one table, `shares`. Clients can't read or list it; the only way in is `create_share` and `get_share` (needs the id). Shares are capped at 100 KB of source, and at 500 new shares per hour across everyone, so a script can't fill the database.
- **Opening a share** shows it read-only. **Edit a copy** forks it into your own local draft (after asking, if that would replace a diagram you were working on) and drops the secret from the URL. Nothing is uploaded until you press **Get link**, which shares your version as a new link; the original link is untouched.
- **Hosting:** static files on GitHub Pages; no build step.

## Files

| Path | Purpose |
|---|---|
| `index.html` | layout and styles |
| `app.js` | editor, preview, export, share, fork |
| `crypto.js` | key derivation and encryption (WebCrypto) |
| `supabase/migrations/0001_init.sql` | `shares` table, cleanup cron job, `ping` |
| `supabase/migrations/0002_encrypt.sql` | switches shares to ciphertext; `create_share` / `get_share` |
| `.github/workflows/keepalive.yml` | daily ping so the free project doesn't pause |

## Setup (one time)

It uses the same Supabase project as airdrop.harsath.com (the `shares` table doesn't touch anything airdrop uses).

1. **Database:** paste `supabase/migrations/0001_init.sql`, then `0002_encrypt.sql`, into **SQL Editor** and run each. Both are safe to re-run.
2. To use a different project instead, change `SUPABASE_URL` / `SUPABASE_KEY` at the top of `app.js` and the project URL and key in `.github/workflows/keepalive.yml`.

## Free-tier limits

- The project pauses after about a week of no activity. `.github/workflows/keepalive.yml` calls `ping` once a day to prevent that (airdrop's copy pings the same project at a different hour, so either one alone is enough). GitHub disables scheduled workflows in repos with no commits for 60 days; re-enable it in the Actions tab if that happens.

## Run locally

```
python3 -m http.server 8000
```

## Deploy

Push to the default branch; GitHub Pages serves it. Keep the `CNAME` file for the custom domain, and add a `CNAME` DNS record `mermaid` → `harsath.github.io`.
