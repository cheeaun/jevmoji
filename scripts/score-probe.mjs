#!/usr/bin/env node
/**
 * Live suggest pipeline probe — categories → batch pages → client list.
 *
 * Usage:
 *   node scripts/score-probe.mjs "hello world"
 *   node scripts/score-probe.mjs "srsly" "anyway"
 *   node scripts/score-probe.mjs "hello world" --probe 👋🌍💬
 *   npm run probe -- "train"
 *
 * Reads TYPESAFE_API_KEY from the environment or .dev.vars.
 * Prints selection, batch hits, and the final ranked list (score > 2, else >= 1).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  suggestCategories,
  suggestEmojiBatch,
  filterCatalog,
  pickEmojisFromRatings,
  categoryScoreQuestions,
} from "../js/jev-chunked.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = path.join(ROOT, "src/data/emojis.json");
const REL_LEVELS = [
  "No relation to the text",
  "Weak or vague connection",
  "Clear connection to the text",
  "Strong, obvious match for the text",
];

function loadEnvFile() {
  const file = path.join(ROOT, ".dev.vars");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const texts = [];
  let probe = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--probe") {
      probe = argv[++i] || "";
      continue;
    }
    if (arg.startsWith("--probe=")) {
      probe = arg.slice("--probe=".length);
      continue;
    }
    if (arg === "-h" || arg === "--help") return { help: true };
    texts.push(arg);
  }
  return { texts, probe: probe ? [...probe] : null };
}

function usage() {
  console.log(`Usage: node scripts/score-probe.mjs <text> [text…] [--probe 👋🌍💬]

Examples:
  node scripts/score-probe.mjs "hello world"
  node scripts/score-probe.mjs "srsly" "anyway" --probe 🙄🤷💬
`);
}

function fmtRatings(rows, limit = 12) {
  if (!rows?.length) return "(none)";
  return rows
    .slice()
    .sort((a, b) => b.emojiScore - a.emojiScore)
    .slice(0, limit)
    .map((r) => `${r.emoji}:${r.emojiScore}`)
    .join(" ");
}

async function scoreProbeEmojis(client, model, text, glyphs, catalog) {
  const present = new Map(catalog.emojis.map((e) => [e.emoji, e]));
  const questions = {};
  for (const g of glyphs) {
    const entry = present.get(g);
    const label = entry?.name ? `${g} ("${entry.name}")` : g;
    questions[g] = {
      type: "score",
      instructions: `How well does the emoji ${label} relate to \`state.text\`?`,
      criteria: REL_LEVELS,
    };
  }
  if (!Object.keys(questions).length) return;
  const res = await client.systemOne({
    state: { text },
    questions,
    model,
  });
  const scores = Object.entries(res.answers || {})
    .map(([emoji, a]) => ({ emoji, emojiScore: Number(a.score), category: present.get(emoji)?.category }))
    .filter((r) => Number.isFinite(r.emojiScore))
    .sort((a, b) => b.emojiScore - a.emojiScore);
  console.log("  probe:", scores.map((r) => `${r.emoji}:${r.emojiScore}`).join(" ") || "(none)");
  console.log("  probe client pick:", pickEmojisFromRatings(scores.map((r) => ({ ...r, categoryScore: 3 }))).join(" ") || "(empty)");
}

async function probeOne(client, model, catalog, text, glyphs) {
  console.log(`\n==== ${JSON.stringify(text)} ====`);
  const cats = await suggestCategories(text, catalog, client, {});
  if (cats.error) {
    console.log("categories error:", cats.error);
    return;
  }

  const selected = (cats.categories || []).filter((c) => c.selected);
  console.log(
    "selected:",
    selected.map((c) => `${c.id}:${c.score} n=${c.emojiCount} pages=${c.pages}`).join(", ") ||
      "(none)"
  );
  console.log(
    "all:",
    (cats.categories || []).map((c) => `${c.id}:${c.score}${c.selected ? "*" : ""}`).join(" ")
  );
  if (cats.retrieval) {
    console.log(
      "retrieval:",
      cats.retrieval.top?.map((e) => `${e.emoji}:${e.retrievalScore}`).join(" ") || "(none)",
      `(count=${cats.retrieval.count})`
    );
  }

  if (glyphs?.length) {
    await scoreProbeEmojis(client, model, text, glyphs, catalog);
  }

  const ratings = [];
  let fetches = 0;
  for (const cat of selected) {
    for (let page = 1; page <= cat.pages; page++) {
      fetches += 1;
      const batch = await suggestEmojiBatch(
        text,
        catalog,
        client,
        {
          category: cat.id,
          categoryScore: cat.score,
          page,
          pageSize: cats.pageSize || 80,
        },
        {}
      );
      if (batch.error) {
        console.log(`  ${cat.id} p${page} error:`, batch.error);
        continue;
      }
      if (batch.ratings?.length) {
        console.log(`  ${cat.id} p${page}:`, fmtRatings(batch.ratings, 8));
      }
      for (const row of batch.ratings || []) {
        ratings.push({
          emoji: row.emoji,
          emojiScore: row.emojiScore,
          categoryScore: cat.score,
          category: cat.id,
        });
      }
    }
  }

  const list = pickEmojisFromRatings(ratings);
  console.log(
    `fetches ${fetches}  ratings ${ratings.length}  list:`,
    list.join(" ") || "(empty)"
  );
  if (ratings.length) {
    console.log("top ratings:", fmtRatings(ratings, 10));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.texts.length) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  loadEnvFile();
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY is not set (env or .dev.vars).");
    process.exit(1);
  }

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`Catalog missing: ${CATALOG_PATH}`);
    process.exit(1);
  }

  const catalog = filterCatalog(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")));
  const model = process.env.TYPESAFE_MODEL || "jev-latest";
  const client = new TypeSafeClient({
    apiKey,
    defaultModel: model,
    timeout: Number(process.env.TYPESAFE_TIMEOUT_MS || 60_000),
  });

  // Sanity: category question count matches present groups.
  const nCatQ = Object.keys(categoryScoreQuestions(catalog)).length;
  console.log(`catalog FQ=${catalog.count}  category questions=${nCatQ}  model=${model}`);

  for (const text of args.texts) {
    await probeOne(client, model, catalog, text, args.probe);
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
