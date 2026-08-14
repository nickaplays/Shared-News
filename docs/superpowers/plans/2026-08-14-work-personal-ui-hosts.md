# Work / Personal UI Hosts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Dev Launchpad and Gemini Twins each toggle Work vs Personal, read/write the matching vault store, and spawn ingest with `--profile`, so both UIs are ready to test (then run migrate once).

**Architecture:** `SHARED_NEWS_DIR` stays the profiles root. Each host resolves `work`/`personal` the same way Shared-News does (Work falls back to the parent folder until `work/sources.json` exists). The toggle is per app (Launchpad `settings.json`; Gemini Twins `localStorage`). News HTTP takes `profile` (query or body); default `work`. Ingest spawn passes `--profile=` and keys the 409 lock by profile.

**Tech Stack:** Node ESM · Express · React · `node:test` / Vitest · Shared-News CLI already on Shared-News `main`

**Spec:** Shared-News `docs/superpowers/specs/2026-08-14-work-personal-profiles-design.md` §6–7

## Global Constraints

- Profile names: `work` and `personal` only; default `work`
- `SHARED_NEWS_DIR` is the **parent** (`…/Nicka-Notes/shared/news`)
- Work fallback: if `work/sources.json` is missing and parent `sources.json` exists, use the parent (remove after migrate)
- Personal never falls back
- Toggle is **per app**, not a global vault flag; do not write profile into `user-state.json`
- Ingest 409 is **per profile**
- Spawn: `SHARED_NEWS_DIR` = parent, plus `--profile=work|personal` (do not pass `--dir=` for normal UI ingest)
- Do **not** run live `migrate-profiles.mjs` until Tasks 1–7 are in both UIs
- Do not drop Work fallback in this plan
- Do not move YouTube `@handle` resolve into Shared-News

---

## File Map

### Dev-Launcher (`/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher`)

| Path | Action |
|------|--------|
| `server/newsProfile.js` | Create: `NEWS_PROFILES`, `parseNewsProfile`, `getSharedNewsRoot`, `resolveNewsStoreDir` |
| `server/newsProfile.test.js` | Create |
| `server/sharedNews.js` | Modify: `getSharedNewsDir` → async `(profile)`, thread `profile` through exports |
| `server/sharedNewsIngest.js` | Modify: `--profile=`, lock `Set` per profile, `SHARED_NEWS_DIR` = root |
| `server/sharedNewsIngest.test.js` | Modify: 409 other profile allowed; spawn args include `--profile=` |
| `server/settings.js` | Modify: `newsProfile: 'work' \| 'personal'` |
| `server/settings.test.js` | Modify |
| `server/index.js` | Modify: parse profile on `/api/news*` |
| `src/lib/newsApi.ts` | Modify: pass `profile` on every news call |
| `src/components/NewsWorkspace.tsx` | Modify: Work/Personal toggle |
| `src/hooks/useHiddenApps.ts` (or settings fetch) | Modify if settings type must include `newsProfile` |

### Gemini Twins (`/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins`)

| Path | Action |
|------|--------|
| `backend/news-profile.js` | Create (same helpers as Launchpad) |
| `backend/tests/news-profile.test.js` | Create |
| `backend/shared-news-store.js` | Modify: `getSharedNewsDir(profile)` async |
| `backend/shared-news-catalog.js` | Modify: thread `profile` |
| `backend/shared-news-ingest.js` | Modify: `--profile=` + per-profile 409 |
| `backend/server.js` | Modify: `/api/news*` parse profile |
| `frontend/src/lib/news/news-api.ts` (or equivalent) | Modify: pass profile |
| `frontend/src/components/news/NewsWorkspace.tsx` | Modify: toggle + `localStorage` key `gemini-twins.newsProfile` |

### Shared-News (operator only, last)

| Path | Action |
|------|--------|
| Live vault | Run `migrate-profiles.mjs` **after** both UIs ship |
| Fallback comments | Leave in place until a later “drop fallback” slice |

