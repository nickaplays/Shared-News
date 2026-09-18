# Hot / Cold Monthly Archive + Seen Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop pruned/retained articles from reviving as new unread by moving them into monthly cold archives with a compact `seen.json` index, protect unread/starred from eviction, and gate routine inserts by 30-day publish age except on first source seed.

**Architecture:** New `archive-store.js` owns `seen.json` I/O, monthly JSONL append, and archive-move. `prune-read.js` returns eligible rows instead of only dropping them; `applyRetainPolicy` consults user-state and returns evicted rows; `upsertArticles` skips seen URLs and age-gated items. `runIngest` wires ensure-archive → upsert → retain-archive → prune-archive → seed `seededAt` → last-run counts. `repair-seen.mjs` rebuilds the index from archive shards.

**Tech Stack:** Node ESM · `node:test` · `rss-parser` · existing Shared-News vault layout

**Spec:** [`docs/superpowers/specs/2026-09-18-hot-cold-archive-seen-design.md`](../specs/2026-09-18-hot-cold-archive-seen-design.md)

## Global Constraints

- Unread and starred never leave the hot store
- Leave-hot always **moves** full article rows to `archive/YYYY-MM.jsonl` (month of `archivedAt`) and upserts `archive/seen.json`
- Insert skip if URL in `seen.json`; routine sync also skips missing/invalid/`date` older than 30 days when source has `seededAt`
- New source (no `seededAt`): age gate off; set `seededAt` after first successful fetch+upsert for that feed
- Default `--max-retain=500`, `minPerSource=15`, prune `maxAgeDays=30` unchanged as numbers
- Host News UI stays hot-only; no archive browse/search/restore UI
- No backfill of historically deleted URLs
- Tests: `node --test *.test.js` from Shared-News repo root
- Do not commit secrets or live vault data

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `archive-store.js` | Create | Paths, seen I/O, ensure dir, append month file, `moveArticlesToArchive`, `rebuildSeenFromArchives` |
| `archive-store.test.js` | Create | Unit tests for seen + move + rebuild |
| `article-insert-gate.js` | Create | Pure `shouldInsertArticle` (seen + age + seeded) |
| `article-insert-gate.test.js` | Create | Gate matrix tests |
| `prune-read.js` | Modify | Return `removed` articles; keep eligibility rules |
| `prune-read.test.js` | Modify | Assert `removed` payloads |
| `articles-store.js` | Modify | `applyRetainPolicy` takes `byUrl`, never evicts unread/starred, returns `evicted`; `upsertArticles` accepts seen + seed/age options |
| `articles-store` tests in `ingest.test.js` / new asserts | Modify | Retain + upsert gate behavior |
| `ingest.mjs` | Modify | Ensure archive, load seen, gate upsert, archive on retain/prune, write `seededAt`, last-run keys |
| `ingest.test.js` | Modify | Archive revival, seed age, unread retain, last-run counts |
| `repair-seen.mjs` | Create | CLI `--profile` / `--dir` rebuild |
| `repair-seen.test.js` | Create | Rebuild after month delete |
| `README.md` | Modify | Document archive layout, repair, behavior |
| Spec status line | Modify | Mark in progress / implemented when done |

**Out of scope files:** Archive UI in Dev-Launcher / Gemini Twins. Host `updateSource` already allowlists fields (preserves `seededAt`); no host change unless a test proves `seededAt` is stripped.

---

### Task 1: `archive-store` — seen index + monthly move

