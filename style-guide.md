# Prospect Research: Style Guide and Redesign Brief

**For the implementing agent.** Rebuild the dashboard at `prospect-research.sam-5b1.workers.dev/dashboard` to match `dashboard.html` (the reference mock, with demo data). This guide explains the rules behind it. Where the two disagree, the tokens in this file win.

---

## 1. What was wrong with the old dashboard

| Problem seen | Heuristic broken | Fix |
|---|---|---|
| Four stacked blue-bordered boxes each saying "12 messages waiting" with the same "Review" link. ArinaFoods and WakaSure each appear twice. | Recognition over recall, Minimalist design | Merge by campaign. One card per campaign with one count and one button. |
| Words like "found", "kept", "run", "Ready to review", "Not a fit" with no explanation. | Match between system and real world | Plain sentences: "Looked at 43 businesses and kept 27 good matches." |
| No clear answer to "what do I do now?" | Visibility of system status, Help users | A hero that states the single next action, plus a 3-step "Where you are" strip. |
| Four kanban columns of text, truncated names ("Impact Hu", "Membersl"), overlapping boxes. | Aesthetic and minimalist design, Error prevention | One list with four tabs, 5 rows per page, no truncation (wrap or ellipsis with title). |
| Hard 1px blue rectangles on cards, but rounded pills elsewhere. | Consistency and standards | One radius scale (section 3). Borders are hairlines, not strong blue. |
| "Back to drafts" and "Start a new campaign" at the foot of a long page. | Flexibility and efficiency | Primary actions live in the hero. |
| An em dash inside copy ("any status, nothing is lost...") and jargon like "Runs 1-8 of 36". | Match real world | "See all 36 searches". |

**Answer to "is square corners on boxes best practice?"** No, not for this product. Sharp rectangles read as formal, technical and slightly stressful. Rounded corners read as friendly and safe, which supports the calm, "I can do this" feeling you want. Stripe, Google (Material 3), Linear, Notion and Airbnb all use radius on cards, inputs and buttons. The real best practice is **consistency**: every control shares one radius family, and radius scales with size. The old page mixed square cards, rounded pills and unrounded boxes, so it broke consistency, which is Nielsen heuristic 4.

---

## 2. Design intent

Feeling: calm, clear, gently encouraging. A person with a long list should feel "this is manageable, I know the next step, and I am in control".

- **Calm**: soft mist background, generous space, one primary colour, no more than 3 coloured elements competing at once.
- **Confident momentum**: every screen has exactly one primary button. Progress is visible (steps, progress bars, counts that go down).
- **Safety**: repeat "Nothing is sent until you approve it" near the main action. It removes the fear of a wrong send.
- **Delight with geometry**: soft circles, arcs, hills and a paper plane. No stock photos, no cartoon people. Think Stripe and Google Workspace: simple shapes, brand colours, lots of air.

---

## 3. Tokens

### Colour
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#1B2A3A` | Headings, body text |
| `--ink-soft` | `#52627A` | Secondary text, hints |
| `--mist` | `#F3F7F8` | Page background |
| `--paper` | `#FFFFFF` | Cards |
| `--line` | `#E3EBEE` | Hairline borders and dividers |
| `--sky` / `--sky-deep` / `--sky-wash` | `#3B6FE0` / `#2B57BA` / `#E8EFFD` | The only action colour |
| `--sage` family | `#4E9C7E`, text `#2F7A5D`, wash `#E4F3EC` | Done, approved, good |
| `--sand` family | text `#B5740F`, wash `#FCF0D9` | Needs attention (waiting) |
| `--rose` family | text `#B4524A`, wash `#FBE9E6` | Not a fit, problems |
| `--lilac` | `#B9AEE8` | Illustration accent only, never text or controls |

Rules: colour is never the only signal (every chip has a text label). Text on tint must reach 4.5:1. Red is for real errors only, "Not a fit" is a soft rose, not an alarm.

### Type
- Headings: **Fraunces** 600/700 (warm, human serif, continues the existing serif look).
- Body and UI: **Figtree** 400/500/600.
- Scale: 38 / 22 / 18 / 16 (body) / 14 (secondary) / 13 (chips). Line height 1.55 body, 1.2 headings. Max line length about 70 characters. Sentence case everywhere, no all caps.

### Spacing
4px base: 4, 8, 12, 16, 24, 32, 48, 64. Cards pad 24. Page sections gap 32. Never place two cards closer than 16.

### Radius (one scale, used everywhere)
| Token | px | Applies to |
|---|---|---|
| `--r-xs` | 8 | Focus ring corners, tiny elements, checkboxes |
| `--r-sm` | 12 | **Buttons, inputs, selects, tabs, nav items** (all controls identical) |
| `--r-md` | 16 | List rows, step tiles, avatars, inner panels |
| `--r-lg` | 24 | Cards, hero, modals |
| `--r-pill` | 999 | Status chips, tags, progress bars, count badges |

**Nesting rule:** inner radius = outer radius minus the padding between them (a 16 row inside a 24 card with 24 padding is fine because they do not touch; where an element sits within 8px of a card edge use 16 or less).
**Control rule:** buttons and inputs are both 44px tall with 12px radius so they line up side by side in forms.

### Elevation
Mostly flat with hairline borders. One soft shadow `0 6px 24px rgba(27,42,58,.07)` only on the hero and on card hover. No heavy or coloured shadows.

### Motion
Only responds to the user: 150 to 200ms for hover, a 2px lift on campaign cards. No auto-playing animation. Respect `prefers-reduced-motion`.

---

## 4. Components

