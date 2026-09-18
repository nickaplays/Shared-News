import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  channelIdFromFeedUrl,
  fetchYoutubeFeedItems,
  isYouTubeShortByDuration,
  parseIso8601DurationSeconds,
  playlistItemToFeedItem,
  uploadsPlaylistIdFromChannelId,
  youtubeWatchOrShortsUrl,
} from "./youtube-feed.js";

describe("youtube-feed", () => {
  test("parses channel id and uploads playlist id", () => {
    assert.equal(
      channelIdFromFeedUrl(
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCO1Ewa1OnZ87iNTVxqxLgwg",
      ),
      "UCO1Ewa1OnZ87iNTVxqxLgwg",
    );
    assert.equal(
      uploadsPlaylistIdFromChannelId("UCO1Ewa1OnZ87iNTVxqxLgwg"),
      "UUO1Ewa1OnZ87iNTVxqxLgwg",
    );
  });

  test("parses ISO-8601 durations and Shorts threshold", () => {
    assert.equal(parseIso8601DurationSeconds("PT49S"), 49);
    assert.equal(parseIso8601DurationSeconds("PT1M8S"), 68);
    assert.equal(parseIso8601DurationSeconds("PT18M39S"), 1119);
    assert.equal(parseIso8601DurationSeconds("PT1H2M3S"), 3723);
    assert.equal(parseIso8601DurationSeconds("bad"), null);
    assert.equal(isYouTubeShortByDuration(180), true);
    assert.equal(isYouTubeShortByDuration(181), false);
    assert.equal(isYouTubeShortByDuration(null), false);
  });

  test("builds watch vs shorts URL from duration", () => {
    assert.equal(
      youtubeWatchOrShortsUrl("abc123", { durationSeconds: 60 }),
      "https://www.youtube.com/shorts/abc123",
    );
    assert.equal(
      youtubeWatchOrShortsUrl("abc123", { durationSeconds: 600 }),
      "https://www.youtube.com/watch?v=abc123",
    );
  });

  test("maps playlist item to feed item", () => {
    const item = playlistItemToFeedItem({
      snippet: {
        title: "Hello",
        description: "Desc",
        publishedAt: "2026-09-13T11:30:05Z",
        resourceId: { videoId: "abc123" },
        thumbnails: {
          high: { url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg" },
        },
      },
    });
    assert.equal(item.link, "https://www.youtube.com/watch?v=abc123");
    assert.equal(item.title, "Hello");
    assert.equal(item.isoDate, "2026-09-13T11:30:05Z");
    assert.equal(
      item.enclosure.url,
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    );
  });

  test("maps playlist item to shorts URL when duration is short", () => {
    const item = playlistItemToFeedItem(
      {
        snippet: {
          title: "Clip",
          resourceId: { videoId: "short1" },
        },
      },
      { durationSeconds: 68 },
    );
    assert.equal(item.link, "https://www.youtube.com/shorts/short1");
  });

  test("fetchYoutubeFeedItems requires api key", async () => {
    await assert.rejects(
      () =>
        fetchYoutubeFeedItems({
          channelId: "UCO1Ewa1OnZ87iNTVxqxLgwg",
          apiKey: "",
        }),
      /YOUTUBE_API_KEY is not set/,
    );
  });

  test("fetchYoutubeFeedItems uses videos.list duration for Shorts URLs", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("playlistItems")) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                {
                  snippet: {
                    title: "Short clip",
                    publishedAt: "2026-09-01T00:00:00Z",
                    resourceId: { videoId: "shortVid" },
                    thumbnails: {
                      default: {
                        url: "https://i.ytimg.com/vi/shortVid/default.jpg",
                      },
                    },
                  },
                },
                {
                  snippet: {
                    title: "Long video",
                    publishedAt: "2026-09-02T00:00:00Z",
                    resourceId: { videoId: "longVid" },
                    thumbnails: {
                      default: {
                        url: "https://i.ytimg.com/vi/longVid/default.jpg",
                      },
                    },
                  },
                },
              ],
            };
          },
        };
      }
      if (href.includes("/videos?")) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                { id: "shortVid", contentDetails: { duration: "PT1M8S" } },
                { id: "longVid", contentDetails: { duration: "PT18M39S" } },
              ],
            };
          },
        };
      }
      throw new Error(`unexpected fetch: ${href}`);
    };
    const result = await fetchYoutubeFeedItems({
      channelId: "UCO1Ewa1OnZ87iNTVxqxLgwg",
      apiKey: "test-key",
      fetchImpl,
      maxResults: 15,
    });
    assert.equal(result.items.length, 2);
    assert.equal(
      result.items[0].link,
      "https://www.youtube.com/shorts/shortVid",
    );
    assert.equal(
      result.items[1].link,
      "https://www.youtube.com/watch?v=longVid",
    );
    assert.match(calls[0], /playlistItems/);
    assert.match(calls[1], /\/videos\?/);
    assert.match(calls[1], /part=contentDetails/);
    assert.match(calls[1], /id=shortVid%2ClongVid|id=shortVid,longVid/);
    assert.match(calls[1], /key=test-key/);
  });
});
