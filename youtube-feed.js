/**
 * Fetch YouTube channel uploads via Data API v3 (not Atom RSS).
 */

/**
 * @param {string} feedUrl
 * @returns {string | null}
 */
export function channelIdFromFeedUrl(feedUrl) {
  try {
    const parsed = new URL(String(feedUrl ?? "").trim());
    const id = parsed.searchParams.get("channel_id");
    if (id && /^UC[\w-]+$/i.test(id)) return id;
  } catch {
    // fall through
  }
  return null;
}

/**
 * @param {string} channelId
 * @returns {string}
 */
export function uploadsPlaylistIdFromChannelId(channelId) {
  if (!/^UC[\w-]+$/i.test(channelId)) {
    throw new Error(`Invalid YouTube channel id: ${channelId}`);
  }
  return `UU${channelId.slice(2)}`;
}

/**
 * @param {Record<string, { url?: string }> | undefined} thumbnails
 * @returns {string | undefined}
 */
export function pickThumbnailUrl(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") return undefined;
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const url = thumbnails[key]?.url;
    if (typeof url === "string" && url.startsWith("https://")) return url;
  }
  return undefined;
}

/**
 * @param {object} item playlistItems resource
 * @returns {object | null} rss-parser-like item
 */
export function playlistItemToFeedItem(item) {
  const videoId = item?.snippet?.resourceId?.videoId;
  if (!videoId) return null;
  const imageUrl = pickThumbnailUrl(item?.snippet?.thumbnails);
  const feedItem = {
    title: String(item?.snippet?.title ?? "Untitled"),
    link: `https://www.youtube.com/watch?v=${videoId}`,
    isoDate: item?.snippet?.publishedAt
      ? String(item.snippet.publishedAt)
      : undefined,
    contentSnippet: item?.snippet?.description
      ? String(item.snippet.description)
      : undefined,
    content: item?.snippet?.description
      ? String(item.snippet.description)
      : undefined,
  };
  if (imageUrl) {
    feedItem.enclosure = { url: imageUrl, type: "image/jpeg" };
    feedItem.mediaGroup = {
      "media:thumbnail": [{ $: { url: imageUrl, width: "1280" } }],
    };
  }
  return feedItem;
}

/**
 * @param {{
 *   channelId: string,
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   maxResults?: number,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{ items: object[] }>}
 */
export async function fetchYoutubeFeedItems({
  channelId,
  apiKey,
  fetchImpl = globalThis.fetch,
  maxResults = 15,
  signal,
}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("YOUTUBE_API_KEY is not set");
  }
  const playlistId = uploadsPlaylistIdFromChannelId(channelId);
  const params = new URLSearchParams({
    part: "snippet",
    playlistId,
    maxResults: String(maxResults),
    key: apiKey,
  });
  const response = await fetchImpl(
    `https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }
  const body = await response.json();
  if (body?.error?.message) {
    throw new Error(String(body.error.message));
  }
  const items = [];
  for (const row of body?.items ?? []) {
    const mapped = playlistItemToFeedItem(row);
    if (mapped) items.push(mapped);
  }
  return { items };
}
