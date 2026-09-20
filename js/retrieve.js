/**
 * Local candidate retrieval from catalog names + keywords.
 * TypeSafe only ranks this shortlist — category labels are not the gate.
 */

export const DEFAULT_RETRIEVE_LIMIT = 40;
export const RETRIEVE_CATEGORY_ID = "retrieve";
/** UI label for the synthetic retrieve row (API still uses the id). */
export const RETRIEVE_CATEGORY_LABEL = "hits";
/** Category boost used when ranking retrieved candidates. */
export const RETRIEVE_CATEGORY_SCORE = 2.5;

export function tokenizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 || t === "i");
}

function isPictograph(char) {
  try {
    return /\p{Extended_Pictographic}/u.test(char);
  } catch {
    return false;
  }
}

export function entryKeywords(entry) {
  const kws = entry?.keywords;
  if (!kws) return [];
  if (Array.isArray(kws)) return kws.map((k) => String(k).toLowerCase());
  return String(kws)
    .split(/[;,]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Score catalog entries against query tokens using name + keywords + glyphs.
 * Returns top matches by retrievalScore (code-only; no model call).
 */
export function retrieveCandidates(text, catalog, { limit = DEFAULT_RETRIEVE_LIMIT } = {}) {
  const raw = String(text ?? "");
  const tokens = tokenizeText(raw);
  const emojis = catalog?.emojis || [];
  const max = Math.max(0, Number(limit) || 0);
  if (!max || !emojis.length) return [];

  const glyphsInText = new Set();
  for (const ch of raw) {
    if (isPictograph(ch)) glyphsInText.add(ch);
  }

  const phrase = tokens.join(" ");
  const scored = [];

  for (const entry of emojis) {
    const name = String(entry.name || "").toLowerCase();
    const nameTokens = name.split(/[^a-z0-9']+/).filter(Boolean);
    const kws = entryKeywords(entry);
    let score = 0;

    if (glyphsInText.has(entry.emoji)) score += 12;

    for (const t of tokens) {
      if (name === t) score += 6;
      else if (nameTokens.includes(t)) score += 4;
      else if (t.length >= 3 && name.includes(t)) score += 2;
      else if (t.length >= 4) {
        // Compound query ("spiderman"): prefer longer name pieces inside the token.
        let bestName = 0;
        for (const n of nameTokens) {
          if (n.length >= 3 && t.includes(n) && n.length > bestName) bestName = n.length;
        }
        if (bestName) score += 2 + bestName;
      }

      for (const k of kws) {
        if (k === t) score += 5;
        else if (k.length >= 3 && t.length >= 3) {
          // Longer keyword inside the query beats short ones like "man".
          if (t.includes(k)) score += 2 + k.length;
          else if (k.includes(t)) score += 2 + t.length;
        }
      }
    }

    if (phrase.length >= 3) {
      if (name.includes(phrase)) score += 4;
      if (kws.some((k) => k.includes(phrase))) score += 4;
    }

    if (score > 0) {
      scored.push({
        emoji: entry.emoji,
        name: entry.name,
        category: entry.category,
        keywords: kws,
        retrievalScore: score,
      });
    }
  }

  scored.sort(
    (a, b) => b.retrievalScore - a.retrievalScore || String(a.emoji).localeCompare(String(b.emoji))
  );
  return scored.slice(0, max);
}

export function retrieveCategoryRow(shortlist, pageSize = 80) {
  const count = shortlist?.length || 0;
  const size = Math.max(1, Number(pageSize) || 80);
  return {
    id: RETRIEVE_CATEGORY_ID,
    score: count ? RETRIEVE_CATEGORY_SCORE : 0,
    selected: count > 0,
    emojiCount: count,
    pages: count ? Math.ceil(count / size) : 0,
  };
}
