# DESIGN.md — Jevmoji × TypeSafe aesthetic

## 1. Objective

Make the Jevmoji page read as a TypeSafe product surface: technical, paper-light, score-first. The page’s job is still “type a phrase → ranked emojis + visible scoring plan,” but the chrome should feel like it belongs next to typesafe.ai, not like a generic emoji toy.

## 2. Product context

Jevmoji is a thin client over TypeSafe’s Jev (System One scores 0–3). Users need trust in the ranking path: categories → batch pages → mixed score. The UI is a small utility tool (expressive enough for brand, not a marketing site).

**Mode:** existing-product redesign to a named external system (typesafe.ai). Match that system; do not invent a second brand.

## 3. Visual foundations

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#FEFEFE` | Page background |
| `--panel` | `#FFFFFF` | Window bodies, tables |
| `--ink` | `#1E1E1E` | Borders, titles, primary text, title bars |
| `--ink-soft` | `#1E1E1E` @ ~86% | Secondary ink |
| `--on-ink` | `#DEDEDE` | Text on black title bars |
| `--muted` | `#858585` | Meta, placeholders, idle status |
| `--line` | `#C4C4C4` | Hairline secondary rules inside panels |
| `--accent` | `#F386A1` | Primary CTA fill, focus, selected rows, pending blocks |
| `--on-accent` | `#1E1E1E` | Text on accent CTA — stays dark in both schemes (legibility) |
| `--ok` | `#03AA5C` | Completed fetch blocks, success ticks |
| `--err` | `#B42318` | Error status only |
| `--radius-panel` | `0` | Window corners — square, terminal chrome |
| `color-scheme` | `light dark` | Follow system; no in-page toggle |
| Dark paper / panel / ink | `#121212` / `#1a1a1a` / `#f2f2f2` | `@media (prefers-color-scheme: dark)` |
| Dark chrome / on-chrome | `#000000` / `#dedede` | Title bars stay black-on-dark terminal |
| `--border` | `1.2px solid var(--ink)` | Window outline |

**Type**

- Display / UI: `"Host Grotesk", "Segoe UI", system-ui, sans-serif` — H1 ~28–32px/600, body 15–16/400
- Data / chrome: `"Fragment Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace` — 11–13px, labels, stats, tables, window titles
- Scale: 11 · 12 · 14 · 16 · 20 · 28 · 36
- Fonts self-hosted via npm (`@fontsource/host-grotesk`, `@fontsource/fragment-mono`), imported in `js/app.js`; no Google Fonts CDN in the page.

**Layout**

- Centered column, max-width `640px`, vertical rhythm `12–16px` between windows
- Stacked “OS windows”: black title bar + white body + black hairline border
- Dense, instrument-like — not airy marketing whitespace

**Signature**

- Terminal window chrome as the page structure (INPUT / OUTPUT / SCORE TRACE)
- Pink/green request-block chart as the scoring story
- Mono status line under the input (`ms · fetches · cost · tokens`)
- Product line lives in chrome too: `Type anything · scored emojis · max 40 · score > 2 · cap 50`
- Click an emoji → clipboard + mono toast (`copied ☕`)
- Emoji list motion (quiet, not trippy): **enter** = fade-in only; **reorder** = FLIP slide when ranks shift; **exit** = fade-out when a tile drops off. No stagger cascade, no bounce.

**Voice**

- Plain, technical, short: “Type a phrase”, “Score > 2”, “pages”, “mix”
- No marketing fluff; no emoji decoration on headers
- Brand ownership: page is **Jevmoji**, not TypeSafe. Visual system borrowed; no TypeSafe logo, site chrome, or copyright that implies TypeSafe authored this page.

## 4. Accessibility

- Body contrast ≥ 4.5:1 on paper/panel; large display ≥ 3:1
- Focus-visible: 2px `--accent` ring with offset (never `outline: none` without replacement)
- Buttons keep disabled state visible; tap targets ≥ 44px on small screens
- Tables scroll horizontally inside a focusable region
- `prefers-reduced-motion`: no required motion on this page

## 5. Voice & tone

Precise lab notebook. Statuses name what is happening (“Scoring categories…”, “3/7 pages”, “Done · 24 emojis”). Errors state the failure, not apology theater.

## 6. Implementation practices

- CSS variables for all color/type tokens
- Keep existing element IDs/classes that `js/app.js` binds to (`#text-input`, `#suggest-btn`, `#suggestions`, `#status`, `#stats`, `#detail`, table/chart classes)
- Window title for detail via CSS `::before` on `#detail` so JS `innerHTML` cannot wipe chrome
- No Tailwind; static CSS under `public/assets/styles.css`
- Secrets stay server-side; redesign is client chrome only

## 7. Anti-patterns

- No purple-blue gradient hero
- No soft rounded-16 card grid
- No emoji used as decorative list bullets
- No fake “47% YoY” stat cards
- No “seamlessly unlock…” copy
- Don’t rebuild TypeSafe’s full marketing site (clouds, waitlist, FAQ) on this utility page
- Don’t claim TypeSafe authorship (no “© TypeSafe”, no top-nav typesafe.ai brand link, no “Jev · System One” product badge as if this were their site)

## 8. Decision-making

When unsure, prefer TypeSafe product UI (windows, mono metrics, black/white + pink) over “cute emoji app.”

## 9. Workflow

1. Reverse-engineer typesafe.ai tokens → this file  
2. Restyle `index.html` + `public/assets/styles.css`  
3. Verify empty/loading/results/error states and mobile width  
4. Keep ranking/API logic unchanged
