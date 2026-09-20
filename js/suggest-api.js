/**
 * Client fetches:
 *   POST /api/categories
 *   POST /api/emoji-batch  (parallel, one per page)
 */

import { errorPayload, normalizeInput } from "./suggest-contract.js";

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return errorPayload("upstream", err?.message || "Network error");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    return data?.error
      ? data
      : errorPayload(
          res.status === 429 ? "rate_limit" : "upstream",
          `${path} failed (${res.status})`
        );
  }
  return data;
}

export async function fetchCategories(rawText) {
  const input = normalizeInput(rawText);
  if (!input.trimmed) {
    return errorPayload("bad_request", "Enter up to 40 characters.");
  }
  return post("/api/categories", { text: input.text });
}

export async function fetchEmojiBatch(rawText, category, categoryScore, page, pageSize) {
  const input = normalizeInput(rawText);
  if (!input.trimmed || !category) {
    return errorPayload("bad_request", "text and category are required");
  }
  return post("/api/emoji-batch", {
    text: input.text,
    category,
    categoryScore,
    page: page || 1,
    pageSize,
  });
}
