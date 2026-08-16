import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_NEWS_PROFILE,
  NEWS_PROFILES,
  resolveNewsDir,
} from "./resolve-news-dir.js";

async function makeRoot() {
  return mkdtemp(path.join(tmpdir(), "shared-news-root-"));
}

describe("resolveNewsDir", () => {
  test("exports work and personal with default work", () => {
    assert.deepEqual([...NEWS_PROFILES], ["work", "personal"]);
    assert.equal(DEFAULT_NEWS_PROFILE, "work");
  });

  test("work always resolves under work/ even if parent sources exist", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "sources.json"), "{}");
    assert.deepEqual(await resolveNewsDir({ newsRoot: root }), {
      storeDir: path.join(root, "work"),
      profile: "work",
    });
  });

  test("work sources resolves work to work directory", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "work"));
    await writeFile(path.join(root, "work", "sources.json"), "{}");
    assert.deepEqual(await resolveNewsDir({ newsRoot: root }), {
      storeDir: path.join(root, "work"),
      profile: "work",
    });
  });

  test("personal never uses parent sources", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "sources.json"), "{}");
    assert.deepEqual(
      await resolveNewsDir({ newsRoot: root, profile: "personal" }),
      {
        storeDir: path.join(root, "personal"),
        profile: "personal",
      },
    );
  });

  test("dir wins and clears profile", async () => {
    assert.deepEqual(
      await resolveNewsDir({
        newsRoot: await makeRoot(),
        profile: "personal",
        dir: "/tmp/explicit-store",
      }),
      { storeDir: "/tmp/explicit-store", profile: null },
    );
  });

  test("rejects unknown profile", async () => {
    const root = await makeRoot();
    await assert.rejects(
      () => resolveNewsDir({ newsRoot: root, profile: "family" }),
      /Unknown news profile: family/,
    );
  });

  test("rejects relative newsRoot", async () => {
    await assert.rejects(
      () => resolveNewsDir({ newsRoot: "shared/news" }),
      /SHARED_NEWS_DIR or --dir= must be an absolute path/,
    );
  });

  test("rejects relative dir", async () => {
    await assert.rejects(
      () => resolveNewsDir({ dir: "news/work" }),
      /SHARED_NEWS_DIR or --dir= must be an absolute path/,
    );
  });
});
