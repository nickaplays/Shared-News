#!/usr/bin/env node

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Parser from "rss-parser";
import {
  readArticlesJsonl,
  writeArticlesJsonl,
  upsertArticles,
} from "./articles-store.js";

const MAX_SUMMARY_LENGTH = 500;
const DEFAULT_FEED_TIMEOUT_MS = 20_000;
const parser = new Parser();

async function fetchDefaultFeed(url, _feed, { signal } = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": "Gemini-Twins-Shared-News/1.0",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }
  return parser.parseString(await response.text());
}

async function readUserStateMtime(filePath) {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function itemDate(item, fallback) {
  const value = item.isoDate ?? item.pubDate ?? item.date;
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function itemSummary(item) {
  const value =
    item.contentSnippet ??
    item.summary ??
    item.content ??
    item.description ??
    "";
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH);
}

function toArticle(item, feed, processedAt) {
  const url = item.link ?? item.url ?? item.guid ?? item.id;
  if (!url) {
    return null;
  }
  return {
    url: String(url),
    title: String(item.title ?? "Untitled"),
    date: itemDate(item, processedAt),
    source: String(feed.label ?? feed.id),
    sourceId: String(feed.id),
    engine: String(feed.engine ?? "roundup"),
    summary: itemSummary(item),
    tags: [],
    category: String(feed.kind),
    processedAt,
  };
}

async function writeLastRun(newsDir, value) {
  await writeFile(
    path.join(newsDir, "last-run.json"),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function fetchFeedWithTimeout(fetchFeed, feed, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      fetchFeed(feed.url, feed, { signal: controller.signal }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/**
 * Fetch enabled feeds and upsert passthrough articles into the shared vault.
 *
 * @param {{
 *   newsDir: string,
 *   fetchFeed?: (url: string, feed: object, options?: {signal: AbortSignal}) => Promise<{items?: object[]}>,
 *   feedTimeoutMs?: number
 * }} options
 */
export async function runIngest({
  newsDir,
  fetchFeed = fetchDefaultFeed,
  feedTimeoutMs = DEFAULT_FEED_TIMEOUT_MS,
}) {
  if (!newsDir || !path.isAbsolute(newsDir)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }

  const startedAt = new Date().toISOString();
  const userStatePath = path.join(newsDir, "user-state.json");
  const userStateMtimeBefore = await readUserStateMtime(userStatePath);
  let feedsAttempted = 0;
  let feedsSucceeded = 0;
  let articlesConsidered = 0;

  try {
    const sources = JSON.parse(
      await readFile(path.join(newsDir, "sources.json"), "utf8"),
    );
    const feeds = Array.isArray(sources.feeds)
      ? sources.feeds.filter((feed) => feed.enabled)
      : [];
    const processedAt = new Date().toISOString();
    const candidates = [];
    const feedFailures = [];

    for (const feed of feeds) {
      feedsAttempted += 1;
      try {
        const parsed = await fetchFeedWithTimeout(
          fetchFeed,
          feed,
          feedTimeoutMs,
        );
        feedsSucceeded += 1;
        for (const item of parsed?.items ?? []) {
          const article = toArticle(item, feed, processedAt);
          if (article) {
            candidates.push(article);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        feedFailures.push(`${feed.id}: ${message}`);
        console.error(`Shared News feed "${feed.id}" failed: ${message}`);
      }
    }

    candidates.sort((a, b) => new Date(b.date) - new Date(a.date));
    const articlesPath = path.join(newsDir, "articles.jsonl");
    const existing = await readArticlesJsonl(articlesPath);
    const result = upsertArticles(existing, candidates, {
      maxNew: 8,
      maxRetain: 200,
    });
    articlesConsidered = result.considered;
    const allFeedsFailed = feedsAttempted > 0 && feedsSucceeded === 0;
    if (!allFeedsFailed) {
      await writeArticlesJsonl(articlesPath, result.articles);
    }

    const userStateMtimeAfter = await readUserStateMtime(userStatePath);
    if (userStateMtimeAfter !== userStateMtimeBefore) {
      throw new Error("user-state.json changed during ingest");
    }

    const failedFeeds = feedFailures.map((entry) => {
      const sep = entry.indexOf(": ");
      return {
        id: sep === -1 ? entry : entry.slice(0, sep),
        error: sep === -1 ? entry : entry.slice(sep + 2),
      };
    });
    const ok = feedsSucceeded > 0 || feedsAttempted === 0;
    const lastRun = {
      startedAt,
      finishedAt: new Date().toISOString(),
      ok,
      feedsAttempted,
      feedsSucceeded,
      articlesConsidered,
      articlesInserted: allFeedsFailed ? 0 : result.inserted,
      articlesUpdated: allFeedsFailed ? 0 : result.updated,
      failedFeeds,
      error: ok
        ? null
        : `All ${feedsAttempted} enabled feeds failed: ${feedFailures.join("; ")}`,
    };
    await writeLastRun(newsDir, lastRun);
    return lastRun;
  } catch (error) {
    const lastRun = {
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      feedsAttempted,
      feedsSucceeded,
      articlesConsidered,
      articlesInserted: 0,
      articlesUpdated: 0,
      failedFeeds: [],
      error: error instanceof Error ? error.message : String(error),
    };
    try {
      await writeLastRun(newsDir, lastRun);
    } catch {
      // Preserve the original ingest failure.
    }
    throw error;
  }
}

function cliNewsDir() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--dir="));
  return argument ? argument.slice("--dir=".length) : process.env.SHARED_NEWS_DIR;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runIngest({ newsDir: cliNewsDir() })
    .then((result) => {
      console.log(JSON.stringify(result));
      if (!result.ok) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
