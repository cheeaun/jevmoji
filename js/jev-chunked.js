/**
 * TypeSafe scoring for jevmoji (Cloudflare Worker).
 *
 * POST /api/categories  — one Score per emoji category → compact rows
 * POST /api/emoji-batch — one page of emoji Score questions
 *
 * Client merges ratings and builds the list (js/rank.js).
 */

import { errorPayload } from "./suggest-contract.js";
import {
  DEFAULT_RETRIEVE_LIMIT,
  RETRIEVE_CATEGORY_ID,
  RETRIEVE_CATEGORY_SCORE,
  retrieveCandidates,
  retrieveCategoryRow,
} from "./retrieve.js";

export const CHOICE_OPTION_LIMIT = 255;
export const DEFAULT_PAGE_SIZE = 80;
export const DEFAULT_MODEL = "jev-latest";
export const SCORE_TOP = 3;
export const CATEGORY_MIN_SCORE = 1;
export const STRONG_MATCH_SCORE = 2;
export const MIN_API_SCORE = 1;
export const MIN_FALLBACK_SCORE = 1;
export const MIN_LIST_SIZE = 15;
export const HARD_MAX_SUGGESTIONS = 50;
export const WEAK_CATEGORY_FANOUT = 3;
export const WEAK_LARGE_EMOJI_COUNT = 500;
export const WEAK_LARGE_PAGE_CAP = 1;
/** Huge groups need this score before we page the full set. */
export const HUGE_CATEGORY_FULL_SCORE = 2.5;
/** Mid-score huge groups batch at most this many pages. */
export const HUGE_CATEGORY_MID_PAGE_CAP = 2;
export const DEFAULT_PRICE_PER_MTOK = 0.042;

export {
  DEFAULT_RETRIEVE_LIMIT,
  RETRIEVE_CATEGORY_ID,
  RETRIEVE_CATEGORY_SCORE,
  retrieveCandidates,
  retrieveCategoryRow,
};

const REL_LEVELS = [
  "No relation to the text",
  "Weak or vague connection",
  "Clear connection to the text",
  "Strong, obvious match for the text",
];

// Short group names for UI + optional boost scoring.
// Routing does not depend on these — see js/retrieve.js.
const CATEGORY_LABELS = {
  smileys: "Faces and emotions",
  people: "People, bodies, gestures",
  animals: "Animals, plants, nature",
  food: "Food and drink",
  travel: "Travel, places, vehicles",
  activities: "Sports, games, parties",
  objects: "Tools, phones, clothes",
  symbols: "Marks, shapes, arrows",
  flags: "Flags",
  component: "Emoji building parts",
  other: "Other",
};

function emptyStats() {
  return { elapsedMs: 0, inputTokens: 0, costUsd: 0 };
}

function buildStats(meter, started, pricePerMTok) {
  const elapsedMs = Date.now() - started;
  const costUsd = (meter.inputTokens / 1_000_000) * pricePerMTok;
  return {
    elapsedMs,
    inputTokens: meter.inputTokens,
    costUsd: Number(costUsd.toFixed(8)),
  };
}

function fail(err) {
  const status = err?.status ?? err?.statusCode;
  if (status === 429 || status === 529) {
    return errorPayload("rate_limit", "TypeSafe rate limited; retry shortly.");
  }
  if (status === 401) {
    return errorPayload("upstream", "Invalid TypeSafe API key.");
  }
  if (status === 422) {
    return errorPayload("bad_request", err?.message || "Invalid TypeSafe request");
  }
  return errorPayload("upstream", err?.message || "TypeSafe request failed");
}

function createMeter(pricePerMTok) {
  const started = Date.now();
  const price = Number.isFinite(pricePerMTok) ? pricePerMTok : DEFAULT_PRICE_PER_MTOK;
  const meter = { inputTokens: 0 };
  return {
    async call(client, request, callOpts) {
      const res = await client.systemOne(request, callOpts);
      const u = res?.usage || {};
      meter.inputTokens += Number(u.input_tokens) || 0;
      return res;
    },
    stats() {
      return buildStats(meter, started, price);
    },
  };
}

