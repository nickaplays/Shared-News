import { normalizeUrl } from "./normalize-url.js";

export const DEFAULT_INSERT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldInsertArticle(
  article,
  {
    seenByUrl = {},
    seeded = false,
    maxAgeDays = DEFAULT_INSERT_MAX_AGE_DAYS,
    nowMs = Date.now(),
  } = {},
) {
  const key = normalizeUrl(article.url);
  if (seenByUrl[key]) {
    return { insert: false, reason: "seen" };
  }
  if (!seeded) {
    return { insert: true, reason: null };
  }
  const dateMs = Date.parse(article.date);
  if (!Number.isFinite(dateMs) || dateMs < nowMs - maxAgeDays * DAY_MS) {
    return { insert: false, reason: "age" };
  }
  return { insert: true, reason: null };
}
