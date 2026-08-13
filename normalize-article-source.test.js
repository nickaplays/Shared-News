import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  feedsFromSourcesDoc,
  matchFeed,
  normalizeArticle,
  normalizeArticles,
} from "./normalize-article-source.js"

const feeds = feedsFromSourcesDoc({
  feeds: [
    { id: "ollama-blog", label: "Ollama", engine: "ollama", kind: "rss" },
    { id: "openai-news", label: "OpenAI", engine: "openai", kind: "rss" },
    { id: "anthropic-news", label: "Anthropic", engine: "anthropic", kind: "rss" },
    { id: "deepmind-blog", label: "Google Gemini", engine: "gemini", kind: "rss" },
    {
      id: "simon-willison-llm-release",
      label: "Simon Willison",
      engine: "roundup",
      kind: "rss",
    },
    {
      id: "youtube-matthew-berman",
      label: "Matthew Berman",
      engine: "roundup",
      kind: "youtube",
    },
    {
      id: "youtube-paul-j-lipsky",
      label: "Paul J Lipsky",
      engine: "roundup",
      kind: "youtube",
    },
  ],
})

describe("matchFeed", () => {
  it("keeps a valid sourceId", () => {
    const feed = matchFeed(
      { url: "https://openai.com/x", sourceId: "openai-news", source: "OpenAI" },
      feeds,
    )
    assert.equal(feed?.id, "openai-news")
  })

  it("matches legacy label-only rows", () => {
    assert.equal(
      matchFeed(
        { url: "https://www.youtube.com/watch?v=abc", source: "Matthew Berman" },
        feeds,
      )?.id,
      "youtube-matthew-berman",
    )
  })

  it("matches by publisher host", () => {
    assert.equal(
      matchFeed(
        { url: "https://openai.com/index/hello", source: "OpenAI", engine: "openai" },
        feeds,
      )?.id,
      "openai-news",
    )
    assert.equal(
      matchFeed(
        { url: "https://simonwillison.net/2026/Aug/10/x", engine: "roundup" },
        feeds,
      )?.id,
      "simon-willison-llm-release",
    )
  })

  it("uses unique engine when label/host are missing", () => {
    assert.equal(
      matchFeed({ url: "https://example.com/x", engine: "ollama" }, feeds)?.id,
      "ollama-blog",
    )
  })

  it("does not collapse roundup engine to a single feed", () => {
    assert.equal(
      matchFeed({ url: "https://example.com/x", engine: "roundup" }, feeds),
      null,
    )
  })
})

describe("normalizeArticle", () => {
  it("rewrites source fields from the matched feed", () => {
    const { matched, article } = normalizeArticle(
      {
        url: "https://openai.com/index/a",
        source: "OpenAI",
        engine: "openai",
        category: "roundup",
      },
      feeds,
    )
    assert.equal(matched, true)
    assert.equal(article.sourceId, "openai-news")
    assert.equal(article.source, "OpenAI")
    assert.equal(article.engine, "openai")
    assert.equal(article.category, "rss")
  })
})

describe("normalizeArticles", () => {
  it("reports unmatched rows", () => {
    const { matched, unmatched, articles } = normalizeArticles(
      [
        { url: "https://openai.com/a", source: "OpenAI" },
        { url: "https://unknown.example/a", source: "Mystery" },
      ],
      feeds,
    )
    assert.equal(matched, 1)
    assert.equal(unmatched, 1)
    assert.equal(articles[0].sourceId, "openai-news")
    assert.equal(articles[1].sourceId, undefined)
  })
})
