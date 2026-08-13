// article-media.test.js
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  extractImageUrl,
  extractSummary,
  plainText,
} from "./article-media.js";

describe("plainText", () => {
  test("strips tags and collapses whitespace", () => {
    assert.equal(plainText("<p>Hi  <b>there</b></p>", 100), "Hi there");
  });
  test("slices to maxLength", () => {
    assert.equal(plainText("abcdefghij", 5), "abcde");
  });
});

describe("extractImageUrl", () => {
  test("reads YouTube mediaGroup thumbnail", () => {
    const url = extractImageUrl({
      mediaGroup: {
        "media:thumbnail": [
          { $: { url: "https://i.ytimg.com/vi/abc/hqdefault.jpg", width: "480" } },
        ],
      },
    });
    assert.equal(url, "https://i.ytimg.com/vi/abc/hqdefault.jpg");
  });

  test("prefers image enclosure", () => {
    assert.equal(
      extractImageUrl({
        enclosure: { url: "https://cdn.example/a.jpg", type: "image/jpeg" },
      }),
      "https://cdn.example/a.jpg",
    );
  });

  test("finds first img src in content", () => {
    assert.equal(
      extractImageUrl({
        content: '<p>x</p><img src="https://cdn.example/hero.png" alt="">',
      }),
      "https://cdn.example/hero.png",
    );
  });

  test("returns undefined when none", () => {
    assert.equal(extractImageUrl({ title: "x" }), undefined);
  });

  test("rejects http image URLs", () => {
    assert.equal(
      extractImageUrl({
        enclosure: { url: "http://cdn.example/a.jpg", type: "image/jpeg" },
      }),
      undefined,
    );
    assert.equal(
      extractImageUrl({
        content: '<img src="http://cdn.example/hero.png">',
      }),
      undefined,
    );
  });

  test("reads top-level mediaThumbnail", () => {
    assert.equal(
      extractImageUrl({
        mediaThumbnail: [{ $: { url: "https://cdn.example/thumb.jpg" } }],
      }),
      "https://cdn.example/thumb.jpg",
    );
  });

  test("prefers widest https thumbnail over wider http", () => {
    assert.equal(
      extractImageUrl({
        mediaGroup: {
          "media:thumbnail": [
            { $: { url: "http://cdn.example/wide.jpg", width: "1200" } },
            { $: { url: "https://cdn.example/narrow.jpg", width: "480" } },
          ],
        },
      }),
      "https://cdn.example/narrow.jpg",
    );
  });

  test("accepts enclosure without type when URL has image extension", () => {
    assert.equal(
      extractImageUrl({
        enclosure: { url: "https://cdn.example/photo.webp" },
      }),
      "https://cdn.example/photo.webp",
    );
  });
});

describe("extractSummary", () => {
  test("uses media description for YouTube-style items", () => {
    const summary = extractSummary(
      {
        mediaGroup: {
          "media:description": ["Line one\n\nLine two"],
        },
      },
      1500,
    );
    assert.match(summary, /Line one/);
    assert.match(summary, /Line two/);
  });

  test("falls back to contentSnippet", () => {
    assert.equal(
      extractSummary({ contentSnippet: "Hello world" }, 1500),
      "Hello world",
    );
  });

  test("unwraps media:description with xml attributes", () => {
    const mediaDesc = Object.create(null);
    mediaDesc._ = "Description with attrs";
    mediaDesc.$ = { type: "plain" };
    const summary = extractSummary(
      {
        mediaGroup: {
          "media:description": mediaDesc,
        },
      },
      1500,
    );
    assert.equal(summary, "Description with attrs");
  });
});