function readScoreAnswer(answer) {
  if (!answer || answer.type !== "score") return null;
  const s = Number(answer.score);
  return Number.isFinite(s) ? s : null;
}

export function filterCatalog(catalog, { fullyQualifiedOnly = true } = {}) {
  const emojis = catalog?.emojis || [];
  const list = fullyQualifiedOnly
    ? emojis.filter((e) => e.status === "fully-qualified")
    : emojis;
  return { ...catalog, count: list.length, emojis: list };
}

export function buildChunks(catalog, chunkSize = DEFAULT_PAGE_SIZE) {
  const emojis = catalog?.emojis || [];
  const size = Math.max(1, Math.min(CHOICE_OPTION_LIMIT, chunkSize));
  const byCategory = new Map();
  for (const entry of emojis) {
    const cat = entry.category || "other";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(entry);
  }
  const chunks = [];
  for (const [category, list] of byCategory) {
    for (let i = 0; i < list.length; i += size) {
      const seen = new Set();
      const options = [];
      for (const entry of list.slice(i, i + size)) {
        const glyph = entry.emoji;
        if (!glyph || seen.has(glyph)) continue;
        seen.add(glyph);
        options.push({ id: glyph, emoji: glyph, name: entry.name });
      }
      if (!options.length) continue;
      chunks.push({
        id: `${category}-${String(chunks.filter((c) => c.category === category).length + 1).padStart(2, "0")}`,
        category,
        options,
      });
    }
  }
  return chunks;
}

export function categoryScoreQuestions(catalog) {
  const present = new Set((catalog?.emojis || []).map((e) => e.category));
  const questions = {};
  for (const [id, label] of Object.entries(CATEGORY_LABELS)) {
    if (!present.has(id)) continue;
    questions[`cat_${id}`] = {
      type: "score",
      instructions: `How relevant is the emoji group "${label}" to \`state.text\`?`,
      criteria: REL_LEVELS,
    };
  }
  return questions;
}

export function emojiScoreQuestions(chunk) {
  const questions = {};
  for (const opt of chunk.options) {
    const kws = Array.isArray(opt.keywords) ? opt.keywords.slice(0, 6).join(", ") : "";
    const label = kws
      ? `${opt.emoji} ("${opt.name}"; keywords: ${kws})`
      : opt.name
        ? `${opt.emoji} ("${opt.name}")`
        : opt.emoji;
    questions[opt.emoji] = {
      type: "score",
      instructions: `How well does the emoji ${label} relate to \`state.text\`?`,
      criteria: REL_LEVELS,
    };
  }
  return questions;
}

export function pickCategoriesFromScores(categoryScores, {
  minScore = CATEGORY_MIN_SCORE,
  max = 5,
  emojiCounts = {},
  weakMax = WEAK_CATEGORY_FANOUT,
} = {}) {
  const ranked = Object.entries(categoryScores || {})
    .filter(([cat, p]) => Number.isFinite(p) && (emojiCounts[cat] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!ranked.length) return [];
  const [topCat, topP] = ranked[0];
  const secondP = ranked[1]?.[1] ?? 0;
  if (topP >= 2.5 && topP >= secondP * 4) return [topCat];

  // Weak top score: fan out to the best non-empty groups instead of one wrong pick.
  if (topP < minScore) {
    return ranked.slice(0, Math.min(weakMax, max)).map(([cat]) => cat);
  }

  const picked = [];
  for (const [cat, p] of ranked) {
    if (picked.length === 0 || p >= minScore) picked.push(cat);
    if (picked.length >= max) break;
  }
  return picked;
}

/** [{ id, score, selected, emojiCount, pages }] */
export function buildCategoryRows(categoryScores, selectedIds, allChunks, pageSize) {
  const size = pageSize || DEFAULT_PAGE_SIZE;
  const byCat = new Map();
  for (const c of allChunks) {
    byCat.set(c.category, (byCat.get(c.category) || 0) + c.options.length);
  }
  const selected = new Set(selectedIds || []);
  return Object.entries(categoryScores || {})
    .map(([id, score]) => {
      const emojiCount = byCat.get(id) ?? 0;
      const rawPages = emojiCount ? Math.ceil(emojiCount / size) : 0;
      const n = Number(score);
      let pages = rawPages;
      if (emojiCount > WEAK_LARGE_EMOJI_COUNT) {
        if (n < CATEGORY_MIN_SCORE) {
          pages = Math.min(rawPages, WEAK_LARGE_PAGE_CAP);
        } else if (n < HUGE_CATEGORY_FULL_SCORE) {
          pages = Math.min(rawPages, HUGE_CATEGORY_MID_PAGE_CAP);
        }
      }
      return {
        id,
        score: Number(Number(score).toFixed(3)),
        selected: selected.has(id) && emojiCount > 0,
        emojiCount,
        pages,
      };
    })
    .sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      return b.score - a.score || a.id.localeCompare(b.id);
    });
}