**Files:**
- Create: `archive-store.js`
- Create: `archive-store.test.js`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`, `normalizeUrl` from `./normalize-url.js`
- Produces:
  - `archiveDir(newsDir)` → `path.join(newsDir, "archive")`
  - `seenPath(newsDir)` → `path.join(archiveDir(newsDir), "seen.json")`
  - `monthArchiveFileName(archivedAtIso)` → `"YYYY-MM.jsonl"` (UTC month from ISO string)
  - `async ensureArchiveLayout(newsDir)` → creates `archive/`, writes empty seen if missing
  - `async readSeen(newsDir)` → `{ version: 1, updatedAt: string | null, byUrl: Record<string, { archivedAt: string, archiveFile: string }> }`
  - `async writeSeen(newsDir, seen)` → writes pretty JSON + trailing newline
  - `async moveArticlesToArchive(newsDir, articles, { archivedAt = new Date().toISOString(), byUrl = {} } = {})` → `{ articlesRemoved: number, userStatePruned: number, nextByUrl, archivedAt, archiveFile }`
    - Appends each article as `{ ...article, url: normalizeUrl(article.url), archivedAt }` to `archive/<month>.jsonl`
    - Upserts `seen.byUrl[normalizedUrl]`
    - Deletes matching keys from a shallow copy of `byUrl`
  - `async rebuildSeenFromArchives(newsDir)` → rebuilds `seen.json` from all `archive/*.jsonl` (skip `seen.json`); last line wins per URL

- [ ] **Step 1: Write the failing tests**

Create `archive-store.test.js`:

```js
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureArchiveLayout,
  monthArchiveFileName,
  moveArticlesToArchive,
  readSeen,
  rebuildSeenFromArchives,
  seenPath,
} from "./archive-store.js";

describe("archive-store", () => {
  test("monthArchiveFileName uses UTC YYYY-MM", () => {
    assert.equal(
      monthArchiveFileName("2026-09-18T10:00:00.000Z"),
      "2026-09.jsonl",
    );
  });

  test("ensureArchiveLayout creates archive and empty seen", async () => {
    const newsDir = await mkdtemp(path.join(tmpdir(), "sn-arch-"));
    await ensureArchiveLayout(newsDir);
    const seen = await readSeen(newsDir);
    assert.equal(seen.version, 1);
    assert.deepEqual(seen.byUrl, {});
    assert.ok(
      (await readFile(seenPath(newsDir), "utf8")).includes('"byUrl"'),
    );
  });

  test("moveArticlesToArchive appends month file and updates seen + byUrl", async () => {
    const newsDir = await mkdtemp(path.join(tmpdir(), "sn-move-"));
    await ensureArchiveLayout(newsDir);
    const url = "https://example.com/a";
    const archivedAt = "2026-09-18T12:00:00.000Z";
    const result = await moveArticlesToArchive(
      newsDir,
      [
        {
          url,
          title: "A",
          date: "2026-07-01T00:00:00.000Z",
          sourceId: "f1",
        },
      ],
      {
        archivedAt,
        byUrl: { [url]: { read: true, readAt: "2026-07-02T00:00:00.000Z" } },
      },
    );
    assert.equal(result.articlesRemoved, 1);
    assert.equal(result.userStatePruned, 1);
    assert.equal(result.nextByUrl[url], undefined);
    assert.equal(result.archiveFile, "2026-09.jsonl");
    const body = await readFile(
      path.join(newsDir, "archive", "2026-09.jsonl"),
      "utf8",
    );
    const row = JSON.parse(body.trim());
    assert.equal(row.url, url);
    assert.equal(row.archivedAt, archivedAt);
    const seen = await readSeen(newsDir);
    assert.equal(seen.byUrl[url].archiveFile, "2026-09.jsonl");
  });

  test("rebuildSeenFromArchives rescans month files", async () => {
    const newsDir = await mkdtemp(path.join(tmpdir(), "sn-rebuild-"));
    await ensureArchiveLayout(newsDir);
    const dir = path.join(newsDir, "archive");
    await writeFile(
      path.join(dir, "2026-08.jsonl"),
      `${JSON.stringify({
        url: "https://example.com/old",
        archivedAt: "2026-08-01T00:00:00.000Z",
      })}\n`,
    );
    await writeFile(
      seenPath(newsDir),
      `${JSON.stringify({ version: 1, updatedAt: null, byUrl: {} }, null, 2)}\n`,
    );
    const seen = await rebuildSeenFromArchives(newsDir);
    assert.equal(
      seen.byUrl["https://example.com/old"].archiveFile,
      "2026-08.jsonl",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test archive-store.test.js`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `archive-store.js`**

```js
import { mkdir, readFile, readdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeUrl } from "./normalize-url.js";

export function archiveDir(newsDir) {
  return path.join(newsDir, "archive");
}

export function seenPath(newsDir) {
  return path.join(archiveDir(newsDir), "seen.json");
}

export function monthArchiveFileName(archivedAtIso) {
  const d = new Date(archivedAtIso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid archivedAt: ${archivedAtIso}`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}.jsonl`;
}

export async function ensureArchiveLayout(newsDir) {
  await mkdir(archiveDir(newsDir), { recursive: true });
  try {
    await readFile(seenPath(newsDir), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeSeen(newsDir, { version: 1, updatedAt: null, byUrl: {} });
  }
}

export async function readSeen(newsDir) {
  try {
    const parsed = JSON.parse(await readFile(seenPath(newsDir), "utf8"));
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? null,
      byUrl:
        parsed.byUrl && typeof parsed.byUrl === "object" ? parsed.byUrl : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 1, updatedAt: null, byUrl: {} };
    }
    throw error;
  }
}

export async function writeSeen(newsDir, seen) {
  await mkdir(archiveDir(newsDir), { recursive: true });
  await writeFile(
    seenPath(newsDir),
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: seen.updatedAt ?? new Date().toISOString(),
        byUrl: seen.byUrl || {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function moveArticlesToArchive(
  newsDir,
  articles,
  { archivedAt = new Date().toISOString(), byUrl = {} } = {},
) {
  await ensureArchiveLayout(newsDir);
  const archiveFile = monthArchiveFileName(archivedAt);
  const filePath = path.join(archiveDir(newsDir), archiveFile);
  const seen = await readSeen(newsDir);
  const nextByUrl = { ...byUrl };
  let articlesRemoved = 0;
  let userStatePruned = 0;
  const lines = [];

  for (const article of articles) {
    const key = normalizeUrl(article.url);
    lines.push(
      JSON.stringify({
        ...article,
        url: key,
        archivedAt,
      }),
    );
    seen.byUrl[key] = { archivedAt, archiveFile };
    articlesRemoved += 1;
    if (nextByUrl[key]) {
      delete nextByUrl[key];
      userStatePruned += 1;
    }
  }

  if (lines.length > 0) {
    await appendFile(filePath, `${lines.join("\n")}\n`, "utf8");
  }
  seen.updatedAt = archivedAt;
  await writeSeen(newsDir, seen);
  return { articlesRemoved, userStatePruned, nextByUrl, archivedAt, archiveFile };
}

export async function rebuildSeenFromArchives(newsDir) {
  await ensureArchiveLayout(newsDir);
  const dir = archiveDir(newsDir);
  const names = (await readdir(dir)).filter(
    (name) => name.endsWith(".jsonl") && name !== "seen.json",
  );
  const byUrl = {};
  for (const name of names.sort()) {
    let content = "";
    try {
      content = await readFile(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        if (!row?.url) continue;
        const key = normalizeUrl(row.url);
        byUrl[key] = {
          archivedAt: row.archivedAt || null,
          archiveFile: name,
        };
      } catch {
        // skip corrupt lines
      }
    }
  }
  const seen = {
    version: 1,
    updatedAt: new Date().toISOString(),
    byUrl,
  };
  await writeSeen(newsDir, seen);
  return seen;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test archive-store.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add archive-store.js archive-store.test.js
git commit -m "$(cat <<'EOF'
feat: add archive store with seen index and monthly move

EOF
)"
```

---

### Task 2: Insert gate (seen + age + seeded)

**Files:**
- Create: `article-insert-gate.js`
- Create: `article-insert-gate.test.js`

**Interfaces:**
- Consumes: none (pure)
- Produces:
  - `DEFAULT_INSERT_MAX_AGE_DAYS = 30`
  - `shouldInsertArticle(article, { seenByUrl, seeded, maxAgeDays = 30, nowMs = Date.now() })` → `{ insert: boolean, reason: null | "seen" | "age" }`
  - `seeded === true` means source has `seededAt`
  - If `seenByUrl[normalizeUrl(article.url)]` → `{ insert: false, reason: "seen" }` (caller may pass already-normalized map keys; gate must normalize)
  - If seeded and (invalid date or age > maxAgeDays) → `{ insert: false, reason: "age" }`
  - Else `{ insert: true, reason: null }`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INSERT_MAX_AGE_DAYS,
  shouldInsertArticle,
} from "./article-insert-gate.js";

const nowMs = Date.parse("2026-09-18T00:00:00.000Z");

describe("shouldInsertArticle", () => {
  test("exports 30-day default", () => {
    assert.equal(DEFAULT_INSERT_MAX_AGE_DAYS, 30);
  });

  test("blocks seen urls even when unseeded", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/a", date: "2026-01-01T00:00:00.000Z" },
      {
        seenByUrl: { "https://example.com/a": { archiveFile: "2026-08.jsonl" } },
        seeded: false,
        nowMs,
      },
    );
    assert.deepEqual(r, { insert: false, reason: "seen" });
  });

  test("unseeded allows old dates", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/b", date: "2025-01-01T00:00:00.000Z" },
      { seenByUrl: {}, seeded: false, nowMs },
    );
    assert.deepEqual(r, { insert: true, reason: null });
  });

  test("seeded blocks older than 30 days", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/c", date: "2026-08-01T00:00:00.000Z" },
      { seenByUrl: {}, seeded: true, nowMs },
    );
    assert.deepEqual(r, { insert: false, reason: "age" });
  });

  test("seeded allows recent dates", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/d", date: "2026-09-10T00:00:00.000Z" },
      { seenByUrl: {}, seeded: true, nowMs },
    );
    assert.deepEqual(r, { insert: true, reason: null });
  });

  test("seeded blocks invalid dates", () => {
    const r = shouldInsertArticle(
      { url: "https://example.com/e", date: "not-a-date" },
      { seenByUrl: {}, seeded: true, nowMs },
    );
    assert.deepEqual(r, { insert: false, reason: "age" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test article-insert-gate.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement `article-insert-gate.js`**

```js
import { normalizeUrl } from "./normalize-url.js";

export const DEFAULT_INSERT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldInsertArticle(
  article,
  {
    seenByUrl = {},
    seeded = false,
    maxAgeDays = DEFAULT_INSERT_MAX_AGE_DAYS,
    nowMs = Date.now(),
  } = {},
) {
  const key = normalizeUrl(article.url);
  if (seenByUrl[key]) {
    return { insert: false, reason: "seen" };
  }
  if (!seeded) {
    return { insert: true, reason: null };
  }
  const dateMs = Date.parse(article.date);
  if (!Number.isFinite(dateMs) || dateMs < nowMs - maxAgeDays * DAY_MS) {
    return { insert: false, reason: "age" };
  }
  return { insert: true, reason: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test article-insert-gate.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add article-insert-gate.js article-insert-gate.test.js
git commit -m "$(cat <<'EOF'
feat: add seen and age insert gate for ingest

EOF
)"
```

---

### Task 3: Prune returns `removed` rows for archive move

**Files:**
- Modify: `prune-read.js`
- Modify: `prune-read.test.js`

**Interfaces:**
- Consumes: existing eligibility rules
- Produces: same as today plus `removed: Article[]` (eligible articles in encounter order). Still filters them out of `articles` and clears `byUrl` keys. Ingest will call `moveArticlesToArchive` **before** relying on disk; pure function stays sync.

- [ ] **Step 1: Extend failing assertion in `prune-read.test.js`**

Add to the existing prune test that removes an old read article:

```js
assert.equal(result.removed.length, 1);
assert.equal(result.removed[0].url, "https://example.com/old");
```

(Use the URL already in that test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test prune-read.test.js`  
Expected: FAIL (`removed` undefined)

- [ ] **Step 3: Update `pruneReadArticles`**

Push eligible articles into `removed` before `continue`; return `removed` in the result object.

```js
export function pruneReadArticles(articles, byUrl, { maxAgeDays = 30, nowMs = Date.now() } = {}) {
  const cutoff = nowMs - maxAgeDays * DAY_MS;
  const nextByUrl = { ...(byUrl || {}) };
  let articlesPruned = 0;
  let userStatePruned = 0;
  const removed = [];
  const kept = [];

  for (const article of articles) {
    const key = article.url;
    const state = nextByUrl[key];
    const readAtMs = state?.readAt ? Date.parse(state.readAt) : NaN;
    const eligible =
      state?.read === true &&
      state?.starred !== true &&
      Number.isFinite(readAtMs) &&
      readAtMs < cutoff;
    if (eligible) {
      removed.push(article);
      articlesPruned += 1;
      if (nextByUrl[key]) {
        delete nextByUrl[key];
        userStatePruned += 1;
      }
      continue;
    }
    kept.push(article);
  }

  return {
    articles: kept,
    byUrl: nextByUrl,
    removed,
    articlesPruned,
    userStatePruned,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test prune-read.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add prune-read.js prune-read.test.js
git commit -m "$(cat <<'EOF'
feat: return pruned articles for archive move

EOF
)"
```

---

### Task 4: Retain consults user-state; return `evicted`

**Files:**
- Modify: `articles-store.js` (`applyRetainPolicy`)
- Modify: retain tests in `ingest.test.js` (existing `applyRetainPolicy` describe block)

**Interfaces:**
- Consumes: `byUrl` map keyed by normalized URL
- Produces: change signature to:

```js
applyRetainPolicy(articles, {
  maxRetain = DEFAULT_MAX_RETAIN,
  minPerSource = DEFAULT_MIN_PER_SOURCE,
  byUrl = {},
} = {})
// returns { articles: Article[], evicted: Article[] }
```

- Always keep if `byUrl[normalizeUrl(url)]` is missing, `read !== true`, or `starred === true`
- Only evictable rows participate in the cap / per-source floor among themselves; always-kept are unioned back
- If always-kept length alone exceeds `maxRetain`, return all always-kept + as many evictable as fit under maxRetain **without** evicting always-kept (hot may exceed maxRetain when always-kept > maxRetain: then `articles = alwaysKept`, `evicted = all former evictable`)

Algorithm (lock this):

1. Partition into `protected` and `evictable` using `byUrl` + `normalizeUrl`.
2. If `protected.length + evictable.length <= maxRetain`, return all, `evicted = []`.
3. Run existing newest-sort + minPerSource floor logic **only on `evictable`**, with effective cap `max(0, maxRetain - protected.length)`.
4. `keptEvictable` from that sub-policy; `evicted` = evictable not in kept.
5. Return `articles = [...protected, ...keptEvictable]` sorted by date desc; `evicted` unsorted or date desc.

Update call sites: `upsertArticles` currently calls `applyRetainPolicy` and expects an array — change upsert to either pass `applyRetain: false` always from ingest (ingest already does per-feed `applyRetain: false` then retain once) or unwrap `.articles`. Prefer: `applyRetainPolicy` always returns `{ articles, evicted }`; update `upsertArticles` internal call to use `.articles` and ignore evicted when `applyRetain: true` (legacy path), and update unit tests.

- [ ] **Step 1: Write failing retain tests**

Replace/extend the existing `applyRetainPolicy keeps a per-source floor` test and add:

```js
test("applyRetainPolicy never evicts unread or starred", () => {
  const byUrl = {
    "https://loud.example/1": { read: true, readAt: "2026-08-01T00:00:00.000Z" },
    "https://loud.example/2": { read: true, readAt: "2026-08-02T00:00:00.000Z" },
    "https://quiet.example/1": { read: false },
    "https://star.example/1": {
      read: true,
      readAt: "2026-01-01T00:00:00.000Z",
      starred: true,
    },
  };
  const articles = [
    /* four articles matching those urls with dates; loud ones newest */
  ];
  const { articles: kept, evicted } = applyRetainPolicy(articles, {
    maxRetain: 2,
    minPerSource: 1,
    byUrl,
  });
  assert.ok(kept.some((a) => a.url.includes("quiet")));
  assert.ok(kept.some((a) => a.url.includes("star")));
  assert.equal(
    kept.some((a) => a.url === "https://quiet.example/1"),
    true,
  );
  assert.ok(evicted.every((a) => byUrl[a.url]?.read === true));
});
```

Fill the `articles` array with the same shape as the existing retain test in `ingest.test.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test ingest.test.js --test-name-pattern="applyRetainPolicy"`  
Expected: FAIL (return shape / unread eviction)

- [ ] **Step 3: Implement retain changes in `articles-store.js`**

Implement partition + sub-cap as described. Update `upsertArticles` when `applyRetain` is true:

```js
const retained = applyRetainPolicy(articles, { maxRetain, minPerSource, byUrl: {} });
articles = retained.articles;
```

(Empty `byUrl` means nothing is `read === true` → everything protected → no eviction inside upsert; ingest is the real retain path.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test ingest.test.js`  
Expected: PASS (fix any callers that still expect an array from `applyRetainPolicy`)

