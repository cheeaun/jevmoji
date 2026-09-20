<div align="center">
	<br>
	<img width="72" height="72" src="design/logo-128.png" alt="Jevmoji">
	<br>
	<br>
</div>

# Jevmoji

> Type up to 40 characters. Get related emojis scored by [TypeSafe](https://typesafe.ai/)’s [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) — many matches, not just one.

**Live:** https://jevmoji.cheeaun.workers.dev\
**Source:** https://github.com/cheeaun/jevmoji

![Empty state](docs/screenshots/empty-state.png)

![Results for “smiling face”](docs/screenshots/results.png)

## Score trace: “hits”

Under **OUTPUT → score trace**, categories list the emoji groups Jev scored. You may also see a row labeled **hits**.

That row is not a Unicode emoji category. It is a shortlist the app builds in code by matching your text against emoji **names and keywords** (for example `spiderman` → spider / web). Those candidates are then scored like everything else. The **Emoji→pages** cell stays blank for hits because that column is for paging large catalog groups, not a keyword shortlist.

If hits is missing, local matching found nothing useful — the list still comes from the scored categories.

## Install

```sh
npm install
echo 'TYPESAFE_API_KEY=your-key' > .dev.vars
```

Get a key from the [TypeSafe console](https://console.typesafe.ai/).

## Usage

```sh
npm run dev
```

http://127.0.0.1:8787

| Command | Description |
| --- | --- |
| `npm run dev` | Vite + Worker with HMR |
| `npm test` | Unit tests (`node --test`) |
| `npm run build` | Production build to `dist/` |
| `npm run deploy` | `vite build` + `wrangler deploy` |
| `npm run catalog` | Rebuild `src/data/emojis.json` from Unicode + emojibase keywords |
| `npm run probe` | Live pipeline probe for a query string (needs a key) |

## Secrets

The TypeSafe key never reaches the browser. The Worker reads it server-side.

| Where | How |
| --- | --- |
| Local | `.dev.vars` — `TYPESAFE_API_KEY=…` |
| Production | `npx wrangler secret put TYPESAFE_API_KEY` |

Never put the key in `.env`, client JS, or the README.

## Environment

### TYPESAFE_API_KEY

Type: `string`

Required. Server only.

### TYPESAFE_MODEL

Type: `string`\
Default: `'jev-latest'`

### TYPESAFE_TIMEOUT_MS

Type: `number`\
Default: `60000`

SDK timeout per attempt.

### TYPESAFE_PRICE_PER_MTOK

Type: `number`\
Default: `0.042`

Cost display only.

### EMOJI_PAGE_SIZE

Type: `number`\
Default: `80`

## Emoji catalog

`src/data/emojis.json` is generated — not hand-edited. It is Worker-only (imported at build time); nothing in the browser fetches it, so it does not live under `public/`.

```sh
npm run catalog                          # Unicode 17.0.0 (default pin)
npm run catalog -- --unicode 16.0
npm run catalog -- --unicode latest      # currently 18.0
npm run catalog -- --include-qualified   # also minimally-qualified + components
```

Default is **17.0.0**: newer than 16, less brand-new than 18 (fonts often lag). Older versions (≤16) live under `unicode.org/Public/emoji/<ver>/`; 17+ live under `unicode.org/Public/<ver>/emoji/`. The script resolves that split for you.

Each entry keeps `emoji`, `name`, `category`, `status`, and `keywords[]` (emojibase tags + name tokens). Keywords power the local **hits** shortlist; hex, subgroup, and ids are omitted to keep the Worker bundle smaller.

## Project structure

| Path | Description |
| --- | --- |
| `index.html` + `js/` | Page + client ranking |
| `public/` | Client static assets (styles, favicon) — no catalog |
| `src/worker.js` + `src/data/` | Worker + generated emoji catalog |
| `scripts/build-emojis.mjs` | Catalog generator |
| `scripts/score-probe.mjs` | Live pipeline probe (`npm run probe`) |
| `js/retrieve.js` | Local name/keyword shortlist behind the **hits** row |
| `design/` | Logo source + export sizes |
| `docs/screenshots/` | README screenshots |
| `AGENTS.md` | Contributor / agent notes (includes private API contract) |
| `DESIGN.md` | Visual system |

## Related

- [Live app](https://jevmoji.cheeaun.workers.dev) - Deployed Worker
- [Jevmoji on GitHub](https://github.com/cheeaun/jevmoji) - Source
- [TypeSafe AI](https://typesafe.ai/) - System One models
- [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) - Intro post
- [Documentation](https://docs.typesafe.ai/)
- [@typesafe-ai/sdk](https://www.npmjs.com/package/@typesafe-ai/sdk) - JavaScript SDK

## License

MIT. See [LICENSE](LICENSE).

TypeSafe and Jev are proprietary — not covered by this license.
