# Work / Personal Profile Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Shared-News resolve nested `work/` and `personal/` stores, ingest each via `--profile`, ship an idempotent migrate helper, and run both profiles on the launchd schedule — without moving vault files yet.

**Architecture:** `SHARED_NEWS_DIR` stays the profiles root. `resolveNewsDir` appends `work` or `personal` unless `--dir=` points at an existing store. `ingest.mjs` and `normalize-sources.mjs` share that helper. `migrate-profiles.mjs` is a one-shot operator tool (not part of ingest). `run-ingest.sh` calls ingest twice, sequential, work then personal.

**Tech Stack:** Node ESM · `node:test` · `rss-parser` · bash launchd wrapper

**Spec:** [`docs/superpowers/specs/2026-08-14-work-personal-profiles-design.md`](../specs/2026-08-14-work-personal-profiles-design.md)

## Global Constraints

- Profile names: `work` and `personal` only; default `work`
- `SHARED_NEWS_DIR` is the **parent** (`…/Nicka-Notes/shared/news`)
- `--dir=` is an absolute **store** path and **ignores** `--profile`
- Do **not** run migrate against the live vault in this plan
- Do not change prune rules, `max-new`/`max-retain` defaults, or YouTube resolve
- Do not implement Dev Launchpad or Gemini Twins toggles here (follow-up plans)
- Tests: `node --test *.test.js` from the Shared-News repo root
- Existing `runIngest({ newsDir })` tests keep passing via explicit `newsDir` (`--dir=` equivalent)

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `resolve-news-dir.js` | Create | `NEWS_PROFILES`, `DEFAULT_NEWS_PROFILE`, `resolveNewsDir` |
| `resolve-news-dir.test.js` | Create | Path / default / `--dir=` wins / unknown profile |
| `ingest.mjs` | Modify | Parse `--profile`, CLI resolve, `last-run.profile`, missing-store error |
| `ingest.test.js` | Modify | Arg parse, last-run `profile`, missing store message |
| `migrate-profiles.mjs` | Create | Idempotent parent → `work/` + empty `personal/` |
| `migrate-profiles.test.js` | Create | Move, no-op, split-brain, missing parent |
| `run-ingest.sh` | Modify | Sequential `--profile=work` then `--profile=personal`; both run if first fails |
| `normalize-sources.mjs` | Modify | `--profile=` + `resolveNewsDir`; `--news-dir` still store override |
| `README.md` | Modify | Profiles, flags, migrate (do not run yet), launchd |
| Spec status line | Modify | `Spec — in progress (package)` |

**Out of scope files:** Dev-Launcher, Gemini-Twins, live `shared/news/` contents, LaunchAgent plist path (still points at this `run-ingest.sh`).

---

### Task 1: `resolveNewsDir` helper

**Files:**
- Create: `resolve-news-dir.js`
- Create: `resolve-news-dir.test.js`

**Interfaces:**
- Consumes: Node `path`
- Produces:
  - `NEWS_PROFILES` = `["work", "personal"]` (frozen array)
  - `DEFAULT_NEWS_PROFILE` = `"work"`
  - `resolveNewsDir({ newsRoot, profile, dir } = {})` → `{ storeDir: string, profile: "work" | "personal" | null }`
  - Throws `Error` with message `SHARED_NEWS_DIR or --dir= must be an absolute path` when the chosen root/dir is missing or relative
  - Throws `Error` with message `Unknown news profile: ${value}` when `profile` is set and not `work` or `personal`

- [ ] **Step 1: Write the failing tests**

Create `resolve-news-dir.test.js`:

```js
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  DEFAULT_NEWS_PROFILE,
  NEWS_PROFILES,
  resolveNewsDir,
} from "./resolve-news-dir.js";

const root = "/tmp/shared-news-root";

describe("resolveNewsDir", () => {
  test("exports work and personal with default work", () => {
    assert.deepEqual([...NEWS_PROFILES], ["work", "personal"]);
    assert.equal(DEFAULT_NEWS_PROFILE, "work");
  });

  test("defaults to work under the news root", () => {
    assert.deepEqual(resolveNewsDir({ newsRoot: root }), {
      storeDir: path.join(root, "work"),
      profile: "work",
    });
  });

  test("appends personal when profile is personal", () => {
    assert.deepEqual(
      resolveNewsDir({ newsRoot: root, profile: "personal" }),
      {
        storeDir: path.join(root, "personal"),
        profile: "personal",
      },
    );
  });

  test("dir wins and clears profile", () => {
    assert.deepEqual(
      resolveNewsDir({
        newsRoot: root,
        profile: "personal",
        dir: "/tmp/explicit-store",
      }),
      { storeDir: "/tmp/explicit-store", profile: null },
    );
  });

  test("rejects unknown profile", () => {
    assert.throws(
      () => resolveNewsDir({ newsRoot: root, profile: "family" }),
      /Unknown news profile: family/,
    );
  });

  test("rejects relative newsRoot", () => {
    assert.throws(
      () => resolveNewsDir({ newsRoot: "shared/news" }),
      /SHARED_NEWS_DIR or --dir= must be an absolute path/,
    );
  });

  test("rejects relative dir", () => {
    assert.throws(
      () => resolveNewsDir({ dir: "news/work" }),
      /SHARED_NEWS_DIR or --dir= must be an absolute path/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test resolve-news-dir.test.js`

