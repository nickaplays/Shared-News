# Shared News

Standalone local shared-news ingest package extracted from Gemini-Twins.

## Setup

```bash
npm install
```

## Run

```bash
node ingest.mjs
```

The ingest reads and writes the shared news store under `SHARED_NEWS_DIR`.

## Test

```bash
node --test *.test.js
```