---

### Task 1: Dev-Launcher `newsProfile` resolver

**Files:**
- Create: `Dev-Launcher/server/newsProfile.js`
- Create: `Dev-Launcher/server/newsProfile.test.js`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`
- Produces:
  - `NEWS_PROFILES = Object.freeze(['work', 'personal'])`
  - `DEFAULT_NEWS_PROFILE = 'work'`
  - `parseNewsProfile(value)` → `'work' | 'personal'` (undefined/null/'' → work; invalid → throw `Error` with `code: 'BAD_REQUEST'`, message `profile must be work or personal`)
  - `getSharedNewsRoot()` → env `SHARED_NEWS_DIR` or `path.join(vaultRoot, 'shared', 'news')` — **parent**, same default as today’s `getSharedNewsDir`
  - `async resolveNewsStoreDir(root, profile)` → absolute store path (Work fallback)

Work from: `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher`

- [ ] **Step 1: Write failing tests** in `server/newsProfile.test.js`

```js
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  DEFAULT_NEWS_PROFILE,
  NEWS_PROFILES,
  parseNewsProfile,
  resolveNewsStoreDir,
} from './newsProfile.js'

describe('parseNewsProfile', () => {
  test('defaults to work', () => {
    assert.equal(parseNewsProfile(undefined), 'work')
    assert.equal(parseNewsProfile(''), DEFAULT_NEWS_PROFILE)
  })
  test('accepts work and personal', () => {
    assert.deepEqual([...NEWS_PROFILES], ['work', 'personal'])
    assert.equal(parseNewsProfile('personal'), 'personal')
  })
  test('rejects unknown', () => {
    assert.throws(
      () => parseNewsProfile('family'),
      (err) => err.code === 'BAD_REQUEST',
    )
  })
})

describe('resolveNewsStoreDir', () => {
  test('work falls back to parent when work/sources.json is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'np-'))
    await writeFile(path.join(root, 'sources.json'), '{"feeds":[]}\n')
    assert.equal(await resolveNewsStoreDir(root, 'work'), root)
  })
  test('work uses work/ when sources exist there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'np2-'))
    await mkdir(path.join(root, 'work'))
    await writeFile(path.join(root, 'work', 'sources.json'), '{"feeds":[]}\n')
    assert.equal(
      await resolveNewsStoreDir(root, 'work'),
      path.join(root, 'work'),
    )
  })
  test('personal never falls back', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'np3-'))
    await writeFile(path.join(root, 'sources.json'), '{"feeds":[]}\n')
    assert.equal(
      await resolveNewsStoreDir(root, 'personal'),
      path.join(root, 'personal'),
    )
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL** (module missing)

Run: `node --test server/newsProfile.test.js`

- [ ] **Step 3: Implement `server/newsProfile.js`**

```js
import { access } from 'node:fs/promises'
import path from 'node:path'
import { getAppsMdPath } from './config.js'

export const NEWS_PROFILES = Object.freeze(['work', 'personal'])
export const DEFAULT_NEWS_PROFILE = 'work'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export function parseNewsProfile(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_NEWS_PROFILE
  }
  if (typeof value !== 'string' || !NEWS_PROFILES.includes(value)) {
    const err = new Error('profile must be work or personal')
    err.code = 'BAD_REQUEST'
    throw err
  }
  return value
}

export function getSharedNewsRoot() {
  const fromEnv = process.env.SHARED_NEWS_DIR?.trim()
  if (fromEnv) return fromEnv
  return path.join(path.dirname(getAppsMdPath()), 'shared', 'news')
}

/** Work parent fallback: remove after vault migrate + both UIs on nested paths. */
export async function resolveNewsStoreDir(root, profile) {
  const selected = parseNewsProfile(profile)
  const nested = path.join(root, selected)
  if (selected === 'work') {
    const nestedSources = path.join(nested, 'sources.json')
    const parentSources = path.join(root, 'sources.json')
    if (!(await exists(nestedSources)) && (await exists(parentSources))) {
      return root
    }
  }
  return nested
}
```

