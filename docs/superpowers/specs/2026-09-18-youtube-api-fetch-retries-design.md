# Shared News — YouTube Data API fetch + RSS retries

> **Date:** 2026-09-18  
> **Status:** Spec — implemented (package)  
> **App:** Shared News (package); Dev-Launcher / launchd env for `YOUTUBE_API_KEY`  
> **Repos:** `/Users/nickadenton/NKA/Automation/Cursor/Shared-News`

## 1. Problem

YouTube Atom feeds (`feeds/videos.xml?channel_id=…`) intermittently return 404/500 even when channel IDs are valid. Ingest fails those feeds on the first try. Non-YouTube RSS can also flake.

## 2. Goals / Non-goals

### Goals

1. Fetch `kind === "youtube"` feeds via **YouTube Data API v3** (uploads playlist), not Atom RSS.  
2. Retry HTTP fetch for non-YouTube feeds (and any remaining HTTP paths) on transient failures.  
3. Keep article shape / upsert / archive pipeline unchanged.  
4. Surface a clear per-feed error when `YOUTUBE_API_KEY` is missing.

### Non-goals

- Archive UI / host News UI changes.  
- Replacing RSS for non-YouTube sources.  
- Quota increase requests.  
- Changing how Launchpad resolves `@handle` → channel id on create.

## 3. Locked decisions

| Decision | Choice |
|----------|--------|
| YouTube path | API only for `kind === "youtube"` |
| RSS path | HTTP with retries |
| Attempts | 3 total; backoff 250ms, 500ms, 1000ms (injectable for tests) |
| Retryable | Network/abort (non-timeout abort from caller), HTTP 404, 408, 429, 5xx |
| Non-retryable | Other 4xx (e.g. 401, 403), parse errors after 200 |
| API | Derive uploads playlist `UU…` from `UC…` channel id + `playlistItems.list` maxResults=15 (1 unit/feed) |
| Channel id | From `feed.url` `channel_id` query (canonical catalog URL) |
| Key | `process.env.YOUTUBE_API_KEY`; launchd/`run-ingest.sh` must export it; Fetch now inherits Dev-Launcher env |
| Missing key | Fail that YouTube feed only: `YOUTUBE_API_KEY is not set` |

## 4. Article mapping (API → ingest item)

From each `playlistItems` row:

| Field | Source |
|-------|--------|
| link/url | `https://www.youtube.com/watch?v={videoId}` |
| title | `snippet.title` |
| date | `snippet.publishedAt` |
| image | prefer `snippet.thumbnails.maxres` → `standard` → `high` → `medium` → `default` |
| summary | `snippet.description` (truncated by existing extract/summary path if applied) |

`toArticle` / media helpers continue to own final article shape where possible; API adapter may emit rss-parser-like items or articles directly — implementation picks the smaller change.

## 5. Callers / env

- `run-ingest.sh`: load key from Dev-Launcher `.env` if present, or `SHARED_NEWS_YOUTUBE_API_KEY` / `YOUTUBE_API_KEY` already in environment.  
- Dev-Launcher `sharedNewsIngest` already spreads `process.env` into spawn.

## 6. Testing

- Retry: mock fetch fails twice with 404 then succeeds → one success; three 500s → throws.  
- YouTube API: mock channels + playlistItems → N articles with watch URLs.  
- Missing key + youtube feed → failedFeeds entry, other feeds still run.  
- Existing ingest tests keep passing.
