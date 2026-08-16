# Prefer Large Feed Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store sharp `…/large.<ext>` image URLs instead of `…/small.<ext>` when Shared-News extracts or enriches article images.

**Architecture:** A pure string helper `preferLargeImageUrl` rewrites the last path segment `small.<ext>` → `large.<ext>`. `extractImageUrl` applies it to every successful https pick. `upsertArticles` upgrades existing stored `/small.` URLs on re-ingest without overwriting unrelated images.

**Tech Stack:** Node ESM · `node:test` · existing `article-media.js` / `articles-store.js`

**Spec:** [`docs/superpowers/specs/2026-08-17-prefer-large-feed-images-design.md`](../specs/2026-08-17-prefer-large-feed-images-design.md)

## Global Constraints

- Host-agnostic: only last path segment `small.(jpe?g|png|webp|gif)` (case-insensitive) → `large.` + same extension
- No HEAD/GET probes; no UI changes; no vault migration script
- Preserve URL search and hash
- Do not overwrite a non-small existing `imageUrl` with a different feed URL
- Tests: `node --test article-media.test.js ingest.test.js` from Shared-News repo root

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `article-media.js` | Modify | Export `preferLargeImageUrl`; apply in `extractImageUrl` |
| `article-media.test.js` | Modify | Unit tests for rewrite + extract integration |
| `articles-store.js` | Modify | Enrich: upgrade stored `/small.` → `/large.` |
| `ingest.test.js` | Modify | Upsert enrich tests for small→large |
| Spec status line | Modify | Mark implemented when done |

---

### Task 1: `preferLargeImageUrl` + wire into `extractImageUrl`

**Files:**
- Modify: `article-media.js`
- Modify: `article-media.test.js`
- Modify: `docs/superpowers/specs/2026-08-17-prefer-large-feed-images-design.md` (status only at end of Task 2)

**Interfaces:**
- Consumes: existing `extractImageUrl` https selection
- Produces: `export function preferLargeImageUrl(url: string): string` — returns rewritten https URL or original; invalid input returns original / non-string returns as-is per implementation below

- [ ] **Step 1: Write failing tests for `preferLargeImageUrl` and extract integration**

Add to `article-media.test.js` imports and new describe block:

```js
import {
  extractImageUrl,
  extractSummary,
  plainText,
  preferLargeImageUrl,
} from "./article-media.js";

describe("preferLargeImageUrl", () => {
  test("rewrites trailing small.jpg to large.jpg", () => {
    assert.equal(
      preferLargeImageUrl(
        "https://images.pushsquare.com/b624c5d5d590a/small.jpg",
      ),
      "https://images.pushsquare.com/b624c5d5d590a/large.jpg",
    );
  });

  test("preserves query and hash", () => {
    assert.equal(
      preferLargeImageUrl("https://cdn.example/x/small.png?w=1#h"),
      "https://cdn.example/x/large.png?w=1#h",
    );
  });

  test("is case-insensitive on the small segment", () => {
    assert.equal(
      preferLargeImageUrl("https://cdn.example/x/SMALL.JPEG"),
      "https://cdn.example/x/large.JPEG",
    );
  });

  test("leaves non-matching paths alone", () => {
    assert.equal(
      preferLargeImageUrl("https://cdn.example/small-thumb.jpg"),
      "https://cdn.example/small-thumb.jpg",
    );
    assert.equal(
      preferLargeImageUrl("https://cdn.example/small/foo.jpg"),
      "https://cdn.example/small/foo.jpg",
    );
    assert.equal(
      preferLargeImageUrl("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    );
  });

  test("returns non-strings unchanged", () => {
    assert.equal(preferLargeImageUrl(undefined), undefined);
    assert.equal(preferLargeImageUrl(null), null);
  });
});

describe("extractImageUrl", () => {
  // …existing tests…

  test("rewrites PushSquare-style small enclosure to large", () => {
    assert.equal(
      extractImageUrl({
        enclosure: {
          url: "https://images.pushsquare.com/b624c5d5d590a/small.jpg",
          type: "image/jpeg",
        },
      }),
      "https://images.pushsquare.com/b624c5d5d590a/large.jpg",
    );
  });
});
```

