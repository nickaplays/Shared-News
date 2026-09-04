#!/usr/bin/env node

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Parser from "rss-parser";
import {
  applyRetainPolicy,
  DEFAULT_MAX_RETAIN,
  DEFAULT_MIN_PER_SOURCE,
  readArticlesJsonl,
  writeArticlesJsonl,
  upsertArticles,
} from "./articles-store.js";
import { extractImageUrl, extractSummary } from "./article-media.js";
import { pruneReadArticles } from "./prune-read.js";
import { resolveNewsDir } from "./resolve-news-dir.js";

const MAX_SUMMARY_LENGTH = 1500;
const DEFAULT_FEED_TIMEOUT_MS = 20_000;
const parser = new Parser({
  customFields: {
    item: [
      ["media:group", "mediaGroup"],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
    ],
  },
});

export function parseIngestArgs(argv) {
  const values = Object.fromEntries(
    argv
      .filter((value) => value.startsWith("--") && value.includes("="))
      .map((value) => {
        const separator = value.indexOf("=");
        return [value.slice(2, separator), value.slice(separator + 1)];
      }),
  );
  const args = {
    maxRetain:
      values["max-retain"] === undefined
        ? DEFAULT_MAX_RETAIN
        : Number(values["max-retain"]),
  };
  if (values["max-new"] !== undefined) {
    args.maxNew = Number(values["max-new"]);
  }
  if (values.dir !== undefined) {
    args.newsDir = values.dir;
  }
  if (values["feed-id"] !== undefined) {
    args.feedId = values["feed-id"];
  }
  if (values.profile !== undefined) {
    args.profile = values.profile;
  }
  return args;
}

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

function toArticle(item, feed, processedAt) {
  const url = item.link ?? item.url ?? item.guid ?? item.id;
  if (!url) {
    return null;
  }
  const imageUrl = extractImageUrl(item);
  const article = {
    url: String(url),
    title: String(item.title ?? "Untitled"),
    date: itemDate(item, processedAt),
    source: String(feed.label ?? feed.id),
    sourceId: String(feed.id),
    engine: String(feed.engine ?? "roundup"),
    summary: extractSummary(item, MAX_SUMMARY_LENGTH),
    tags: [],
    category: String(feed.kind),
    processedAt,
  };
  if (imageUrl) {
    article.imageUrl = imageUrl;
  }
  return article;
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
 *   feedTimeoutMs?: number,
 *   feedId?: string,
 *   maxNew?: number,
 *   maxRetain?: number,
 *   minPerSource?: number,
 *   profile?: "work" | "personal" | null
 * }} options
 */
