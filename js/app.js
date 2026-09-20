import "@fontsource/host-grotesk/latin-400.css";
import "@fontsource/host-grotesk/latin-500.css";
import "@fontsource/host-grotesk/latin-600.css";
import "@fontsource/fragment-mono/latin-400.css";
import { normalizeInput } from "./suggest-contract.js";
import { fetchCategories, fetchEmojiBatch } from "./suggest-api.js";
import {
  pickEmojisFromRatings,
  detailForEmojis,
  mergeStats,
  emptyStats,
} from "./rank.js";

const input = document.getElementById("text-input");
const button = document.getElementById("suggest-btn");
const suggestions = document.getElementById("suggestions");
const status = document.getElementById("status");
const statsEl = document.getElementById("stats");
const detailEl = document.getElementById("detail");

let busy = false;

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function formatCost(usd) {
  const v = Number(usd) || 0;
  if (v === 0) return "$0";
  if (v < 0.0001) return `$${v.toFixed(6)}`;
  if (v < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(4)}`;
}

function pct(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "0%";
  return `${((Math.max(0, Math.min(3, s)) / 3) * 100).toFixed(1)}%`;
}

function renderStats(stats, note) {
  if (!stats) {
    statsEl.hidden = true;
    statsEl.textContent = "";
    return;
  }
  const ms = stats.elapsedMs ?? 0;
  const sec = ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
  const bits = [
    sec,
    `${stats.fetches ?? 0} fetch${stats.fetches === 1 ? "" : "es"}`,
    formatCost(stats.costUsd),
    `${formatTokens(stats.inputTokens)} in`,
  ];
  if (note) bits.push(note);
  statsEl.hidden = false;
  statsEl.textContent = bits.join("  ·  ");
}

/** All /api/emoji-batch jobs for selected categories. */
function batchJobs(categories, pageSize) {
  const size = pageSize || 80;
  const jobs = [];
  const selected = (categories || []).filter((c) => c.selected);
  const targets = selected.length ? selected : categories || [];
  for (const cat of targets) {
    if (!(cat.emojiCount ?? 0)) continue;
    const pages = cat.pages || 1;
    for (let page = 1; page <= pages; page++) {
      jobs.push({
        category: cat.id,
        categoryScore: cat.score ?? 1,
        page,
        pages,
        pageSize: size,
        emojiCount: cat.emojiCount ?? 0,
      });
    }
  }
  return jobs;
}

function renderCategoriesAndPlan(detail, note, completedPages) {
  const all = detail.categories || [];
  const pageSize = detail.pageSize || 80;
  const completed = completedPages ?? 0;
  const selected = all.filter((c) => c.selected);
  const jobs = batchJobs(all, pageSize);
  const totalBatchPages = jobs.length || selected.reduce((n, c) => n + (c.pages || 1), 0);

  const catRows = all
    .map((c) => {
      const pagesCell = c.selected
        ? `${c.emojiCount}→${c.pages}`
        : "—";
      return `<tr class="${c.selected ? "is-selected" : ""}">
        <td>${c.selected ? "✓" : ""}</td>
        <td class="cat-name">${c.id}</td>
        <td class="num">${pct(c.score)}</td>
        <td class="num">${pagesCell}</td>
      </tr>`;
    })
    .join("");

  const blocks = (n, cls) =>
    Array.from({ length: Math.max(0, n || 0) }, () => `<i class="req-block ${cls}"></i>`).join("");

  return `
    <div class="detail-label">Categories &amp; fetch plan</div>
    <div class="request-chart">
      <div class="table-wrap" tabindex="0" role="region" aria-label="Categories table">
        <table class="cat-table">
          <thead>
            <tr>
              <th></th>
              <th>Category</th>
              <th>Score</th>
              <th>Emoji→pages</th>
            </tr>
          </thead>
          <tbody>
            ${catRows || '<tr><td colspan="4">No categories yet</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="chart-line chart-line-summary">
        <span class="chart-k">Page size</span>
        <span class="chart-v">${pageSize}</span>
        <span class="chart-k">Pages</span>
        <span class="chart-v">${completed}/${totalBatchPages}</span>
        <span class="chart-k">Calls</span>
        <span class="chart-v">1 + ${totalBatchPages}</span>
      </div>
      <div class="chart-blocks" aria-hidden="true">${
        totalBatchPages
          ? Array.from({ length: totalBatchPages }, (_, i) =>
              `<i class="req-block ${i < completed ? "req-green" : "req-blue"}"></i>`
            ).join("")
          : blocks(1, "req-green")
      }</div>
      ${note ? `<div class="chart-desc">${note}</div>` : ""}
    </div>
  `;
}

function renderEmojiTable(ratings) {
  if (!ratings?.length) {
    return `<div class="detail-cats">Waiting for emoji scores…</div>`;
  }

  // Group by category for rowspan.
  const byCat = new Map();
  for (const r of ratings) {
    const key = r.category || "—";
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(r);
  }

  const body = [...byCat.entries()]
    .map(([category, rows]) => {
      const first = rows[0];
      const catPct = pct(first.categoryScore, first.categoryPct);
      const catRaw = Number(first.categoryScore ?? 0).toFixed(2);
      return rows
        .map((r, i) => {
          const catCells =
            i === 0
              ? `<th scope="rowgroup" rowspan="${rows.length}" class="cat-cell">
                   <div class="cat-cell-name">${category}</div>
                   <div class="cat-cell-score">
                     <span class="pct">${catPct}</span>
                     <span class="raw muted">(${catRaw})</span>
                   </div>
                 </th>`
              : "";
          return `<tr>
            ${catCells}
            <td class="g">${r.emoji}</td>
            <td class="num">${pct(r.emojiScore, r.emojiPct)}</td>
            <td class="num strong">${r.combinedPct ?? 0}%</td>
          </tr>`;
        })
        .join("");
    })
    .join("");

  return `
    <div class="detail-label">Emoji scores</div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Emoji scores table">
      <table class="emoji-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Emoji</th>
            <th>Score</th>
            <th>Mix</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

let lastDetailKey = null;

function renderDetail(detail, note, completedPages) {
  if (!detail) {
    detailEl.hidden = true;
    detailEl.innerHTML = "";
    lastDetailKey = null;
    return;
  }
  const ratings = detail.emojiRatings || [];
  const key = JSON.stringify({
    note: note || "",
    completedPages: completedPages ?? 0,
    pageSize: detail.pageSize || null,
    cats: (detail.categories || []).map((c) => [
      c.id,
      c.score,
      c.selected,
      c.pages,
      c.emojiCount,
    ]),
    rats: ratings.map((r) => [
      r.emoji,
      r.emojiScore,
      r.category,
      r.categoryScore,
      r.combinedPct,
    ]),
  });
  // Live batches repaint often; skip when the score trace payload is unchanged.
  if (key === lastDetailKey && !detailEl.hidden) return;
  lastDetailKey = key;
  detailEl.hidden = false;
  detailEl.innerHTML = `
    ${renderCategoriesAndPlan(detail, note, completedPages)}
    ${renderEmojiTable(ratings)}
  `;
}

function updateChrome() {
  const info = normalizeInput(input.value);
  if (info.overLimit) input.value = info.text;
  button.disabled = busy || info.trimmed.length === 0;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function createEmojiEl(emoji) {
  const span = document.createElement("span");
  span.dataset.emoji = emoji;
  span.textContent = emoji;
  span.title = "Click to copy";
  span.setAttribute("role", "button");
  span.tabIndex = 0;
  span.addEventListener("click", () => copyEmoji(emoji, span));
  span.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copyEmoji(emoji, span);
    }
  });
  return span;
}