- **Primary button**: sky fill, white text, verb plus object ("Check 50 messages"). One per card, one per screen area.
- **Ghost button**: white, hairline border, for secondary actions. Border turns sky on hover.
- **Quiet button**: text only, for "See all 84" style links.
- **Input**: 44px, 12px radius, 1.5px `--line` border, label above (never placeholder-only), focus = sky border plus 4px `--sky-wash` ring. Error = rose border plus a plain sentence below ("Add a valid email, like name@company.com").
- **Chip**: pill, tinted background, dot plus text. Types: waiting (sand), done (sage), info (sky), no (rose).
- **Campaign card**: initial badge, name, "Last search" time, one big number, one sentence, progress bar, one primary button.
- **Tabs (segmented)**: four statuses on the one list. Count in each tab. Active tab is white on mist.
- **Step strip**: 3 steps, states done, now, next. Numbering is allowed here because it really is a sequence.
- **Empty state**: small geometric illustration, one-line title, one sentence saying what will appear and how. Never a blank box.

---

## 5. Illustration system

- **Shapes**: circles, arcs, rolling hills, dotted trails, a paper plane. Flat fills, no outlines except the hero plane (3px sky stroke) so the plane is the one focal point.
- **Palette**: sky, sage, lilac, sand, all at 40 to 90 percent opacity so they stay soft.
- **Where**: hero (large scene), empty states (small, 120px), first-run onboarding, success screens ("All checked!" with plane arriving at a hill).
- **Where not**: never on dense data tables, never behind text, never animated on load.
- **Accessibility**: `role="img"` with a short `aria-label` for meaningful scenes, `aria-hidden="true"` for decoration.
- **Spend boldness once per screen**: the hero is the one memorable thing. Everything else stays plain so the page does not feel busy.

Suggested extra scenes: (1) plane landing on a hill (all messages checked), (2) two overlapping circles (empty list, already used in the logo), (3) a sun over hills (nothing new today, enjoy your day), (4) a small envelope with a tick (message approved).

---

## 6. Copy rules (layman test)

If a new user cannot read a label and say what happens when they click, rewrite it.

| Old | New |
|---|---|
| Dashboard | Home |
| 12 messages waiting for your approval (x4) | 13 messages waiting for you (one card per campaign) |
| 43 found, 27 kept | Looked at 43 businesses and kept 27 good matches |
| Ready to review | Ready to check |
| Done | Finished |
| Approved, follow up yourself | Approved (hint: "You approved these. Follow up when you are ready.") |
| Not a fit | Not a fit (hint: "We will not message them.") |
| All runs | Recent searches |
| Runs 1-8 of 36 | See all 36 searches |
| Back to drafts | Check messages |

Rules: sentence case, active voice, plain verbs, same name for the same thing everywhere (always "campaign", always "messages", never "drafts" or "outreach" for the same item). No jargon (run, kept, pipeline). Numbers always come with a noun. Errors say what happened and how to fix it, never "Oops".

---

## 7. Layout of Home (top to bottom)

1. **Hero**: greeting, one headline with the number that matters, one sentence of explanation, primary and secondary buttons, reassurance line, illustration.
2. **Where you are**: 3-step strip.
3. **Start with these**: up to 3 campaign cards sorted by most waiting. If more exist, a quiet "See all campaigns" link.
4. **Two columns**: "Your messages" (tabs and 5 rows) and "Recent searches" (4 items).

Information limits (anti-overwhelm): max 3 cards, 5 rows per list, 4 recent searches, 1 primary button per card. Anything beyond is behind "See all". On mobile everything stacks in the same order.

---

## 8. Nielsen's 10 heuristics, applied

1. **Visibility of system status**: step strip, progress bars, status chips with text, "Last search" times.
2. **Match with the real world**: plain English, no jargon, "businesses" and "messages".
3. **User control and freedom**: Pause and "Not a fit" are reversible tabs; confirm before sending, offer undo for approve.
4. **Consistency and standards**: one radius scale, one button height, one chip style, same words everywhere.
5. **Error prevention**: nothing sends without approval, say so on screen; disable Send until at least one message is approved.
6. **Recognition rather than recall**: campaign names always beside their messages, no truncated names.
7. **Flexibility and efficiency**: primary action on every card, keyboard tab order, "Check 50 messages" jumps straight to the queue.
8. **Aesthetic and minimalist design**: 3 cards, 5 rows, one illustration per screen.
9. **Help recognise and recover from errors**: error text states cause and fix, input errors sit under the field.
10. **Help and documentation**: hints under each tab, empty states explain what will appear, optional "What is a good match?" tooltip.

Also applied: Fitts (44px targets), Hick (few choices at once), Miller (chunks of 3 to 5), Gestalt proximity (cards group related data).

---

## 9. Accessibility floor

- Contrast 4.5:1 for text, 3:1 for UI borders that carry meaning.
- Visible 3px sky focus ring on every interactive element.
- Targets at least 44px.
- Tabs use `role="tablist"`, `role="tab"`, `aria-selected`.
- Never rely on colour alone, always pair with text.
- Respect `prefers-reduced-motion`.

---

## 10. Hand-off checklist for the agent

- [ ] Replace all `border-radius: 0` and ad-hoc radii with the tokens in section 3.
- [ ] Merge duplicate campaign rows (same campaign name) into one card with the combined count.
- [ ] Replace the 4-column board with the tabbed list (5 rows, "See all N").
- [ ] Rename labels per section 6 across all pages (Messages, Campaigns, Email accounts too).
- [ ] Add the hero and the step strip, driven by real counts (waiting total, found total).
- [ ] Add empty states with the geometric illustration for every list.
- [ ] Apply the same tokens to Messages, Campaigns and Email accounts pages so the whole app is consistent.
- [ ] Keep inputs at 44px height and 12px radius in the new campaign form.
- [ ] Test at 375px, 768px and 1280px.
