# Shared News — Prefer large feed images

> **Date:** 2026-08-17  
> **Status:** Spec — implemented  
> **App:** Shared News (package)  
> **Repos:** `/Users/nickadenton/NKA/Automation/Cursor/Shared-News`  
> **Approach:** Pure path rewrite at extract + enrich upgrade (no HEAD)

## 1. Problem

Some RSS feeds (e.g. PushSquare / Gamer Network CDNs) expose article images as
`https://images…/<id>/small.jpg`. Cards and article heroes scale those thumbnails
up and look blurry. The same CDN serves a sharp variant at `…/large.jpg`.

Image URLs are chosen in Shared-News (`article-media.js` → `imageUrl` on
`articles.jsonl`). Host UIs only display the stored URL.

## 2. Goals / Non-goals

### Goals

1. When extracting `imageUrl`, prefer `…/large.<ext>` over `…/small.<ext>` when the
   last path segment is exactly `small` plus a known image extension.
2. On re-ingest enrich, upgrade existing stored `/small.` `imageUrl` values to
   `/large.` so blurry rows improve without deleting articles.
3. Keep the rule host-agnostic and synchronous (string rewrite only).

### Non-goals

- Rewriting URLs in Dev Launchpad or Gemini Twins at render time.
- One-shot vault migration scripts.
- HTTP HEAD/GET probes to confirm `large` exists.
- Rewriting `medium`, width query params, or non-segment names like `small-thumb.jpg`.
- Changing summary enrich rules or overwrite policy for unrelated image URLs.

## 3. Locked decisions

| Decision | Choice |
|----------|--------|
| Where | Shared-News ingest only |
| Scope | Host-agnostic; last path segment `small.<ext>` → `large.<ext>` |
| Extensions | `jpg`, `jpeg`, `png`, `webp`, `gif` (case-insensitive) |
| Probe | None — rewrite without verifying `large` exists |
| Existing rows | Enrich upgrades `/small.` → `/large.` on re-ingest |
| UI | Unchanged; displays stored `imageUrl` |

## 4. Design

### 4.1 Rewrite helper

Add `preferLargeImageUrl(url)` in `article-media.js` (or a tiny sibling used only
for this):

- Input must already be an https URL string (callers use existing `firstHttps`).
- Parse with `URL`. If the **pathname**’s final segment matches
  `/^small\.(jpe?g|png|webp|gif)$/i`, replace that segment with `large.` + the
  same extension (preserve original extension casing from the match, or normalize
  to the matched group — either is fine if tests pin one).
- Preserve search and hash.
- Return the original string when there is no match or the URL is invalid.

Apply once to the final URL returned by `extractImageUrl` (all branches).

### 4.2 Enrich

In `upsertArticles` (`articles-store.js`), when merging an existing row:

1. Empty summary ← non-empty incoming (unchanged).
2. Missing `imageUrl` ← incoming `imageUrl` (unchanged).
3. **New:** if `prev.imageUrl` rewrites via `preferLargeImageUrl` to a different
   string, set `next.imageUrl` to that large URL and count `updated`.

Do not replace a non-small existing image with a different feed URL (current
“never overwrite a present image” rule stays, except the small→large upgrade).

Incoming extracts already go through `preferLargeImageUrl` in `extractImageUrl`,
so new inserts store large URLs when applicable.

### 4.3 Failure modes

If a host has `/small.` but no `/large.`, the browser may 404 that image. Acceptable
for this CDN pattern; no fallback to small at runtime. Can tighten later with a
host allowlist or HEAD probe if needed.

## 5. Testing

- `preferLargeImageUrl` / `extractImageUrl`: small→large; query/hash kept;
  case-insensitive segment; non-matches untouched; http still rejected upstream.
- `upsertArticles`: existing row with `/small.` upgrades to `/large.` on re-ingest;
  non-small `imageUrl` still not overwritten by a different incoming image.

## 6. Rollout

1. Implement + unit tests in Shared-News.
2. Deploy / pull package; next scheduled or manual ingest upgrades matching rows
   and stores large URLs for new items.
3. No host UI or vault migrate step.