function emptyHintFor(phase, { batchCount = 0 } = {}) {
  if (phase === "loading") return "awaiting scores…";
  if (phase === "done") {
    if (!batchCount) return "no categories · try another phrase";
    return "no matches · nothing scored above 2";
  }
  return "awaiting input";
}

function sameEmojiList(a, b) {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let lastEmojiList = null;

/**
 * Live batches call this often — skip DOM when the ranked list is unchanged,
 * and move existing nodes in place instead of tearing the grid down.
 * Motion: enter (fade) / reorder (FLIP) / exit (ghost fade).
 */
function renderEmojis(emojis, phase = "idle", meta = {}) {
  const list = emojis || [];
  const reduce = prefersReducedMotion();

  if (!list.length) {
    const hasTiles = suggestions.querySelector("span[data-emoji]");
    const hint = suggestions.querySelector(".empty-hint");
    const next = emptyHintFor(phase, meta);
    const done = phase === "done";
    if (!hasTiles && hint && lastEmojiList && lastEmojiList.length === 0) {
      if (hint.textContent !== next) hint.textContent = next;
      hint.classList.toggle("is-done", done);
      return;
    }
    suggestions.replaceChildren();
    const p = document.createElement("p");
    p.className = done ? "empty-hint is-done" : "empty-hint";
    p.textContent = next;
    suggestions.appendChild(p);
    lastEmojiList = [];
    return;
  }

  const existing = suggestions.querySelectorAll("span[data-emoji]");
  if (sameEmojiList(list, lastEmojiList) && existing.length) {
    return;
  }

  const firstRects = new Map();
  const keep = new Map();
  for (const el of existing) {
    keep.set(el.dataset.emoji, el);
    firstRects.set(el, el.getBoundingClientRect());
  }

  const staleHint = suggestions.querySelector(".empty-hint");
  if (staleHint) staleHint.remove();

  const seen = new Set();
  const nextEls = [];

  for (const emoji of list) {
    if (seen.has(emoji)) continue;
    seen.add(emoji);
    let span = keep.get(emoji);
    const isEnter = !span;
    if (!span) span = createEmojiEl(emoji);
    else keep.delete(emoji);
    nextEls.push({ span, isEnter });
  }

  const exiting = [...keep.values()];

  if (!reduce && exiting.length) {
    const parentRect = suggestions.getBoundingClientRect();
    for (const el of exiting) {
      const r = firstRects.get(el);
      if (!r) continue;
      const ghost = el.cloneNode(true);
      ghost.removeAttribute("data-emoji");
      ghost.dataset.ghost = "1";
      ghost.classList.remove("emoji-enter", "is-copied");
      ghost.classList.add("emoji-exit");
      ghost.style.position = "absolute";
      ghost.style.left = `${r.left - parentRect.left}px`;
      ghost.style.top = `${r.top - parentRect.top}px`;
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      ghost.style.margin = "0";
      ghost.tabIndex = -1;
      ghost.setAttribute("aria-hidden", "true");
      suggestions.appendChild(ghost);
      setTimeout(() => ghost.remove(), 160);
    }
  }

  for (const el of exiting) el.remove();

  // In-place order/insert keeps element identity (no full grid flash).
  for (const { span } of nextEls) {
    suggestions.appendChild(span);
  }

  lastEmojiList = list.slice();

  if (reduce) {
    for (const { span, isEnter } of nextEls) {
      if (isEnter) span.classList.remove("emoji-enter");
    }
    return;
  }

  for (const { span, isEnter } of nextEls) {
    if (isEnter) {
      span.classList.remove("emoji-enter");
      void span.offsetWidth;
      span.classList.add("emoji-enter");
      continue;
    }
    const first = firstRects.get(span);
    if (!first) continue;
    const last = span.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      span.style.transform = "";
      span.style.transition = "";
      continue;
    }
    span.style.transition = "none";
    span.style.transform = `translate(${dx}px, ${dy}px)`;
    void span.offsetWidth;
    span.style.transition = "transform 160ms cubic-bezier(0.2, 0.7, 0.2, 1)";
    span.style.transform = "translate(0, 0)";
  }
}

