const DAY_MS = 24 * 60 * 60 * 1000;

export function pruneReadArticles(articles, byUrl, { maxAgeDays = 30, nowMs = Date.now() } = {}) {
  const cutoff = nowMs - maxAgeDays * DAY_MS;
  const nextByUrl = { ...(byUrl || {}) };
  let articlesPruned = 0;
  let userStatePruned = 0;
  const removed = [];
  const kept = [];

  for (const article of articles) {
    const key = article.url;
    const state = nextByUrl[key];
    const readAtMs = state?.readAt ? Date.parse(state.readAt) : NaN;
    const eligible =
      state?.read === true &&
      state?.starred !== true &&
      Number.isFinite(readAtMs) &&
      readAtMs < cutoff;
    if (eligible) {
      removed.push(article);
      articlesPruned += 1;
      if (nextByUrl[key]) {
        delete nextByUrl[key];
        userStatePruned += 1;
      }
      continue;
    }
    kept.push(article);
  }

  return {
    articles: kept,
    byUrl: nextByUrl,
    removed,
    articlesPruned,
    userStatePruned,
  };
}
