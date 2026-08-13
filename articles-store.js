import { readFile, writeFile } from "node:fs/promises";
import { normalizeUrl } from "./normalize-url.js";

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
 * @param {Article[]} existing
 * @param {Article[]} incoming
 * @param {{ maxNew: number, maxRetain: number }} limits
 * @returns {{ articles: Article[], inserted: number, updated: number, considered: number }}
 */
export function upsertArticles(existing, incoming, { maxNew, maxRetain }) {
  const byUrl = new Map();
  for (const article of existing) {
    byUrl.set(normalizeUrl(article.url), article);
  }

  let inserted = 0;
  let updated = 0;
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
      if (changed) {
        byUrl.set(normalizedUrl, next);
        updated += 1;
      }
      continue;
    }
    if (inserted >= maxNew) {
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
  articles.sort((a, b) => new Date(b.date) - new Date(a.date));
  if (articles.length > maxRetain) {
    articles = articles.slice(0, maxRetain);
  }

  return { articles, inserted, updated, considered };
}
