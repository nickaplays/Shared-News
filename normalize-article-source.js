/**
 * Map shared-news articles onto canonical feeds from sources.json.
 * One article → one feed id (Feedly-style origin).
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   engine?: string,
 *   kind?: string,
 *   url?: string,
 *   enabled?: boolean
 * }} NewsFeed
 */

/**
 * @param {string | undefined | null} value
 */
function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

/**
 * @param {string} articleUrl
 */
function articleHost(articleUrl) {
  try {
    return new URL(String(articleUrl)).hostname.replace(/^www\./i, "").toLowerCase()
  } catch {
    return ""
  }
}

/**
 * Hostname → feed id for non-ambiguous publishers.
 * YouTube is matched by label (watch URLs lack channel id).
 */
const HOST_TO_FEED_ID = [
  { host: "ollama.com", id: "ollama-blog" },
  { host: "openai.com", id: "openai-news" },
  { host: "anthropic.com", id: "anthropic-news" },
  { host: "deepmind.google", id: "deepmind-blog" },
  { host: "blog.google", id: "deepmind-blog" },
  { host: "simonwillison.net", id: "simon-willison-llm-release" },
]

/**
 * @param {object} article
 * @param {NewsFeed[]} feeds
 * @returns {NewsFeed | null}
 */
export function matchFeed(article, feeds) {
  if (!Array.isArray(feeds) || feeds.length === 0) return null
  const byId = new Map(feeds.map((feed) => [feed.id, feed]))

  const sourceId = typeof article?.sourceId === "string" ? article.sourceId.trim() : ""
  if (sourceId && byId.has(sourceId)) {
    return byId.get(sourceId) ?? null
  }

  const label = norm(article?.source)
  if (label) {
    const byLabel = feeds.filter((feed) => norm(feed.label) === label)
    if (byLabel.length === 1) return byLabel[0]
  }

  const host = articleHost(article?.url)
  if (host) {
    for (const rule of HOST_TO_FEED_ID) {
      if (host === rule.host || host.endsWith(`.${rule.host}`)) {
        const feed = byId.get(rule.id)
        if (feed) return feed
      }
    }
  }

  const engine = norm(article?.engine)
  if (engine && engine !== "roundup") {
    const byEngine = feeds.filter((feed) => norm(feed.engine) === engine)
    if (byEngine.length === 1) return byEngine[0]
  }

  return null
}

/**
 * @param {object} article
 * @param {NewsFeed[]} feeds
 * @returns {{ article: object, matched: boolean, feed: NewsFeed | null }}
 */
export function normalizeArticle(article, feeds) {
  const feed = matchFeed(article, feeds)
  if (!feed) {
    return { article, matched: false, feed: null }
  }
  return {
    matched: true,
    feed,
    article: {
      ...article,
      sourceId: feed.id,
      source: feed.label,
      engine: feed.engine ?? article.engine,
      category: feed.kind ?? article.category,
    },
  }
}

/**
 * @param {object[]} articles
 * @param {NewsFeed[]} feeds
 */
export function normalizeArticles(articles, feeds) {
  let matched = 0
  let unmatched = 0
  const next = articles.map((article) => {
    const result = normalizeArticle(article, feeds)
    if (result.matched) matched += 1
    else unmatched += 1
    return result.article
  })
  return { articles: next, matched, unmatched }
}

/**
 * @param {object} sourcesDoc
 * @returns {NewsFeed[]}
 */
export function feedsFromSourcesDoc(sourcesDoc) {
  const feeds = sourcesDoc?.feeds
  if (!Array.isArray(feeds)) return []
  return feeds.filter(
    (feed) => feed && typeof feed.id === "string" && feed.id.trim(),
  )
}
