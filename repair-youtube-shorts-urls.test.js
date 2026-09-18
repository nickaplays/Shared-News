import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  repairWatchUrlsToShorts,
  youtubeVideoIdFromUrl,
} from "./repair-youtube-shorts-urls.js";

describe("repair-youtube-shorts-urls", () => {
  test("extracts video id from watch and shorts URLs", () => {
    assert.equal(
      youtubeVideoIdFromUrl("https://www.youtube.com/watch?v=abc123def45"),
      "abc123def45",
    );
    assert.equal(
      youtubeVideoIdFromUrl("https://www.youtube.com/shorts/abc123def45"),
      "abc123def45",
    );
    assert.equal(youtubeVideoIdFromUrl("https://example.com/x"), null);
  });

  test("rewrites short-duration watch URLs to shorts", () => {
    const articles = [
      {
        url: "https://www.youtube.com/watch?v=shortVid123",
        title: "Clip",
      },
      {
        url: "https://www.youtube.com/watch?v=longVid1234",
        title: "Long",
      },
    ];
    const byUrl = {
      "https://www.youtube.com/watch?v=shortVid123": {
        read: true,
        readAt: "2026-09-01T00:00:00.000Z",
      },
    };
    const result = repairWatchUrlsToShorts(articles, byUrl, {
      shortVid123: 68,
      longVid1234: 1119,
    });
    assert.equal(result.rewritten, 1);
    assert.equal(result.deduped, 0);
    assert.equal(
      result.articles[0].url,
      "https://www.youtube.com/shorts/shortVid123",
    );
    assert.equal(
      result.articles[1].url,
      "https://www.youtube.com/watch?v=longVid1234",
    );
    assert.deepEqual(result.byUrl["https://www.youtube.com/shorts/shortVid123"], {
      read: true,
      readAt: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(result.byUrl["https://www.youtube.com/watch?v=shortVid123"], undefined);
  });

  test("dedupes when shorts row already exists", () => {
    const articles = [
      {
        url: "https://www.youtube.com/shorts/shortVid123",
        title: "Clip shorts",
        processedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        url: "https://www.youtube.com/watch?v=shortVid123",
        title: "Clip watch",
        processedAt: "2026-09-18T00:00:00.000Z",
      },
    ];
    const byUrl = {
      "https://www.youtube.com/watch?v=shortVid123": {
        read: false,
        starred: true,
      },
      "https://www.youtube.com/shorts/shortVid123": {
        read: true,
        readAt: "2026-08-02T00:00:00.000Z",
      },
    };
    const result = repairWatchUrlsToShorts(articles, byUrl, {
      shortVid123: 70,
    });
    assert.equal(result.deduped, 1);
    assert.equal(result.articles.length, 1);
    assert.equal(
      result.articles[0].url,
      "https://www.youtube.com/shorts/shortVid123",
    );
    assert.equal(result.byUrl["https://www.youtube.com/watch?v=shortVid123"], undefined);
    assert.equal(result.byUrl["https://www.youtube.com/shorts/shortVid123"].starred, true);
    assert.equal(result.byUrl["https://www.youtube.com/shorts/shortVid123"].read, true);
  });
});