- [ ] **Step 4: Run `node --test server/newsProfile.test.js` — expect PASS**

- [ ] **Step 5: Commit** in Dev-Launcher

```bash
git add server/newsProfile.js server/newsProfile.test.js
git commit -m "feat: resolve work and personal news store dirs"
```

---

### Task 2: Dev-Launcher settings `newsProfile` + ingest `--profile` + 409 map

**Files:**
- Modify: `server/settings.js`, `server/settings.test.js`
- Modify: `server/sharedNewsIngest.js`, `server/sharedNewsIngest.test.js`

**Interfaces:**
- Consumes: `parseNewsProfile`, `getSharedNewsRoot` from `./newsProfile.js`
- Produces:
  - `LauncherSettings.newsProfile`: `'work' | 'personal'` (default `'work'`)
  - `runSharedNewsIngest({ feedId, maxNew, profile })` appends `--profile=${profile}` (default work); env `SHARED_NEWS_DIR` = **root** (parent); last-run read from `await resolveNewsStoreDir(root, profile)`
  - Lock: `ingestRunningByProfile = new Set()`; same profile → `INGEST_IN_PROGRESS`; other profile allowed

- [ ] **Step 1: Failing tests**

`settings.test.js` — default includes `newsProfile: 'work'`; save round-trip `'personal'`; invalid stored value falls back to work.

`sharedNewsIngest.test.js` — extend the concurrent test: first call `{ profile: 'work' }` holds the lock; second `{ profile: 'personal' }` must **not** throw `INGEST_IN_PROGRESS`. Add a test that spawn args include `--profile=work` (inspect `spawn` mock args).

- [ ] **Step 2: Run those tests — expect FAIL**

- [ ] **Step 3: Implement**

In `defaultSettings` / `loadSettingsFrom` / `saveSettingsTo` add:

```js
newsProfile: parseNewsProfile(parsed?.newsProfile ?? current.newsProfile ?? 'work')
```

Wrap `parseNewsProfile` in try/catch in load path so a corrupt file still returns `'work'`.

In `sharedNewsIngest.js`:

```js
const ingestRunningByProfile = new Set()

export async function runSharedNewsIngest(options = {}, dependencies = {}) {
  const normalized = normalizeIngestOptions(options)
  const profile = parseNewsProfile(options.profile)
  if (ingestRunningByProfile.has(profile)) throw ingestInProgressError()
  ingestRunningByProfile.add(profile)
  const root = getSharedNewsRoot()
  const storeDir = await resolveNewsStoreDir(root, profile)
  const args = ['ingest.mjs', `--profile=${profile}`]
  if (normalized.feedId !== undefined) args.push(`--feed-id=${normalized.feedId}`)
  args.push(`--max-new=${normalized.maxNew}`)
  try {
    const child = spawn(process.execPath, args, {
      cwd: resolveSharedNewsRoot(),
      env: { ...process.env, SHARED_NEWS_DIR: root },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    await waitForChild(child)
    return JSON.parse(await readFile(path.join(storeDir, 'last-run.json'), 'utf8'))
  } finally {
    ingestRunningByProfile.delete(profile)
  }
}
```

- [ ] **Step 4: `node --test server/settings.test.js server/sharedNewsIngest.test.js` — PASS**

- [ ] **Step 5: Commit** `feat: persist newsProfile and ingest per profile`

---

### Task 3: Dev-Launcher thread `profile` through news APIs

**Files:**
- Modify: `server/sharedNews.js`
- Modify: `server/index.js`
- Modify: existing `server/sharedNews*.test.js` only if they break (default profile `work` + parent fallback should keep temp dirs working)

