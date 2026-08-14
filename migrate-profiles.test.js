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
  await writeFile(path.join(root, ".legacy-imported.json"), "{}");
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
    assert.equal(result.moved.at(-1), "sources.json");
    assert.deepEqual(result.leftovers, []);
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
    assert.equal(
      await readFile(path.join(root, "work", ".legacy-imported.json"), "utf8"),
      "{}",
    );
    await assert.rejects(readFile(path.join(root, ".legacy-imported.json")));
  });

  test("is idempotent when work already exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sn-mig2-"));
    await mkdir(path.join(root, "work"));
    await writeFile(
      path.join(root, "work", "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    await writeFile(path.join(root, "articles.jsonl"), "leftover\n");
    await writeFile(path.join(root, "articles.jsonl.bak-old"), "backup\n");
    const first = await migrateProfiles(root);
    assert.equal(first.skipped, true);
    assert.deepEqual(first.leftovers, [
      "articles.jsonl",
      "articles.jsonl.bak-old",
    ]);
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

  test("seeds personal sources without overwriting existing articles", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sn-partial-personal-"));
    await mkdir(path.join(root, "work"));
    await writeFile(
      path.join(root, "work", "sources.json"),
      JSON.stringify({ feeds: [] }),
    );
    await mkdir(path.join(root, "personal"));
    const existingArticle = '{"url":"https://keep.example/1"}\n';
    await writeFile(
      path.join(root, "personal", "articles.jsonl"),
      existingArticle,
    );

    const result = await migrateProfiles(root);
    assert.equal(result.skipped, true);
    assert.equal(result.createdPersonal, true);

    const articles = await readFile(
      path.join(root, "personal", "articles.jsonl"),
      "utf8",
    );
    assert.equal(articles, existingArticle);

    const personalSources = JSON.parse(
      await readFile(path.join(root, "personal", "sources.json"), "utf8"),
    );
    assert.deepEqual(personalSources.feeds, []);
    assert.deepEqual(personalSources.groups, []);
  });
});
