export type CategorySection = "live" | "movies" | "series";

export type CategoryPrefs = {
  alpha: boolean;
  hidden: string[];
  order: string[];
  labels: Record<string, string>;
};

export type CategoryView = { id: string; label: string };

const KEY = "triplea-iptv-v1-categories";
const SECTIONS: CategorySection[] = ["live", "movies", "series"];

function blank(): CategoryPrefs {
  return { alpha: false, hidden: [], order: [], labels: {} };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim());
}

function labels(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label === "string") out[key] = label;
  }
  return out;
}

export function loadCategoryPrefs(): Record<CategorySection, CategoryPrefs> {
  const prefs = { live: blank(), movies: blank(), series: blank() };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as unknown;
    if (!raw || typeof raw !== "object") return prefs;
    for (const section of SECTIONS) {
      const item = (raw as Record<string, unknown>)[section];
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      prefs[section] = {
        alpha: Boolean(row.alpha),
        hidden: strings(row.hidden),
        order: strings(row.order),
        labels: labels(row.labels),
      };
    }
  } catch {
    /* keep defaults */
  }
  return prefs;
}

export function saveCategoryPrefs(prefs: Record<CategorySection, CategoryPrefs>) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export function playlistNames(values: string[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    const name = value.trim() || "General";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function categoryLabel(id: string, prefs: CategoryPrefs): string {
  const custom = prefs.labels[id]?.trim();
  return custom || id;
}

export function editorOrder(playlist: string[], prefs: CategoryPrefs): string[] {
  const known = playlistNames(playlist);
  const ranked = prefs.order.filter((name) => known.includes(name));
  const rest = known.filter((name) => !ranked.includes(name));
  const list = [...ranked, ...rest];
  if (!prefs.alpha) return list;
  return [...list].sort((a, b) => categoryLabel(a, prefs).localeCompare(categoryLabel(b, prefs)));
}

export function arrangeCategories(playlist: string[], prefs: CategoryPrefs): CategoryView[] {
  return editorOrder(playlist, prefs)
    .filter((id) => !prefs.hidden.includes(id))
    .map((id) => ({ id, label: categoryLabel(id, prefs) }));
}
