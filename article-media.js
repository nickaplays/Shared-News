const IMG_SRC_RE = /<img[^>]+src=["']([^"']+)["']/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i;

function xmlText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "_" in value) return String(value._ ?? "");
  return String(value);
}

export function plainText(value, maxLength) {
  const text = xmlText(value)
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
  let bestUrl;
  let bestW = 0;
  for (const t of thumbs) {
    const url = firstHttps(t?.$?.url);
    if (!url) continue;
    const w = Number(t?.$?.width) || 0;
    if (!bestUrl || w >= bestW) {
      bestUrl = url;
      bestW = w;
    }
  }
  return bestUrl;
}

export function extractImageUrl(item) {
  const fromMedia = mediaThumbUrl(item?.mediaGroup);
  if (fromMedia) return fromMedia;

  const enc = item?.enclosure;
  if (enc) {
    const type = String(enc.type || "");
    const isImage =
      type.startsWith("image/") ||
      (!type && IMAGE_EXT_RE.test(String(enc.url || "")));
    if (isImage) {
      const u = firstHttps(enc.url);
      if (u) return u;
    }
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
  const mediaRaw = Array.isArray(mediaDesc) ? mediaDesc[0] : mediaDesc;
  const mediaText = mediaRaw != null ? xmlText(mediaRaw) : "";
  const raw =
    mediaText ||
    item?.contentSnippet ||
    item?.summary ||
    item?.content ||
    item?.description ||
    "";
  return plainText(raw, maxLength);
}
