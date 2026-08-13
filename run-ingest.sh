#!/bin/bash
# Shared News Phase 0 — local ingest (Hostinger n8n cannot run Execute Command
# against this Mac vault). Invoked by launchd every 6 hours.
set -euo pipefail

export SHARED_NEWS_DIR="${SHARED_NEWS_DIR:-/Users/nickadenton/NKA/Obsidian/Automation-Projects/Nicka-Notes/shared/news}"
NODE="${NODE_BIN:-/opt/homebrew/bin/node}"
INGEST="/Users/nickadenton/NKA/Automation/Cursor/Shared-News/ingest.mjs"
LOG_DIR="${HOME}/Library/Logs/shared-news"
mkdir -p "$LOG_DIR"

{
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
  "$NODE" "$INGEST"
} >>"$LOG_DIR/ingest.log" 2>&1
