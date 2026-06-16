# JS Recon — API Map & Secret Miner

A lightweight Chrome/Edge extension that does one thing well: as you browse, it **mines
every JavaScript bundle for secrets and endpoints**, records the API calls pages actually
make, and assembles a **live API map** you can export as an **OpenAPI spec**.

No proxy, no debugger banner — it uses a content script + `webRequest`, so it's quiet and
fast. It's the client-side recon half of a full pentest suite, pulled out as its own tool.

> ⚠️ **Authorized recon only.** Use only on apps you own or are permitted to test. The
> extension fetches script files and reads page JS to map them; keep a scope set on engagements.

## Install

1. Unzip, open `chrome://extensions`, enable **Developer mode**, **Load unpacked** → this folder.
2. Click the icon, make sure **Collecting** is on, optionally set a **scope** (comma-separated
   hosts, `*` wildcard; blank = everything).
3. Browse your target normally. Open **API map** to see what it found.

## What it collects

- **Endpoints from JS** — paths and absolute URLs found in inline + external scripts.
- **Observed endpoints** — real XHR/fetch/ping/websocket calls (method + path + query params),
  seen via `webRequest`.
- **Secrets** — AWS / Google / GitHub / Slack / Stripe keys, private keys, JWTs, and generic
  `apikey/secret/token` assignments, found in JS and storage/cookies.
- Paths are templated (`/users/123` → `/users/{id}`) and merged per host. Known trackers and
  static assets are filtered out to keep the map clean.

## The API map & OpenAPI export

Open the map, pick a host, and you get a table of endpoints (method, path, params, whether it
was **observed** or only **from JS**, hit count) plus any secrets seen on that host.

- **Export OpenAPI** — a guessed OpenAPI 3.0 spec for the selected host (paths, methods, path +
  query parameters). Import it into Postman, Swagger UI, an API fuzzer, etc.
- **Export all (JSON)** — the full raw dataset.

> The spec is *discovered and unverified* — methods/params are inferred from what was seen.
> Treat it as a starting map, not ground truth.

## Files

`manifest.json`, `background.js` (engine: webRequest + mining + model), `cs.js` (content
script), `popup.html/.js` (toggle + stats), `viewer.html/.js` (API map + OpenAPI export),
`icons/`.

## Notes & limits

- Some external scripts won't fetch (CORS/auth) — those are skipped silently.
- It maps the API surface; it doesn't attack anything. Pair it with a proxy/fuzzer for testing.
- Storage values aren't exfiltrated — only keys/cookies are scanned for token patterns, locally.
