# 30 · Running behind a Cloudflare Tunnel

What goes wrong with web apps behind Cloudflare, what was researched about it (2026-10-15), and what
this repository does about each item. The alpha is published through a Cloudflare Tunnel, and the
previous system hit Cloudflare's 524 timeout in production (M27 in [00 · Prior art](00-prior-art.md)).

**How to read the evidence.** "Measured" means it was run against this system. "Vendor docs" means
Cloudflare's own pages. "Reported" means a forum or blog, which is anecdote, not guarantee.

---

## 1 · Setup

```
browser ──HTTPS──► Cloudflare edge ──tunnel──► cloudflared ──http──► app:3001 (web UI)
                                                                     app:3000 (API, NOT routed)
```

- Run `cloudflared` as the optional compose service: `npm run alpha:tunnel`. It needs `TUNNEL_TOKEN` in
  `infra/compose/.env`. Create the tunnel in the Cloudflare dashboard and add one public hostname whose
  service is `http://app:3001` (plain http, inside the tunnel).
- **Route only the web port.** The web server calls the API privately, so the API needs no public
  hostname. That keeps the API's `trust proxy`, its key and session surface, and Bot Fight Mode out of the
  picture.
- Do not set `httpHostHeader` on the route and do not put another proxy that rewrites `Host` in between
  (section 2, item 3).

## 2 · The list

| # | Problem | Cause | What to do | Status here |
|---|---|---|---|---|
| 1 | **524 "a timeout occurred"** | Cloudflare waits 100 s for the origin to answer; fixed on Free, Pro and Business, raised only on Enterprise (vendor docs, reported) | Anything long becomes a background job with a progress endpoint | Import commit is synchronous, about **2.4 ms per row, so a ceiling near 40,000 rows** (measured: 5,000 rows 12 s, 20,000 rows 48 s). Pinned as **D-57** |
| 2 | **413 on big uploads** | Request bodies are capped at 100 MB on Free and Pro (reported) | Keep uploads below it | Fine: imports 20 MB, attachments 16 MB |
| 3 | **"Invalid Server Actions request", login and every form action fails** | Next.js compares the browser's `Origin` with `x-forwarded-host` or `host`; a proxy that changes the host breaks it ([next.js#58019](https://github.com/vercel/next.js/issues/58019)) | Route straight to `app:3001` and keep the original Host. If a reverse proxy is ever added, set `experimental.serverActions.allowedOrigins` to the public hostname | **Not exercised through a real tunnel yet.** Check this first on the first deploy |
| 4 | **502 Bad Gateway** | cloudflared cannot reach the origin: service down, wrong port, https where http is served ([vendor docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)) | Use `http://app:3001`; start cloudflared after the app is healthy | The compose service waits for the app's healthcheck |
| 5 | **ERR_TOO_MANY_REDIRECTS** | An origin redirect to https combined with a route over http, or Cloudflare "Flexible" SSL with "Always Use HTTPS" | No HTTPS redirect at the origin | None exists |
| 6 | **Hydration errors, broken layout** | Rocket Loader and Auto Minify rewrite a server-rendered React app's JS and HTML (reported) | Turn both off for the hostname (Speed → Optimization) | Dashboard setting, not code |
| 7 | **Webhook and API callers get a challenge page** | Bot Fight Mode cannot be skipped per hostname or by WAF rules (reported) | Do not publish the API. If another system (JobPortal) must call it, give it its own hostname and rules, or use a service token behind Cloudflare Access | API not routed |
| 8 | **Audit rows all say 127.0.0.1** | The web server calls the API from the same host and did not pass the client address on | Pass `CF-Connecting-IP` on as `X-Forwarded-For` | **Fixed** (`apps/web/lib/client-ip.ts`); measured: login and import rows carry the browser's address |
| 9 | **Spoofable client IP** | The API sets `trust proxy: true`, so it believes `X-Forwarded-For` | The API must not be directly reachable from the internet | Holds while only the web port is published. The recorded IP is for the audit trail only, never authorisation |
| 10 | **Tunnel flaps or disconnects** | cloudflared prefers QUIC over UDP 7844; some networks drop or time out UDP (vendor docs). The log line "failed to sufficiently increase receive buffer size" is harmless | Set `TUNNEL_PROTOCOL=http2` | Exposed as an env var in compose |
| 11 | **403 on a message body** | Cloudflare managed WAF rules can block request bodies that resemble attacks; free-form message text and spintax are plausible triggers (no specific report found) | Watch Security → Events in the first week; add a skip rule for the exact rule that fires | Unverified |
| 12 | **Streaming responses arrive in one lump** | cloudflared buffers unless the response is `text/event-stream` (vendor docs) | None needed | Nothing streams SSE; presence and typing are plain polling |
| 13 | **Sign-in cookie not accepted** | `Secure` cookies need https between browser and edge | The tunnel gives https, so it works. Direct http access by IP does not | Fine behind the tunnel |

## 3 · A defect found while doing this

Not a Cloudflare problem, but it would have shown up in the same week: **imports above 1 MB failed
in the web UI** with `Body exceeded 1 MB limit`. Uploads go through a Next.js server action, which
refuses bodies over 1 MB unless configured. A 40,000-row CSV (1.46 MB) reproduced it; the same cap hit
attachment sends. Fixed by `experimental.serverActions.bodySizeLimit: '25mb'` in
`apps/web/next.config.ts`, just above the API's own limits so the API decides what is too large.
Measured after the change: the same file uploads, and no limit error is logged.

## 4 · Dashboard checklist for the hostname

- SSL/TLS mode: **Full**. (The tunnel itself is encrypted; this only matters if you add a proxied DNS record.)
- Speed → Optimization: **Rocket Loader off, Auto Minify off**.
- Caching: leave the default (dynamic HTML is not cached). Never add a "Cache Everything" rule on this host.
- Optional: **Cloudflare Access** in front of the hostname for the alpha (email one-time code). Browsers
  pass it once; the app's own sign-in still applies. Anything non-browser needs a service token.
- After the first deploy: sign in, upload a 2 MB CSV, send a message with an attachment, open Security →
  Events, and read `docker compose logs cloudflared` for errors.

## 5 · Sources

- Cloudflare, Tunnel common errors: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/>
- Cloudflare community, error 524: <https://community.cloudflare.com/t/3a-timeout-occurred-error-code-524-3/553238>
- Upload limits by plan (secondary): <https://fast.io/resources/cloudflare-upload-limit.md>
- Next.js server actions and forwarded hosts: <https://github.com/vercel/next.js/issues/58019>
- Bot Fight Mode blocking webhook calls (reported): <https://support.vapi.ai/t/26741573/cloudflare-bot-fight-mode-blocking-webhook-server-call>
- Rocket Loader and Auto Minify with SSR apps (reported): <https://v2.nuxt.com/deployments/cloudflare>
- Redirect loops behind TLS-terminating proxies: <https://blog.openreplay.com/fix-err-too-many-redirects/>
- QUIC buffer warning: <https://github.com/quic-go/quic-go/wiki/UDP-Buffer-Sizes>

**Gap in the research:** no post-mortem specific to a Next.js app with server actions behind a tunnel
was found beyond the issue in row 3. Rows 11 and 12 are inferences, not observations.
