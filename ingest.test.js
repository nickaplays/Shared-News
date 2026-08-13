import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseIngestArgs, runIngest } from "./ingest.mjs";
import { normalizeUrl } from "./normalize-url.js";
import {
  readArticlesJsonl,
  writeArticlesJsonl,
  upsertArticles,
} from "./articles-store.js";

describe("normalizeUrl", () => {
  test("strips fragment and trailing slash", () => {
    assert.equal(
      normalizeUrl("https://Example.com/Post/?utm_source=1#x"),
      "https://example.com/Post",
    );
  });
});

describe("upsertArticles", () => {
  test("inserts new urls and skips duplicates", () => {
    const existing = [
      {
        url: "https://a.example/1",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const incoming = [
      { ...existing[0], title: "A-updated" },
      {
        url: "https://a.example/2",
        title: "B",
        date: "2026-01-02T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "snippet",
        tags: [],
        category: "rss",
        processedAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const result = upsertArticles(existing, incoming, {
      maxNew: 8,
      maxRetain: 200,
    });
    assert.equal(result.inserted, 1);
    assert.equal(result.articles.length, 2);
    assert.equal(
      result.articles.find((a) => a.url === "https://a.example/1").title,
      "A",
    );
  });

  test("treats normalized URL variants as duplicates", () => {
    const existing = [
      {
        url: "https://A.example/1/",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const incoming = [
      {
        url: "https://a.example/1",
        title: "B",
        date: "2026-01-02T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const result = upsertArticles(existing, incoming, {
      maxNew: 8,
      maxRetain: 200,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.articles.length, 1);
  });

  test("respects maxNew and maxRetain", () => {
    const existing = [];
    const incoming = Array.from({ length: 10 }, (_, i) => ({
      url: `https://a.example/${i}`,
      title: `T${i}`,
      date: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      source: "T",
      sourceId: "t",
      engine: "roundup",
      summary: "",
      tags: [],
      category: "rss",
      processedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const result = upsertArticles(existing, incoming, {
      maxNew: 8,
      maxRetain: 5,
    });
    assert.equal(result.inserted, 8);
    assert.equal(result.articles.length, 5);
  });
});

describe("jsonl round-trip", () => {
  test("write and read preserves lines", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-"));
    const file = path.join(dir, "articles.jsonl");
    const articles = [
      {
        url: "https://a.example/1",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "s",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    await writeArticlesJsonl(file, articles);
    const read = await readArticlesJsonl(file);
    assert.deepEqual(read, articles);
    const raw = await readFile(file, "utf8");
    assert.ok(raw.trim().split("\n").length === 1);
  });
});

describe("parseIngestArgs", () => {
  test("reads feed-id, max-new, max-retain, and dir", () => {
    assert.deepEqual(
      parseIngestArgs([
        "--dir=/tmp/shared-news",
        "--feed-id=openai-news",
        "--max-new=10",
        "--max-retain=150",
      ]),
      {
        newsDir: "/tmp/shared-news",
        feedId: "openai-news",
        maxNew: 10,
        maxRetain: 150,
      },
    );
  });

  test("uses default article limits", () => {
    assert.deepEqual(parseIngestArgs([]), {
      maxNew: 8,
      maxRetain: 200,
    });
  });
});

describe("runIngest", () => {
  test("ingests enabled feeds newest-first without touching user state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-ingest-"));
    const userStatePath = path.join(dir, "user-state.json");
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "disabled",
            label: "Disabled",
            engine: "roundup",
            kind: "rss",
            url: "https://feeds.example/disabled",
            enabled: false,
          },
          {
            id: "test-feed",
            label: "Test Feed",
            engine: "ollama",
            kind: "rss",
            url: "https://feeds.example/test",
            enabled: true,
          },
        ],
      }),
    );
    await writeFile(userStatePath, '{"version":1,"byUrl":{}}\n');
    const before = await stat(userStatePath);
    const requested = [];

    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async (url) => {
        requested.push(url);
        return {
          items: [
            {
              title: "Older",
              link: "https://example.com/older/?utm_source=test#fragment",
              isoDate: "2026-08-10T00:00:00.000Z",
              contentSnippet: "Old snippet",
            },
            {
              title: "Newer",
              link: "https://example.com/newer",
              pubDate: "Tue, 11 Aug 2026 00:00:00 GMT",
              content: "x".repeat(600),
            },
          ],
        };
      },
    });

    assert.deepEqual(requested, ["https://feeds.example/test"]);
    assert.equal(result.ok, true);
    assert.equal(result.mode, "full");
    assert.equal(result.feedId, null);
    assert.equal(result.articlesInserted, 2);
    const articles = await readArticlesJsonl(path.join(dir, "articles.jsonl"));
    assert.equal(articles.length, 2);
    assert.equal(articles[0].title, "Newer");
    assert.equal(articles[0].summary.length, 500);
    assert.equal(articles[0].category, "rss");
    assert.equal(articles[0].sourceId, "test-feed");
    assert.deepEqual(articles[0].tags, []);
    assert.equal(articles[1].url, "https://example.com/older");
    const lastRun = JSON.parse(
      await readFile(path.join(dir, "last-run.json"), "utf8"),
    );
    assert.equal(lastRun.feedsAttempted, 1);
    assert.equal(lastRun.feedsSucceeded, 1);
    assert.equal(lastRun.mode, "full");
    assert.equal(lastRun.feedId, null);
    assert.equal(lastRun.articlesConsidered, 2);
    assert.equal(lastRun.error, null);
    const after = await stat(userStatePath);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  test("continues ingest when one feed fails", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-partial-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "broken",
            label: "Broken",
            engine: "roundup",
            kind: "rss",
            url: "https://feeds.example/broken",
            enabled: true,
          },
          {
            id: "working",
            label: "Working",
            engine: "roundup",
            kind: "rss",
            url: "https://feeds.example/working",
            enabled: true,
          },
        ],
      }),
    );

    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async (_url, feed) => {
        if (feed.id === "broken") {
          throw new Error("Status code 500");
        }
        return {
          items: [
            {
              title: "Working article",
              link: "https://example.com/working",
              isoDate: "2026-08-11T00:00:00.000Z",
            },
          ],
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.feedsAttempted, 2);
    assert.equal(result.feedsSucceeded, 1);
    assert.ok(result.articlesInserted > 0);
    assert.deepEqual(result.failedFeeds, [
      { id: "broken", error: "Status code 500" },
    ]);
    const articles = await readArticlesJsonl(path.join(dir, "articles.jsonl"));
    assert.equal(articles.length, 1);
  });

  test("with feedId only fetches that enabled feed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-single-feed-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "first",
            label: "First",
            kind: "rss",
            url: "https://feeds.example/first",
            enabled: true,
          },
          {
            id: "second",
            label: "Second",
            kind: "rss",
            url: "https://feeds.example/second",
            enabled: true,
          },
        ],
      }),
    );
    const requested = [];

    const result = await runIngest({
      newsDir: dir,
      feedId: "second",
      fetchFeed: async (url) => {
        requested.push(url);
        return { items: [] };
      },
    });

    assert.deepEqual(requested, ["https://feeds.example/second"]);
    assert.equal(result.mode, "feed");
    assert.equal(result.feedId, "second");
    const lastRun = JSON.parse(
      await readFile(path.join(dir, "last-run.json"), "utf8"),
    );
    assert.equal(lastRun.mode, "feed");
    assert.equal(lastRun.feedId, "second");
  });

  test("with unknown feedId fails without writing articles", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-unknown-feed-"));
    const articlesPath = path.join(dir, "articles.jsonl");
    const original = '{"url":"https://example.com/existing"}\n';
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "known",
            label: "Known",
            kind: "rss",
            url: "https://feeds.example/known",
            enabled: true,
          },
        ],
      }),
    );
    await writeFile(articlesPath, original);

    await assert.rejects(
      runIngest({
        newsDir: dir,
        feedId: "missing",
        fetchFeed: async () => {
          throw new Error("must not fetch");
        },
      }),
      /missing/,
    );

    assert.equal(await readFile(articlesPath, "utf8"), original);
    const lastRun = JSON.parse(
      await readFile(path.join(dir, "last-run.json"), "utf8"),
    );
    assert.equal(lastRun.ok, false);
    assert.equal(lastRun.mode, "feed");
    assert.equal(lastRun.feedId, "missing");
  });

  test("respects maxNew", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-max-new-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "many",
            label: "Many",
            kind: "rss",
            url: "https://feeds.example/many",
            enabled: true,
          },
        ],
      }),
    );

    const result = await runIngest({
      newsDir: dir,
      maxNew: 2,
      fetchFeed: async () => ({
        items: Array.from({ length: 5 }, (_, index) => ({
          title: `Article ${index}`,
          link: `https://example.com/${index}`,
          isoDate: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        })),
      }),
    });

    assert.equal(result.articlesInserted, 2);
    const articles = await readArticlesJsonl(path.join(dir, "articles.jsonl"));
    assert.equal(articles.length, 2);
  });

  test("records all-feed failure without replacing articles", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-failure-"));
    const articlesPath = path.join(dir, "articles.jsonl");
    const original = '{"url":"https://example.com/existing"}\n';
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "broken",
            label: "Broken",
            engine: "roundup",
            kind: "rss",
            url: "https://feeds.example/broken",
            enabled: true,
          },
        ],
      }),
    );
    await writeFile(articlesPath, original);

    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async () => {
        throw new Error("feed unavailable");
      },
    });

    assert.equal(await readFile(articlesPath, "utf8"), original);
    assert.equal(result.ok, false);
    assert.equal(result.feedsAttempted, 1);
    assert.equal(result.feedsSucceeded, 0);
    assert.match(result.error, /broken: feed unavailable/);
    const lastRun = JSON.parse(
      await readFile(path.join(dir, "last-run.json"), "utf8"),
    );
    assert.equal(lastRun.ok, false);
    assert.match(lastRun.error, /feed unavailable/);
    assert.deepEqual(lastRun.failedFeeds, [
      { id: "broken", error: "feed unavailable" },
    ]);
  });
});
