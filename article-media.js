const IMG_SRC_RE = /<img[^>]+src=["']([^"']+)["']/i;

export function plainText(value, maxLength) {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

function firstHttps(url) {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://")) return undefined;
  return trimmed;
}

function mediaThumbUrl(mediaGroup) {
  const thumbs = mediaGroup?.["media:thumbnail"];
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined;
  // Prefer last entry if widths differ; else first
  let best = thumbs[0];
  let bestW = Number(best?.$?.width) || 0;
  for (const t of thumbs) {
    const w = Number(t?.$?.width) || 0;
    if (w >= bestW) {
      best = t;
      bestW = w;
    }
  }
  return firstHttps(best?.$?.url);
}

export function extractImageUrl(item) {
  const fromMedia = mediaThumbUrl(item?.mediaGroup);
  if (fromMedia) return fromMedia;

  const enc = item?.enclosure;
  if (enc && String(enc.type || "").startsWith("image/")) {
    const u = firstHttps(enc.url);
    if (u) return u;
  }

  if (Array.isArray(item?.mediaThumbnail) && item.mediaThumbnail[0]) {
    const u = firstHttps(
      item.mediaThumbnail[0]?.$?.url ?? item.mediaThumbnail[0]?.url,
    );
    if (u) return u;
  }

  for (const field of [item?.content, item?.summary, item?.description]) {
    const match = String(field ?? "").match(IMG_SRC_RE);
    if (match) {
      const u = firstHttps(match[1]);
      if (u) return u;
    }
  }
  return undefined;
}

export function extractSummary(item, maxLength) {
  const mediaDesc = item?.mediaGroup?.["media:description"];
  const mediaText = Array.isArray(mediaDesc) ? mediaDesc[0] : mediaDesc;
  const raw =
    mediaText ||
    item?.contentSnippet ||
    item?.summary ||
    item?.content ||
    item?.description ||
    "";
  return plainText(raw, maxLength);
}