- [ ] **Step 5: Commit**

```bash
git add articles-store.js ingest.test.js
git commit -m "$(cat <<'EOF'
feat: retain only read unstarred articles and return evicted

EOF
)"
```

---

### Task 5: `upsertArticles` applies insert gate

**Files:**
- Modify: `articles-store.js` (`upsertArticles`)
- Modify: `ingest.test.js` (upsert describe) or add cases in `article-insert-gate` integration via upsert tests

**Interfaces:**
- Add options: `seenByUrl = {}`, `seeded = false`, `maxAgeDays = 30`, `nowMs = Date.now()`
- Before insert of a missing URL, call `shouldInsertArticle`; if not insert, skip and tally is **not** done inside upsert — return also `skippedSeen` and `skippedAge` counts

```js
upsertArticles(existing, incoming, limits) 
// returns { articles, inserted, updated, considered, skippedSeen, skippedAge }
```

- [ ] **Step 1: Write failing upsert tests**

```js
test("upsertArticles skips seen and age-gated urls", () => {
  const existing = [];
  const incoming = [
    {
      url: "https://example.com/seen",
      title: "S",
      date: "2026-09-17T00:00:00.000Z",
      source: "T",
      sourceId: "t",
      engine: "roundup",
      summary: "",
      tags: [],
      category: "rss",
      processedAt: "2026-09-18T00:00:00.000Z",
    },
    {
      url: "https://example.com/old",
      title: "O",
      date: "2026-01-01T00:00:00.000Z",
      source: "T",
      sourceId: "t",
      engine: "roundup",
      summary: "",
      tags: [],
      category: "rss",
      processedAt: "2026-09-18T00:00:00.000Z",
    },
    {
      url: "https://example.com/new",
      title: "N",
      date: "2026-09-17T00:00:00.000Z",
      source: "T",
      sourceId: "t",
      engine: "roundup",
      summary: "",
      tags: [],
      category: "rss",
      processedAt: "2026-09-18T00:00:00.000Z",
    },
  ];
  const result = upsertArticles(existing, incoming, {
    applyRetain: false,
    seeded: true,
    nowMs: Date.parse("2026-09-18T00:00:00.000Z"),
    seenByUrl: {
      "https://example.com/seen": { archiveFile: "2026-08.jsonl" },
    },
  });
  assert.equal(result.inserted, 1);
  assert.equal(result.skippedSeen, 1);
  assert.equal(result.skippedAge, 1);
  assert.equal(result.articles[0].url, "https://example.com/new");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test ingest.test.js --test-name-pattern="skips seen"`  
