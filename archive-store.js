import { mkdir, readFile, readdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeUrl } from "./normalize-url.js";

export function archiveDir(newsDir) {
  return path.join(newsDir, "archive");
}

export function seenPath(newsDir) {
  return path.join(archiveDir(newsDir), "seen.json");
}

export function monthArchiveFileName(archivedAtIso) {
  const d = new Date(archivedAtIso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid archivedAt: ${archivedAtIso}`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}.jsonl`;
}

export async function ensureArchiveLayout(newsDir) {
  await mkdir(archiveDir(newsDir), { recursive: true });
  try {
    await readFile(seenPath(newsDir), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeSeen(newsDir, { version: 1, updatedAt: null, byUrl: {} });
  }
}

export async function readSeen(newsDir) {
  try {
    const parsed = JSON.parse(await readFile(seenPath(newsDir), "utf8"));
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? null,
      byUrl:
        parsed.byUrl && typeof parsed.byUrl === "object" ? parsed.byUrl : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 1, updatedAt: null, byUrl: {} };
    }
    throw error;
  }
}

export async function writeSeen(newsDir, seen) {
  await mkdir(archiveDir(newsDir), { recursive: true });
  await writeFile(
    seenPath(newsDir),
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: seen.updatedAt ?? new Date().toISOString(),
        byUrl: seen.byUrl || {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function moveArticlesToArchive(
  newsDir,
  articles,
  { archivedAt = new Date().toISOString(), byUrl = {} } = {},
) {
  await ensureArchiveLayout(newsDir);
  const archiveFile = monthArchiveFileName(archivedAt);
  const filePath = path.join(archiveDir(newsDir), archiveFile);
  const seen = await readSeen(newsDir);
  const nextByUrl = { ...byUrl };
  let articlesRemoved = 0;
  let userStatePruned = 0;
  const lines = [];

  for (const article of articles) {
    const key = normalizeUrl(article.url);
    lines.push(
      JSON.stringify({
        ...article,
        url: key,
        archivedAt,
      }),
    );
    seen.byUrl[key] = { archivedAt, archiveFile };
    articlesRemoved += 1;
    if (nextByUrl[key]) {
      delete nextByUrl[key];
      userStatePruned += 1;
    }
  }

  if (lines.length > 0) {
    await appendFile(filePath, `${lines.join("\n")}\n`, "utf8");
  }
  seen.updatedAt = archivedAt;
  await writeSeen(newsDir, seen);
  return { articlesRemoved, userStatePruned, nextByUrl, archivedAt, archiveFile };
}

export async function rebuildSeenFromArchives(newsDir) {
  await ensureArchiveLayout(newsDir);
  const dir = archiveDir(newsDir);
  const names = (await readdir(dir)).filter(
    (name) => name.endsWith(".jsonl") && name !== "seen.json",
  );
  const byUrl = {};
  for (const name of names.sort()) {
    let content = "";
    try {
      content = await readFile(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        if (!row?.url) continue;
        const key = normalizeUrl(row.url);
        byUrl[key] = {
          archivedAt: row.archivedAt || null,
          archiveFile: name,
        };
      } catch {
        // skip corrupt lines
      }
    }
  }
  const seen = {
    version: 1,
    updatedAt: new Date().toISOString(),
    byUrl,
  };
  await writeSeen(newsDir, seen);
  return seen;
}
