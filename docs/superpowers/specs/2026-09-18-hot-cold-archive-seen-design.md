# Shared News — Hot store + monthly cold archive + seen index

> **Date:** 2026-09-18  
> **Status:** Spec — approved for planning  
> **App:** Shared News (package primary); Dev Launchpad + Gemini Twins (seed metadata / no archive UI yet)  
> **Repos:**  
> - `/Users/nickadenton/NKA/Automation/Cursor/Shared-News`  
> - `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher` (seed / `seededAt` only as needed)  
> - `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins` (same, if it seeds sources)  
> **Approach:** Monthly archive shards + compact `seen.json` (Approach B); 30-day publish-date gate on routine sync with new-source seed exception

## 1. Problem

Ingest upserts any RSS URL missing from hot `articles.jsonl`. Two removal paths delete rows without remembering them:

1. **Prune** — `read === true`, not starred, `readAt` older than 30 days → remove article and clear `user-state` for that URL.  
2. **Retain** — keep newest ~500 (with per-source floor); drop the rest regardless of read/unread.

If a removed URL is still in the feed’s RSS window, the next ingest inserts it again with no user-state → it appears as a **new unread** article. Unread can also be retain-evicted today, which violates “unread stay until the user deals with them.”

## 2. Goals / Non-goals

### Goals

1. **Unread and starred never leave the hot store** (neither prune nor retain).  
2. Anything that leaves hot is **moved to cold archive**, not deleted.  
3. Re-ingest **never** resurrects a known URL as a new/unread hot article.  
4. **New sources** still get a full first-sync window (including items older than 30 days).  
5. Routine sync for already-seeded sources applies a **30-day publish-date gate** for unknown URLs.  
6. Hot path stays small; history lives in **monthly** archive files for later search/recovery and manual delete.  
7. Ingest stays fast via a compact **`seen.json`** index (do not open every archive file each run).

### Non-goals

- Archive browse / search / restore UI in Launchpad or Gemini Twins (layout must support it later).  
- Changing the default News UI to load cold archives.  
- HTTP ingest server or schema changes to article JSONL field shapes (beyond move + index).  
- Backfilling `seen.json` for URLs already deleted before this ships.  
- Auto-deleting archive months (operator may `rm` month files manually).

## 3. Locked decisions

| Decision | Choice |
|----------|--------|
| Removal | Move to cold, never hard-delete article body on prune/retain |
| Hot eligibility for eviction | Only `read === true` and not starred |
| Unread / starred | Never pruned, never retain-evicted (hot may exceed `--max-retain`) |
| Archive shard key | Calendar month of **leave-hot time** (`archivedAt`), `YYYY-MM.jsonl` |
| Seen index | `archive/seen.json` — URL → `{ archivedAt, archiveFile }` |
| Routine age gate | Skip insert if article `date` older than 30 days **and** source already seeded |
| New source | First successful ingest seeds the source; age gate off until then |
| Missing / invalid `date` | Routine sync: skip; first seed: allow |
| Host UI | Hot-only; no archive UI in this change |
| Migration | Empty `archive/` + empty `seen.json`; fill on first prune/retain after deploy |
| Manual month delete | Drop matching `seen.json` entries (or repair rebuilds `seen` from remaining archives) so re-ingest can happen if desired |

---

## 4. Vault layout (per profile)

Under `shared/news/work/` or `shared/news/personal/`:

```
articles.jsonl              # hot: unread + starred + recent read
user-state.json
sources.json
last-run.json
archive/
  2026-08.jsonl             # cold full article lines
  2026-09.jsonl
  seen.json                 # compact URL index for ingest
```

### 4.1 `archive/seen.json`

```json
{
  "version": 1,
  "updatedAt": "2026-09-18T00:00:00.000Z",
  "byUrl": {
    "https://example.com/a": {
      "archivedAt": "2026-09-18T00:00:00.000Z",
      "archiveFile": "2026-09.jsonl"
    }
  }
}
```

URLs are stored **normalized** (same `normalizeUrl` as hot upsert).

### 4.2 Archive JSONL line

Same article object as hot, plus:

```json
{
  "url": "https://example.com/a",
  "title": "…",
  "date": "2026-07-01T00:00:00.000Z",
  "sourceId": "…",
  "archivedAt": "2026-09-18T00:00:00.000Z"
}
```

Other existing article fields are preserved unchanged.

### 4.3 Source seed metadata

On the source object in `sources.json` (or adjacent catalog field owned by hosts — package must read it):

| Field | Meaning |
|-------|---------|
| `seededAt` | ISO timestamp set after the source’s **first successful ingest** that considered that feed (package may set it; hosts must not clear it on edit) |

Absence of `seededAt` ⇒ treat as unseeded (age gate off).

---

## 5. Pipeline

### 5.1 Insert (per feed item)

