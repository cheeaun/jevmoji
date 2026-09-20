/**
 * Client-side ranking after /api/categories + /api/emoji-batch.
 * combined = (categoryScore/3) * (emojiScore/3)
 */

export const SCORE_TOP = 3;
export const STRONG_MATCH_SCORE = 2;
export const MIN_FALLBACK_SCORE = 1;
export const HARD_MAX_SUGGESTIONS = 50;

export function scoreToPct(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  return Number(((Math.max(0, Math.min(SCORE_TOP, s)) / SCORE_TOP) * 100).toFixed(1));
}

function rankRows(rows) {
  return rows
    .map((r) => ({
      ...r,
      combined:
        (Math.max(0, r.categoryScore) / SCORE_TOP) *
        (Math.max(0, r.emojiScore) / SCORE_TOP),
    }))
    .sort(
      (a, b) =>
        b.combined - a.combined ||
        b.emojiScore - a.emojiScore ||
        String(a.emoji).localeCompare(String(b.emoji))
    );
}

/**
 * List rules:
 * 1) Prefer live scores > 2
 * 2) If none, fall back to scores >= 1 (still sorted by combined score)
 * 3) Hard max 50
 */
export function pickEmojisFromRatings(ratings) {
  const ranked = rankRows(ratings || []);
  const strong = ranked.filter((r) => r.emojiScore > STRONG_MATCH_SCORE);
  const pool = strong.length
    ? strong
    : ranked.filter((r) => r.emojiScore >= MIN_FALLBACK_SCORE);
  return pool.slice(0, HARD_MAX_SUGGESTIONS).map((r) => r.emoji);
}

export function detailForEmojis(emojiList, ratings) {
  const byEmoji = new Map();
  for (const r of ratings || []) {
    const combined =
      (Math.max(0, r.categoryScore) / SCORE_TOP) *
      (Math.max(0, r.emojiScore) / SCORE_TOP);
    const prev = byEmoji.get(r.emoji);
    if (!prev || combined > prev.combined) {
      byEmoji.set(r.emoji, { ...r, combined });
    }
  }
  return (emojiList || []).map((emoji) => {
    const row = byEmoji.get(emoji);
    return {
      emoji,
      category: row?.category ?? null,
      emojiScore: Number((row?.emojiScore ?? 0).toFixed(3)),
      categoryScore: Number((row?.categoryScore ?? 0).toFixed(3)),
      combined: Number((row?.combined ?? 0).toFixed(4)),
      emojiPct: scoreToPct(row?.emojiScore ?? 0),
      categoryPct: scoreToPct(row?.categoryScore ?? 0),
      combinedPct: Number((Math.max(0, row?.combined ?? 0) * 100).toFixed(1)),
    };
  });
}

export function emptyStats() {
  return { elapsedMs: 0, inputTokens: 0, costUsd: 0, fetches: 0 };
}

export function mergeStats(parts) {
  const total = emptyStats();
  let maxElapsed = 0;
  for (const s of parts || []) {
    if (!s) continue;
    total.inputTokens += Number(s.inputTokens) || 0;
    total.costUsd += Number(s.costUsd) || 0;
    total.fetches += 1; // one client → Worker call per stats object
    maxElapsed = Math.max(maxElapsed, Number(s.elapsedMs) || 0);
  }
  total.elapsedMs = maxElapsed;
  total.costUsd = Number(total.costUsd.toFixed(8));
  return total;
}
