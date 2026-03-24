export function hasToken(storageKey = "access_token") {
  if (typeof window === "undefined") return false;
  return !!sessionStorage.getItem(storageKey);
}
