# product/ — Prospect Research scaffold

File scaffold per `specs/architecture.md`, `specs/data-model.md`,
`specs/research-loop.md`, and `tools.md` Part B. TypeScript throughout.

## Scaffold map

| File | Spec source | Contents |
|---|---|---|
| `package.json` | architecture §8 | Worker scripts + dependencies (not installed) |
| `tsconfig.json` | — | Strict TS config (`src/` → `dist/`) |
| `wrangler.jsonc` | architecture §§3,8 | Worker `prospect-research` + one D1 (`prospect_research`) + one Workflow (`research-workflow`); account `5b1a6a62ef2a35ff1da503bafc123ef6` |
| `schema.sql` | data-model | DDL for all 8 entities with fields + enum CHECKs |
| `src/index.ts` | architecture §4, research-loop §9 | Worker API route skeleton (journey phases) |
| `src/db.ts` | data-model, tools.md Part B | Typed D1 accessors: writers validate enums/FKs/transitions/dedupe; readers back `rs.get_run_state` |
| `src/meta.ts` | architecture §5 | Responses request builder + `web_search_call`/`results`/`url_citation` parser; tolerates zero citations |
| `src/workflow.ts` | research-loop §§3,7,9 | Workflow skeleton: phases, `brief_confirmed`/`drafts_decided` gates, error taxonomy |
| `public/index.html` | architecture §3, product journey | App shell (onboarding, profile review, progress, shortlist + evidence, drafts, follow-ups); no secrets |
| `README.md` | — | This file |

Open items carried forward: O-1 (static-serving mechanism — see `wrangler.jsonc`
comment), O-2 (D1/Workflow plan quotas — verify before first deploy), O-3
(grounding-quality experiment).

## How to verify (after installs are approved)

Installs, builds, deploys, and live calls are out of scope for the scaffold
objective — do not run them here. When approved:

1. `npm install` (uses `package.json`; no lockfile committed by scaffold).
2. `npx tsc --noEmit` (uses `tsconfig.json`).
3. `npx wrangler d1 execute prospect_research --local --file=./schema.sql`
   then `wrangler dev` and exercise `/api/*` routes.
4. `wrangler secret put MODEL_API_KEY` (presence-only check; never commit values).
5. Before first deploy: resolve O-1/O-2, then one live smoke run on a rehearsed brief.
