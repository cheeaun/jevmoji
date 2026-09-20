#!/usr/bin/env node
/**
 * Build src/data/emojis.json from Unicode emoji-test.txt.
 *
 * Unicode moved emoji data paths after 16.0:
 *   ≤16.0  https://www.unicode.org/Public/emoji/<ver>/emoji-test.txt
 *   ≥17.0  https://www.unicode.org/Public/<ver>.0.0/emoji/emoji-test.txt
 *   latest https://www.unicode.org/Public/emoji/latest/emoji-test.txt
 *
 * Default pin is 17.0.0 — published, but not as bleeding-edge as 18.
 * Catalog lives under src/ (Worker import only) — not public/, which would
 * also copy it into the client build.
 * Keywords/hex/subgroup/id are omitted: the Worker only scores glyphs + category.
 *
 * Usage:
 *   node scripts/build-emojis.mjs
 *   node scripts/build-emojis.mjs --unicode 17.0.0
 *   node scripts/build-emojis.mjs --unicode 16.0
 *   node scripts/build-emojis.mjs --unicode latest
 *   node scripts/build-emojis.mjs --include-qualified   # also MQ + component
 *   node scripts/build-emojis.mjs --out path/to/emojis.json
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_UNICODE = "17.0.0";
const DEFAULT_OUT = path.join(ROOT, "src/data/emojis.json");

/** Unicode group header → catalog category id used by CATEGORY_LABELS. */
const GROUP_TO_CATEGORY = {
  "Smileys & Emotion": "smileys",
  "People & Body": "people",
  Component: "component",
  "Animals & Nature": "animals",
  "Food & Drink": "food",
  "Travel & Places": "travel",
  Activities: "activities",
  Objects: "objects",
  Symbols: "symbols",
  Flags: "flags",
};

const CATEGORIES = [
  { id: "smileys", label: "Smileys & Emotion" },
  { id: "people", label: "People & Body" },
  { id: "animals", label: "Animals & Nature" },
  { id: "food", label: "Food & Drink" },
  { id: "travel", label: "Travel & Places" },
  { id: "activities", label: "Activities" },
  { id: "objects", label: "Objects" },
  { id: "symbols", label: "Symbols" },
  { id: "flags", label: "Flags" },
  { id: "component", label: "Components" },
  { id: "other", label: "Other" },
];

// code points; status # emoji Eversion name
const LINE_RE =
  /^([0-9A-Fa-f][0-9A-Fa-f ]*?)\s*;\s*([a-z-]+)\s+#\s+(\S+)\s+(E\d+(?:\.\d+)*)\s+(.+)$/u;

function parseArgs(argv) {
  const args = {
    unicode: DEFAULT_UNICODE,
    out: DEFAULT_OUT,
    includeQualified: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--unicode" || a === "-u") args.unicode = argv[++i];
    else if (a === "--out" || a === "-o") args.out = path.resolve(argv[++i]);
    else if (a === "--include-qualified") args.includeQualified = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/build-emojis.mjs [--unicode 16.0|17.0.0|18.0.0|latest] [--out file] [--include-qualified]"
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

/** Normalize user version to the directory Unicode actually serves. */
function normalizePublicVersion(version) {
  const raw = String(version).replace(/^v/i, "").trim();
  if (raw === "latest") return "latest";
  const parts = raw.split(".").map((p) => (p === "" ? "0" : p));
  const major = Number(parts[0]);
  if (!Number.isFinite(major)) {
    throw new Error(`Invalid Unicode version: ${version}`);
  }
  if (major <= 16) {
    // Old tree uses 16.0 / 15.1 / 13.1 — not 16.0.0
    if (parts.length === 1) return `${major}.0`;
    return parts.slice(0, 2).join(".");
  }
  // 17+ lives under Public/<major>.<minor>.<patch>/emoji/
  const minor = parts[1] ?? "0";
  const patch = parts[2] ?? "0";
  return `${major}.${minor}.${patch}`;
}

function emojiTestUrl(version) {
  if (version === "latest") {
    return "https://www.unicode.org/Public/emoji/latest/emoji-test.txt";
  }
  const pub = normalizePublicVersion(version);
  const major = Number(pub.split(".")[0]);
  if (major <= 16) {
    return `https://www.unicode.org/Public/emoji/${pub}/emoji-test.txt`;
  }
  return `https://www.unicode.org/Public/${pub}/emoji/emoji-test.txt`;
}

function hexFromCodepoints(codepointField) {
  return codepointField
    .trim()
    .split(/\s+/)
    .map((p) => p.toUpperCase())
    .join("-");
}

function parseEmojiTest(text, { includeQualified }) {
  const emojis = [];
  let version = null;
  let group = null;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("# Version:")) {
      version = line.split(":").slice(1).join(":").trim();
      continue;
    }
    if (line.startsWith("# group:")) {
      group = line.slice("# group:".length).trim();
      continue;
    }
    if (!line || line.startsWith("#") || !group) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;

    const [, codepoints, status, emoji, , name] = m;
    const keep =
      status === "fully-qualified" ||
      (includeQualified &&
        (status === "minimally-qualified" || status === "component"));
    if (!keep) continue;

    const category = GROUP_TO_CATEGORY[group] || "other";
    // Runtime uses emoji/name/category/status only.
    emojis.push({
      emoji,
      name: name.trim(),
      category,
      status,
      hex: hexFromCodepoints(codepoints),
    });
  }

  return { version, emojis };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "jevmoji-catalog-builder/1.0" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function buildCatalog({ version, emojis, url, includeQualified }) {
  const present = new Set(emojis.map((e) => e.category));
  return {
    version: version || "unknown",
    source: includeQualified
      ? `unicode.org emoji-test.txt (${url})`
      : `unicode.org emoji-test.txt fully-qualified (${url})`,
    count: emojis.length,
    categories: CATEGORIES.filter((c) => c.id === "other" || present.has(c.id)),
    emojis: emojis.map(({ emoji, name, category, status }) => ({
      emoji,
      name,
      category,
      status,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = emojiTestUrl(args.unicode);
  console.log(`Fetching ${url}`);
  const text = await fetchText(url);
  const { version, emojis } = parseEmojiTest(text, {
    includeQualified: args.includeQualified,
  });

  if (!emojis.length) {
    throw new Error("No emoji rows parsed — check the Unicode URL/version.");
  }

  const catalog = buildCatalog({
    version,
    emojis,
    url,
    includeQualified: args.includeQualified,
  });

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(catalog)}\n`, "utf8");

  const byStatus = {};
  const byCategory = {};
  for (const e of catalog.emojis) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }
  console.log(`Wrote ${args.out}`);
  console.log(`  unicode ${catalog.version}  count ${catalog.count}`);
  console.log(`  status  ${JSON.stringify(byStatus)}`);
  console.log(`  category ${JSON.stringify(byCategory)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