let toastTimer = 0;

function showToast(text) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  // force layout so the enter transition runs
  void toast.offsetWidth;
  toast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-on");
    setTimeout(() => {
      toast.hidden = true;
    }, 160);
  }, 1400);
}

async function copyEmoji(emoji, span) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(emoji);
    } else {
      const ta = document.createElement("textarea");
      ta.value = emoji;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    showToast(`copied ${emoji}`);
    if (span) {
      span.classList.add("is-copied");
      setTimeout(() => span.classList.remove("is-copied"), 400);
    }
  } catch {
    showToast("copy failed");
  }
}

function paint({
  emojis,
  ratings,
  categories,
  pageSize,
  stats,
  note,
  completedPages,
  phase = "loading",
  batchCount = 0,
}) {
  renderEmojis(emojis, phase, { batchCount });
  renderStats(stats, note);
  renderDetail(
    {
      categories,
      pageSize,
      emojiRatings: detailForEmojis(emojis, ratings),
    },
    note,
    completedPages
  );
}

async function runSuggest() {
  const info = normalizeInput(input.value);
  if (!info.trimmed || busy) return;
  busy = true;
  updateChrome();
  setStatus("Scoring categories…");
  renderEmojis([], "loading");
  lastEmojiList = [];
  renderStats(null);
  renderDetail(null);

  const text = info.text;
  const statParts = [];
  const ratings = [];

  try {
    const cats = await fetchCategories(text);
    if (cats?.error) {
      setStatus(cats.error.message || "Failed", true);
      if (cats.stats) renderStats(cats.stats);
      renderEmojis([], "done", { batchCount: 0 });
      return;
    }
    if (cats.stats) statParts.push(cats.stats);

    const categories = cats.categories || [];
    const pageSize = cats.pageSize || 80;
    const jobs = batchJobs(categories, pageSize);
    const batchCount = jobs.length;
    // Finished or not: empty OUTPUT must not say "awaiting" once categories are known.
    const emptyPhase = batchCount ? "loading" : "done";

    paint({
      emojis: [],
      ratings,
      categories,
      pageSize,
      stats: mergeStats(statParts),
      note: "",
      completedPages: 0,
      phase: emptyPhase,
      batchCount,
    });
    setStatus(batchCount ? `${batchCount} pages…` : "No categories selected");

    let completedPages = 0;
    let failed = null;

    const rerender = () => {
      const emojis = pickEmojisFromRatings(ratings);
      const finished = completedPages >= batchCount;
      paint({
        emojis,
        ratings,
        categories,
        pageSize,
        stats: mergeStats(statParts.length ? statParts : [emptyStats()]),
        note: "",
        completedPages,
        phase: finished ? "done" : "loading",
        batchCount,
      });
      if (!finished) {
        setStatus(`${completedPages}/${batchCount} pages`);
      }
      return emojis;
    };

    await Promise.all(
      jobs.map((job) =>
        fetchEmojiBatch(text, job.category, job.categoryScore, job.page, job.pageSize)
          .then((payload) => {
            if (payload?.error) {
              failed = payload;
            } else {
              if (payload?.stats) statParts.push(payload.stats);
              for (const row of payload?.ratings || []) {
                ratings.push({
                  emoji: row.emoji,
                  emojiScore: row.emojiScore,
                  categoryScore: job.categoryScore,
                  category: job.category,
                });
              }
            }
            completedPages += 1;
            rerender();
          })
          .catch((err) => {
            failed = failed || {
              error: { code: "upstream", message: err?.message || "Batch failed" },
            };
            completedPages += 1;
            rerender();
          })
      )
    );

    const emojis = pickEmojisFromRatings(ratings);
    const stats = mergeStats(statParts.length ? statParts : [emptyStats()]);

    paint({
      emojis,
      ratings,
      categories,
      pageSize,
      stats,
      note: "",
      completedPages,
      phase: "done",
      batchCount,
    });

    if (!emojis.length && failed) {
      setStatus(failed.error.message || "Failed", true);
    } else if (!emojis.length) {
      setStatus(
        batchCount
          ? "No matches · nothing scored above 2"
          : "No categories selected",
        false
      );
    } else {
      setStatus(`Done · ${emojis.length} emojis`);
    }
  } catch (err) {
    setStatus(err?.message || "Failed", true);
    renderEmojis([], "done", { batchCount: 0 });
  } finally {
    busy = false;
    updateChrome();
  }
}

input.addEventListener("input", updateChrome);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runSuggest();
  }
});
button.addEventListener("click", runSuggest);
updateChrome();
