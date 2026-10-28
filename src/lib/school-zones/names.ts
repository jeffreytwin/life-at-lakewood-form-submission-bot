// School names as the sites write them (Jeff, 2026-10-28: "Also
// standardize names"). The districts' own data names a school its own
// way: Manatee's locator says "Gullett ES" and "Harvey K-8 at Copperstone
// (PK-3)", Sarasota's zones say "Tatum Ridge Elementary Zone". The sites
// say "Gullett Elementary" and "Tatum Ridge Elementary": the style of the
// Life At Lakewood pages Jeff verified on 2026-10-28, which is the
// standard every site is held to. A school whose pages use a fuller name
// than the district (Dr Mona Jain, Annie Lucy Williams) keeps it, below.
// Pure.

export type SchoolLevel = "elementary" | "middle" | "high";
export const SCHOOL_LEVELS: SchoolLevel[] = ["elementary", "middle", "high"];

/** How the pages label each level. */
export const LEVEL_LABEL: Record<SchoolLevel, string> = {
  elementary: "Grade School",
  middle: "Middle School",
  high: "High School",
};

export type District = "manatee" | "sarasota";

/**
 * Manatee schools whose name on the sites is not the locator's label with
 * its abbreviation spelled out. Keyed by the locator's label.
 */
const MANATEE_NAMES: Record<string, string> = {
  "Jain MS": "Dr Mona Jain Middle",
  "Mills ES": "Virgil Mills Elementary",
  "Witt ES": "Gene Witt Elementary",
  "Williams ES": "Annie Lucy Williams Elementary",
  // Two campuses, one school (Jeff, 2026-10-28): the pages name it once.
  "Harvey K-8 at Copperstone (PK-3)": "Barbara A. Harvey K-8",
  "Harvey K-8 at North River Ranch (4-8)": "Barbara A. Harvey K-8",
  "Johnson K-8 School of Int'l Studies": "Johnson K-8",
};

/** Spaces of every kind as one plain space, trimmed: the collections carry narrow no-break spaces. */
export function cleanText(text: string): string {
  return text.replace(/[  -​  　]/g, " ").replace(/\s+/g, " ").trim();
}

/** A district's name for a school, as the sites write it. */
export function displayName(district: District, raw: string): string {
  const name = cleanText(raw);
  if (district === "manatee") {
    if (MANATEE_NAMES[name]) return MANATEE_NAMES[name];
    return name
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/ ES$/, " Elementary")
      .replace(/ MS$/, " Middle")
      .replace(/ HS$/, " High");
  }
  let out = name
    .replace(/^NEW\s+/i, "")
    .replace(/\s+Zone$/i, "")
    .replace(/\b(Elementary|Middle|High) School$/i, "$1")
    .replace(/\bMcintosh\b/g, "McIntosh");
  // The district's K-8s read "Skye Ranch School" in some years' layers.
  if (/ School$/.test(out) && !/\b(Elementary|Middle|High)\b/.test(out)) out = out.replace(/ School$/, " K-8");
  return out;
}

const GENERIC = new Set([
  "school", "elementary", "middle", "high", "es", "ms", "hs", "k", "8", "k8", "pk", "the", "at", "of", "dr", "community", "campus",
]);

/** The words that tell one school from another: "Annie Lucy Williams Elementary" → williams, annie, lucy. */
function coreWords(name: string): Set<string> {
  const words = cleanText(name)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !GENERIC.has(w));
  return new Set(words);
}

/**
 * The same school, however each names it: one's distinguishing words are
 * all among the other's ("Williams Elementary" and "Annie Lucy Williams
 * Elementary"; "Parrish Community High School" and "Parrish Community High").
 */
export function sameSchool(a: string, b: string): boolean {
  const x = coreWords(a);
  const y = coreWords(b);
  if (x.size === 0 || y.size === 0) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((w) => big.has(w));
}

const SUFFIX = /\s+(Elementary|Middle|High)$/;

/** The schools a page names for one level: "McNeal and Braden River Elementary" → McNeal Elementary, Braden River Elementary. */
export function splitSchools(text: string): string[] {
  const clean = cleanText(text);
  if (!clean) return [];
  const parts = clean.split(/\s+(?:and|&)\s+|\s*\/\s*|\s*,\s*/).filter(Boolean);
  const suffix = clean.match(SUFFIX)?.[1];
  return parts.map((p) => (suffix && !SUFFIX.test(p) && !/K-8/.test(p) ? `${p} ${suffix}` : p));
}

/** Several schools for one level as the pages write it: "McNeal and Braden River Elementary". */
export function combineSchools(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  const suffixes = names.map((n) => n.match(SUFFIX)?.[1] ?? null);
  const shared = suffixes[0] && suffixes.every((s) => s === suffixes[0]) ? suffixes[0] : null;
  const parts = shared ? names.map((n) => n.replace(SUFFIX, "")) : names;
  const body = parts.length === 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return shared ? `${body} ${shared}` : body;
}

export type LevelVerdict = "same" | "renamed" | "rezoned" | "missing";

/**
 * How a page's school for a level stands against the district's: the
 * same text; the same school written another way; another school; or
 * no school named at all.
 */
export function compareLevel(current: string, proposed: string): LevelVerdict {
  if (cleanText(current) === proposed) return "same";
  if (!cleanText(current)) return "missing";
  const now = splitSchools(current);
  const next = splitSchools(proposed);
  if (now.length !== next.length) return "rezoned";
  const unmatched = [...next];
  for (const school of now) {
    const i = unmatched.findIndex((n) => sameSchool(school, n));
    if (i < 0) return "rezoned";
    unmatched.splice(i, 1);
  }
  return "renamed";
}