Expected: FAIL

- [ ] **Step 3: Wire gate into `upsertArticles`**

Import `shouldInsertArticle`. On missing URL branch, gate before insert; increment skip counters.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test ingest.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add articles-store.js ingest.test.js
git commit -m "$(cat <<'EOF'
feat: skip seen and age-gated urls in upsert

EOF
)"
```

---

### Task 6: Wire `runIngest` end-to-end

**Files:**
- Modify: `ingest.mjs`
- Modify: `ingest.test.js`
- Modify: spec status in `docs/superpowers/specs/2026-09-18-hot-cold-archive-seen-design.md` to `Spec — in progress (package)` at start of this task if not already

**Interfaces:**
- After resolving `newsDir`, `await ensureArchiveLayout(newsDir)` and `const seen = await readSeen(newsDir)`
- Per feed upsert:

```js
const seeded = typeof feed.seededAt === "string" && feed.seededAt.trim() !== "";
const result = upsertArticles(articles, feedCandidates, {
  maxNew,
  applyRetain: false,
  seenByUrl: seen.byUrl,
  seeded,
});
articlesSkippedSeen += result.skippedSeen;
articlesSkippedAge += result.skippedAge;
```

- After all feeds succeed path: load user-state `byUrl`; run retain:

```js
const retained = applyRetainPolicy(articles, { maxRetain, minPerSource, byUrl });
articles = retained.articles;
if (retained.evicted.length) {
  const moved = await moveArticlesToArchive(newsDir, retained.evicted, { byUrl });
  byUrl = moved.nextByUrl;
  articlesArchivedRetain = moved.articlesRemoved;
  // refresh seen in memory from disk or merge moved keys into seen.byUrl
}
```

- Then prune:

```js
const pruned = pruneReadArticles(articles, byUrl, { maxAgeDays: 30 });
if (pruned.removed.length) {
  const moved = await moveArticlesToArchive(newsDir, pruned.removed, {
    byUrl: pruned.byUrl,
  });
  // Note: prune already cleared byUrl for removed; pass pruned.byUrl so move does not double-count userStatePruned — OR pass pre-prune byUrl and let move clear. Prefer: move with **pre-clear** byUrl copy, then use move.nextByUrl as SoT and skip prune's byUrl mutations for disk write.
}
```

**Preferred prune+archive sequence (lock this):**

1. `const eligible = pruneReadArticles(...)` for `removed` + kept articles only — use eligibility helper **or** keep prune as-is returning `removed` and `articles` / `byUrl`.  
2. `moveArticlesToArchive(newsDir, pruned.removed, { byUrl: originalByUrl })` so user-state keys are cleared in move.  
3. Hot articles = `pruned.articles`.  
4. Persist hot articles + `moved.nextByUrl` (merge: start from original, apply retain move, then prune move).

Simpler locked sequence:

1. Retain → move evicted (updates byUrl + seen)  
2. Prune on remaining articles with current byUrl → move `removed` (updates byUrl + seen)  
3. Write hot articles + user-state from final byUrl  
4. Set `articlesPruned` / `userStatePruned` from prune move counts for compatibility; also set `articlesArchivedPrune` / `articlesArchivedRetain`

- Mark feeds seeded: after a successful feed fetch+upsert in the loop, if `!feed.seededAt`, set `feed.seededAt = startedAt` (or `new Date().toISOString()`) and set `sourcesDirty = true`. After loop, if dirty, write `sources.json` with updated feeds (preserve groups and other fields).

- `last-run.json` / return value include: `articlesArchivedPrune`, `articlesArchivedRetain`, `articlesSkippedSeen`, `articlesSkippedAge`, and keep `articlesPruned` / `userStatePruned` equal to prune-path archive counts for old tests.

- [ ] **Step 1: Write failing integration tests in `ingest.test.js`**

1. Extend existing prune test: after ingest, `archive/YYYY-MM.jsonl` contains old URL, `seen.json` has it, hot does not; second ingest with that URL in RSS does not re-insert (`articlesInserted === 0` for that url).  
2. New test: unseeded feed inserts item dated 60 days ago; after run `seededAt` set; second run with same old URL not in hot already… actually first run inserts it; for age gate on second run use a **different** old URL still in RSS → skippedAge >= 1.  
3. New test: unread survives retain with `maxRetain: 1` while many read articles archive.

Use fixed `archivedAt` via injecting time only through article dates / readAt; month file name follows `new Date()` at move time — in tests assert `seen.byUrl[oldUrl]` exists and some `archive/*.jsonl` contains the url (glob read), rather than hard-coding month if flaky across month boundaries. Prefer passing deterministic clock: optional `nowMs` on `runIngest` for tests only:

```js
// add optional nowMs to runIngest options; default Date.now()
// pass to prune, gate, and moveArticlesToArchive archivedAt = new Date(nowMs).toISOString()
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `node --test ingest.test.js`  
Expected: FAIL on new assertions

- [ ] **Step 3: Implement wiring in `ingest.mjs`**

Follow the preferred sequence above. Re-read `seen` after moves or merge into local `seen.byUrl` so later feeds in the same run see new tombstones (retain/prune happen after all feed upserts, so mid-run only matters for multi-feed upsert of same URL — seen loaded once at start is enough for insert gate; moves happen after all upserts).

- [ ] **Step 4: Run full package tests**

Run: `node --test *.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ingest.mjs ingest.test.js docs/superpowers/specs/2026-09-18-hot-cold-archive-seen-design.md
git commit -m "$(cat <<'EOF'
feat: archive on prune/retain and gate re-ingest via seen

EOF
)"
```

---

### Task 7: `repair-seen` CLI

**Files:**
- Create: `repair-seen.mjs`
- Create: `repair-seen.test.js`
- Modify: `README.md`

**Interfaces:**
- CLI: `node repair-seen.mjs [--profile=work|personal] [--dir=/abs/store]`
- Uses `resolveNewsDir` like ingest; calls `rebuildSeenFromArchives(storeDir)`; prints JSON summary `{ urls: number, storeDir }`
- Export `repairSeen({ newsDir })` for tests

- [ ] **Step 1: Write failing test**

```js
test("repairSeen rebuilds after month file exists", async () => {
  const newsDir = await mkdtemp(path.join(tmpdir(), "sn-repair-"));
  await ensureArchiveLayout(newsDir);
  await writeFile(
    path.join(newsDir, "archive", "2026-07.jsonl"),
    `${JSON.stringify({
      url: "https://example.com/z",
      archivedAt: "2026-07-15T00:00:00.000Z",
    })}\n`,
  );
  await writeSeen(newsDir, { version: 1, updatedAt: null, byUrl: {} });
  const { repairSeen } = await import("./repair-seen.mjs");
  const result = await repairSeen({ newsDir });
  assert.equal(result.urls, 1);
  const seen = await readSeen(newsDir);
  assert.ok(seen.byUrl["https://example.com/z"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test repair-seen.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement `repair-seen.mjs`**

Mirror `ingest.mjs` CLI argv/`resolveNewsDir`/`main` pattern; body calls `rebuildSeenFromArchives`.

- [ ] **Step 4: Update README**

Document:

```
archive/
  YYYY-MM.jsonl
  seen.json
```

Behavior: unread/starred stay hot; prune/retain move to archive; routine sync skips seen + >30d when seeded; `node repair-seen.mjs --profile=work` after manually deleting a month file.

- [ ] **Step 5: Run tests + commit**

Run: `node --test *.test.js`  
Expected: PASS

```bash
git add repair-seen.mjs repair-seen.test.js README.md
git commit -m "$(cat <<'EOF'
feat: add repair-seen CLI and document archive layout

EOF
)"
```

---

### Task 8: Host sanity (Dev-Launcher only if needed)

**Files:**
- Verify only: `Dev-Launcher/server/sharedNews.js` `updateSource` allowlist
- Optional test in Dev-Launcher if `seededAt` would be stripped — **expected: no code change**

- [ ] **Step 1: Confirm `updateSource` allowedKeys are `enabled|label|url|kind|groupId` only**

Read `sharedNews.js` — if true, skip code changes.

- [ ] **Step 2: Manual note in commit or skip commit**

If no changes: no commit. If somehow `seededAt` is copied from a full feed replace path, fix that path to preserve unknown fields on write.

- [ ] **Step 3: Mark spec implemented**

Set design spec status to `Spec — implemented (package)`; host UI archive still deferred.

```bash
git add docs/superpowers/specs/2026-09-18-hot-cold-archive-seen-design.md
git commit -m "$(cat <<'EOF'
docs: mark hot/cold archive spec implemented for package

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Unread/starred never leave hot | Task 4 |
| Move to monthly archive on prune/retain | Tasks 1, 3, 6 |
| `seen.json` blocks re-insert | Tasks 2, 5, 6 |
| 30-day gate when seeded | Tasks 2, 5, 6 |
| New source full window + `seededAt` | Task 6 |
| Hot-only host UI | Task 8 (no UI) |
| Repair after manual month delete | Task 7 |
| last-run skip/archive counts | Task 6 |
| No historical backfill | Task 6 (ensure empty seen only) |

No TBD placeholders remain in task steps. Return shapes are consistent: `applyRetainPolicy` → `{ articles, evicted }`; `upsertArticles` → includes `skippedSeen` / `skippedAge`; `moveArticlesToArchive` → `{ articlesRemoved, userStatePruned, nextByUrl, archivedAt, archiveFile }`.
