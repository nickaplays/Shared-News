# Shared News — Work / Personal profile stores

> **Date:** 2026-08-14  
> **Status:** Spec — implemented (package + hosts); Work parent fallback removed   
> **App:** Shared News (package) + Dev Launchpad + Gemini Twins (UI follow-up)  
> **Repos:**  
> - `/Users/nickadenton/NKA/Automation/Cursor/Shared-News`  
> - `/Users/nickadenton/NKA/Automation/Cursor/Dev-Launcher`  
> - `/Users/nickadenton/NKA/Automation/Cursor/Gemini-Twins`  
> **Approach:** Nested profile folders (Approach A)

## 1. Problem

There is one vault store (`shared/news/` with a single `sources.json`, `articles.jsonl`, `user-state.json`, `last-run.json`). That catalog is the **work** reading list. Replacing Feedly for personal RSS/YouTube needs a second full account: different sources, groups, articles, and stars, switched from each host UI.

## 2. Goals / Non-goals

### Goals

1. Two isolated stores — **work** and **personal** — each with its own sources, groups, articles, user-state, and last-run.  
2. Keep today’s vault data as **work** (one-time migrate into `work/`). **Personal** starts empty.  
3. Shared-News CLI selects a store with `--profile=work|personal`. Default **work**.  
4. Scheduled ingest (launchd, 6h) refreshes **both** stores, sequentially (work then personal). Personal still runs if work fails.  
5. Each host UI (Dev Launchpad, Gemini Twins) has its own Work/Personal toggle; the choice is **not** shared between apps.  
6. Roll out so existing UIs do not break: implement package + UI path wiring **before** running migrate; temporarily Work fell back to the parent folder until `work/sources.json` existed (removed after migrate).

### Non-goals

- More than two profiles, or a `profiles.json` registry.  
- A global vault-level “active profile” shared by both UIs.  
- Moving YouTube `@handle` resolve into Shared-News.  
- Changing article JSONL fields, prune rules (30-day read, skip starred), or `max-new` / `max-retain` defaults.  
- An HTTP ingest server.  
- Copying work feeds into personal.

## 3. Locked decisions

| Decision | Choice |
|----------|--------|
| Layout | `shared/news/work/` and `shared/news/personal/` |
| `SHARED_NEWS_DIR` | Still the **parent** (`…/Nicka-Notes/shared/news`) |
| Profile names | Fixed: `work`, `personal` |
| Current files | Become **work** via migrate (not left at parent) |
| Personal seed | Empty catalog + empty articles + empty `byUrl` |
| CLI default | `--profile=work` |
| `--dir=` | Absolute **store** path (folder that contains `sources.json`); **ignores** `--profile` |
| Schedule | Both profiles, sequential, work first |
| UI toggle | Per app; persist in that app’s settings (not in the news vault) |
| Ingest 409 | **Per profile** (Launchpad): Work fetch may run while Personal is idle |
| Package vs UI | Package: folders, CLI, launchd, migrate helper. UIs: toggle + `SHARED_NEWS_DIR/<profile>/` + pass `--profile` to spawn |

---

## 4. Vault layout

After migrate:

```
shared/news/                    # SHARED_NEWS_DIR (profiles root)
  work/
    sources.json
    articles.jsonl
    user-state.json
    last-run.json
  personal/
    sources.json
    articles.jsonl
    user-state.json
    last-run.json
```

Parent `shared/news/` must **not** keep a live `sources.json` / `articles.jsonl` after migrate (avoids two sources of truth). Timestamped `articles.jsonl.bak-*` files move into `work/` with the live store.

### 4.1 Empty personal templates

`sources.json`:

```json
{
  "version": 2,
  "updatedAt": "<ISO now>",
  "feeds": [],
  "groups": []
}
```

`articles.jsonl`: empty file.

`user-state.json`:

```json
{
  "version": 1,
  "updatedAt": "<ISO now>",
  "byUrl": {}
}
```

No `last-run.json` until the first personal ingest.

---

## 5. Package (Shared-News)

### 5.1 Resolve store path

```
storeDir = dirFlag ?? join(SHARED_NEWS_DIR, profile)   // profile default work
```

`SHARED_NEWS_DIR` / resolved `storeDir` must be absolute (same rule as today). Unknown `--profile` values fail before fetch (`work` and `personal` only).

Export a small helper (e.g. `resolveNewsDir({ newsRoot, profile, dir })`) used by `ingest.mjs` and `normalize-sources.mjs`.

### 5.2 CLI

```bash
node ingest.mjs [--profile=work|personal] [--feed-id=ID] [--max-new=N] [--max-retain=N] [--dir=/abs/store]
```

| Flag | Behavior |
|------|----------|
| `--profile` | `work` (default) or `personal`; selects `SHARED_NEWS_DIR/<profile>/` |
| `--dir` | Absolute store directory; skips profile |
| `--feed-id`, `--max-new`, `--max-retain` | Unchanged; apply only to that store |

