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