**Interfaces:**
- Replace `getSharedNewsDir()` with `async function getSharedNewsDir(profile)` = `resolveNewsStoreDir(getSharedNewsRoot(), parseNewsProfile(profile))`
- Every exported mutating/load function takes `profile` (optional, default work) as last options field or first options field: `loadSharedNews({ includeHidden, profile })`, `createSource(input, { seed, runIngest, profile })`, `updateSource(id, patch, { profile })`, `deleteSource(id, { profile })`, groups + `patchSharedNewsUserState(urls, patch, { profile })`
- Internal `readSourcesDoc` / `writeSourcesDoc` take `newsDir` resolved once at the export boundary
- `index.js`: `const profile = parseNewsProfile(req.query.profile ?? req.body?.profile)` on every `/api/news*` handler; pass into the sharedNews call. 400 on BAD_REQUEST.

- [ ] **Step 1: Add a focused test** in `sharedNews.sources.test.js` (or new `sharedNews.profile.test.js`): two temp trees under one root (`work/sources.json` vs `personal/sources.json`); `loadSharedNews({ profile: 'personal' })` returns personal feeds only.

- [ ] **Step 2: Run that test — FAIL until wiring exists**

- [ ] **Step 3: Thread `profile` as specified.** Keep `getSharedNewsDir` export for ingest tests but make it async.

- [ ] **Step 4: `node --test server/*.test.js` — PASS**

- [ ] **Step 5: Commit** `feat: news APIs scoped to work or personal profile`

---

### Task 4: Dev Launchpad Work/Personal toggle

**Files:**
- Modify: `src/lib/newsApi.ts`
- Modify: `src/components/NewsWorkspace.tsx`
- Modify: settings client types (`src/hooks/useHiddenApps.ts` or wherever GET `/api/settings` is typed)

**Interfaces:**
- `newsApi` functions take `profile: 'work' | 'personal'`
- `fetchNews(profile)` → `GET /api/news?profile=`
- POST bodies include `{ ..., profile }`
- Toggle: two buttons **Work** | **Personal** in the News header (left of the view picker), `aria-pressed`, accent when selected
- Persist via existing settings PUT (`newsProfile`). Load on mount from GET `/api/settings`. Default work.
- On toggle: save settings, clear search/filter sticky as if filter key changed, `fetchNews` again

- [ ] **Step 1: Add a small unit test** if the repo has component tests; otherwise add `src/lib/newsApi.test.ts` (or extend an existing test) asserting `fetchNews('personal')` hits `/api/news?profile=personal` (mock `fetch`).

- [ ] **Step 2: FAIL then implement newsApi + toggle UI**

Toggle markup (place in the header flex next to the title or before `NewsViewPicker`):

```tsx
<div className="inline-flex rounded-lg border border-[var(--border)] p-0.5" role="group" aria-label="News profile">
  {(['work', 'personal'] as const).map((p) => (
    <button
      key={p}
      type="button"
      aria-pressed={profile === p}
      disabled={busy}
      onClick={() => void setNewsProfile(p)}
      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
        profile === p
          ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--accent)]'
          : 'text-[var(--muted)] hover:text-[var(--text)]'
      }`}
    >
      {p}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Manual check** `npm run dev` — Work still shows current catalog (fallback). Personal empty/missing until migrate.

- [ ] **Step 4: Commit** `feat: Work and Personal news toggle`

---

### Task 5: Gemini Twins resolver (same contract as Task 1)

**Files:**
- Create: `Gemini-Twins/backend/news-profile.js`
- Create: `Gemini-Twins/backend/tests/news-profile.test.js`

Copy the Task 1 helper, but `getSharedNewsRoot` should match today’s `getSharedNewsDir` in `shared-news-store.js` (env or `path.join(resolveVaultRoot(), 'shared', 'news')`). Do not import Dev-Launcher files.

Work from: `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins`

- [ ] **Step 1–5:** Same tests/implementation as Task 1, GT paths, commit `feat: resolve work and personal news store dirs`

---

### Task 6: Gemini Twins ingest `--profile` + 409 map + catalog thread

