/**
 * Fetch YouTube channel uploads via Data API v3 (not Atom RSS).
 * Shorts (duration ≤ 180s) get /shorts/{id} URLs so host filters work.
 */

/** YouTube Shorts maximum length in seconds. */
export const YOUTUBE_SHORTS_MAX_SECONDS = 180;

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
 * @param {string | null | undefined} iso
 * @returns {number | null} total seconds, or null if unparseable
 */
export function parseIso8601DurationSeconds(iso) {
  const m = String(iso ?? "").match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i,
  );
  if (!m || (m[1] == null && m[2] == null && m[3] == null)) {
    return null;
  }
  return (
    Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
  );
}

/**
 * @param {number | null | undefined} durationSeconds
 * @param {number} [maxSeconds]
 * @returns {boolean}
 */
export function isYouTubeShortByDuration(
  durationSeconds,
  maxSeconds = YOUTUBE_SHORTS_MAX_SECONDS,
) {
  return (
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds >= 0 &&
    durationSeconds <= maxSeconds
  );
}

/**
 * @param {string} videoId
 * @param {{ durationSeconds?: number | null }} [options]
 * @returns {string}
 */
export function youtubeWatchOrShortsUrl(videoId, { durationSeconds } = {}) {
  if (isYouTubeShortByDuration(durationSeconds)) {
    return `https://www.youtube.com/shorts/${videoId}`;
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
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
 * @param {{ durationSeconds?: number | null }} [options]
 * @returns {object | null} rss-parser-like item
 */
export function playlistItemToFeedItem(item, { durationSeconds } = {}) {
  const videoId = item?.snippet?.resourceId?.videoId;
  if (!videoId) return null;
  const imageUrl = pickThumbnailUrl(item?.snippet?.thumbnails);
  const feedItem = {
    title: String(item?.snippet?.title ?? "Untitled"),
    link: youtubeWatchOrShortsUrl(String(videoId), { durationSeconds }),
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
 *   videoIds: string[],
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<Map<string, number | null>>}
 */
export async function fetchVideoDurationsSeconds({
  videoIds,
  apiKey,
  fetchImpl = globalThis.fetch,
  signal,
}) {
  /** @type {Map<string, number | null>} */
  const durations = new Map();
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (ids.length === 0) return durations;

  // videos.list allows up to 50 ids per request
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      part: "contentDetails",
      id: batch.join(","),
      key: apiKey,
    });
    const response = await fetchImpl(
      `https://www.googleapis.com/youtube/v3/videos?${params}`,
      { signal },
    );
    if (!response.ok) {
      throw new Error(`Status code ${response.status}`);
    }
    const body = await response.json();
    if (body?.error?.message) {
      throw new Error(String(body.error.message));
    }
    for (const row of body?.items ?? []) {
      durations.set(
        String(row.id),
        parseIso8601DurationSeconds(row?.contentDetails?.duration),
      );
    }
  }
  return durations;
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
  const playlistRows = body?.items ?? [];
  const videoIds = playlistRows
    .map((row) => row?.snippet?.resourceId?.videoId)
    .filter(Boolean)
    .map(String);
  const durations = await fetchVideoDurationsSeconds({
    videoIds,
    apiKey,
    fetchImpl,
    signal,
  });
  const items = [];
  for (const row of playlistRows) {
    const videoId = row?.snippet?.resourceId?.videoId;
    const mapped = playlistItemToFeedItem(row, {
      durationSeconds: videoId ? durations.get(String(videoId)) : null,
    });
    if (mapped) items.push(mapped);
  }
  return { items };
}
