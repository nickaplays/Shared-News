# Shared News

Standalone local shared-news ingest package.

After migrate, `SHARED_NEWS_DIR` is the **profiles root**:

```
$SHARED_NEWS_DIR/work/
$SHARED_NEWS_DIR/personal/
```

Each profile always resolves to `$SHARED_NEWS_DIR/<profile>/` (no parent-folder fallback).

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
| `--max-new=N` | Optional per-feed insert cap (default: all missing items from each feed's RSS snapshot) |
| `--max-retain=N` | Global retain cap with per-source floor (default 500, min 15 per source) |

`run-ingest.sh` (launchd every 6h) runs nested work then personal profiles.

Normalize an individual profile with:

```bash
node normalize-sources.mjs --profile=work
node normalize-sources.mjs --profile=personal
```

For normalization, `--news-dir` selects an explicit store, overrides
`--profile`, and must be an absolute path.

## Migrate (operator, one-shot)

```bash
export SHARED_NEWS_DIR="/Users/nickadenton/NKA/Obsidian/Automation-Projects/Nicka-Notes/shared/news"
node migrate-profiles.mjs
```

Moves current parent files into `work/` and seeds empty `personal/`. Idempotent. Refuses if both parent and `work/sources.json` exist. Already applied on the live vault.

## Test

```bash
node --test *.test.js
```
