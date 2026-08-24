# News UI Feed UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset feed scroll on context change, add **Mark above**, implement **J/K** focus navigation, and remove **Refresh** (keep **Fetch Now**) in Dev Launchpad and Gemini Twins News UIs.

**Architecture:** Pure helpers in each host’s `newsFilters` module (`markAboveUrls`, `nextNewsFocusIndex`, `clampNewsFocusIndex`). Wire scroll ref, focus state, Mark above buttons, and keydown in each `NewsWorkspace`. No Shared-News ingest/API changes. Mirror Launchpad then Gemini Twins.

**Tech Stack:** TypeScript · React · Vitest · existing `newsFilters` / `NewsWorkspace`

**Spec:** [`docs/superpowers/specs/2026-08-25-news-ui-scroll-mark-above-shortcuts-design.md`](../specs/2026-08-25-news-ui-scroll-mark-above-shortcuts-design.md)

## Global Constraints

- Mark above: unread URLs at indices `0..index-1` only; never include clicked index
- J/K: focus + `scrollIntoView` only; no open; no mark-read
- Scroll reset on sidebar filter change and Work ↔ Personal; not on mark/star/hide/Fetch Now/search typing
- Toolbar: remove **Refresh**; keep **Fetch Now** (label stays `Fetch now` as today)
- Button label exact: `Mark above`
- Unread detection: use `a.isUnread` (same as `markReadUrls`)
- No Shared-News package / schema / new API routes
- Mirror helpers + UI in Dev-Launcher and Gemini Twins (no shared npm package)

---

## File Map

| Path | Responsibility |
|------|----------------|
| `Dev-Launcher/src/lib/newsFilters.ts` | `markAboveUrls`, `nextNewsFocusIndex`, `clampNewsFocusIndex` |
| `Dev-Launcher/src/lib/newsFilters.test.ts` | Unit tests for those helpers |
| `Dev-Launcher/src/components/NewsWorkspace.tsx` | Scroll reset, Mark above, J/K, remove Refresh |
| `Dev-Launcher/src/components/NewsWorkspace.test.ts` | Toolbar asserts Fetch now only |
| `Gemini-Twins/frontend/src/lib/news/news-filters.ts` | Mirror helpers |
| `Gemini-Twins/frontend/src/lib/news/news-filters.test.ts` | Mirror tests |
| `Gemini-Twins/frontend/src/components/news/NewsWorkspace.tsx` | Mirror UI wiring |
| `Shared-News/docs/superpowers/specs/2026-08-25-…-design.md` | Status → implemented |

---

### Task 1: Launchpad — `markAboveUrls` helper

**Files:**
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher/src/lib/newsFilters.ts`
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher/src/lib/newsFilters.test.ts`

**Interfaces:**
- Consumes: `SharedNewsArticle` (existing), `isUnread` field
- Produces: `markAboveUrls(visibleArticles: SharedNewsArticle[], index: number): string[]`

- [ ] **Step 1: Write the failing tests**

Add import of `markAboveUrls` alongside `markReadUrls`. Append:

