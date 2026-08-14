import path from "node:path";

export const NEWS_PROFILES = Object.freeze(["work", "personal"]);
export const DEFAULT_NEWS_PROFILE = "work";

function requireAbsolute(dir) {
  if (!dir || !path.isAbsolute(dir)) {
    throw new Error("SHARED_NEWS_DIR or --dir= must be an absolute path");
  }
  return dir;
}

export function resolveNewsDir({ newsRoot, profile, dir } = {}) {
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
  return {
    storeDir: path.join(requireAbsolute(newsRoot), selected),
    profile: selected,
  };
}
