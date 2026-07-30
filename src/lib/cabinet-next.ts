/** Safe in-app redirect after magic/OTP login. Only /cabinet/* allowed. */
export function safeCabinetNext(raw: string | null | undefined): string {
  if (!raw) return "/cabinet";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/cabinet";
  }
  const path = decoded.split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/cabinet")) return "/cabinet";
  if (path.includes("//") || path.includes("\\") || path.includes("..")) {
    return "/cabinet";
  }
  return path;
}

export function withCabinetNext(magicUrl: string, next?: string | null) {
  const safe = safeCabinetNext(next);
  if (safe === "/cabinet") return magicUrl;
  const u = new URL(magicUrl);
  u.searchParams.set("next", safe);
  return u.toString();
}
