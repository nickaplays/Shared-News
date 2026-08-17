# Shared News — YouTube Shorts synthetic sidebar

> **Date:** 2026-08-17  
> **Status:** Spec — approved for planning  
> **App:** Dev Launchpad + Gemini Twins (News UI); Shared News vault unchanged  
> **Repos:**  
> - `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher`  
> - `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins`  
> - Spec stored in Shared-News for cross-host tracking: `/Users/nickadenton/NKA/Automation/Cursor/Shared-News`  
> **Approach:** Client-only filter + synthetic sidebar (Approach 1)

## 1. Problem

YouTube channel feeds mix normal videos and Shorts. Shorts use article URLs like
`https://www.youtube.com/shorts/<id>`. Those items litter channel source views
and any catalog group that contains those channels. Operators want Shorts in
one place and out of normal YouTube source/group browsing.

Today, **groups attach to feeds**, not articles. There is no article-level
routing.

## 2. Goals / Non-goals

### Goals

1. Detect YouTube Shorts from article URL (`…/shorts/…`).
2. Show a **synthetic** sidebar section **Youtube Shorts** (not a Manage Sources
   group or feed).
3. When filtering by **source** or **catalog group**, exclude Shorts.
4. Shorts still appear under **All**, **Unread**, **Starred**, and **Search**.
5. Ship the same behavior in **Dev Launchpad** and **Gemini Twins**.

### Non-goals

- Changing Shared-News ingest or `articles.jsonl` schema.
- Creating/editing a real `sources.json` group or fake feed.
- Reassigning `sourceId` / channel identity on articles.
- Hiding Shorts from All / Unread / Starred / Search.
- Deduplicating helper into a shared npm package in this slice (mirror code +
  tests in both hosts).

## 3. Locked decisions

| Decision | Choice |
|----------|--------|
| Visibility in source/group views | Exclude Shorts entirely (option A) |
| Sidebar representation | Synthetic section only (option A) |
| Hosts | Both Launchpad and Gemini Twins (option A) |
| Detection | Client-side URL parse; no ingest flag |
| Section label | `Youtube Shorts` (exact) |
| Section visibility | Show when ≥1 Short exists in the loaded article set |
| Article identity | Keep original `sourceId` / source label on the article |

## 4. Design

### 4.1 Detection

`isYouTubeShort(url: string): boolean`

- Parse with `URL`; return false on invalid / non-string.
- Host (lowercase): `youtube.com`, `www.youtube.com`, or `m.youtube.com`
  (also allow hosts that end with `.youtube.com` only if the registrable label
  is exactly `youtube.com` — prefer exact host allowlist above).
- Pathname starts with `/shorts/` (case-insensitive path segments as produced
  by URL parsing).
- Not Shorts: `/watch`, `youtu.be`, non-YouTube hosts.

### 4.2 Filter model

Extend `NewsFilter` with `{ kind: 'shorts' }` (or equivalent reserved kind —
not a catalog `group` id).

`filterArticles`:

| Filter | Behavior |
|--------|----------|
| `all` / `unread` / `starred` | Unchanged (Shorts included when they match) |
| `source` | Match source key **and** `!isYouTubeShort(url)` |
| `group` | Match enabled feeds in group **and** `!isYouTubeShort(url)` |
| `shorts` | `isYouTubeShort(url)` only |

Triage / show-read / search compose on top of the above unchanged.

`normalizeNewsFilter`: if `shorts` is selected but zero Shorts remain after
reload, fall back to `unread` (same pattern as missing source/group).

### 4.3 Sidebar & unread

- Synthetic section type (e.g. `type: 'shorts'`) with label **Youtube Shorts**,
  unread = count of unread Shorts in the article set.
- Placement: after system filters (All / Unread / Starred), **before** the first
  catalog group / ungrouped feed list.
- Only render the section when Shorts count ≥ 1.
- Per-feed and per-catalog-group unread badges must **not** count Shorts
  (compute unread-by-source from non-Short articles only, or subtract).

Manage Sources: no changes; synthetic section is not editable there.

### 4.4 Hosts

Implement mirrored helpers/tests in:

- Dev Launchpad: `src/lib/newsFilters.ts` (+ tests), wire `NewsWorkspace` sidebar
  / filter.
- Gemini Twins: equivalent `frontend/src/lib/news/…` filters and News workspace.

## 5. Testing

- `isYouTubeShort`: shorts URL true; watch / youtu.be / other false; www/m hosts.
- `filterArticles`: source/group exclude Shorts; `shorts` keeps only Shorts;
  all/unread/starred still include Shorts when applicable.
- Sidebar builder / unread: Shorts unread not attributed to channel; synthetic
  section unread correct; section omitted when no Shorts.

## 6. Rollout

1. Launchpad filters + sidebar + tests.  
2. Mirror in Gemini Twins.  
3. No Shared-News package release required for this feature.  
4. Existing Shorts in the vault appear correctly on next UI load (URL-based).
