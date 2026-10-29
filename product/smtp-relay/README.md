# smtp-relay — binding-only SMTP container

Stateless relay: the Worker POSTs per-request SMTP credentials + message(s);
the relay sends through the user's provider and forgets. No secrets at rest,
no logs of credentials, no public route (container binding only).

## Endpoints

- `GET /health` → `{ok, service, startedAt, uptimeSec}`
- `POST /verify` `{host, port, secure?, username, password}` → `{ok}` or
  `{ok:false, error, category}`
- `POST /send` `{creds..., from, fromName?, to, subject, text, replyTo?, unsubUrl?}`
  → `{ok, messageId}` or `{ok:false, status:"failed", error, category, retryable}`
- `POST /send-batch` `{creds..., from?, messages: [{to, subject, text,
  from?, fromName?, replyTo?, unsubUrl?}]}` (1–50 msgs, one SMTP connection,
  sequential) → `{ok, results: [...]}` in request order

Port 25 is rejected (use 465/587). Errors are categorized
auth/validation/rate_limit/transient/permanent/policy with a retryable flag.

## Develop

```sh
node --test server.test.js   # contract tests, stub transport, no network
docker build -t smtp-relay:local .
docker run --rm -p 8080:8080 smtp-relay:local
```

## Deploy

The Worker build deploys this automatically (`containers[].image` points at
`./smtp-relay/Dockerfile`). After ANY relay change:

1. `npx wrangler deploy` from `product/`
2. Verify the new code is actually serving:
   `GET https://<worker>/api/relay-health` must show fresh `startedAt`

## Gotcha: stale build cache (seen 2026-10-29)

Docker Desktop buildkit served a stale `COPY server.js` layer across deploys
(green build + deploy, old code live — proven by comparing the file hash
inside the image with disk). If the live `startedAt` doesn't move after a
relay change:

```sh
docker builder prune -f
npx wrangler deploy   # then re-check /api/relay-health
```

Direct `wrangler containers push` of a hand-tagged image is NOT a working
fallback (registry rejects cross-repo blob mounts).
