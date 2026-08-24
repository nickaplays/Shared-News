# Shared News — Feed UX: scroll reset, Mark above, J/K, Fetch Now only

> **Date:** 2026-08-25  
> **Status:** Spec — awaiting implementation  
> **App:** Dev Launchpad + Gemini Twins (News UI); Shared News ingest/schema unchanged  
> **Repos:**  
> - `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher`  
> - `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins`  
> - Spec stored in Shared-News for cross-host tracking: `/Users/nickadenton/NKA/Automation/Cursor/Shared-News`  
> **Approach:** Shared helpers + mirror UI in both hosts (Approach 1)

## 1. Problem

Daily News use in Launchpad and Gemini Twins has several Feedly-style gaps:

1. Changing sidebar group/source (or other list context) leaves the feed pane scrolled mid-list from the previous view — users must scroll back to the top.
2. There is no per-card **Mark above** to clear everything above the current item in the visible list.
3. **J / K** keyboard navigation was assumed to exist but was never implemented (listed as future/non-goal in earlier shell specs).
4. Toolbar **Refresh** only reloads the vault catalog; **Fetch Now** already ingests then reloads. Operators find Refresh redundant.

## 2. Goals / Non-goals

### Goals

1. Reset the feed list scroll position to the top whenever list context changes (sidebar filter or Work/Personal profile).
2. Add **Mark above** beside **Read** on every article row/card: mark unread articles visually above the clicked item (exclude clicked).
3. Implement Feedly-style **J** (next) / **K** (previous): focus + scroll into view only.
4. Remove the **Refresh** toolbar button; keep **Fetch Now** only.
5. Ship identical behavior in **Dev Launchpad** and **Gemini Twins**.

### Non-goals

- Shared-News ingest, `articles.jsonl` schema, or new mark-read API routes.
- Auto-open / mark-read on J/K; Enter-to-open shortcut (follow-up).
- Extracting a shared npm package (mirror helpers + tests in both hosts).
- Renaming Fetch Now or adding a hidden Refresh under Manage (follow-up if launchd-only reload is needed).
- Changing Fetch Now semantics (still: ingest → refresh catalog → clear sticky).

## 3. Locked decisions

| Decision | Choice |
|----------|--------|
| Mark above semantics | Visually above in current visible list; **exclude** clicked card (option A) |
| J / K behavior | Focus + `scrollIntoView` only; no open, no mark-read (option A) |
| Scroll reset triggers | Any sidebar filter change **and** Work ↔ Personal (option C) |
| Toolbar | Remove **Refresh**; **Fetch Now** only |
| Hosts | Both Launchpad and Gemini Twins |
| Helpers | Pure functions next to existing `newsFilters` (mirrored); no shared package |
| Mark above API | Existing `POST /api/news/mark-read` with client-supplied `urls[]` + sticky read |

## 4. Design

### 4.1 Scroll reset

Attach a ref to the feed pane (`overflow-y-auto` container in `NewsWorkspace`).

When any of the following change, set `scrollTop = 0` (and clear keyboard focus index — see 4.3):

| Trigger | Examples |
|---------|----------|
| Sidebar filter | `all`, `unread`, `starred`, `shorts`, `group`, `source` |
| Profile | Work ↔ Personal |

**Do not** reset scroll for: mark-read / unread, star, hide, Mark above, Mark-as-read menu, Fetch Now, Manage Sources open/close, view-mode picker, search query typing (search already filters the same pane; resetting on every keystroke is hostile — only reset when `filter` or `profile` identity changes).

Implementation note: `useEffect` keyed on a stable serialization of `filter` + `profile` is enough; run after paint so the new list is mounted.

### 4.2 Mark above

#### Helper

```ts
markAboveUrls(visible: SharedNewsArticle[], index: number): string[]
```

- `visible` = the same ordered list rendered in the main pane (after triage + search).
- Return URLs of items at indices `0 .. index-1` that are unread (`!read`), in list order.
- If `index <= 0` or no unread above → empty array.
- Never include `visible[index]`.

