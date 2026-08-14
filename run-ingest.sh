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
