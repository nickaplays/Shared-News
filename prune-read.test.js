import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pruneReadArticles } from "./prune-read.js";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-08-13T12:00:00.000Z");

describe("pruneReadArticles", () => {
  test("removes read older than 30d and drops user-state key", () => {
    const articles = [
      { url: "https://a.example/old", title: "old" },
      { url: "https://a.example/keep", title: "keep" },
    ];
    const byUrl = {
      "https://a.example/old": {
        read: true,
        readAt: "2026-06-01T00:00:00.000Z",
      },
      "https://a.example/keep": {
        read: true,
        readAt: "2026-08-10T00:00:00.000Z",
      },
    };
    const result = pruneReadArticles(articles, byUrl, { maxAgeDays: 30, nowMs: now });
    assert.equal(result.articlesPruned, 1);
    assert.equal(result.userStatePruned, 1);
    assert.equal(result.articles.length, 1);
    assert.equal(result.articles[0].url, "https://a.example/keep");
    assert.equal(result.byUrl["https://a.example/old"], undefined);
  });

  test("keeps unread, missing readAt, and starred", () => {
    const articles = [
      { url: "https://a.example/u" },
      { url: "https://a.example/legacy" },
      { url: "https://a.example/star" },
    ];
    const byUrl = {
      "https://a.example/u": { read: false },
      "https://a.example/legacy": { read: true },
      "https://a.example/star": {
        read: true,
        readAt: "2020-01-01T00:00:00.000Z",
        starred: true,
      },
    };
    const result = pruneReadArticles(articles, byUrl, { maxAgeDays: 30, nowMs: now });
    assert.equal(result.articlesPruned, 0);
    assert.equal(result.articles.length, 3);
  });
});