/** Ranking helper for tests — same rule as js/rank.js. */
export function pickEmojisFromRatings(ratings) {
  const byEmoji = new Map();
  for (const r of ratings || []) {
    const combined =
      (Math.max(0, r.categoryScore) / SCORE_TOP) *
      (Math.max(0, r.emojiScore) / SCORE_TOP);
    const prev = byEmoji.get(r.emoji);
    if (
      !prev ||
      combined > prev.combined ||
      (combined === prev.combined && r.emojiScore > prev.emojiScore)
    ) {
      byEmoji.set(r.emoji, { ...r, combined });
    }
  }
  const ranked = [...byEmoji.values()].sort(
    (a, b) =>
      b.combined - a.combined ||
      b.emojiScore - a.emojiScore ||
      String(a.emoji).localeCompare(String(b.emoji))
  );
  const strong = ranked.filter((r) => r.emojiScore > STRONG_MATCH_SCORE);
  let pool = strong;
  if (pool.length < MIN_LIST_SIZE) {
    const strongSet = new Set(strong.map((r) => r.emoji));
    const need = MIN_LIST_SIZE - strong.length;
    const rest = ranked.filter((r) => !strongSet.has(r.emoji));
    pool = [...strong, ...rest.slice(0, need)];
  }
  return pool.slice(0, HARD_MAX_SUGGESTIONS).map((r) => r.emoji);
}

/**
 * POST /api/categories
 * → { categories: [{ id, score, selected, emojiCount, pages }], pageSize, stats, retrieval? }
 *
 * Always attaches a `retrieve` row when local name/keyword retrieval hits.
 * That shortlist is the non-empty floor; category labels are boost only.
 */
export async function suggestCategories(text, catalog, client, options = {}) {
  const pageSize = Number(options.pageSize || options.chunkSize || DEFAULT_PAGE_SIZE);
  const full = filterCatalog(catalog, {
    fullyQualifiedOnly: options.fullyQualifiedOnly !== false,
  });
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { categories: [], pageSize, stats: emptyStats() };
  if (!client?.systemOne) {
    return errorPayload("upstream", "Jev client not configured");
  }

  const model = options.model || DEFAULT_MODEL;
  const state = { text: trimmed };
  const allChunks = options.chunks || buildChunks(full, options.chunkSize);
  const track = createMeter(options.pricePerMTok);
  const categoryScores = {};
  const emojiCounts = {};
  for (const c of allChunks) {
    emojiCounts[c.category] = (emojiCounts[c.category] || 0) + c.options.length;
  }

  const retrieveLimit = Number(options.retrieveLimit || DEFAULT_RETRIEVE_LIMIT);
  const shortlist = retrieveCandidates(trimmed, full, { limit: retrieveLimit });

  try {
    const res = await track.call(
      client,
      { state, questions: categoryScoreQuestions(full), model },
      { timeout: options.timeoutMs }
    );
    for (const [qid, answer] of Object.entries(res?.answers || {})) {
      if (!qid.startsWith("cat_")) continue;
      const s = readScoreAnswer(answer);
      if (s != null) categoryScores[qid.slice(4)] = s;
    }
  } catch (err) {
    return { ...fail(err), stats: track.stats() };
  }

  let selectedIds = pickCategoriesFromScores(categoryScores, {
    minScore: options.categoryMinScore,
    max: options.maxCategories,
    emojiCounts,
  });
  if (!selectedIds.length) {
    selectedIds = Object.entries(categoryScores)
      .filter(([id]) => (emojiCounts[id] ?? 0) > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([id]) => id);
  }

  const rows = buildCategoryRows(categoryScores, selectedIds, allChunks, pageSize);
  const retrieveRow = retrieveCategoryRow(shortlist, pageSize);
  if (retrieveRow.selected) {
    rows.unshift(retrieveRow);
  }

  return {
    categories: rows,
    pageSize,
    stats: track.stats(),
    retrieval: {
      count: shortlist.length,
      limit: retrieveLimit,
      top: shortlist.slice(0, 8).map((e) => ({
        emoji: e.emoji,
        name: e.name,
        retrievalScore: e.retrievalScore,
      })),
    },
  };
}