**Files:**
- Modify: `backend/shared-news-ingest.js` and `backend/tests/shared-news-ingest.test.js`
- Modify: `backend/shared-news-store.js` — `getSharedNewsDir` becomes async `(profile)`
- Modify: `backend/shared-news-catalog.js` — thread `profile` like Launchpad Task 3
- Modify: `backend/server.js` — parse `req.query.profile ?? req.body?.profile` on `/api/news*`

**Interfaces:** Same spawn contract as Launchpad Task 2 (`SHARED_NEWS_DIR` = root, `--profile=`). Same `Set` lock per profile.

- [ ] **Step 1: Failing tests** for spawn args + two-profile 409 (mirror Launchpad)

- [ ] **Step 2: Implement ingest + thread catalog `loadSharedNewsBundle({ profile })` etc.**

- [ ] **Step 3: Run GT backend news tests — PASS**

- [ ] **Step 4: Commit** `feat: news APIs and ingest scoped to profile`

---

### Task 7: Gemini Twins toggle + localStorage

**Files:**
- Modify: frontend news API module (same folder as existing `fetch` to `/api/news`)
- Modify: `frontend/src/components/news/NewsWorkspace.tsx`

**Interfaces:**
- Persist `localStorage['gemini-twins.newsProfile']` = `work` | `personal` (default work). Not `user-state.json`.
- Same toggle UI as Launchpad (reuse the same button group markup)
- All news fetches include `profile`

- [ ] **Step 1: Implement toggle + wire fetch**

- [ ] **Step 2: `npm test` / project test command for frontend news if present**

- [ ] **Step 3: Manual** — Launchpad on Work, GT on Personal (after migrate) must not clobber each other’s saved toggle

- [ ] **Step 4: Commit** `feat: Work and Personal news toggle`

---

### Task 8: Operator migrate + test protocol (no code drop-fallback)

**Do this only after Tasks 1–7 are running in both UIs.**

Work from Shared-News:

```bash
export SHARED_NEWS_DIR="/Users/nickadenton/NKA/Obsidian/Automation-Projects/Nicka-Notes/shared/news"
node migrate-profiles.mjs
```

Expect JSON `{ ok: true, skipped: false, moved: [...], createdPersonal: true }`. Parent must no longer have live `sources.json`. `work/` has the old catalog. `personal/` empty feeds.

**Test checklist**

1. Restart Launchpad and Gemini Twins.  
2. Launchpad **Work**: previous articles still there.  
3. Launchpad **Personal**: empty sources; add one RSS feed; seed appears; **Fetch now** only updates personal `last-run.json`.  
4. Gemini Twins toggle **Personal**: sees that feed/articles. Toggle **Work**: old catalog.  
5. Set Launchpad to Work and GT to Personal at the same time — lists stay different.  
6. Star an article on Personal; Launchpad Work must not show that star.  
7. Concurrent **Fetch now** on Work (Launchpad) while Personal ingest runs (GT) — neither 409s the other. Same profile twice → 409.  
8. Do **not** drop Work fallback in this slice.

- [ ] **Step 1: Run migrate** (operator)

- [ ] **Step 2: Walk the checklist**

- [ ] **Step 3: Commit nothing in Shared-News unless you add a short “migrate done” note to the spec status line** (`Spec — implemented (package + hosts); fallback still on`)

---

## Spec coverage

| Spec § | Task |
|--------|------|
| Package CLI / migrate / launchd | Done on Shared-News `main` |
| §6.1 path + Work fallback | 1, 5 |
| §6.2 per-app toggle | 2+4 (Launchpad settings), 7 (GT localStorage) |
| §6.3 ingest `--profile` + 409 per profile | 2, 6 |
| §7 rollout 2–4 | 1–8 |
| §7 step 5 drop fallback | **Out of this plan** |

## Ready for testing after

- Tasks 1–4: Launchpad can toggle; Work uses today’s vault via fallback; Personal empty until Task 8.  
- Tasks 5–7: GT same.  
- Task 8: real two-account data.
