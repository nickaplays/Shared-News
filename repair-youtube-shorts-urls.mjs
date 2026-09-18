#!/usr/bin/env node

/**
 * One-shot: rewrite short-duration YouTube watch URLs to /shorts/{id}
 * so the host Youtube Shorts filter works. Dedupes against existing shorts rows.
 *
 * Usage:
 *   YOUTUBE_API_KEY=… node repair-youtube-shorts-urls.mjs --profile=personal
 *   node repair-youtube-shorts-urls.mjs --dir=/abs/store --dry-run
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readArticlesJsonl,
  writeArticlesJsonl,
} from "./articles-store.js";
import { repairWatchUrlsToShorts, youtubeVideoIdFromUrl } from "./repair-youtube-shorts-urls.js";
import { resolveNewsDir } from "./resolve-news-dir.js";
import { fetchVideoDurationsSeconds } from "./youtube-feed.js";

export function parseRepairYoutubeShortsArgs(argv) {
  const values = Object.fromEntries(
    argv
      .filter((value) => value.startsWith("--") && value.includes("="))
      .map((value) => {
        const separator = value.indexOf("=");
        return [value.slice(2, separator), value.slice(separator + 1)];
      }),
  );
  const flags = new Set(argv.filter((v) => v.startsWith("--") && !v.includes("=")));
  const args = { dryRun: flags.has("--dry-run") };
  if (values.dir !== undefined) args.newsDir = values.dir;
  if (values.profile !== undefined) args.profile = values.profile;
  return args;
}

/**
 * @param {{
 *   newsDir: string,
 *   apiKey?: string,
 *   dryRun?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function repairYoutubeShortsUrls({
  newsDir,
  apiKey = process.env.YOUTUBE_API_KEY,
  dryRun = false,
  fetchImpl = globalThis.fetch,
}) {
  if (!newsDir || !path.isAbsolute(newsDir)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("YOUTUBE_API_KEY is not set");
  }

  const articlesPath = path.join(newsDir, "articles.jsonl");
  const userStatePath = path.join(newsDir, "user-state.json");
  const articles = await readArticlesJsonl(articlesPath);

  let userState = { byUrl: {} };
  try {
    userState = JSON.parse(await readFile(userStatePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const byUrl =
    userState.byUrl && typeof userState.byUrl === "object"
      ? userState.byUrl
      : {};

  const videoIds = [
    ...new Set(
      articles
        .map((a) => youtubeVideoIdFromUrl(a.url))
        .filter(Boolean),
    ),
  ];
  const durationMap = await fetchVideoDurationsSeconds({
    videoIds,
    apiKey,
    fetchImpl,
  });
  /** @type {Record<string, number | null>} */
  const durationsByVideoId = Object.fromEntries(durationMap);

  const result = repairWatchUrlsToShorts(articles, byUrl, durationsByVideoId);

  if (!dryRun && (result.rewritten > 0 || result.deduped > 0)) {
    await writeArticlesJsonl(articlesPath, result.articles);
    await writeFile(
      userStatePath,
      `${JSON.stringify(
        {
          ...userState,
          byUrl: result.byUrl,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }

  return {
    storeDir: newsDir,
    dryRun,
    considered: articles.length,
    videoIds: videoIds.length,
    rewritten: result.rewritten,
    deduped: result.deduped,
    articlesRemaining: result.articles.length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = parseRepairYoutubeShortsArgs(process.argv.slice(2));
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
    repairYoutubeShortsUrls({
      newsDir: resolved.storeDir,
      dryRun: args.dryRun,
    })
      .then((result) => {
        console.log(JSON.stringify(result));
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
