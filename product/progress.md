
## 2026-11-01 — Evidence panel rebuilt: accordions, humanized history, real proof (user UX critique)

User flagged the old panel (raw "created - <ISO> dedupe merge" lines, bare
channel/date/note fields, unclear evidence) and asked for accordions +
504Yard-style logging. Rebuilt (4 commits: c057527, 61877fc, 5a18ee7,
+ quote clamp; deployed 947cc943/d3d82ca4):
- Native <details> accordions: "Why <name> was shortlisted" (open),
  "History", with the contact-log form inside History.
- Proof rows: claim + humanized source ("their own page"/"search result" +
  host link). ROOT FIX: the detail route filtered evidence to
  assessment-linked rows only, hiding discovery proof (prospect.evidence_ids
  was never consulted) - every shortlisted pick rendered an empty panel.
  Discovery evidence now included.
- History humanized: event labels (Added/Shortlisted/Merged with duplicate...),
  medium+short timestamps (no seconds), channel rows labeled (WhatsApp/Email/
  Phone call...), tidy labeled log form.
- Card location de-duplicated ("Ikeja, Maryland, Ogba and Oregun, Lagos,
  Nigeria" instead of repeated "Lagos, Nigeria" chains); hint de-duplicated
  ("The research behind this pick:"); long page quotes clamped; sticky
  selection bar no longer covers the panel (clearance added).
Verified live in the owner's Chrome via Browser MCP on the Duban
International Hotel shortlist (screenshots reviewed, 2-image budget).
Evidence: 464/446->464/464 vitest, SMOKE PASS each deploy.
