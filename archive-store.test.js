import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
