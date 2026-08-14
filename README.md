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
