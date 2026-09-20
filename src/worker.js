/**
 * Cloudflare Worker API (Vite + @cloudflare/vite-plugin).
 * Static page is served by Vite; this Worker handles /api/* only.
 */

import { TypeSafeClient } from "@typesafe-ai/sdk";
import catalogRaw from "./data/emojis.json";
import {
  suggestCategories,
  suggestEmojiBatch,
  filterCatalog,
} from "../js/jev-chunked.js";
import { normalizeInput, errorPayload } from "../js/suggest-contract.js";

let catalogCache = null;
let clientCache = null;

function getClient(env) {
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey) return null;
  if (!clientCache) {
    clientCache = new TypeSafeClient({
      apiKey,
      defaultModel: env.TYPESAFE_MODEL || "jev-latest",
      timeout: Number(env.TYPESAFE_TIMEOUT_MS || 60_000),
    });
  }
  return clientCache;
}

function getCatalog() {
  if (!catalogCache) {
    catalogCache = filterCatalog(catalogRaw, { fullyQualifiedOnly: true });
  }
  return catalogCache;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function resolveErrorStatus(payload) {
  const code = payload?.error?.code;
  return code === "bad_request" ? 400 : code === "rate_limit" ? 429 : 502;
}

function requireClient(env) {
  const client = getClient(env);
  if (!client) {
    return json(
      500,
      errorPayload("upstream", "TYPESAFE_API_KEY is not set on the Worker.")
    );
  }
  return null;
}

async function handleCategories(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, errorPayload("bad_request", "Invalid JSON body"));
  }
  const input = normalizeInput(body?.text);
  if (!input.trimmed) {
    return json(400, errorPayload("bad_request", "Enter up to 40 characters."));
  }
  const missing = requireClient(env);
  if (missing) return missing;

  const payload = await suggestCategories(input.text, getCatalog(), getClient(env), {
    model: env.TYPESAFE_MODEL || "jev-latest",
    fullyQualifiedOnly: true,
    pageSize: body?.pageSize || env.EMOJI_PAGE_SIZE || undefined,
    pricePerMTok: env.TYPESAFE_PRICE_PER_MTOK
      ? Number(env.TYPESAFE_PRICE_PER_MTOK)
      : undefined,
  });
  if (payload?.error) return json(resolveErrorStatus(payload), payload);
  return json(200, payload);
}

async function handleEmojiBatch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, errorPayload("bad_request", "Invalid JSON body"));
  }
  const input = normalizeInput(body?.text);
  if (!input.trimmed) {
    return json(400, errorPayload("bad_request", "Enter up to 40 characters."));
  }
  const category = String(body?.category || "").trim();
  if (!category) {
    return json(400, errorPayload("bad_request", "category is required"));
  }
  const missing = requireClient(env);
  if (missing) return missing;

  const payload = await suggestEmojiBatch(
    input.text,
    getCatalog(),
    getClient(env),
    {
      category,
      categoryScore: body?.categoryScore,
      page: body?.page,
      pageSize: body?.pageSize,
    },
    {
      model: env.TYPESAFE_MODEL || "jev-latest",
      fullyQualifiedOnly: true,
      pageSize: body?.pageSize || env.EMOJI_PAGE_SIZE || undefined,
      pricePerMTok: env.TYPESAFE_PRICE_PER_MTOK
        ? Number(env.TYPESAFE_PRICE_PER_MTOK)
        : undefined,
    }
  );
  if (payload?.error) return json(resolveErrorStatus(payload), payload);
  return json(200, payload);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/categories" && request.method === "POST") {
      return handleCategories(request, env);
    }
    if (path === "/api/emoji-batch" && request.method === "POST") {
      return handleEmojiBatch(request, env);
    }
    return json(404, errorPayload("bad_request", "Not found"));
  },
};
