import test from "node:test";
import assert from "node:assert/strict";

import {
  tokenizeText,
  retrieveCandidates,
  retrieveCategoryRow,
  RETRIEVE_CATEGORY_ID,
} from "../js/retrieve.js";
import {
  suggestCategories,
  suggestEmojiBatch,
  filterCatalog,
  pickEmojisFromRatings,
} from "../js/jev-chunked.js";

const catalog = {
  emojis: [
    {
      emoji: "👋",
      name: "waving hand",
      category: "people",
      status: "fully-qualified",
      keywords: ["wave", "hello", "hand", "waving"],
    },
    {
      emoji: "🌍",
      name: "globe showing Europe-Africa",
      category: "travel",
      status: "fully-qualified",
      keywords: ["world", "earth", "globe", "planet"],
    },
    {
      emoji: "🙄",
      name: "face with rolling eyes",
      category: "smileys",
      status: "fully-qualified",
      keywords: ["eyeroll", "seriously", "eye", "rolling"],
    },
    {
      emoji: "🚂",
      name: "locomotive",
      category: "travel",
      status: "fully-qualified",
      keywords: ["train", "railway", "engine"],
    },
    {
      emoji: "🐱",
      name: "cat face",
      category: "animals",
      status: "fully-qualified",
      keywords: ["cat", "kitten", "pet"],
    },
  ],
};

test("tokenizeText splits words", () => {
  assert.deepEqual(tokenizeText("Hello, World!"), ["hello", "world"]);
});

test("retrieveCandidates matches names and keywords", () => {
  const helloWorld = retrieveCandidates("hello world", catalog, { limit: 10 });
  const glyphs = helloWorld.map((e) => e.emoji);
  assert.ok(glyphs.includes("👋"), "wave/hello");
  assert.ok(glyphs.includes("🌍"), "world/globe");

  const train = retrieveCandidates("train", catalog);
  assert.equal(train[0]?.emoji, "🚂");

  const noHits = retrieveCandidates("zzzzqqq", catalog);
  assert.deepEqual(noHits, []);
});

test("retrieveCandidates prefers longer pieces inside compound tokens", () => {
  const spiderCatalog = {
    emojis: [
      {
        emoji: "🕷️",
        name: "spider",
        category: "animals",
        status: "fully-qualified",
        keywords: ["spider", "animal", "insect"],
      },
      {
        emoji: "👨",
        name: "man",
        category: "people",
        status: "fully-qualified",
        keywords: ["man", "adult", "bro"],
      },
      {
        emoji: "🏃",
        name: "man running",
        category: "people",
        status: "fully-qualified",
        keywords: ["man", "running", "fast"],
      },
    ],
  };
  const hits = retrieveCandidates("spiderman", spiderCatalog, { limit: 5 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0]?.emoji, "🕷️");
});

test("buildCategoryRows caps huge mid-score groups", async () => {
  const { buildCategoryRows } = await import("../js/jev-chunked.js");
  const chunks = [];
  for (let i = 0; i < 2418; i++) {
    chunks.push({ category: "people", options: [{ emoji: `p${i}` }] });
  }
  for (let i = 0; i < 160; i++) {
    chunks.push({ category: "animals", options: [{ emoji: `a${i}` }] });
  }
  const rows = buildCategoryRows(
    { people: 1.55, animals: 1.05 },
    ["people", "animals"],
    chunks,
    80
  );
  const people = rows.find((r) => r.id === "people");
  const animals = rows.find((r) => r.id === "animals");
  assert.equal(people.pages, 2);
  assert.equal(animals.pages, 2);

  const strongPeople = buildCategoryRows(
    { people: 2.8 },
    ["people"],
    chunks,
    80
  ).find((r) => r.id === "people");
  assert.equal(strongPeople.pages, Math.ceil(2418 / 80));
});

test("retrieveCategoryRow is selected only when shortlist non-empty", () => {
  const empty = retrieveCategoryRow([], 80);
  assert.equal(empty.selected, false);
  assert.equal(empty.pages, 0);

  const hit = retrieveCategoryRow([{ emoji: "👋" }, { emoji: "🌍" }], 80);
  assert.equal(hit.id, RETRIEVE_CATEGORY_ID);
  assert.equal(hit.selected, true);
  assert.equal(hit.emojiCount, 2);
  assert.equal(hit.pages, 1);
});

test("suggestCategories attaches retrieve row + retrieval debug", async () => {
  const fq = filterCatalog(catalog);
  const client = {
    async systemOne({ questions }) {
      const usage = { input_tokens: 30, output_tokens: 4 };
      const answers = {};
      for (const qid of Object.keys(questions)) {
        answers[qid] = {
          type: "score",
          score: qid === "cat_travel" ? 2.8 : 0.2,
          confidence: 1,
          legend: {},
          probabilities: {},
        };
      }
      return { model: "t", answers, usage };
    },
  };

  const res = await suggestCategories("hello world", fq, client, { pageSize: 80 });
  const retrieve = res.categories.find((c) => c.id === RETRIEVE_CATEGORY_ID);
  assert.ok(retrieve?.selected);
  assert.ok(retrieve.emojiCount >= 2);
  assert.ok(res.retrieval.count >= 2);
  assert.ok(res.retrieval.top.some((e) => e.emoji === "👋" || e.emoji === "🌍"));
});

test("suggestEmojiBatch category=retrieve scores shortlist", async () => {
  const fq = filterCatalog(catalog);
  const client = {
    async systemOne({ questions }) {
      const usage = { input_tokens: 20, output_tokens: 4 };
      const answers = {};
      for (const qid of Object.keys(questions)) {
        answers[qid] = {
          type: "score",
          score: qid === "👋" || qid === "🌍" ? 2.4 : 0.8,
          confidence: 0.9,
          legend: {},
          probabilities: {},
        };
      }
      return { model: "t", answers, usage };
    },
  };

  const page = await suggestEmojiBatch(
    "hello world",
    fq,
    client,
    { category: RETRIEVE_CATEGORY_ID, categoryScore: 2.5, page: 1, pageSize: 80 },
    {}
  );
  const glyphs = page.ratings.map((r) => r.emoji);
  assert.ok(glyphs.includes("👋"));
  assert.ok(glyphs.includes("🌍"));
  assert.ok(page.ratings.every((r) => r.emojiScore >= 1));

  const list = pickEmojisFromRatings(
    page.ratings.map((r) => ({ ...r, categoryScore: 2.5, category: RETRIEVE_CATEGORY_ID }))
  );
  assert.ok(list.includes("👋"));
});

test("pickEmojisFromRatings dedupes retrieve + category overlap", () => {
  const list = pickEmojisFromRatings([
    { emoji: "👋", emojiScore: 2.12, categoryScore: 2.5, category: "retrieve" },
    { emoji: "👋", emojiScore: 2.08, categoryScore: 0.22, category: "people" },
    { emoji: "🗺️", emojiScore: 1.72, categoryScore: 2.5, category: "retrieve" },
  ]);
  // 1 strong + pad lower-score map to the min list floor.
  assert.equal(list[0], "👋");
  assert.ok(list.includes("🗺️"));
});