Expected: FAIL with `Cannot find module` / `resolve-news-dir.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `resolve-news-dir.js`:

```js
import path from "node:path";

export const NEWS_PROFILES = Object.freeze(["work", "personal"]);
export const DEFAULT_NEWS_PROFILE = "work";

function requireAbsolute(dir) {
  if (!dir || !path.isAbsolute(dir)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }
  return dir;
}

export function resolveNewsDir({ newsRoot, profile, dir } = {}) {
  if (dir !== undefined && dir !== null && dir !== "") {
    return { storeDir: requireAbsolute(dir), profile: null };
  }
  const selected =
    profile === undefined || profile === null || profile === ""
      ? DEFAULT_NEWS_PROFILE
      : profile;
  if (!NEWS_PROFILES.includes(selected)) {
    throw new Error(`Unknown news profile: ${selected}`);
  }
  return {
    storeDir: path.join(requireAbsolute(newsRoot), selected),
    profile: selected,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test resolve-news-dir.test.js`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add resolve-news-dir.js resolve-news-dir.test.js
git commit -m "feat: resolve nested work and personal news dirs"
```

---

### Task 2: CLI `--profile` + last-run `profile` + missing-store error

**Files:**
- Modify: `ingest.mjs`
- Modify: `ingest.test.js`

**Interfaces:**
- Consumes: `resolveNewsDir` from `./resolve-news-dir.js`
- Produces:
  - `parseIngestArgs(argv)` also sets `profile` when `--profile=` is present (string, unvalidated — validation is `resolveNewsDir`)
  - `runIngest({ newsDir, profile, ... })` writes `profile: profile ?? null` on every `last-run.json` object (success and catch)
  - Missing `sources.json`: throw `Error` `News store not found: ${newsDir} (run migrate-profiles.mjs)` instead of a raw ENOENT
  - CLI: `const resolved = resolveNewsDir({ newsRoot: process.env.SHARED_NEWS_DIR, profile: args.profile, dir: args.newsDir })` then `runIngest({ ...args, newsDir: resolved.storeDir, profile: resolved.profile })`

- [ ] **Step 1: Write the failing tests**

In `ingest.test.js`, extend `parseIngestArgs` and add two `runIngest` tests. Keep the existing default-limits test unchanged (`parseIngestArgs([])` still `{ maxNew: 8, maxRetain: 200 }` — no `profile` key).

Append inside `describe("parseIngestArgs")`:

```js
  test("reads profile", () => {
    assert.deepEqual(parseIngestArgs(["--profile=personal"]), {
      maxNew: 8,
      maxRetain: 200,
      profile: "personal",
    });
  });
```

In `describe("runIngest")`, after the existing tests, add:

```js
  test("records profile on last-run when provided", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-profile-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    const result = await runIngest({
      newsDir: dir,
      profile: "personal",
      fetchFeed: async () => ({ items: [] }),
    });
    assert.equal(result.profile, "personal");
    const lastRun = JSON.parse(
      await readFile(path.join(dir, "last-run.json"), "utf8"),
    );
    assert.equal(lastRun.profile, "personal");
  });

  test("records null profile when omitted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-noprof-"));
    await writeFile(
      path.join(dir, "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    const result = await runIngest({
      newsDir: dir,
      fetchFeed: async () => ({ items: [] }),
    });
    assert.equal(result.profile, null);
  });

  test("throws a migrate hint when sources.json is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-news-missing-"));
    await assert.rejects(
      () => runIngest({ newsDir: dir, fetchFeed: async () => ({ items: [] }) }),
      /News store not found: .* \(run migrate-profiles.mjs\)/,
    );
  });
```

Also add a unit test that `resolveNewsDir` + a temp tree writes only under personal (no work files):

```js
describe("profile isolation", () => {
  test("resolveNewsDir personal path is a sibling of work", async () => {
    const { resolveNewsDir } = await import("./resolve-news-dir.js");
    const root = await mkdtemp(path.join(tmpdir(), "shared-news-root-"));
    const { storeDir, profile } = resolveNewsDir({
      newsRoot: root,
      profile: "personal",
    });
    assert.equal(profile, "personal");
    assert.equal(storeDir, path.join(root, "personal"));
    assert.equal(path.dirname(storeDir), root);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test ingest.test.js`

Expected: FAIL on `reads profile` / `records profile` / missing-store (implementation not updated).

- [ ] **Step 3: Implement `parseIngestArgs` + `runIngest` + CLI**

In `parseIngestArgs`, after the `feed-id` block:

```js
  if (values.profile !== undefined) {
    args.profile = values.profile;
  }
```

At top of `ingest.mjs` add:

```js
import { resolveNewsDir } from "./resolve-news-dir.js";
```

Change `runIngest` signature to accept `profile` (default `null`):

```js
export async function runIngest({
  newsDir,
  fetchFeed = fetchDefaultFeed,
  feedTimeoutMs = DEFAULT_FEED_TIMEOUT_MS,
  feedId,
  maxNew = 8,
  maxRetain = 200,
  profile = null,
}) {
```

After the existing absolute-path check, before reading sources, replace the `readFile(sources.json)` ENOENT with:

```js
    let sourcesRaw;
    try {
      sourcesRaw = await readFile(path.join(newsDir, "sources.json"), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `News store not found: ${newsDir} (run migrate-profiles.mjs)`,
        );
      }
      throw error;
    }
    const sources = JSON.parse(sourcesRaw);
```

Add `profile: profile ?? null` to **both** `lastRun` object literals (success and catch).

Replace the CLI `runIngest({...})` block:

```js
  const args = parseIngestArgs(process.argv.slice(2));
  let resolved;
  try {
    resolved = resolveNewsDir({
      newsRoot: process.env.SHARED_NEWS_DIR,
      profile: args.profile,
      dir: args.newsDir,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  runIngest({
    ...args,
    newsDir: resolved.storeDir,
    profile: resolved.profile,
  })
```

Update the `runIngest` JSDoc `@param` to include `profile?: "work" | "personal" | null`.

- [ ] **Step 4: Run all ingest tests**

Run: `node --test ingest.test.js resolve-news-dir.test.js`

Expected: PASS (existing ingest tests plus new ones).

- [ ] **Step 5: Commit**

```bash
git add ingest.mjs ingest.test.js
git commit -m "feat: ingest --profile and last-run profile field"
```

---

### Task 3: `migrate-profiles.mjs`

**Files:**
- Create: `migrate-profiles.mjs`
- Create: `migrate-profiles.test.js`

**Interfaces:**
- Consumes: `NEWS_PROFILES` from `./resolve-news-dir.js` (personal folder name `personal`, work `work`)
- Produces: `export async function migrateProfiles(newsRoot)` → `{ ok: true, skipped: boolean, moved: string[], createdPersonal: boolean }`
  - `newsRoot` must be absolute
  - If `work/sources.json` exists **and** parent `sources.json` exists → throw `Cannot migrate: sources.json exists at both parent and work/`
  - If `work/sources.json` exists → do not move parent files; still create empty personal if missing; `skipped: true`
  - If parent `sources.json` exists → mkdir `work/`, move `sources.json`, `articles.jsonl`, `user-state.json`, `last-run.json`, and any `articles.jsonl.bak-*` into `work/`
  - If neither parent nor `work/sources.json` → throw `No sources.json at parent or work/; nothing to migrate`
  - Personal missing → write empty templates (spec §4.1); no `last-run.json` for personal
  - Idempotent: second call with only `work/sources.json` returns `skipped: true` and `createdPersonal: false` if personal already exists

Empty `sources.json`:

```json
{
  "version": 2,
  "updatedAt": "<ISO now from Date.toISOString()>",
  "feeds": [],
  "groups": []
}
```

Empty `user-state.json`:

```json
{
  "version": 1,
  "updatedAt": "<ISO now>",
  "byUrl": {}
}
```

`articles.jsonl`: empty string `""` (no trailing requirement beyond writeFile).

- [ ] **Step 1: Write the failing tests**

Create `migrate-profiles.test.js`:

```js
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrateProfiles } from "./migrate-profiles.mjs";

async function writeParentStore(root) {
  await writeFile(
    path.join(root, "sources.json"),
    JSON.stringify({ version: 2, feeds: [{ id: "a", enabled: true }] }),
  );
  await writeFile(path.join(root, "articles.jsonl"), '{"url":"https://a.example/1"}\n');
  await writeFile(
    path.join(root, "user-state.json"),
    JSON.stringify({ version: 1, byUrl: {} }),
  );
  await writeFile(path.join(root, "last-run.json"), JSON.stringify({ ok: true }));
  await writeFile(path.join(root, "articles.jsonl.bak-stamp"), "backup\n");
}

describe("migrateProfiles", () => {
  test("moves parent store into work and seeds empty personal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sn-mig-"));
    await writeParentStore(root);
    const result = await migrateProfiles(root);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.ok(result.moved.includes("sources.json"));
    assert.ok(result.createdPersonal);
    const workSources = JSON.parse(
      await readFile(path.join(root, "work", "sources.json"), "utf8"),
    );
    assert.equal(workSources.feeds[0].id, "a");
    await assert.rejects(readFile(path.join(root, "sources.json")));
    const personalSources = JSON.parse(
      await readFile(path.join(root, "personal", "sources.json"), "utf8"),
    );
    assert.deepEqual(personalSources.feeds, []);
    assert.deepEqual(personalSources.groups, []);
    const personalState = JSON.parse(
      await readFile(path.join(root, "personal", "user-state.json"), "utf8"),
    );
    assert.deepEqual(personalState.byUrl, {});
    const personalArticles = await readFile(
      path.join(root, "personal", "articles.jsonl"),
      "utf8",
    );
    assert.equal(personalArticles, "");
    await assert.rejects(
      readFile(path.join(root, "personal", "last-run.json")),
    );
    const bak = await readFile(
      path.join(root, "work", "articles.jsonl.bak-stamp"),
      "utf8",
    );
    assert.equal(bak, "backup\n");
  });

  test("is idempotent when work already exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sn-mig2-"));
    await mkdir(path.join(root, "work"));
    await writeFile(
      path.join(root, "work", "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    const first = await migrateProfiles(root);
    assert.equal(first.skipped, true);
    assert.equal(first.createdPersonal, true);
    const second = await migrateProfiles(root);
    assert.equal(second.skipped, true);
    assert.equal(second.createdPersonal, false);
  });

  test("refuses split-brain parent and work sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sn-split-"));
    await writeFile(path.join(root, "sources.json"), "{}");
    await mkdir(path.join(root, "work"));
    await writeFile(path.join(root, "work", "sources.json"), "{}");
    await assert.rejects(
      () => migrateProfiles(root),
      /Cannot migrate: sources.json exists at both parent and work\//,
    );
  });

  test("throws when nothing to migrate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sn-empty-"));
    await assert.rejects(
      () => migrateProfiles(root),
      /No sources.json at parent or work\/; nothing to migrate/,
    );
  });

  test("rejects relative newsRoot", async () => {
    await assert.rejects(
      () => migrateProfiles("shared/news"),
      /SHARED_NEWS_DIR or --dir= must be an absolute path/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test migrate-profiles.test.js`

Expected: FAIL `Cannot find module './migrate-profiles.mjs'`.

- [ ] **Step 3: Write `migrate-profiles.mjs`**

```js
#!/usr/bin/env node

import {
  access,
  mkdir,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MOVE_NAMES = new Set([
  "sources.json",
  "articles.jsonl",
  "user-state.json",
  "last-run.json",
]);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function emptySources(now) {
  return {
    version: 2,
    updatedAt: now,
    feeds: [],
    groups: [],
  };
}

function emptyUserState(now) {
  return {
    version: 1,
    updatedAt: now,
    byUrl: {},
  };
}

async function seedPersonal(personalDir) {
  const now = new Date().toISOString();
  await mkdir(personalDir, { recursive: true });
  await writeFile(
    path.join(personalDir, "sources.json"),
    `${JSON.stringify(emptySources(now), null, 2)}\n`,
  );
  await writeFile(path.join(personalDir, "articles.jsonl"), "");
  await writeFile(
    path.join(personalDir, "user-state.json"),
    `${JSON.stringify(emptyUserState(now), null, 2)}\n`,
  );
}

export async function migrateProfiles(newsRoot) {
  if (!newsRoot || !path.isAbsolute(newsRoot)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }
  const workDir = path.join(newsRoot, "work");
  const personalDir = path.join(newsRoot, "personal");
  const parentSources = path.join(newsRoot, "sources.json");
  const workSources = path.join(workDir, "sources.json");
  const parentHas = await exists(parentSources);
  const workHas = await exists(workSources);

  if (parentHas && workHas) {
    throw new Error(
      "Cannot migrate: sources.json exists at both parent and work/",
    );
  }
  if (!parentHas && !workHas) {
    throw new Error("No sources.json at parent or work/; nothing to migrate");
  }

  const moved = [];
  let skipped = false;
  if (workHas) {
    skipped = true;
  } else {
    await mkdir(workDir, { recursive: true });
    const names = await readdir(newsRoot);
    for (const name of names) {
      const shouldMove =
        MOVE_NAMES.has(name) || name.startsWith("articles.jsonl.bak-");
      if (!shouldMove) {
        continue;
      }
      await rename(path.join(newsRoot, name), path.join(workDir, name));
      moved.push(name);
    }
  }

  let createdPersonal = false;
  if (!(await exists(path.join(personalDir, "sources.json")))) {
    await seedPersonal(personalDir);
    createdPersonal = true;
  }

  return { ok: true, skipped, moved, createdPersonal };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const newsRoot = process.argv[2] ?? process.env.SHARED_NEWS_DIR;
  migrateProfiles(newsRoot)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
```

CLI: `node migrate-profiles.mjs [absoluteNewsRoot]` — do **not** invoke this against the live vault in this task.

- [ ] **Step 4: Run migrate tests**

Run: `node --test migrate-profiles.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrate-profiles.mjs migrate-profiles.test.js
git commit -m "feat: migrate parent news store into work and personal"
```

---

### Task 4: Sequential dual-profile `run-ingest.sh`

**Files:**
- Modify: `run-ingest.sh`

**Interfaces:**
- Consumes: `ingest.mjs --profile=work` and `--profile=personal` (Task 2)
- Produces: launchd wrapper that always attempts both profiles; exit 1 if either failed; `SHARED_NEWS_DIR` default remains the **parent** vault path

- [ ] **Step 1: Replace `run-ingest.sh` body**

Keep the header comment (local ingest; Hostinger n8n cannot Execute Command). Replace the ingest invocation so a work failure does not skip personal:

```bash
#!/bin/bash
# Shared News — local ingest (Hostinger n8n cannot run Execute Command
# against this Mac vault). Invoked by launchd every 6 hours.
# Runs work then personal. Both run even if work fails.
set -uo pipefail

export SHARED_NEWS_DIR="${SHARED_NEWS_DIR:-/Users/nickadenton/NKA/Obsidian/Automation-Projects/Nicka-Notes/shared/news}"
NODE="${NODE_BIN:-/opt/homebrew/bin/node}"
INGEST="/Users/nickadenton/NKA/Automation/Cursor/Shared-News/ingest.mjs"
LOG_DIR="${HOME}/Library/Logs/shared-news"
mkdir -p "$LOG_DIR"

{
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
  work_ok=0
  personal_ok=0
  "$NODE" "$INGEST" --profile=work || work_ok=$?
  "$NODE" "$INGEST" --profile=personal || personal_ok=$?
  if [ "$work_ok" -ne 0 ] || [ "$personal_ok" -ne 0 ]; then
    echo "ingest failed work=${work_ok} personal=${personal_ok}"
    exit 1
  fi
} >>"$LOG_DIR/ingest.log" 2>&1
```

Note: `set -e` is intentionally omitted so `cmd || work_ok=$?` records the status. `set -u` still catches unset vars.

- [ ] **Step 2: Syntax-check the wrapper**

Run: `bash -n run-ingest.sh`

Expected: no output, exit 0.

- [ ] **Step 3: Confirm both profile flags are present**

Run: `grep -n 'profile=' run-ingest.sh`

Expected: lines with `--profile=work` and `--profile=personal`.

- [ ] **Step 4: Commit**

```bash
git add run-ingest.sh
git commit -m "feat: scheduled ingest runs work then personal"
```

Do not `launchctl unload/load` in this task. After migrate (operator, later), the existing LaunchAgent will pick up this script on the next 6h tick or a manual `run-ingest.sh`.

---

### Task 5: `normalize-sources.mjs` profile resolve + README + spec status

**Files:**
- Modify: `normalize-sources.mjs`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-14-work-personal-profiles-design.md` (status line only)

**Interfaces:**
- Consumes: `resolveNewsDir` from `./resolve-news-dir.js`
- Produces: `parseArgs` accepts `--profile=work|personal` (equals form) and existing `--news-dir PATH` / `--dry-run`. `--news-dir` is a store override (like `--dir=`) and ignores profile. Default profile `work` via `resolveNewsDir` when `--news-dir` omitted.

- [ ] **Step 1: Update `parseArgs` in `normalize-sources.mjs`**

Replace the current `newsDir` defaulting with:

```js
import { resolveNewsDir } from "./resolve-news-dir.js"

function parseArgs(argv) {
  let dryRun = false
  let profile
  let dir
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--dry-run") dryRun = true
    else if (arg === "--news-dir") {
      dir = argv[i + 1]
      i += 1
    } else if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length)
    }
  }
  const resolved = resolveNewsDir({
    newsRoot:
      process.env.SHARED_NEWS_DIR?.trim() ||
      "/Users/nickadenton/NKA/Obsidian/Automation-Projects/Nicka-Notes/shared/news",
    profile,
    dir,
  })
  return { dryRun, newsDir: resolved.storeDir, profile: resolved.profile }
}
```

Keep `path.resolve` unnecessary once `resolveNewsDir` requires absolute `--news-dir`. If someone passes a relative `--news-dir`, `resolveNewsDir` throws — that is correct.

Update the file header comment Usage to:

```
Usage:
  node normalize-sources.mjs [--dry-run] [--profile=work|personal] [--news-dir PATH]
