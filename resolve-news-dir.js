import { access } from "node:fs/promises";
import path from "node:path";

export const NEWS_PROFILES = Object.freeze(["work", "personal"]);
export const DEFAULT_NEWS_PROFILE = "work";

function requireAbsolute(dir) {
  if (!dir || !path.isAbsolute(dir)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }
  return dir;
}

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

export async function resolveNewsDir({ newsRoot, profile, dir } = {}) {
  if (dir !== undefined && dir !== null && dir !== "") {
    return { storeDir: requireAbsolute(dir), profile: null };
  }
  const selected =
    profile === undefined || profile === null || profile === ""
      ? DEFAULT_NEWS_PROFILE
      : profile;
  if (!NEWS_PROFILES.includes(selected)) {
    throw new Error(`Unknown news profile: ${selected}`);
  }
  const root = requireAbsolute(newsRoot);
  const profileDir = path.join(root, selected);
  if (
    selected === "work" &&
    !(await exists(path.join(profileDir, "sources.json"))) &&
    (await exists(path.join(root, "sources.json")))
  ) {
    // Remove at rollout step 5, after migrate and UI fallbacks.
    return { storeDir: root, profile: selected };
  }
  return {
    storeDir: profileDir,
    profile: selected,
  };
}
