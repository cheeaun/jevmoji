import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildChunks,
  categoryScoreQuestions,
  emojiScoreQuestions,
  filterUsefulRatings,
  pickCategoriesFromScores,
  pickEmojisFromRatings,
  suggestCategories,
  suggestEmojiBatch,
  filterCatalog,
  CHOICE_OPTION_LIMIT,
} from "../js/jev-chunked.js";
import { normalizeInput, MAX_INPUT } from "../js/suggest-contract.js";
import { TypeSafeClient } from "@typesafe-ai/sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/emojis.json"), "utf8")
);

test("normalizeInput caps at 40 code points", () => {
  const info = normalizeInput("😀".repeat(50));
  assert.equal([...info.text].length, MAX_INPUT);
});

test("catalog FQ filter + glyph chunks", () => {
  const fq = filterCatalog(catalog);
  assert.ok(fq.count >= 3000);
  assert.ok(fq.emojis.every((e) => e.status === "fully-qualified"));
  const chunks = buildChunks(fq, 80);
  for (const chunk of chunks) {
    assert.ok(chunk.options.length <= CHOICE_OPTION_LIMIT);
  }
});

test("questions are Score type; categories list groups", () => {
  const fq = filterCatalog(catalog);
  const cats = categoryScoreQuestions(fq);
  assert.equal(cats.cat_travel.type, "score");
  assert.ok(Array.isArray(cats.cat_travel.criteria));
  const chunks = buildChunks(fq, 80);
  const q = emojiScoreQuestions(chunks[0]);
  assert.equal(q[chunks[0].options[0].emoji].type, "score");
});

test("pickCategoriesFromScores prefers strong groups", () => {
  const counts = { travel: 200, food: 100, people: 50, other: 0 };
  assert.deepEqual(
    pickCategoriesFromScores({ travel: 3, food: 0.5 }, { emojiCounts: counts }),
    ["travel"]
  );
  const mixed = pickCategoriesFromScores(
    { travel: 2.2, food: 2, people: 0.5 },
    { emojiCounts: counts }
  );
  assert.ok(mixed.includes("travel") && mixed.includes("food"));
});

test("pickCategoriesFromScores skips empty and fans out when weak", () => {
  const counts = { other: 0, smileys: 171, people: 2418, animals: 160 };
  const picked = pickCategoriesFromScores(
    { other: 0.73, smileys: 0.47, people: 0.23, animals: 0.2 },
    { emojiCounts: counts }
  );
  assert.deepEqual(picked, ["smileys", "people", "animals"]);
  assert.ok(!picked.includes("other"));
});

test("filterUsefulRatings returns score >= 1", () => {
  const rows = [
    { emoji: "A", emojiScore: 2.9 },
    { emoji: "B", emojiScore: 2.1 },
    { emoji: "C", emojiScore: 1.39 },
    { emoji: "D", emojiScore: 0.98 },
    { emoji: "E", emojiScore: 2.0 },
  ];
  const out = filterUsefulRatings(rows);
  assert.deepEqual(out.map((r) => r.emoji), ["A", "B", "C", "E"]);
  assert.ok(out.every((r) => r.emojiScore >= 1));
});

test("pickEmojisFromRatings prefers score > 2, falls back to >= 1", () => {
  const many = [];
  for (let i = 0; i < 60; i++) {
    many.push({ emoji: `S${i}`, emojiScore: 2.1, categoryScore: 3, category: "travel" });
  }
  for (let i = 0; i < 20; i++) {
    many.push({ emoji: `W${i}`, emojiScore: 1.0, categoryScore: 3, category: "travel" });
  }
  const out = pickEmojisFromRatings(many);
  assert.equal(out.length, 50);
  assert.ok(out.every((e) => e.startsWith("S")));

  const few = [
    { emoji: "A", emojiScore: 2.9, categoryScore: 3, category: "travel" },
    { emoji: "B", emojiScore: 2.2, categoryScore: 3, category: "travel" },
    { emoji: "W0", emojiScore: 1.5, categoryScore: 3, category: "travel" },
  ];
  const mixed = pickEmojisFromRatings(few);
  assert.deepEqual(mixed, ["A", "B"]);

  const fallback = [
    { emoji: "hi", emojiScore: 1.9, categoryScore: 3, category: "smileys" },
    { emoji: "mid", emojiScore: 1.4, categoryScore: 2, category: "smileys" },
    { emoji: "lo", emojiScore: 0.9, categoryScore: 2, category: "smileys" },
  ];
  assert.deepEqual(pickEmojisFromRatings(fallback), ["hi", "mid"]);
});

test("slim categories + emoji-batch payloads", async () => {
  const fq = filterCatalog(catalog);
  const chunks = buildChunks(fq, 80);
  const train =
    chunks
      .filter((c) => c.category === "travel")
      .flatMap((c) => c.options)
      .find((o) => o.emoji === "🚂")?.emoji;

  const client = {
    async systemOne({ questions }) {
      const usage = { input_tokens: 40, output_tokens: 4 };
      const qids = Object.keys(questions);
      if (qids.some((id) => id.startsWith("cat_"))) {
        const answers = {};
        for (const qid of qids) {
          answers[qid] = {
            type: "score",
            score: qid === "cat_travel" ? 3 : 0,
            confidence: 1,
            legend: {},
            probabilities: {},
          };
        }
        return { model: "t", answers, usage };
      }
      const answers = {};
      for (const qid of qids) {
        answers[qid] = {
          type: "score",
          score: qid === train ? 3 : 1,
          confidence: 0.9,
          legend: {},
          probabilities: {},
        };
      }
      return { model: "t", answers, usage };
    },
  };

  const step1 = await suggestCategories("train", catalog, client, { chunks, pageSize: 80 });
  assert.ok(step1.categories.some((c) => c.id === "travel" && c.selected));
  assert.equal(step1.requestPlan, undefined);
  assert.equal(step1.selectedCategories, undefined);
  assert.equal(step1.stats.requests, undefined);
  assert.equal(step1.stats.outputTokens, undefined);
  assert.ok(step1.stats.inputTokens > 0);
  assert.ok(typeof step1.stats.costUsd === "number");

  const travel = step1.categories.find((c) => c.id === "travel");
  const page = await suggestEmojiBatch(
    "train",
    catalog,
    client,
    { category: "travel", categoryScore: travel.score, page: 1, pageSize: 80 },
    { chunks }
  );
  assert.ok(page.ratings.length > 0);
  assert.ok(page.ratings.some((r) => r.emoji === train));
  assert.ok(page.ratings.every((r) => r.emojiScore >= 1));
  assert.equal(page.ratings[0].categoryScore, undefined);
  assert.equal(page.category, undefined);
});

test("SDK client constructs from env key", () => {
  const prev = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    const client = new TypeSafeClient();
    assert.equal(typeof client.systemOne, "function");
  } finally {
    if (prev === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = prev;
  }
});
