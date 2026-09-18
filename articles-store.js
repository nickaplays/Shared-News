import { readFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_INSERT_MAX_AGE_DAYS,
  shouldInsertArticle,
} from "./article-insert-gate.js";
import { preferLargeImageUrl } from "./article-media.js";
import { normalizeUrl } from "./normalize-url.js";

export const DEFAULT_MAX_RETAIN = 500;
export const DEFAULT_MIN_PER_SOURCE = 15;

/**
 * @typedef {Object} Article
 * @property {string} url
 * @property {string} title
 * @property {string} date
 * @property {string} source
 * @property {string} sourceId
 * @property {string} engine
 * @property {string} summary
 * @property {string[]} tags
 * @property {string} category
 * @property {string} processedAt
 */

/**
 * @param {string} filePath
 * @returns {Promise<Article[]>}
 */
export async function readArticlesJsonl(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const articles = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      articles.push(JSON.parse(trimmed));
    } catch {
      // skip corrupt JSONL lines
    }
  }
  return articles;
}

/**
 * @param {string} filePath
 * @param {Article[]} articles
 * @returns {Promise<void>}
 */
export async function writeArticlesJsonl(filePath, articles) {
  const body = articles.map((article) => JSON.stringify(article)).join("\n");
  await writeFile(filePath, body ? `${body}\n` : "", "utf8");
}

/**
 * Keep protected articles plus the newest evictable articles up to maxRetain,
 * while preserving minPerSource per sourceId among evictable articles.
 * When per-source floors exceed the effective evictable cap, floors win.
 *
 * @param {Article[]} articles
 * @param {{
 *   maxRetain?: number,
 *   minPerSource?: number,
 *   byUrl?: Record<string, { read?: boolean, starred?: boolean }>,
 * }} options
 * @returns {{ articles: Article[], evicted: Article[] }}
 */
export function applyRetainPolicy(
  articles,
  {
    maxRetain = DEFAULT_MAX_RETAIN,
    minPerSource = DEFAULT_MIN_PER_SOURCE,
    byUrl = {},
  } = {},
) {
  const protectedArticles = [];
  const evictable = [];
  for (const article of articles) {
    const state = byUrl[normalizeUrl(article.url)];
    if (!state || state.read !== true || state.starred === true) {
      protectedArticles.push(article);
    } else {
      evictable.push(article);
    }
  }

  const sortNewest = (items) =>
    [...items].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (protectedArticles.length + evictable.length <= maxRetain) {
    return { articles: sortNewest(articles), evicted: [] };
  }

  if (protectedArticles.length > maxRetain) {
    return {
      articles: sortNewest(protectedArticles),
      evicted: sortNewest(evictable),
    };
  }

  const effectiveCap = Math.max(0, maxRetain - protectedArticles.length);
  const sorted = sortNewest(evictable);
  const bySource = new Map();
  for (const article of sorted) {
    const sourceId = String(article.sourceId ?? "");
    if (!bySource.has(sourceId)) {
      bySource.set(sourceId, []);
    }
    bySource.get(sourceId).push(article);
  }

  const kept = new Map();
  for (const items of bySource.values()) {
    for (const article of items.slice(0, minPerSource)) {
      kept.set(normalizeUrl(article.url), article);
    }
  }

  if (kept.size < effectiveCap) {
    for (const article of sorted) {
      if (kept.size >= effectiveCap) {
        break;
      }
      const key = normalizeUrl(article.url);
      if (!kept.has(key)) {
        kept.set(key, article);
      }
    }
  }

  const keptEvictable = Array.from(kept.values());
  const keptSet = new Set(keptEvictable);
  return {
    articles: sortNewest([...protectedArticles, ...keptEvictable]),
    evicted: evictable.filter((article) => !keptSet.has(article)),
  };
}

/**
 * @param {Article[]} existing
 * @param {Article[]} incoming
 * @param {{
 *   maxNew?: number,
 *   maxRetain?: number,
 *   minPerSource?: number,
 *   applyRetain?: boolean,
 *   seenByUrl?: Record<string, unknown>,
 *   seeded?: boolean,
 *   maxAgeDays?: number,
 *   nowMs?: number,
 * }} limits
 * @returns {{
 *   articles: Article[],
 *   inserted: number,
 *   updated: number,
 *   considered: number,
 *   skippedSeen: number,
 *   skippedAge: number,
 * }}
 */
export function upsertArticles(
  existing,
  incoming,
  {
    maxNew,
    maxRetain = DEFAULT_MAX_RETAIN,
    minPerSource = DEFAULT_MIN_PER_SOURCE,
    applyRetain = true,
    seenByUrl = {},
    seeded = false,
    maxAgeDays = DEFAULT_INSERT_MAX_AGE_DAYS,
    nowMs = Date.now(),
  },
) {
  const insertLimit =
    maxNew === undefined || maxNew === null
      ? Number.POSITIVE_INFINITY
      : maxNew;
  const byUrl = new Map();
  for (const article of existing) {
    byUrl.set(normalizeUrl(article.url), article);
  }

  let inserted = 0;
  let updated = 0;
  let skippedSeen = 0;
  let skippedAge = 0;
  const considered = incoming.length;

  for (const article of incoming) {
    const normalizedUrl = normalizeUrl(article.url);
    const prev = byUrl.get(normalizedUrl);
    if (prev) {
      const next = { ...prev };
      let changed = false;
      const prevSummary = String(prev.summary ?? "").trim();
      const nextSummary = String(article.summary ?? "").trim();
      if (!prevSummary && nextSummary) {
        next.summary = article.summary;
        changed = true;
      }
      if (!prev.imageUrl && article.imageUrl) {
        next.imageUrl = article.imageUrl;
        changed = true;
      }
      if (prev.imageUrl) {
        const preferred = preferLargeImageUrl(prev.imageUrl);
        if (
          typeof preferred === "string" &&
          preferred !== prev.imageUrl
        ) {
          next.imageUrl = preferred;
          changed = true;
        }
      }
      if (changed) {
        byUrl.set(normalizedUrl, next);
        updated += 1;
      }
      continue;
    }
    const gate = shouldInsertArticle(article, {
      seenByUrl,
      seeded,
      maxAgeDays,
      nowMs,
    });
    if (!gate.insert) {
      if (gate.reason === "seen") {
        skippedSeen += 1;
      } else if (gate.reason === "age") {
        skippedAge += 1;
      }
      continue;
    }
    if (inserted >= insertLimit) {
      continue;
    }
    const stored = { ...article, url: normalizedUrl };
    if (!stored.imageUrl) {
      delete stored.imageUrl;
    }
    byUrl.set(normalizedUrl, stored);
    inserted += 1;
  }

  let articles = Array.from(byUrl.values());
  if (applyRetain) {
    const retained = applyRetainPolicy(articles, {
      maxRetain,
      minPerSource,
      byUrl: {},
    });
    articles = retained.articles;
  } else {
    articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  return {
    articles,
    inserted,
    updated,
    considered,
    skippedSeen,
    skippedAge,
  };
}
