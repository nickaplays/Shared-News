export function normalizeUrl(input) {
  const u = new URL(String(input).trim());
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
  ]) {
    u.searchParams.delete(key);
  }
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  let out = u.toString();
  if (out.endsWith("?")) {
    out = out.slice(0, -1);
  }
  return out;
}
