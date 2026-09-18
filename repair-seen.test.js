import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureArchiveLayout,
  readSeen,
  writeSeen,
} from "./archive-store.js";

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
  assert.equal(result.storeDir, newsDir);
  const seen = await readSeen(newsDir);
  assert.ok(seen.byUrl["https://example.com/z"]);
});
