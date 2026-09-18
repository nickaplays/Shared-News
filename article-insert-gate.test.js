import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INSERT_MAX_AGE_DAYS,
  shouldInsertArticle,
} from "./article-insert-gate.js";

const nowMs = Date.parse("2026-09-18T00:00:00.000Z");

describe("shouldInsertArticle", () => {
  test("exports 30-day default", () => {
    assert.equal(DEFAULT_INSERT_MAX_AGE_DAYS, 30);
  });

  test("blocks seen urls even when unseeded", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/a", date: "2026-01-01T00:00:00.000Z" },
      {
        seenByUrl: { "https://example.com/a": { archiveFile: "2026-08.jsonl" } },
        seeded: false,
        nowMs,
      },
    );
    assert.deepEqual(r, { insert: false, reason: "seen" });
  });

  test("unseeded allows old dates", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/b", date: "2025-01-01T00:00:00.000Z" },
      { seenByUrl: {}, seeded: false, nowMs },
    );
    assert.deepEqual(r, { insert: true, reason: null });
  });

  test("seeded blocks older than 30 days", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/c", date: "2026-08-01T00:00:00.000Z" },
      { seenByUrl: {}, seeded: true, nowMs },
    );
    assert.deepEqual(r, { insert: false, reason: "age" });
  });

  test("seeded allows recent dates", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/d", date: "2026-09-10T00:00:00.000Z" },
      { seenByUrl: {}, seeded: true, nowMs },
    );
    assert.deepEqual(r, { insert: true, reason: null });
  });

  test("seeded blocks invalid dates", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/e", date: "not-a-date" },
      { seenByUrl: {}, seeded: true, nowMs },
    );
    assert.deepEqual(r, { insert: false, reason: "age" });
  });
});
