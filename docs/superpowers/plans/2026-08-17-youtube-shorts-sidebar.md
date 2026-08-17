# YouTube Shorts Synthetic Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route YouTube Shorts URLs into a synthetic **Youtube Shorts** sidebar filter in Launchpad and Twins, excluding them from source/group views.

**Architecture:** Client-only `isYouTubeShort(url)` + `{ kind: 'shorts' }` filter. Source/group filters and per-source unread exclude Shorts. Synthetic sidebar button (not Manage Sources). No ingest/vault changes.

**Tech Stack:** TypeScript · Vitest · existing `newsFilters` / NewsWorkspace

**Spec:** [`docs/superpowers/specs/2026-08-17-youtube-shorts-sidebar-design.md`](../specs/2026-08-17-youtube-shorts-sidebar-design.md)

## Global Constraints

- Section label exact: `Youtube Shorts`
- Detection: youtube.com / www / m + pathname `/shorts/`
- Exclude Shorts from source + catalog group filters and their unread badges
- Keep Shorts in All / Unread / Starred / Search
- Show synthetic section only when ≥1 Short in loaded articles
- No Shared-News ingest or `sources.json` changes
- Mirror logic in Dev-Launcher and Gemini Twins

---

## File Map

| Path | Action |
|------|--------|
| `Dev-Launcher/src/lib/newsFilters.ts` | `isYouTubeShort`, filter + unread + normalize |
| `Dev-Launcher/src/lib/newsFilters.test.ts` | Tests |
| `Dev-Launcher/src/lib/newsView.ts` | `newsFilterKey` for shorts |
| `Dev-Launcher/src/components/NewsWorkspace.tsx` | Sidebar button + normalize |
| `Gemini-Twins/frontend/src/lib/news/news-filters.ts` | Mirror |
| `Gemini-Twins/frontend/src/lib/news/news-filters.test.ts` | Mirror |
| `Gemini-Twins/frontend/src/lib/news/news-view.ts` | Mirror |
| `Gemini-Twins/frontend/src/components/news/NewsWorkspace.tsx` | Mirror |
| Spec status | implemented when done |

### Task 1: Dev Launchpad filters + sidebar

- [x] TDD helpers/filters/unread
- [x] Wire NewsWorkspace
- [ ] Commit

### Task 2: Gemini Twins mirror

- [x] Same as Task 1 in GT paths
- [ ] Commit

### Task 3: Spec status

- [x] Mark spec implemented; commit in Shared-News