```ts
describe('markAboveUrls', () => {
  it('returns unread urls strictly above index', () => {
    const urls = markAboveUrls(
      [
        article({ url: 'https://a/0', isUnread: true, read: false }),
        article({ url: 'https://a/1', isUnread: false, read: true }),
        article({ url: 'https://a/2', isUnread: true, read: false }),
        article({ url: 'https://a/3', isUnread: true, read: false }),
      ],
      3,
    )
    expect(urls).toEqual(['https://a/0', 'https://a/2'])
  })

  it('returns empty when index is 0 or negative', () => {
    const list = [article({ url: 'https://a/0', isUnread: true })]
    expect(markAboveUrls(list, 0)).toEqual([])
    expect(markAboveUrls(list, -1)).toEqual([])
  })

  it('returns empty when nothing unread above', () => {
    const urls = markAboveUrls(
      [
        article({ url: 'https://a/0', isUnread: false, read: true }),
        article({ url: 'https://a/1', isUnread: true }),
      ],
      1,
    )
    expect(urls).toEqual([])
  })

  it('does not include the article at index', () => {
    const urls = markAboveUrls(
      [
        article({ url: 'https://a/0', isUnread: true }),
        article({ url: 'https://a/1', isUnread: true }),
      ],
      1,
    )
    expect(urls).toEqual(['https://a/0'])
    expect(urls).not.toContain('https://a/1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (cwd Dev-Launcher):

```bash
npx vitest run src/lib/newsFilters.test.ts -t markAboveUrls
```

Expected: FAIL (`markAboveUrls` is not exported / not defined)

- [ ] **Step 3: Write minimal implementation**

In `newsFilters.ts`, after `markReadUrls`:

```ts
export function markAboveUrls(
  visibleArticles: SharedNewsArticle[],
  index: number,
): string[] {
  if (!Number.isFinite(index) || index <= 0) return []
  const end = Math.min(Math.floor(index), visibleArticles.length)
  const urls: string[] = []
  for (let i = 0; i < end; i += 1) {
    const a = visibleArticles[i]
    if (a?.isUnread) urls.push(a.url)
  }
  return urls
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/newsFilters.test.ts -t markAboveUrls
```

Expected: PASS

- [ ] **Step 5: Commit (Dev-Launcher repo)**

```bash
cd /Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher
git add src/lib/newsFilters.ts src/lib/newsFilters.test.ts
git commit -m "$(cat <<'EOF'
feat(news): add markAboveUrls helper for Mark above action

EOF
)"
```

---

### Task 2: Launchpad — keyboard focus index helpers

**Files:**
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher/src/lib/newsFilters.ts`
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher/src/lib/newsFilters.test.ts`

**Interfaces:**
- Consumes: none beyond numbers
- Produces:
  - `nextNewsFocusIndex(current: number | null, length: number, direction: 'next' | 'prev'): number | null`
  - `clampNewsFocusIndex(current: number | null, length: number): number | null`

- [ ] **Step 1: Write the failing tests**

```ts
describe('nextNewsFocusIndex', () => {
  it('J from null selects 0', () => {
    expect(nextNewsFocusIndex(null, 5, 'next')).toBe(0)
  })

  it('K from null selects last', () => {
    expect(nextNewsFocusIndex(null, 5, 'prev')).toBe(4)
  })

  it('advances and clamps', () => {
    expect(nextNewsFocusIndex(0, 3, 'next')).toBe(1)
    expect(nextNewsFocusIndex(2, 3, 'next')).toBe(2)
    expect(nextNewsFocusIndex(1, 3, 'prev')).toBe(0)
    expect(nextNewsFocusIndex(0, 3, 'prev')).toBe(0)
  })

  it('returns null when length is 0', () => {
    expect(nextNewsFocusIndex(null, 0, 'next')).toBeNull()
    expect(nextNewsFocusIndex(0, 0, 'prev')).toBeNull()
  })
})

