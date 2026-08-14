#!/usr/bin/env node
/**
 * Rewrite shared/news/articles.jsonl so every matched row has a canonical
 * sourceId / source / engine / category from sources.json.
 *
 * Usage:
 *   node normalize-sources.mjs [--dry-run] [--profile=work|personal] [--news-dir PATH]
 */

import { copyFile, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readArticlesJsonl, writeArticlesJsonl } from "./articles-store.js"
import {
  feedsFromSourcesDoc,
  normalizeArticles,
} from "./normalize-article-source.js"
import { resolveNewsDir } from "./resolve-news-dir.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  let dryRun = false
  let profile
  let dir
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--dry-run") dryRun = true
    else if (arg === "--news-dir") {
      dir = argv[i + 1]
      i += 1
    } else if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length)
    }
  }
  const resolved = resolveNewsDir({
    newsRoot:
      process.env.SHARED_NEWS_DIR?.trim() ||
      "/Users/nickadenton/NKA/Obsidian/Automation-Projects/Nicka-Notes/shared/news",
    profile,
    dir,
  })
  return { dryRun, newsDir: resolved.storeDir, profile: resolved.profile }
}

async function main() {
  const { dryRun, newsDir } = parseArgs(process.argv.slice(2))
  const sourcesPath = path.join(newsDir, "sources.json")
  const articlesPath = path.join(newsDir, "articles.jsonl")

  const sourcesDoc = JSON.parse(await readFile(sourcesPath, "utf8"))
  const feeds = feedsFromSourcesDoc(sourcesDoc)
  const existing = await readArticlesJsonl(articlesPath)
  const { articles, matched, unmatched } = normalizeArticles(existing, feeds)

  const changed = articles.filter((article, index) => {
    const before = existing[index]
    return (
      before.sourceId !== article.sourceId ||
      before.source !== article.source ||
      before.engine !== article.engine ||
      before.category !== article.category
    )
  }).length

  console.log(
    JSON.stringify(
      {
        newsDir,
        feeds: feeds.length,
        articles: articles.length,
        matched,
        unmatched,
        changed,
        dryRun,
      },
      null,
      2,
    ),
  )

  if (unmatched > 0) {
    const samples = articles
      .filter((article) => !feeds.some((feed) => feed.id === article.sourceId))
      .slice(0, 10)
      .map((article) => ({
        url: article.url,
        source: article.source,
        engine: article.engine,
        sourceId: article.sourceId,
      }))
    console.error("Unmatched samples:", JSON.stringify(samples, null, 2))
  }

  if (dryRun) return

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = path.join(newsDir, `articles.jsonl.bak-${stamp}`)
  await copyFile(articlesPath, backupPath)
  await writeArticlesJsonl(articlesPath, articles)
  console.log(`Wrote ${articlesPath}`)
  console.log(`Backup ${backupPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