#### UI

On every view mode that shows a **Read** control (article, cards, magazine, list/compact):

- Add a **Mark above** button immediately beside **Read**.
- `disabled` when actions are busy/loading **or** `markAboveUrls(visible, index).length === 0`.
- Click: `stopPropagation`; `runAction(urls, '/api/news/mark-read')` (sticky URLs via existing path).

Label: `Mark above` (exact). No new icon required; match existing small action button styles.

### 4.3 J / K keyboard navigation

#### State

- `focusedIndex: number | null` — index into `visible`, or `null` when no focus.
- On filter/profile change: set `focusedIndex` to `null` (or `0` only after first J/K — prefer `null` until first key so the list doesn’t look selected until the user navigates).
- When `visible` shrinks and `focusedIndex >= visible.length`, clamp to `visible.length - 1` or `null` if empty.

#### Key handler

Document-level `keydown` while News workspace is mounted:

| Key | Action |
|-----|--------|
| `j` / `J` | Next: `focusedIndex = min((focusedIndex ?? -1) + 1, visible.length - 1)` |
| `k` / `K` | Previous: `focusedIndex = max((focusedIndex ?? visible.length) - 1, 0)` |

Ignore when:

- Target is `input`, `textarea`, `select`, or `contenteditable`
- A modal/panel that captures keys is open (Manage Sources, mark-read menu) — same spirit as existing Escape handlers
- `visible.length === 0`
- Modifier keys that imply browser chords (`meta` / `ctrl` / `alt`) — plain J/K only

After updating index: `scrollIntoView({ block: 'nearest' })` on the focused row (via `data-news-index` or ref map). **Do not** open the URL or mark read.

#### Visual focus

Focused row gets a clear ring/highlight distinct from unread tint (e.g. stronger border using accent token). Unfocused rows unchanged.

### 4.4 Remove Refresh

In both hosts’ `NewsWorkspace` toolbar:

- Delete the **Refresh** button and its `onClick={() => refresh({ clearSticky: true })}` handler wiring from the toolbar only.
- Keep `refresh()` as an internal helper (used by Fetch Now, mark actions, profile switch, etc.).
- **Fetch Now** unchanged: `runNewsIngest` → `refresh({ clearSticky: true })` → status message.
- Update any unit tests that assert Refresh appears beside Fetch Now (e.g. Launchpad `NewsWorkspace.test.ts`).

### 4.5 Host file touch list (expected)

| Host | Likely files |
|------|----------------|
| Dev Launchpad | `src/components/NewsWorkspace.tsx`, `src/lib/newsFilters.ts` (+ tests), `NewsWorkspace.test.ts` |
| Gemini Twins | `frontend/src/components/news/NewsWorkspace.tsx`, `frontend/src/lib/news/news-filters.ts` (+ tests), related tests |

No Shared-News package code changes.

## 5. Testing

| Area | Coverage |
|------|----------|
| `markAboveUrls` | Empty above; unread-only; excludes index; all-read above → `[]` |
| Scroll reset | Effect/helper: filter/profile change implies scroll-to-top contract (component or lightweight test) |
| J/K | Index math: first J from null → 0; K from null → last; clamps; ignores when list empty |
| Toolbar | Fetch Now present; Refresh absent |
| Manual | Both hosts: switch group mid-scroll → top; Mark above; J/K focus ring; Fetch Now still works |

## 6. Success criteria

1. Changing any sidebar filter or Work/Personal jumps the feed to the top.
2. **Mark above** marks only unread items above the clicked card in the current visible list.
3. **J** / **K** move focus with scroll-into-view and never open or mark read; ignored while typing in search.
4. Toolbar shows **Fetch Now** and no **Refresh**.
5. Launchpad and Gemini Twins behave the same.

## 7. Delivery notes

- Implement Launchpad and Gemini Twins in the same slice for parity.
- Spec lives in Shared-News; code commits land in the two host repos.
- If operators later need catalog reload without ingest, add a quiet auto-poll or Manage-only Refresh — not part of this slice.
