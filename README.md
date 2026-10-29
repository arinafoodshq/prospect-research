# Prospect Research — AI prospecting agent for small businesses

A business owner describes what they sell. The agent researches who might buy
it, ranks prospects with public evidence, drafts personalised outreach, and
holds every message for human approval. Built for the Meta Global AI Developer
Hackathon (26 Oct – 4 Nov 2026).

Live demo: `https://prospect-research.sam-5b1.workers.dev` (`?live=1` for the real API)

## How it works

1. Owner enters business name, website and/or description; confirms the profile.
2. The agent plans searches, discovers candidates, investigates public pages,
   assesses fit with cited evidence, and writes per-prospect drafts.
3. The owner reviews evidence, edits drafts, and approves or rejects each one.
4. Approved email campaigns send on schedule (cron-driven); WhatsApp/Telegram
   stay click-to-send. Nothing is ever sent without explicit human approval.

## Architecture

- Product: Cloudflare Worker + D1 + Workflows (`product/`). Meta
  `muse-spark-1.3` via the Responses API does all research, ranking and
  drafting, server-side, with web-search grounding.
- Dev controller: local autonomous agent (`loop.py`, `controller/`) — never deployed.
- Specs in `specs/`; status in `progress.md`.

## Develop

```bash
cd product
npm test -- --run        # vitest suite
npm run typecheck        # tsc --noEmit
node tests/smoke.mjs     # UI shell smoke
npx wrangler dev         # local worker + D1
```

## Compliance note (demo)

- Outreach is researched and drafted by AI; a human approves every message
  before anything is sent. Campaigns support suppression lists, unsubscribe
  links, and pause/cancel.
- Prospect data comes only from publicly listed business contact details with
  recorded sources. No private individuals, no scraped personal data.
- Operators are responsible for applicable consent, privacy and anti-spam
  requirements (including Nigeria's NDPA and GDPR/UK GDPR where relevant)
  and for their email provider's acceptable-use policy.
- Demo sends go to controlled test recipients only — never cold outreach to
  real prospects during evaluation.

## Secrets

Never commit keys or `.dev.vars` (gitignored). Required secrets are Worker
secrets: `MODEL_API_KEY`, `CRED_KEY` (credential encryption),
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (only for Gmail sending).
