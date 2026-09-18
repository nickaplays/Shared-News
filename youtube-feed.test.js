import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  channelIdFromFeedUrl,
  fetchYoutubeFeedItems,
  playlistItemToFeedItem,
  uploadsPlaylistIdFromChannelId,
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

  test("fetchYoutubeFeedItems calls playlistItems", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                snippet: {
                  title: "Vid",
                  publishedAt: "2026-09-01T00:00:00Z",
                  resourceId: { videoId: "xyz" },
                  thumbnails: {
                    default: { url: "https://i.ytimg.com/vi/xyz/default.jpg" },
                  },
                },
              },
            ],
          };
        },
      };
    };
    const result = await fetchYoutubeFeedItems({
      channelId: "UCO1Ewa1OnZ87iNTVxqxLgwg",
      apiKey: "test-key",
      fetchImpl,
      maxResults: 15,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].link, "https://www.youtube.com/watch?v=xyz");
    assert.match(calls[0], /playlistItems/);
    assert.match(calls[0], /playlistId=UUO1Ewa1OnZ87iNTVxqxLgwg/);
    assert.match(calls[0], /key=test-key/);
  });
});
