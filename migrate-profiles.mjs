#!/usr/bin/env node

import {
  access,
  mkdir,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NEWS_PROFILES } from "./resolve-news-dir.js";

const [workProfile, personalProfile] = NEWS_PROFILES;

const MOVE_NAMES = new Set([
  "articles.jsonl",
  "user-state.json",
  "last-run.json",
  ".legacy-imported.json",
  "sources.json",
]);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function emptySources(now) {
  return {
    version: 2,
    updatedAt: now,
    feeds: [],
    groups: [],
  };
}

function emptyUserState(now) {
  return {
    version: 1,
    updatedAt: now,
    byUrl: {},
  };
}

async function seedPersonal(personalDir) {
  const now = new Date().toISOString();
  await mkdir(personalDir, { recursive: true });
  const sourcesPath = path.join(personalDir, "sources.json");
  if (!(await exists(sourcesPath))) {
    await writeFile(
      sourcesPath,
      `${JSON.stringify(emptySources(now), null, 2)}\n`,
    );
  }
  const articlesPath = path.join(personalDir, "articles.jsonl");
  if (!(await exists(articlesPath))) {
    await writeFile(articlesPath, "");
  }
  const userStatePath = path.join(personalDir, "user-state.json");
  if (!(await exists(userStatePath))) {
    await writeFile(
      userStatePath,
      `${JSON.stringify(emptyUserState(now), null, 2)}\n`,
    );
  }
}

export async function migrateProfiles(newsRoot) {
  if (!newsRoot || !path.isAbsolute(newsRoot)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }
  const workDir = path.join(newsRoot, workProfile);
  const personalDir = path.join(newsRoot, personalProfile);
  const parentSources = path.join(newsRoot, "sources.json");
  const workSources = path.join(workDir, "sources.json");
  const parentHas = await exists(parentSources);
  const workHas = await exists(workSources);

  if (parentHas && workHas) {
    throw new Error(
      `Cannot migrate: sources.json exists at both parent and ${workProfile}/`,
    );
  }
  if (!parentHas && !workHas) {
    throw new Error(
      `No sources.json at parent or ${workProfile}/; nothing to migrate`,
    );
  }

  const moved = [];
  let leftovers = [];
  let skipped = false;
  if (workHas) {
    skipped = true;
    leftovers = (await readdir(newsRoot))
      .filter(
        (name) =>
          MOVE_NAMES.has(name) || name.startsWith("articles.jsonl.bak-"),
      )
      .sort();
  } else {
    await mkdir(workDir, { recursive: true });
    const names = await readdir(newsRoot);
    const namesToMove = names
      .filter(
        (name) =>
          name !== "sources.json" &&
          (MOVE_NAMES.has(name) || name.startsWith("articles.jsonl.bak-")),
      )
      .sort();
    namesToMove.push("sources.json");
    for (const name of namesToMove) {
      await rename(path.join(newsRoot, name), path.join(workDir, name));
      moved.push(name);
    }
  }

  let createdPersonal = false;
  if (!(await exists(path.join(personalDir, "sources.json")))) {
    await seedPersonal(personalDir);
    createdPersonal = true;
  }

  return { ok: true, skipped, moved, leftovers, createdPersonal };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const newsRoot = process.argv[2] ?? process.env.SHARED_NEWS_DIR;
  migrateProfiles(newsRoot)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