1. Normalize URL.  
2. If URL in hot store → update path only (existing upsert merge rules); do not count as insert.  
3. If URL in `seen.json` → **skip** (no hot insert, no “new unread”).  
4. If source has `seededAt` and article `date` is missing/invalid or older than 30 days → **skip**.  
5. If source has no `seededAt` → age gate off (still respect steps 2–3).  
6. Else insert into hot as today (unread).

After a feed’s first successful fetch+upsert pass in a run that included that feed, set `seededAt` if unset.

### 5.2 Leave hot (archive move)

Shared helper used by prune and retain:

1. Append full article (+ `archivedAt`) to `archive/YYYY-MM.jsonl` for the leave-hot month.  
2. Upsert `seen.json` entry.  
3. Remove from hot `articles.jsonl`.  
4. Remove that URL’s entry from `user-state.byUrl` (same cleanup prune does today). Rely on `seen.json` for “already known.”

### 5.3 Prune

Unchanged eligibility, new action:

- Eligible: `read === true`, not starred, finite `readAt`, `readAt` older than 30 days.  
- Action: archive move (5.2), not delete-only.

### 5.4 Retain

- Default `--max-retain=500`, `minPerSource=15` unchanged as numbers.  
- Retain must consult `user-state.byUrl` (today it only looks at articles).  
- **Always keep:** no state, `read !== true`, or `starred === true`.  
- **Candidates for eviction:** `read === true` and not starred.  
- If always-kept rows alone exceed `maxRetain`, hot size wins over the cap (do not archive unread/starred).  
- Among evictable rows, apply existing newest-first / per-source floor logic; evicted rows use archive move (5.2).

### 5.5 Re-ingest of archived URL

No hot insert. Do not pull the cold row back automatically. (Future restore UI may copy cold → hot and clear `seen` / adjust state.)

### 5.6 Concurrent edits

Keep today’s `user-state` mtime guard before prune/archive writes.

### 5.7 `last-run.json`

Add these counts (keep existing `articlesPruned` / `userStatePruned` as prune-path leave-hot counts for compatibility, or alias — implementation may set `articlesPruned` equal to prune-archived count):

| Key | Meaning |
|-----|---------|
| `articlesArchivedPrune` | Left hot via 30-day read prune → archive |
| `articlesArchivedRetain` | Left hot via retain → archive |
| `articlesSkippedSeen` | RSS items skipped because URL in `seen.json` |
| `articlesSkippedAge` | RSS items skipped by 30-day gate on seeded sources |

---

## 6. Host impact

| Area | Change |
|------|--------|
| News list / unread | Unchanged — hot only |
| Fetch now / ingest spawn | Unchanged contract; CLI behavior changes under the hood |
| Add source / seed-on-create | Must not strip `seededAt`; first ingest populates it |
| Archive UI / search | Out of scope |

Gemini Twins: same seed-metadata rule if it writes sources.

---

## 7. Migration & repair

1. On first run after upgrade, ensure `archive/` exists; create `seen.json` with empty `byUrl` if missing.  
2. No backfill for historically deleted URLs.  
3. **Repair (package helper or flag):** rebuild `seen.json` by scanning all `archive/*.jsonl` lines (last write wins per URL).  
4. **Manual month delete:** operator deletes `archive/YYYY-MM.jsonl` then runs repair (or deletes matching `byUrl` keys) so those URLs may re-enter on a later ingest if still in RSS and age/seed rules allow.

---

## 8. Testing (package)

1. Unread and starred never leave hot under prune or retain pressure.  
2. Prune-eligible row lands in correct `archive/YYYY-MM.jsonl` + `seen.json`, absent from hot and from `user-state`.  
3. Retain-evicted read/unstarred row takes the same archive path; unread retained above cap stay hot.  
4. Second ingest of an archived RSS URL does not insert.  
5. New source (no `seededAt`): inserts items older than 30 days; sets `seededAt`.  
6. Seeded source: skips unknown URLs older than 30 days; still inserts recent unknowns.  
7. Missing/invalid date: skipped when seeded; allowed when unseeded.  
8. Repair rebuilds `seen` after deleting a month file; that URL can insert again if otherwise eligible.

Host tests: only if seed metadata wiring changes; no archive UI tests.

---

## 9. Future (explicitly deferred)

- UI search across `archive/*.jsonl`  
- Restore archived article to hot  
- Optional publish-month shards (rejected for v1; leave-hot month is SoT)  
- Tombstone-only path without full article body (rejected; full cold rows are SoT)

---

## 10. Rollout

1. Implement + test in Shared-News package.  
2. Wire `seededAt` if hosts create sources without going through package.  
3. Deploy; existing profiles gain `archive/` on next ingest.  
4. Watch `last-run` skip/archive counts for unexpected mass skips.
