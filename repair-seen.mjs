#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { rebuildSeenFromArchives } from "./archive-store.js";
import { resolveNewsDir } from "./resolve-news-dir.js";

export function parseRepairSeenArgs(argv) {
  const values = Object.fromEntries(
    argv
      .filter((value) => value.startsWith("--") && value.includes("="))
      .map((value) => {
        const separator = value.indexOf("=");
        return [value.slice(2, separator), value.slice(separator + 1)];
      }),
  );
  const args = {};
  if (values.dir !== undefined) {
    args.newsDir = values.dir;
  }
  if (values.profile !== undefined) {
    args.profile = values.profile;
  }
  return args;
}

/**
 * Rescan archive month files and rewrite archive/seen.json.
 *
 * @param {{ newsDir: string }} options
 * @returns {Promise<{ urls: number, storeDir: string }>}
 */
export async function repairSeen({ newsDir }) {
  if (!newsDir || !path.isAbsolute(newsDir)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }
  const seen = await rebuildSeenFromArchives(newsDir);
  return {
    urls: Object.keys(seen.byUrl).length,
    storeDir: newsDir,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = parseRepairSeenArgs(process.argv.slice(2));
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
    repairSeen({ newsDir: resolved.storeDir })
      .then((result) => {
        console.log(JSON.stringify(result));
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