export async function runIngest({
  newsDir,
  fetchFeed = fetchDefaultFeed,
  feedTimeoutMs = DEFAULT_FEED_TIMEOUT_MS,
  feedId,
  maxNew,
  maxRetain = DEFAULT_MAX_RETAIN,
  minPerSource = DEFAULT_MIN_PER_SOURCE,
  profile = null,
}) {
  if (!newsDir || !path.isAbsolute(newsDir)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }

  const startedAt = new Date().toISOString();
  const mode = feedId === undefined ? "full" : "feed";
  const selectedFeedId = feedId ?? null;
  const userStatePath = path.join(newsDir, "user-state.json");
  const userStateMtimeBefore = await readUserStateMtime(userStatePath);
  let feedsAttempted = 0;
  let feedsSucceeded = 0;
  let articlesConsidered = 0;

  try {
    let sourcesRaw;
    try {
      sourcesRaw = await readFile(path.join(newsDir, "sources.json"), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `News store not found: ${newsDir} (run migrate-profiles.mjs)`,
        );
      }
      throw error;
    }
    const sources = JSON.parse(sourcesRaw);
    const enabledFeeds = Array.isArray(sources.feeds)
      ? sources.feeds.filter((feed) => feed.enabled)
      : [];
    const feeds =
      feedId === undefined
        ? enabledFeeds
        : enabledFeeds.filter((feed) => feed.id === feedId);
    if (feedId !== undefined && feeds.length === 0) {
      throw new Error(`Enabled feed not found: ${feedId}`);
    }
    const processedAt = new Date().toISOString();
    const feedFailures = [];
    const articlesPath = path.join(newsDir, "articles.jsonl");
    let articles = await readArticlesJsonl(articlesPath);
    let articlesInserted = 0;
    let articlesUpdated = 0;

    for (const feed of feeds) {
      feedsAttempted += 1;
      try {
        const parsed = await fetchFeedWithTimeout(
          fetchFeed,
          feed,
          feedTimeoutMs,
        );
        feedsSucceeded += 1;
        const feedCandidates = [];
        for (const item of parsed?.items ?? []) {
          try {
            const article = toArticle(item, feed, processedAt);
            if (article) {
              feedCandidates.push(article);
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.error(
              `Shared News item skipped in feed "${feed.id}": ${message}`,
            );
          }
        }
        feedCandidates.sort((a, b) => new Date(b.date) - new Date(a.date));
        articlesConsidered += feedCandidates.length;
        const result = upsertArticles(articles, feedCandidates, {
          maxNew,
          applyRetain: false,
        });
        articles = result.articles;
        articlesInserted += result.inserted;
        articlesUpdated += result.updated;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        feedFailures.push(`${feed.id}: ${message}`);
        console.error(`Shared News feed "${feed.id}" failed: ${message}`);
      }
    }

    const allFeedsFailed = feedsAttempted > 0 && feedsSucceeded === 0;
    if (!allFeedsFailed) {
      articles = applyRetainPolicy(articles, { maxRetain, minPerSource });
    }

    // Concurrent Launchpad edits: fail before any prune writes.
    const userStateMtimeAfter = await readUserStateMtime(userStatePath);
    if (userStateMtimeAfter !== userStateMtimeBefore) {
      throw new Error("user-state.json changed during ingest");
    }

    let articlesPruned = 0;
    let userStatePruned = 0;
    if (!allFeedsFailed) {
      let userState;
      try {
        userState = JSON.parse(await readFile(userStatePath, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
        userState = { byUrl: {} };
      }
      const byUrl =
        userState.byUrl && typeof userState.byUrl === "object"
          ? userState.byUrl
          : {};
      const pruned = pruneReadArticles(articles, byUrl, {
        maxAgeDays: 30,
      });
      articlesPruned = pruned.articlesPruned;
      userStatePruned = pruned.userStatePruned;
      await writeArticlesJsonl(articlesPath, pruned.articles);
      if (articlesPruned > 0 || userStatePruned > 0) {
        await writeFile(
          userStatePath,
          `${JSON.stringify(
            {
              ...userState,
              byUrl: pruned.byUrl,
              updatedAt: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
        );
      }
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
      mode,
      feedId: selectedFeedId,
      profile: profile ?? null,
      feedsAttempted,
      feedsSucceeded,
      articlesConsidered,
      articlesInserted: allFeedsFailed ? 0 : articlesInserted,
      articlesUpdated: allFeedsFailed ? 0 : articlesUpdated,
      articlesPruned,
      userStatePruned,
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
      mode,
      feedId: selectedFeedId,
      profile: profile ?? null,
      feedsAttempted,
      feedsSucceeded,
      articlesConsidered,
      articlesInserted: 0,
      articlesUpdated: 0,
      articlesPruned: 0,
      userStatePruned: 0,
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = parseIngestArgs(process.argv.slice(2));
  let resolved;
  try {
    resolved = await resolveNewsDir({
      newsRoot: process.env.SHARED_NEWS_DIR,
      profile: args.profile,
      dir: args.newsDir,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  if (resolved) {
    runIngest({
      ...args,
      newsDir: resolved.storeDir,
      profile: resolved.profile,
    })
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
}