Keep all existing `extractImageUrl` tests; they should still pass (none use `/small.`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test article-media.test.js`

Expected: FAIL — `preferLargeImageUrl` is not exported / not a function.

- [ ] **Step 3: Implement `preferLargeImageUrl` and apply in `extractImageUrl`**

In `article-media.js`, add:

```js
const SMALL_SEGMENT_RE = /^small\.(jpe?g|png|webp|gif)$/i;

/**
 * @param {unknown} url
 * @returns {unknown}
 */
export function preferLargeImageUrl(url) {
  if (typeof url !== "string") return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const parts = parsed.pathname.split("/");
  const last = parts[parts.length - 1] || "";
  const match = last.match(SMALL_SEGMENT_RE);
  if (!match) return url;
  const ext = match[1];
  parts[parts.length - 1] = `large.${ext}`;
  parsed.pathname = parts.join("/");
  return parsed.toString();
}
```

Note: the case-insensitive test expects `large.JPEG` (extension casing from the original segment’s extension characters). Implement by taking the extension substring from `last` after the dot rather than lowercasing:

```js
  if (!SMALL_SEGMENT_RE.test(last)) return url;
  const ext = last.slice(last.lastIndexOf(".") + 1);
  parts[parts.length - 1] = `large.${ext}`;
```

At the end of `extractImageUrl`, wrap returns — cleanest approach: assign to a local then return once:

```js
export function extractImageUrl(item) {
  let url;
  const fromMedia = mediaThumbUrl(item?.mediaGroup);
  if (fromMedia) url = fromMedia;
  // … existing branches set url …
  // after content loop, if still unset: return undefined
  if (!url) {
    // existing early returns become assignments; final:
  }
  return url ? preferLargeImageUrl(url) : undefined;
}
```

Concrete refactor of `extractImageUrl`:

```js
export function extractImageUrl(item) {
  const fromMedia = mediaThumbUrl(item?.mediaGroup);
  if (fromMedia) return preferLargeImageUrl(fromMedia);

  const enc = item?.enclosure;
  if (enc) {
    const type = String(enc.type || "");
    const isImage =
      type.startsWith("image/") ||
      (!type && IMAGE_EXT_RE.test(String(enc.url || "")));
    if (isImage) {
      const u = firstHttps(enc.url);
      if (u) return preferLargeImageUrl(u);
    }
  }

  if (Array.isArray(item?.mediaThumbnail) && item.mediaThumbnail[0]) {
    const u = firstHttps(
      item.mediaThumbnail[0]?.$?.url ?? item.mediaThumbnail[0]?.url,
    );
    if (u) return preferLargeImageUrl(u);
  }

  for (const field of [item?.content, item?.summary, item?.description]) {
    const match = String(field ?? "").match(IMG_SRC_RE);
    if (match) {
      const u = firstHttps(match[1]);
      if (u) return preferLargeImageUrl(u);
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test article-media.test.js`

Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add article-media.js article-media.test.js
git commit -m "$(cat <<'EOF'
feat: prefer large over small feed image path segments

EOF
)"
```

---

### Task 2: Enrich existing `/small.` `imageUrl` on upsert

**Files:**
- Modify: `articles-store.js`
- Modify: `ingest.test.js` (upsert describe)
- Modify: `docs/superpowers/specs/2026-08-17-prefer-large-feed-images-design.md` (status → implemented)

**Interfaces:**
- Consumes: `preferLargeImageUrl` from `./article-media.js`
- Produces: `upsertArticles` updates rows when stored `imageUrl` rewrites to a different large URL

- [ ] **Step 1: Write failing enrich tests**

In `ingest.test.js` inside `describe("upsertArticles", …)`, add:

```js
  test("upgrades existing small imageUrl to large on re-ingest", () => {
    const existing = [
      {
        url: "https://a.example/1",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "Kept",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "https://images.pushsquare.com/abc/small.jpg",
      },
    ];
    const incoming = [
      {
        ...existing[0],
        imageUrl: "https://images.pushsquare.com/abc/large.jpg",
      },
    ];
    const result = upsertArticles(existing, incoming, {
      maxNew: 0,
      maxRetain: 200,
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 1);
    const row = result.articles.find((a) => a.url === "https://a.example/1");
    assert.equal(
      row.imageUrl,
      "https://images.pushsquare.com/abc/large.jpg",
    );
    assert.equal(row.summary, "Kept");
  });

  test("upgrades small imageUrl even when incoming omits imageUrl", () => {
    const existing = [
      {
        url: "https://a.example/1",
        title: "A",
        date: "2026-01-01T00:00:00.000Z",
        source: "T",
        sourceId: "t",
        engine: "roundup",
        summary: "Kept",
        tags: [],
        category: "rss",
        processedAt: "2026-01-01T00:00:00.000Z",
        imageUrl: "https://cdn.example/x/small.webp",
      },
    ];
    const incoming = [{ ...existing[0] }];
    delete incoming[0].imageUrl;
    const result = upsertArticles(existing, incoming, {
      maxNew: 0,
      maxRetain: 200,
    });
    assert.equal(result.updated, 1);
    const row = result.articles.find((a) => a.url === "https://a.example/1");
    assert.equal(row.imageUrl, "https://cdn.example/x/large.webp");
  });
```

Keep existing test `"does not overwrite non-empty summary or existing imageUrl"` (old.jpg → new.jpg) — it must still pass.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test ingest.test.js`

Expected: FAIL on the new upgrade tests (`updated` stays 0 / `imageUrl` still `small`).

- [ ] **Step 3: Implement enrich upgrade in `articles-store.js`**

At top of `articles-store.js`:

```js
import { preferLargeImageUrl } from "./article-media.js";
```

In the existing-row merge block, after the missing-`imageUrl` fill:

```js
      if (!prev.imageUrl && article.imageUrl) {
        next.imageUrl = article.imageUrl;
        changed = true;
      }
      if (prev.imageUrl) {
        const preferred = preferLargeImageUrl(prev.imageUrl);
        if (
          typeof preferred === "string" &&
          preferred !== prev.imageUrl
        ) {
          next.imageUrl = preferred;
          changed = true;
        }
      }
```

Do not use incoming image to overwrite non-small URLs.

- [ ] **Step 4: Run full relevant tests**

Run: `node --test article-media.test.js ingest.test.js`

Expected: PASS.

- [ ] **Step 5: Update spec status and commit**

In `docs/superpowers/specs/2026-08-17-prefer-large-feed-images-design.md`, set:

`> **Status:** Spec — implemented`

```bash
git add articles-store.js ingest.test.js docs/superpowers/specs/2026-08-17-prefer-large-feed-images-design.md
git commit -m "$(cat <<'EOF'
feat: upgrade stored small imageUrls on article enrich

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `preferLargeImageUrl` path rewrite | Task 1 |
| Apply in `extractImageUrl` | Task 1 |
| Host-agnostic; extensions list; preserve query/hash | Task 1 tests |
| Enrich upgrade small→large | Task 2 |
| Do not overwrite non-small images | Task 2 keeps existing test |
| No UI / HEAD / migration | Out of scope (no tasks) |
