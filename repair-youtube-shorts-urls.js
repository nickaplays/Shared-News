import { normalizeUrl } from "./normalize-url.js";
import {
  isYouTubeShortByDuration,
  youtubeWatchOrShortsUrl,
} from "./youtube-feed.js";

const VIDEO_ID_RE = /^[\w-]{11}$/;

/**
 * @param {string | undefined | null} url
 * @returns {string | null}
 */
export function youtubeVideoIdFromUrl(url) {
  try {
    const parsed = new URL(String(url ?? "").trim());
    const host = parsed.hostname.toLowerCase();
    if (
      host !== "youtube.com" &&
      host !== "www.youtube.com" &&
      host !== "m.youtube.com" &&
      host !== "youtu.be"
    ) {
      return null;
    }
    if (host === "youtu.be") {
      const id = parsed.pathname.replace(/^\//, "").split("/")[0];
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    const shorts = parsed.pathname.match(/^\/shorts\/([\w-]{11})\/?$/i);
    if (shorts) return shorts[1];
    const watch = parsed.searchParams.get("v");
    if (watch && VIDEO_ID_RE.test(watch)) return watch;
  } catch {
    // fall through
  }
  return null;
}

/**
 * @param {Record<string, unknown> | undefined} a
 * @param {Record<string, unknown> | undefined} b
 * @returns {Record<string, unknown> | undefined}
 */
function mergeUserState(a, b) {
  if (!a) return b;
  if (!b) return a;
  const readAts = [a.readAt, b.readAt]
    .filter((v) => typeof v === "string" && Number.isFinite(Date.parse(v)))
    .sort();
  return {
    ...a,
    ...b,
    read: a.read === true || b.read === true,
    starred: a.starred === true || b.starred === true,
    hidden: a.hidden === true || b.hidden === true,
    ...(readAts.length > 0 ? { readAt: readAts[0] } : {}),
  };
}

/**
 * Rewrite short-duration watch URLs to /shorts/{id} and dedupe against
 * existing shorts rows. Migrates user-state keys.
 *
 * @param {Array<{ url: string, [key: string]: unknown }>} articles
 * @param {Record<string, Record<string, unknown>>} byUrl
 * @param {Record<string, number | null | undefined>} durationsByVideoId
 * @returns {{
 *   articles: typeof articles,
 *   byUrl: typeof byUrl,
 *   rewritten: number,
 *   deduped: number,
 * }}
 */
export function repairWatchUrlsToShorts(articles, byUrl, durationsByVideoId) {
  const nextByUrl = { ...(byUrl || {}) };
  /** @type {Map<string, { url: string, [key: string]: unknown }>} */
  const byCanonical = new Map();
  let rewritten = 0;
  let deduped = 0;

  for (const article of articles) {
    const videoId = youtubeVideoIdFromUrl(article.url);
    const duration =
      videoId != null ? durationsByVideoId[videoId] : undefined;
    const isShort = isYouTubeShortByDuration(duration);
    const oldUrl = normalizeUrl(article.url);
    let nextArticle = { ...article, url: oldUrl };

    if (videoId && isShort) {
      const shortsUrl = normalizeUrl(
        youtubeWatchOrShortsUrl(videoId, { durationSeconds: duration }),
      );
      const isWatchForm = /[?&]v=/.test(oldUrl) || !oldUrl.includes("/shorts/");
      if (isWatchForm && shortsUrl !== oldUrl) {
        const existing = byCanonical.get(shortsUrl);
        if (existing) {
          deduped += 1;
          nextByUrl[shortsUrl] = mergeUserState(
            nextByUrl[shortsUrl],
            nextByUrl[oldUrl],
          );
          delete nextByUrl[oldUrl];
          continue;
        }
        nextArticle = { ...nextArticle, url: shortsUrl };
        if (nextByUrl[oldUrl]) {
          nextByUrl[shortsUrl] = mergeUserState(
            nextByUrl[shortsUrl],
            nextByUrl[oldUrl],
          );
          delete nextByUrl[oldUrl];
        }
        rewritten += 1;
      }
    }

    const key = normalizeUrl(nextArticle.url);
    if (byCanonical.has(key)) {
      deduped += 1;
      nextByUrl[key] = mergeUserState(nextByUrl[key], nextByUrl[oldUrl]);
      if (oldUrl !== key) delete nextByUrl[oldUrl];
      continue;
    }
    byCanonical.set(key, { ...nextArticle, url: key });
  }

  return {
    articles: [...byCanonical.values()],
    byUrl: nextByUrl,
    rewritten,
    deduped,
  };
}
