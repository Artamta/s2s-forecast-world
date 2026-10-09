export type Route = "forecast" | "regions" | "briefing" | "about";
export const ROUTES: Route[] = ["forecast", "regions", "briefing", "about"];

export interface UrlState {
  route: Route;
  region: string | null;
  source: string | null;
  issue: string | null;
  product: string | null;
  week: number | null;
  point: { latitude: number; longitude: number } | null;
  cells: boolean;
  snapshot: boolean;
}

export function readUrl(): UrlState {
  const query = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace("#", "") as Route;
  const week = Number(query.get("week"));
  const [latitude, longitude] = (query.get("point") ?? "").split(",").map(Number);
  return {
    route: ROUTES.includes(hash) ? hash : "forecast",
    region: query.get("region"),
    source: query.get("source"),
    issue: query.get("issue"),
    product: query.get("product"),
    week: Number.isInteger(week) && week >= 1 && week <= 6 ? week : null,
    point: Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null,
    cells: query.get("cells") === "1",
    snapshot: query.get("snapshot") === "1",
  };
}

/** Replace the query string without adding a history entry. */
export function writeUrl(values: Record<string, string | null>): void {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === "") query.delete(key);
    else query.set(key, value);
  }
  const text = query.toString();
  try {
    window.history.replaceState(null, "", `${window.location.pathname}${text ? `?${text}` : ""}${window.location.hash}`);
  } catch {
    // Some embedded viewers refuse address changes; the page works without them.
  }
}
