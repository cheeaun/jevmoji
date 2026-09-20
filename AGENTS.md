# jevmoji

Vite + Cloudflare Worker emoji suggester. TypeSafe Score relevance; key never in the browser.

**Live:** https://jevmoji.cheeaun.workers.dev\
**Source:** https://github.com/cheeaun/jevmoji

**API is intentionally undocumented in README** — do not publish request/response shapes there. Abuse of deployed keys costs real credits.

## Commands

```bash
npm install
echo 'TYPESAFE_API_KEY=...' > .dev.vars
npm run dev     # http://127.0.0.1:8787 (hard-coded in vite.config.js)
npm test
npm run probe -- "hello world"   # live pipeline: categories → batches → list
npm run build
npm run deploy
npm run catalog # rebuild src/data/emojis.json (default Unicode 17.0.0)
```

## Layout

| Path | Role |
| --- | --- |
| `index.html` + `js/` | Page + client ranking |
| `public/` | Client static CSS/favicon only |
| `scripts/build-emojis.mjs` | Generates `src/data/emojis.json` (Unicode + emojibase keywords) |
| `scripts/score-probe.mjs` | Live pipeline probe for one or more query strings |
| `js/retrieve.js` | Local name/keyword shortlist (primary empty-result guard) |
| `src/worker.js` + `src/data/emojis.json` | Worker + catalog (import only — not in `public/`) |
| `README.md` | User-facing docs (install, usage, env) — no API contract |
| `DESIGN.md` | Visual system / tokens |
| `design/` | Logo source (`logo.svg`) + export sizes |
| `docs/screenshots/` | README images — **mobile-first**, not desktop |

## README screenshots

- Capture at a **phone viewport** (use **390×844**, CSS pixels) — not 1280px desktop
- Paths: `docs/screenshots/empty-state.png`, `docs/screenshots/results.png`
- Empty: default page, no query. Results: live query for **smiling face**, wait until status is `Done`
- Crop empty-state to the UI (drop dead space under OUTPUT); keep results showing OUTPUT + score trace
- Optimize PNG (palette/optimize ok); keep text readable
- Source is a local run on port **8787** with a real key in `.dev.vars`

Catalog notes:

- Regenerate with `npm run catalog -- --unicode <ver|latest>`
- Default pin **17.0.0**; URL layout changes at Unicode 17 (`Public/<ver>/emoji/`)
- Do **not** put the catalog under `public/` — Vite would copy it into the client build
- Entries: `{emoji, name, category, status, keywords[]}` — keywords from emojibase + name tokens
- Keywords feed `js/retrieve.js` local shortlisting (not category-label routing)
- Runtime filter keeps `status === "fully-qualified"`

## API contract (private — agents only)

Do not copy these examples into README.

### `POST /api/categories`

Request:

```json
{"text": "train"}
```

Response:

```json
{
  "categories": [
    {
      "id": "travel",
      "score": 2.99,
      "selected": true,
      "emojiCount": 221,
      "pages": 3
    }
  ],
  "pageSize": 80,
  "stats": {
    "elapsedMs": 806,
    "inputTokens": 1005,
    "costUsd": 0.00004221
  }
}
```

### `POST /api/emoji-batch`

Request:

```json
{
  "text": "train",
  "category": "travel",
  "categoryScore": 2.99,
  "page": 1,
  "pageSize": 80
}
```

Response:

```json
{
  "ratings": [
    {"emoji": "🚆", "emojiScore": 2.99}
  ],
  "stats": {
    "elapsedMs": 800,
    "inputTokens": 12000,
    "costUsd": 0.0005
  }
}
```

Notes:

- `stats`: `{ elapsedMs, inputTokens, costUsd }` only
- Batch `ratings`: only `emojiScore >= 1` (fallback pool)
- Categories response may include a selected `retrieve` row + `retrieval` debug
- UI labels that row **hits**; API / batch jobs still use id `retrieve`
- `POST /api/emoji-batch` with `category: "retrieve"` scores the local name/keyword shortlist
- Batch response does not echo `category` / `categoryScore` — client attaches them
- Client pages selected categories in parallel; UI re-renders as each batch lands
- Input max **40** characters (`js/suggest-contract.js`)

## List rules

- Live list: prefer ratings with `emojiScore > 2`
- If that set is `< 15`, pad with lower-score ratings (same sort) until **15** or the pool is exhausted
- Ranked by `(categoryScore/3)×(emojiScore/3)`; retrieve rows use categoryScore 2.5
- Hard max **50**
- API batch still returns `emojiScore >= 1` (padding source); weaker scores only if present in ratings
- **Primary routing:** `js/retrieve.js` name/keyword shortlist (scored via `category: "retrieve"`)
- Category labels are boost/UI only — not the empty-result gate
- Category selection still skips empty groups; keep bar is `categoryScore >= 1`
- If top category score `< 1`, fan out to top 3 non-empty groups
- Huge groups (`emojiCount > 500`): `score < 1` → 1 page; `score < 2.5` → max 2 pages; else full
- Compound query tokens prefer longer keyword/name pieces (`spiderman` → spider)

## TypeSafe

- `@typesafe-ai/sdk` in the Worker only
- Score 0–3; cost `inputTokens/1e6 × $0.042` (`TYPESAFE_PRICE_PER_MTOK`)

## Dev notes

- Port **8787** — do not use Vite default 5173
- Secrets: `.dev.vars` locally, Wrangler secret in production — never `.env`, never client JS
- No mock ranker, no `/api/health`, no Node `server/` process
- Custom instruction: reply in English; no lab jargon
- **Do not document `/api/*` in README**