```

- [ ] **Step 2: Rewrite `README.md`**

````markdown
# Shared News

Standalone local shared-news ingest package.

After migrate, `SHARED_NEWS_DIR` is the **profiles root**:

```
$SHARED_NEWS_DIR/work/
$SHARED_NEWS_DIR/personal/
```

Do **not** run migrate until Dev Launchpad and Gemini Twins can open `work/` (or fall back to the parent folder).

## Setup

```bash
npm install
```

## Run

```bash
export SHARED_NEWS_DIR="/Users/nickadenton/NKA/Obsidian/Automation-Projects/Nicka-Notes/shared/news"
node ingest.mjs --profile=work
node ingest.mjs --profile=personal
```

| Flag | Meaning |
|------|---------|
| `--profile=work\|personal` | Store under `$SHARED_NEWS_DIR/<profile>/` (default `work`) |
| `--dir=/abs/store` | Absolute store path; ignores `--profile` |
| `--feed-id=ID` | Single enabled feed |
| `--max-new=N` | Insert cap (default 8) |
| `--max-retain=N` | Retain cap (default 200) |

`run-ingest.sh` (launchd every 6h) runs work then personal.

## Migrate (operator, later)

```bash
node migrate-profiles.mjs
```

Moves current parent files into `work/` and seeds empty `personal/`. Idempotent. Refuses if both parent and `work/sources.json` exist.

## Test

```bash
node --test *.test.js
```
````

- [ ] **Step 3: Set spec status**

Change the spec header status from `Spec — awaiting review` to `Spec — in progress (package)`.

- [ ] **Step 4: Run the full test suite**

Run: `node --test *.test.js`

Expected: PASS (all existing + new files).

- [ ] **Step 5: Commit**

```bash
git add normalize-sources.mjs README.md docs/superpowers/specs/2026-08-14-work-personal-profiles-design.md
git commit -m "docs: profile CLI for normalize-sources and README"
```

---

## Follow-up (not this plan)

1. Dev Launchpad: Work/Personal toggle, `newsDir(profile)`, ingest `--profile`, 409 per profile, Work parent fallback.  
2. Gemini Twins: same toggle + path wiring + fallback.  
3. Operator: `node migrate-profiles.mjs` on the live vault.  
4. Drop Work parent fallback.

---

## Spec coverage

| Spec section | Task |
|--------------|------|
| §4 nested folders / empty personal templates | Task 3 |
| §5.1 `resolveNewsDir` | Task 1 |
| §5.2 CLI `--profile` / `--dir=` / last-run `profile` | Task 2 |
| §5.3 `run-ingest.sh` both, sequential, both attempted | Task 4 |
| §5.4 `migrate-profiles.mjs` idempotent / split-brain | Task 3 |
| §5.5 tests | Tasks 1–3, 5 |
| §7 step 1 package only; do not run migrate | Tasks 3–4 (helper exists, not executed on vault) |
| §8 unknown profile / missing store / work fail still runs personal | Tasks 1, 2, 4 |
| §6–7 UI / operator migrate | Follow-up, not this plan |