describe('clampNewsFocusIndex', () => {
  it('clamps or clears', () => {
    expect(clampNewsFocusIndex(null, 3)).toBeNull()
    expect(clampNewsFocusIndex(5, 3)).toBe(2)
    expect(clampNewsFocusIndex(1, 3)).toBe(1)
    expect(clampNewsFocusIndex(0, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/newsFilters.test.ts -t 'nextNewsFocusIndex|clampNewsFocusIndex'
```

Expected: FAIL (not defined)

- [ ] **Step 3: Write minimal implementation**

```ts
export function nextNewsFocusIndex(
  current: number | null,
  length: number,
  direction: 'next' | 'prev',
): number | null {
  if (length <= 0) return null
  if (current === null) {
    return direction === 'next' ? 0 : length - 1
  }
  if (direction === 'next') {
    return Math.min(current + 1, length - 1)
  }
  return Math.max(current - 1, 0)
}

export function clampNewsFocusIndex(
  current: number | null,
  length: number,
): number | null {
  if (current === null || length <= 0) return null
  if (current < 0) return 0
  if (current >= length) return length - 1
  return current
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/newsFilters.test.ts -t 'nextNewsFocusIndex|clampNewsFocusIndex'
```

Expected: PASS

- [ ] **Step 5: Commit (Dev-Launcher)**

```bash
git add src/lib/newsFilters.ts src/lib/newsFilters.test.ts
git commit -m "$(cat <<'EOF'
feat(news): add J/K focus index helpers

EOF
)"
```

---

### Task 3: Launchpad — toolbar: remove Refresh

**Files:**
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher/src/components/NewsWorkspace.test.ts`
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher/src/components/NewsWorkspace.tsx` (toolbar only)

**Interfaces:**
- Consumes: existing `fetchNow` / `refresh` internals
- Produces: toolbar with **Fetch now** only (no **Refresh** button)

- [ ] **Step 1: Update the failing/outdated toolbar test**

Replace the test that expects Refresh:

```ts
it('renders Fetch now without Refresh', () => {
  const html = renderToStaticMarkup(createElement(NewsWorkspace))

  expect(html).toContain('Fetch now')
  expect(html).not.toContain('>Refresh</button>')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/NewsWorkspace.test.ts -t 'Fetch now'
```

Expected: FAIL because Refresh button still renders (`>Refresh</button>` present)

- [ ] **Step 3: Remove the Refresh toolbar button**

In `NewsWorkspace.tsx`, delete the second toolbar button block (the one with label `Refresh` and `onClick={() => void refresh({ clearSticky: true })}`). Keep the **Fetch now** button and keep the internal `refresh` function used elsewhere.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/NewsWorkspace.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit (Dev-Launcher)**

```bash
git add src/components/NewsWorkspace.tsx src/components/NewsWorkspace.test.ts
git commit -m "$(cat <<'EOF'
feat(news): drop Refresh toolbar button; keep Fetch now

EOF
)"
```

---

### Task 4: Launchpad — scroll reset, Mark above, J/K in NewsWorkspace

**Files:**
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher/src/components/NewsWorkspace.tsx`

**Interfaces:**
- Consumes: `markAboveUrls`, `nextNewsFocusIndex`, `clampNewsFocusIndex`, existing `newsFilterKey`, `runAction`, `visible`
- Produces: scroll-to-top on filter/profile; Mark above on rows; J/K focus ring

- [ ] **Step 1: Extend imports and state**

Import `markAboveUrls`, `nextNewsFocusIndex`, `clampNewsFocusIndex` from `../lib/newsFilters`.

Inside `NewsWorkspace`, add:

```ts
const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
const feedScrollRef = useRef<HTMLDivElement | null>(null)
const focusedIndexRef = useRef<number | null>(null)
focusedIndexRef.current = focusedIndex
```

- [ ] **Step 2: Scroll + focus reset on filter/profile**

After `filterKey` / `visible` are defined, add:

```ts
useEffect(() => {
  if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0
  setFocusedIndex(null)
}, [filterKey, profile])

useEffect(() => {
  setFocusedIndex((prev) => clampNewsFocusIndex(prev, visible.length))
}, [visible.length])
```

Attach `ref={feedScrollRef}` to the feed pane div that currently has `className="min-h-0 flex-1 overflow-y-auto px-4 py-3"`.

- [ ] **Step 3: J/K keydown listener**

```ts
useEffect(() => {
  function onKeyDown(event: KeyboardEvent) {
    if (manageOpen || markMenuOpen) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target
    if (target instanceof HTMLElement) {
      const tag = target.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      ) {
        return
      }
    }
    const key = event.key
    if (key !== 'j' && key !== 'J' && key !== 'k' && key !== 'K') return
    if (visible.length === 0) return
    event.preventDefault()
    const direction = key === 'j' || key === 'J' ? 'next' : 'prev'
    const next = nextNewsFocusIndex(
      focusedIndexRef.current,
      visible.length,
      direction,
    )
    setFocusedIndex(next)
    if (next === null) return
    const el = feedScrollRef.current?.querySelector(
      `[data-news-index="${next}"]`,
    )
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }
  document.addEventListener('keydown', onKeyDown)
  return () => document.removeEventListener('keydown', onKeyDown)
}, [manageOpen, markMenuOpen, visible.length])
```

- [ ] **Step 4: Mark above control helper**

Inside the component (near `starButton`):

```ts
function markAboveButton(index: number) {
  const urls = markAboveUrls(visible, index)
  return (
    <button
      type="button"
      disabled={articleActionsDisabled || urls.length === 0}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        void runAction(urls, '/api/news/mark-read')
      }}
      className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-medium hover:border-[rgba(var(--accent-rgb),0.4)] disabled:opacity-50"
    >
      Mark above
    </button>
  )
}
```

For **cards** / **magazine** / **title-only** modes, use `text-[10px]` on the button class to match sibling Read buttons in those layouts (duplicate the helper with a `size: 'sm' | 'md'` param, or pass `className`).

Recommended signature:

```ts
function markAboveButton(index: number, className: string) {
  const urls = markAboveUrls(visible, index)
  return (
    <button
      type="button"
      disabled={articleActionsDisabled || urls.length === 0}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        void runAction(urls, '/api/news/mark-read')
      }}
      className={className}
    >
      Mark above
    </button>
  )
}
```

Call sites: place **immediately after** each **Read** / **Unread** toggle button in all four view modes (`article`, `cards`, `magazine`, `title-only`).

Article-view className (match Read):

`rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] font-medium hover:border-[rgba(var(--accent-rgb),0.4)] disabled:opacity-50`

Cards/magazine/title-only: same but `text-[10px]` to match those Read buttons.

- [ ] **Step 5: Focus attributes on list rows**

In each `visible.map((article, index) => …)`:

- Add `data-news-index={index}` on the outer `<li>`
- Add focus ring when `focusedIndex === index`, e.g. append to className:

```ts
focusedIndex === index
  ? ' outline outline-2 outline-[rgba(var(--accent-rgb),0.55)] outline-offset-[-2px]'
  : ''
```

Apply consistently across all four view modes.

- [ ] **Step 6: Run Launchpad unit tests**

```bash
cd /Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher
npm test
```

Expected: all vitest + server tests PASS

- [ ] **Step 7: Manual smoke (Launchpad)**

1. Open News, scroll mid-list, click another group → feed at top  
2. Work ↔ Personal → feed at top  
3. Mark above on item 5 → items above marked read; item 5 unchanged until Read  
4. J/K moves focus ring; does not open tabs; ignored in search box  
5. Fetch now still works; no Refresh button  

- [ ] **Step 8: Commit (Dev-Launcher)**

```bash
git add src/components/NewsWorkspace.tsx
git commit -m "$(cat <<'EOF'
feat(news): scroll reset, Mark above, and J/K focus navigation

EOF
)"
```

---

### Task 5: Gemini Twins — mirror filter helpers

**Files:**
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins/frontend/src/lib/news/news-filters.ts`
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins/frontend/src/lib/news/news-filters.test.ts`

**Interfaces:**
- Same signatures as Tasks 1–2 (`markAboveUrls`, `nextNewsFocusIndex`, `clampNewsFocusIndex`)

- [ ] **Step 1: Copy the same failing tests** from Tasks 1–2 into `news-filters.test.ts` (import the three new symbols; keep existing `article()` helper).

- [ ] **Step 2: Run to verify fail**

```bash
cd /Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins/frontend
npx vitest run src/lib/news/news-filters.test.ts -t 'markAboveUrls|nextNewsFocusIndex|clampNewsFocusIndex'
```

Expected: FAIL

- [ ] **Step 3: Copy the same implementations** into `news-filters.ts` after `markReadUrls`.

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/lib/news/news-filters.test.ts -t 'markAboveUrls|nextNewsFocusIndex|clampNewsFocusIndex'
```

Expected: PASS

- [ ] **Step 5: Commit (Gemini-Twins repo)**

```bash
cd /Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins
git add frontend/src/lib/news/news-filters.ts frontend/src/lib/news/news-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(news): add markAboveUrls and J/K focus helpers

EOF
)"
```

---

### Task 6: Gemini Twins — mirror NewsWorkspace UI

**Files:**
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins/frontend/src/components/news/NewsWorkspace.tsx`

**Interfaces:**
- Same behavior as Task 4; GT has no `NewsWorkspace.test.ts` — rely on filters tests + manual smoke

- [ ] **Step 1: Remove Refresh toolbar button** (same deletion as Task 3; keep Fetch now).

- [ ] **Step 2: Wire scroll ref, focusedIndex, reset effects, J/K listener, `markAboveButton`, `data-news-index`, focus outline** — same as Task 4 Steps 1–5. Import helpers from `@/lib/news/news-filters` (or the relative path this file already uses for `markReadUrls`).

Confirm GT already has `newsFilterKey(filter)` (or equivalent) for the scroll effect dependency; if the local name differs, use the existing filter-key helper already used for view prefs.

- [ ] **Step 3: Run frontend tests**

```bash
cd /Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins/frontend
npm test
```

Expected: PASS

- [ ] **Step 4: Manual smoke (Gemini Twins)** — same checklist as Task 4 Step 7.

- [ ] **Step 5: Commit (Gemini-Twins)**

```bash
git add frontend/src/components/news/NewsWorkspace.tsx
git commit -m "$(cat <<'EOF'
feat(news): scroll reset, Mark above, J/K; remove Refresh

EOF
)"
```

---

### Task 7: Mark Shared-News spec implemented

**Files:**
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Shared-News/docs/superpowers/specs/2026-08-25-news-ui-scroll-mark-above-shortcuts-design.md`
- Modify: `/Users/nickadenton/NKA/Automation/Cursor/Shared-News/docs/superpowers/plans/2026-08-25-news-ui-scroll-mark-above-shortcuts.md` (this plan — checkboxes as completed when finishing)

- [ ] **Step 1: Update spec header status**

Change:

```markdown
> **Status:** Spec — awaiting implementation
```

to:

```markdown
> **Status:** Spec — implemented
```

- [ ] **Step 2: Commit (Shared-News)**

```bash
cd /Users/nickadenton/NKA/Automation/Cursor/Shared-News
git add docs/superpowers/specs/2026-08-25-news-ui-scroll-mark-above-shortcuts-design.md docs/superpowers/plans/2026-08-25-news-ui-scroll-mark-above-shortcuts.md
git commit -m "$(cat <<'EOF'
docs: mark news feed UX scroll/Mark above/J/K spec implemented

EOF
)"
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Scroll to top on filter + profile | 4, 6 |
| Mark above (exclude clicked) | 1, 4, 5, 6 |
| J/K focus only | 2, 4, 5, 6 |
| Remove Refresh / keep Fetch Now | 3, 6 |
| Both hosts | 1–4 Launchpad, 5–6 GT |
| No ingest/API changes | (none) |
| Tests for helpers + toolbar | 1–3, 5 |
| Spec status | 7 |