/**
 * API returns the fallback pool: emojiScore >= 1.
 * Client still prefers > 2 live; >= 1 only if that list is empty.
 */
export function filterUsefulRatings(ratings, {
  minScore = MIN_API_SCORE,
} = {}) {
  return (ratings || []).filter((r) => r.emojiScore >= minScore);
}

/**
 * POST /api/emoji-batch
 * → { ratings: [{ emoji, emojiScore }], stats }
 * category=retrieve scores the local shortlist; other ids score catalog groups.
 * Ratings with emojiScore >= 1 (client prefers > 2, falls back to >= 1).
 */
export async function suggestEmojiBatch(
  text,
  catalog,
  client,
  { category, categoryScore = 1, page = 1, pageSize } = {},
  options = {}
) {
  const full = filterCatalog(catalog, {
    fullyQualifiedOnly: options.fullyQualifiedOnly !== false,
  });
  const trimmed = String(text ?? "").trim();
  const size = Math.max(
    1,
    Math.min(
      CHOICE_OPTION_LIMIT,
      Number(pageSize) || options.pageSize || options.chunkSize || DEFAULT_PAGE_SIZE
    )
  );
  const pageNo = Math.max(1, Math.floor(Number(page) || 1));

  if (!trimmed || !category) return { ratings: [], stats: emptyStats() };
  if (!client?.systemOne) {
    return errorPayload("upstream", "Jev client not configured");
  }

  const model = options.model || DEFAULT_MODEL;
  const state = { text: trimmed };

  let emojis = [];
  if (category === RETRIEVE_CATEGORY_ID) {
    const shortlist = retrieveCandidates(trimmed, full, {
      limit: Number(options.retrieveLimit || DEFAULT_RETRIEVE_LIMIT),
    });
    emojis = shortlist.map((e) => ({
      id: e.emoji,
      emoji: e.emoji,
      name: e.name,
      keywords: e.keywords,
    }));
  } else {
    const allChunks = options.chunks || buildChunks(full, options.chunkSize);
    for (const chunk of allChunks) {
      if (chunk.category !== category) continue;
      for (const opt of chunk.options) emojis.push(opt);
    }
  }

  const slice = emojis.slice((pageNo - 1) * size, pageNo * size);
  if (!slice.length) return { ratings: [], stats: emptyStats() };

  const track = createMeter(options.pricePerMTok);
  const scored = [];
  try {
    const res = await track.call(
      client,
      {
        state,
        questions: emojiScoreQuestions({
          id: `${category}-page-${pageNo}`,
          category,
          options: slice,
        }),
        model,
      },
      { timeout: options.timeoutMs }
    );
    const answers = res?.answers || {};
    for (const opt of slice) {
      const s = readScoreAnswer(answers[opt.emoji]);
      if (s == null) continue;
      scored.push({ emoji: opt.emoji, emojiScore: s });
    }
  } catch (err) {
    return { ...fail(err), ratings: [], stats: track.stats() };
  }

  return {
    ratings: filterUsefulRatings(scored),
    stats: track.stats(),
  };
}