`last-run.json` stays **inside the profile store**. `mode` / `feedId` semantics unchanged; add `"profile": "work"|"personal"` when resolved via `--profile` (omit or null when `--dir=` was used).

### 5.3 `run-ingest.sh`

Keep default `SHARED_NEWS_DIR` as the parent vault path. Run:

```bash
"$NODE" "$INGEST" --profile=work
"$NODE" "$INGEST" --profile=personal
```

Sequential. Do not `set -e` abort the second run if the first exits non-zero; log both. Overall script exit non-zero if **either** profile failed.

### 5.4 Migrate helper

One-shot `migrate-profiles.mjs` (not a flag on `ingest.mjs`):

1. If `work/sources.json` already exists → no-op success (idempotent).  
2. If parent has `sources.json` → create `work/`, move `sources.json`, `articles.jsonl`, `user-state.json`, `last-run.json`, and `articles.jsonl.bak-*` into `work/`.  
3. If `personal/` missing → create it with empty templates (§4.1).  
4. Refuse to migrate if parent has `sources.json` **and** `work/sources.json` (split-brain).

**Do not run migrate as part of everyday ingest.** Operator runs it once after both UIs understand `work/` (or have parent fallback).

### 5.5 Tests

- Resolve: default profile → `…/work`; `--profile=personal`; `--dir=` wins.  
- Unknown profile throws.  
- Migrate: parent files → `work/`; personal created; second run no-op; split-brain throws.  
- Ingest with `--profile` reads/writes that folder only (existing ingest tests pointed at a temp store still pass via `--dir=`).

---

## 6. Host UIs (follow-up; not this package’s implementation)

### 6.1 Path contract

```
newsDir(profile) = join(SHARED_NEWS_DIR, profile)   // profile = 'work' | 'personal'
```

All catalog, articles, user-state, delete-purge, and spawn-ingest calls use `newsDir(activeProfile)`.

**Work path:** `join(SHARED_NEWS_DIR, 'work')`. **Personal path:** `join(SHARED_NEWS_DIR, 'personal')`. If a store folder is missing, the UI shows empty / the CLI errors with a clear migrate hint.

### 6.2 Toggle

- Control: **Work** | **Personal** on the News canvas (Launchpad) and the equivalent Gemini Twins News surface.  
- Persist per app (Launchpad: `settings.json`; Gemini Twins: existing settings/store — not `user-state.json`).  
- Switching reloads sources, groups, articles, starred, and last-run from the other store. No mixing.

### 6.3 Ingest spawn

Launchpad `POST /api/news/ingest` passes `--profile=<active>`. Single-flight **409** is keyed by profile, not global.

Seed-on-create uses `--profile=` plus `--feed-id` / `--max-new=10` for the **visible** profile.

Gemini Twins remains a vault consumer; it does not need to own catalog CRUD. It must resolve the same profile path so lists match its toggle.

YouTube `@handle` resolve stays in Launchpad and writes the resolved RSS URL into the **active** profile’s `sources.json`.

---

## 7. Rollout order

1. **Shared-News:** `--profile`, `resolveNewsDir`, launchd both profiles, migrate helper. Do **not** run migrate yet.  
2. **Dev Launchpad:** toggle + path wiring + `--profile` on spawn + Work parent fallback.  
3. **Gemini Twins:** same toggle + path wiring + Work parent fallback.  
4. **Run migrate** once (operator). Current files → `work/`; empty `personal/`.  
5. **Drop Work parent fallback** after both apps have shipped nested paths. ✅ Done.

Do not add a toggle that still reads the parent for both sides (switching would no-op). Do not migrate before the UIs can open `work/`.

---

## 8. Error handling

| Case | Behavior |
|------|----------|
| Unknown `--profile` | Fail before fetch; write `last-run.json` only if a store dir was already resolved |
| Missing `personal/` before migrate | CLI `--profile=personal` fails with a clear “store not found; run migrate” |
| Work ingest fails on schedule | Log; still run personal; wrapper exit ≠ 0 |
| `user-state.json` mtime changes mid-ingest | Unchanged: abort prune writes for **that** profile only |
| Split-brain parent + `work/` both have `sources.json` | Migrate refuses |
| Concurrent Fetch now same profile | 409 (Launchpad) |
| Concurrent Fetch now other profile | Allowed |

---

## 9. Testing (hosts, later)

- Launchpad: toggle Work → Personal reloads empty personal catalog; Fetch now / seed / delete-purge touch only the active store.  
- Gemini Twins: independent toggle does not change Launchpad’s saved profile.  
- After migrate: Work shows previous articles; parent folder has no live `sources.json`.

---

## 10. Implementation split

| Slice | Repo |
|-------|------|
| Resolve, CLI `--profile`, `run-ingest.sh`, migrate helper, tests | Shared-News (this spec’s implementation plan) |
| Toggle, settings, `newsDir(profile)`, ingest `--profile`, 409 per profile, fallback | Dev-Launcher |
| Toggle, `newsDir(profile)`, fallback | Gemini-Twins |
| Run `migrate-profiles.mjs` once | Operator (after both UIs) |
