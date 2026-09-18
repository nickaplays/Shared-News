import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseIngestArgs, runIngest } from "./ingest.mjs";
import { resolveNewsDir } from "./resolve-news-dir.js";
import { normalizeUrl } from "./normalize-url.js";
import {
  applyRetainPolicy,
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

  test("enriches missing imageUrl and empty summary without counting maxNew", () => {
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
        category: "youtube",
        processedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const incoming = [
      {
        ...existing[0],
        summary: "Filled from media",
        imageUrl: "https://i.ytimg.com/vi/x/hqdefault.jpg",
      },
    ];
    const result = upsertArticles(existing, incoming, {
      maxNew: 0,
      maxRetain: 200,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 1);
    const row = result.articles.find((a) => a.url === "https://a.example/1");
    assert.equal(row.summary, "Filled from media");
    assert.equal(row.imageUrl, "https://i.ytimg.com/vi/x/hqdefault.jpg");
  });

  test("does not overwrite non-empty summary or existing imageUrl", () => {
    const existing = [
      {
        url: "https://a.example/1",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "Keep me",
        imageUrl: "https://cdn.example/old.jpg",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const incoming = [
      {
        ...existing[0],
        summary: "New",
        imageUrl: "https://cdn.example/new.jpg",
      },
    ];
    const result = upsertArticles(existing, incoming, {
      maxNew: 8,
      maxRetain: 200,
    });
    assert.equal(result.updated, 0);
    const row = result.articles[0];
    assert.equal(row.summary, "Keep me");
    assert.equal(row.imageUrl, "https://cdn.example/old.jpg");
  });

  test("upgrades existing small imageUrl to large on re-ingest", () => {
    const existing = [
      {
        url: "https://a.example/1",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "Kept",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "https://images.pushsquare.com/abc/small.jpg",
      },
    ];
    const incoming = [
      {
        ...existing[0],
        imageUrl: "https://images.pushsquare.com/abc/large.jpg",
      },
    ];
    const result = upsertArticles(existing, incoming, {
      maxNew: 0,
      maxRetain: 200,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 1);
    const row = result.articles.find((a) => a.url === "https://a.example/1");
    assert.equal(
      row.imageUrl,
      "https://images.pushsquare.com/abc/large.jpg",
    );
    assert.equal(row.summary, "Kept");
  });

  test("upgrades small imageUrl even when incoming omits imageUrl", () => {
    const existing = [
      {
        url: "https://a.example/1",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "Kept",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "https://cdn.example/x/small.webp",
      },
    ];
    const incoming = [{ ...existing[0] }];
    delete incoming[0].imageUrl;
    const result = upsertArticles(existing, incoming, {
      maxNew: 0,
      maxRetain: 200,
    });
    assert.equal(result.updated, 1);
    const row = result.articles.find((a) => a.url === "https://a.example/1");
    assert.equal(row.imageUrl, "https://cdn.example/x/large.webp");
  });

  test("respects maxNew per batch", () => {
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
      applyRetain: false,
    });
    assert.equal(result.inserted, 8);
    assert.equal(result.articles.length, 8);
  });

  test("upsertArticles skips seen and age-gated urls", () => {
    const existing = [];
    const incoming = [
      {
        url: "https://example.com/seen",
        title: "S",
        date: "2026-09-17T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-09-18T00:00:00.000Z",
      },
      {
        url: "https://example.com/old",
        title: "O",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-09-18T00:00:00.000Z",
      },
      {
        url: "https://example.com/new",
        title: "N",
        date: "2026-09-17T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-09-18T00:00:00.000Z",
      },
    ];
    const result = upsertArticles(existing, incoming, {
      applyRetain: false,
      seeded: true,
      nowMs: Date.parse("2026-09-18T00:00:00.000Z"),
      seenByUrl: {
        "https://example.com/seen": { archiveFile: "2026-08.jsonl" },
      },
    });
    assert.equal(result.inserted, 1);
    assert.equal(result.skippedSeen, 1);
    assert.equal(result.skippedAge, 1);
    assert.equal(result.articles[0].url, "https://example.com/new");
  });

  test("applyRetainPolicy keeps a per-source floor", () => {
    const articles = [
      {
        url: "https://loud.example/1",
        title: "L1",
        date: "2026-08-10T00:00:00.000Z",
        source: "Loud",
        sourceId: "loud",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-08-10T00:00:00.000Z",
      },
      {
        url: "https://loud.example/2",
        title: "L2",
        date: "2026-08-09T00:00:00.000Z",
        source: "Loud",
        sourceId: "loud",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-08-09T00:00:00.000Z",
      },
      {
        url: "https://quiet.example/1",
        title: "Q1",
        date: "2026-08-01T00:00:00.000Z",
        source: "Quiet",
        sourceId: "quiet",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const byUrl = Object.fromEntries(
      articles.map((article) => [article.url, { read: true }]),
    );
    const { articles: retained, evicted } = applyRetainPolicy(articles, {
      maxRetain: 2,
      minPerSource: 1,
      byUrl,
    });
    assert.equal(retained.length, 2);
    assert.ok(retained.some((article) => article.sourceId === "quiet"));
    assert.equal(evicted.length, 1);
  });

  test("applyRetainPolicy never evicts unread or starred", () => {
    const byUrl = {
      "https://loud.example/1": {
        read: true,
        readAt: "2026-08-01T00:00:00.000Z",
      },
      "https://loud.example/2": {
        read: true,
        readAt: "2026-08-02T00:00:00.000Z",
      },
      "https://quiet.example/1": { read: false },
      "https://star.example/1": {
        read: true,
        readAt: "2026-01-01T00:00:00.000Z",
        starred: true,
      },
    };
    const articles = [
      {
        url: "https://loud.example/1",
        title: "L1",
        date: "2026-08-10T00:00:00.000Z",
        source: "Loud",
        sourceId: "loud",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-08-10T00:00:00.000Z",
      },
      {
        url: "https://loud.example/2",
        title: "L2",
        date: "2026-08-09T00:00:00.000Z",
        source: "Loud",
        sourceId: "loud",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-08-09T00:00:00.000Z",
      },
      {
        url: "https://quiet.example/1",
        title: "Q1",
        date: "2026-08-01T00:00:00.000Z",
        source: "Quiet",
        sourceId: "quiet",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        url: "https://star.example/1",
        title: "S1",
        date: "2026-01-01T00:00:00.000Z",
        source: "Star",
        sourceId: "star",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const { articles: kept, evicted } = applyRetainPolicy(articles, {
      maxRetain: 2,
      minPerSource: 1,
      byUrl,
    });

    assert.ok(kept.some((article) => article.url.includes("quiet")));
    assert.ok(kept.some((article) => article.url.includes("star")));
    assert.equal(
      kept.some((article) => article.url === "https://quiet.example/1"),
      true,
    );
    assert.ok(evicted.every((article) => byUrl[article.url]?.read === true));
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
      maxRetain: 500,
    });
  });

  test("reads profile", () => {
    assert.deepEqual(parseIngestArgs(["--profile=personal"]), {
      maxRetain: 500,
      profile: "personal",
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
              content: "x".repeat(1600),
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
    assert.equal(articles[0].summary.length, 1500);
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

  test("respects maxNew per feed", async () => {
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

  test("syncs missing items per feed without cross-feed starvation", async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "shared-news-per-feed-sync-"),
    );
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "loud-feed",
            label: "Loud",
            kind: "rss",
            url: "https://feeds.example/loud",
            enabled: true,
          },
          {
            id: "quiet-feed",
            label: "Quiet",
            kind: "rss",
            url: "https://feeds.example/quiet",
            enabled: true,
          },
        ],
      }),
    );

    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async (_url, feed) => {
        if (feed.id === "loud-feed") {
          return {
            items: Array.from({ length: 12 }, (_, index) => ({
              title: `Loud ${index}`,
              link: `https://loud.example/${index}`,
              isoDate: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
            })),
          };
        }
        return {
          items: [
            {
              title: "Quiet 1",
              link: "https://quiet.example/1",
              isoDate: "2026-08-01T00:00:00.000Z",
            },
            {
              title: "Quiet 2",
              link: "https://quiet.example/2",
              isoDate: "2026-08-02T00:00:00.000Z",
            },
            {
              title: "Quiet 3",
              link: "https://quiet.example/3",
              isoDate: "2026-08-03T00:00:00.000Z",
            },
          ],
        };
      },
    });

    assert.equal(result.articlesInserted, 15);
    const articles = await readArticlesJsonl(path.join(dir, "articles.jsonl"));
    assert.equal(
      articles.filter((article) => article.sourceId === "quiet-feed").length,
      3,
    );
    assert.equal(
      articles.filter((article) => article.sourceId === "loud-feed").length,
      12,
    );
  });

  test("extracts imageUrl and summary from YouTube-shaped mediaGroup item", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-youtube-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "yt-feed",
            label: "YouTube",
            engine: "roundup",
            kind: "youtube",
            url: "https://feeds.example/youtube",
            enabled: true,
          },
        ],
      }),
    );

    await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({
        items: [
          {
            title: "Video title",
            link: "https://www.youtube.com/watch?v=abc123",
            isoDate: "2026-08-11T00:00:00.000Z",
            mediaGroup: {
              "media:thumbnail": [
                { $: { url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg", width: "480" } },
              ],
              "media:description": "YouTube video description text",
            },
          },
        ],
      }),
    });

    const articles = await readArticlesJsonl(path.join(dir, "articles.jsonl"));
    assert.equal(articles.length, 1);
    assert.equal(
      articles[0].imageUrl,
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    );
    assert.equal(articles[0].summary, "YouTube video description text");
    assert.equal(articles[0].category, "youtube");
  });

  test("reports articlesUpdated when re-ingest enriches existing rows", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-update-"));
    const articlesPath = path.join(dir, "articles.jsonl");
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "enrich-feed",
            label: "Enrich",
            engine: "roundup",
            kind: "youtube",
            url: "https://feeds.example/enrich",
            enabled: true,
          },
        ],
      }),
    );
    await writeArticlesJsonl(articlesPath, [
      {
        url: "https://www.youtube.com/watch?v=abc123",
        title: "Video title",
        date: "2026-08-11T00:00:00.000Z",
        source: "YouTube",
        sourceId: "enrich-feed",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "youtube",
        processedAt: "2026-08-11T00:00:00.000Z",
      },
    ]);

    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({
        items: [
          {
            title: "Video title",
            link: "https://www.youtube.com/watch?v=abc123",
            isoDate: "2026-08-11T00:00:00.000Z",
            mediaGroup: {
              "media:thumbnail": [
                {
                  $: {
                    url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
                    width: "480",
                  },
                },
              ],
              "media:description": "Filled on re-ingest",
            },
          },
        ],
      }),
    });

    assert.equal(result.articlesInserted, 0);
    assert.equal(result.articlesUpdated, 1);
    const articles = await readArticlesJsonl(articlesPath);
    assert.equal(articles[0].summary, "Filled on re-ingest");
    assert.equal(
      articles[0].imageUrl,
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    );
  });

  test("prunes old read articles after upsert and records last-run counts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-prune-"));
    const articlesPath = path.join(dir, "articles.jsonl");
    const userStatePath = path.join(dir, "user-state.json");
    const oldUrl = "https://example.com/old-read";
    const oldStateUrl =
      "https://EXAMPLE.com/old-read/?utm_source=test#fragment";
    const keepUrl = "https://example.com/keep";
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "prune-feed",
            label: "Prune Feed",
            engine: "roundup",
            kind: "rss",
            url: "https://feeds.example/prune",
            enabled: true,
          },
        ],
      }),
    );
    await writeArticlesJsonl(articlesPath, [
      {
        url: oldUrl,
        title: "Old read",
        date: "2026-06-01T00:00:00.000Z",
        source: "Prune Feed",
        sourceId: "prune-feed",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        url: keepUrl,
        title: "Keep unread",
        date: "2026-08-01T00:00:00.000Z",
        source: "Prune Feed",
        sourceId: "prune-feed",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    await writeFile(
      userStatePath,
      JSON.stringify(
        {
          version: 1,
          byUrl: {
            [oldStateUrl]: {
              read: true,
              readAt: "2026-06-01T00:00:00.000Z",
            },
            [keepUrl]: {
              read: false,
            },
          },
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({ items: [] }),
      nowMs: Date.parse("2026-09-18T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.ok(result.articlesPruned >= 1);
    assert.ok(result.userStatePruned >= 1);
    const articles = await readArticlesJsonl(articlesPath);
    assert.equal(
      articles.some((article) => article.url === oldUrl),
      false,
    );
    assert.equal(
      articles.some((article) => article.url === keepUrl),
      true,
    );
    const userState = JSON.parse(await readFile(userStatePath, "utf8"));
    assert.equal(userState.byUrl[oldUrl], undefined);
    assert.ok(userState.byUrl[keepUrl]);
    const lastRun = JSON.parse(
      await readFile(path.join(dir, "last-run.json"), "utf8"),
    );
    assert.ok(lastRun.articlesPruned >= 1);
    assert.ok(lastRun.userStatePruned >= 1);
    assert.equal(lastRun.articlesArchivedPrune, 1);
    const seen = JSON.parse(
      await readFile(path.join(dir, "archive", "seen.json"), "utf8"),
    );
    assert.ok(seen.byUrl[oldUrl]);
    const archiveFiles = (await readdir(path.join(dir, "archive"))).filter(
      (name) => name.endsWith(".jsonl"),
    );
    const archiveRows = (
      await Promise.all(
        archiveFiles.map((name) =>
          readFile(path.join(dir, "archive", name), "utf8"),
        ),
      )
    ).join("\n");
    assert.match(archiveRows, /https:\/\/example\.com\/old-read/);

    const second = await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({
        items: [
          {
            title: "Old read returns",
            link: oldUrl,
            isoDate: "2026-06-01T00:00:00.000Z",
          },
        ],
      }),
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    assert.equal(second.articlesInserted, 0);
    assert.equal(second.articlesSkippedSeen, 1);
    assert.equal(
      (await readArticlesJsonl(articlesPath)).some(
        (article) => article.url === oldUrl,
      ),
      false,
    );
  });

  test("seeds an old first snapshot then age-gates later old URLs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-seed-gate-"));
    const sourcesPath = path.join(dir, "sources.json");
    const firstOldUrl = "https://example.com/seed-old";
    const laterOldUrl = "https://example.com/later-old";
    await writeFile(
      sourcesPath,
      JSON.stringify({
        groups: [{ id: "news", label: "News" }],
        feeds: [
          {
            id: "seed-feed",
            label: "Seed Feed",
            engine: "roundup",
            kind: "rss",
            url: "https://feeds.example/seed",
            enabled: true,
          },
        ],
      }),
    );

    const first = await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({
        items: [
          {
            title: "Old seed article",
            link: firstOldUrl,
            isoDate: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
      nowMs: Date.parse("2026-09-18T00:00:00.000Z"),
    });
    assert.equal(first.articlesInserted, 1);
    const seededSources = JSON.parse(await readFile(sourcesPath, "utf8"));
    assert.equal(
      seededSources.feeds[0].seededAt,
      "2026-09-18T00:00:00.000Z",
    );
    assert.deepEqual(seededSources.groups, [{ id: "news", label: "News" }]);

    const second = await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({
        items: [
          {
            title: "Old seed article",
            link: firstOldUrl,
            isoDate: "2026-07-01T00:00:00.000Z",
          },
          {
            title: "Later old article",
            link: laterOldUrl,
            isoDate: "2026-07-02T00:00:00.000Z",
          },
        ],
      }),
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    assert.equal(second.articlesInserted, 0);
    assert.equal(second.articlesSkippedAge, 1);
    assert.equal(
      (await readArticlesJsonl(path.join(dir, "articles.jsonl"))).some(
        (article) => article.url === laterOldUrl,
      ),
      false,
    );
  });

  test("age-gates undated seeded items but inserts them during initial seed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-date-gate-"));
    const sourcesPath = path.join(dir, "sources.json");
    await writeFile(
      sourcesPath,
      JSON.stringify({
        feeds: [
          {
            id: "seeded-feed",
            label: "Seeded Feed",
            kind: "rss",
            url: "https://feeds.example/seeded",
            enabled: true,
            seededAt: "2026-09-01T00:00:00.000Z",
          },
          {
            id: "unseeded-feed",
            label: "Unseeded Feed",
            kind: "rss",
            url: "https://feeds.example/unseeded",
            enabled: true,
          },
        ],
      }),
    );

    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async (_url, feed) => ({
        items:
          feed.id === "seeded-feed"
            ? [
                {
                  title: "Missing date",
                  link: "https://example.com/missing-date",
                },
                {
                  title: "Invalid date",
                  link: "https://example.com/invalid-seeded-date",
                  isoDate: "not-a-date",
                },
              ]
            : [
                {
                  title: "Initial invalid date",
                  link: "https://example.com/invalid-unseeded-date",
                  pubDate: "not-a-date",
                },
              ],
      }),
      nowMs: Date.parse("2026-09-18T00:00:00.000Z"),
    });

    assert.equal(result.articlesSkippedAge, 2);
    assert.equal(result.articlesInserted, 1);
    const articles = await readArticlesJsonl(path.join(dir, "articles.jsonl"));
    assert.deepEqual(
      articles.map((article) => article.url),
      ["https://example.com/invalid-unseeded-date"],
    );
    assert.equal(articles[0].date, "");
    const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
    assert.equal(
      sources.feeds.find((feed) => feed.id === "unseeded-feed").seededAt,
      "2026-09-18T00:00:00.000Z",
    );
  });

  test("retain archives read articles while unread survives a low cap", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-retain-"));
    const articlesPath = path.join(dir, "articles.jsonl");
    const userStatePath = path.join(dir, "user-state.json");
    const unreadUrl = "https://example.com/unread";
    const readUrls = [
      "https://example.com/read-1",
      "https://example.com/read-2",
      "https://example.com/read-3",
    ];
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({
        feeds: [
          {
            id: "retain-feed",
            label: "Retain Feed",
            kind: "rss",
            url: "https://feeds.example/retain",
            enabled: true,
          },
        ],
      }),
    );
    await writeArticlesJsonl(
      articlesPath,
      [unreadUrl, ...readUrls].map((url, index) => ({
        url,
        title: `Article ${index}`,
        date: `2026-09-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
        source: "Retain Feed",
        sourceId: "retain-feed",
        engine: "roundup",
        summary: "",
        tags: [],
        category: "rss",
        processedAt: "2026-09-18T00:00:00.000Z",
      })),
    );
    await writeFile(
      userStatePath,
      `${JSON.stringify({
        version: 1,
        byUrl: {
          [unreadUrl]: { read: false },
          ...Object.fromEntries(
            readUrls.map((url) => [
              url,
              { read: true, readAt: "2026-09-17T00:00:00.000Z" },
            ]),
          ),
        },
      })}\n`,
    );

    const result = await runIngest({
      newsDir: dir,
      maxRetain: 1,
      minPerSource: 0,
      fetchFeed: async () => ({ items: [] }),
      nowMs: Date.parse("2026-09-18T00:00:00.000Z"),
    });

    assert.equal(result.articlesArchivedRetain, 3);
    assert.equal(result.articlesArchivedPrune, 0);
    assert.deepEqual(
      (await readArticlesJsonl(articlesPath)).map((article) => article.url),
      [unreadUrl],
    );
    const seen = JSON.parse(
      await readFile(path.join(dir, "archive", "seen.json"), "utf8"),
    );
    assert.ok(readUrls.every((url) => seen.byUrl[url]));
    const userState = JSON.parse(await readFile(userStatePath, "utf8"));
    assert.deepEqual(userState.byUrl, { [unreadUrl]: { read: false } });
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

  test("records profile on last-run when provided", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-profile-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    const result = await runIngest({
      newsDir: dir,
      profile: "personal",
      fetchFeed: async () => ({ items: [] }),
    });
    assert.equal(result.profile, "personal");
    const lastRun = JSON.parse(
      await readFile(path.join(dir, "last-run.json"), "utf8"),
    );
    assert.equal(lastRun.profile, "personal");
  });

  test("records null profile when omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-noprof-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({ items: [] }),
    });
    assert.equal(result.profile, null);
  });

  test("throws a migrate hint when sources.json is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-missing-"));
    await assert.rejects(
      () => runIngest({ newsDir: dir, fetchFeed: async () => ({ items: [] }) }),
      /News store not found: .* \(run migrate-profiles.mjs\)/,
    );
  });
});

describe("profile isolation", () => {
  test("personal ingest does not create a work directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shared-news-root-"));
    const personalDir = path.join(root, "personal");
    await mkdir(personalDir);
    await writeFile(
      path.join(personalDir, "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    const { storeDir, profile } = await resolveNewsDir({
      newsRoot: root,
      profile: "personal",
    });
    await runIngest({
      newsDir: storeDir,
      profile,
      fetchFeed: async () => ({ items: [] }),
    });
    assert.equal(profile, "personal");
    assert.equal(storeDir, personalDir);
    await assert.rejects(stat(path.join(root, "work")), { code: "ENOENT" });
  });
});
