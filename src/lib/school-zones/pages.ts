// What each village's page says about its schools now: three rich-text
// fields of the site's village pages collection (HousesforSale-DynamicPages
// on every site), each a paragraph like
// <p class="font_7"><strong>Grade School: </strong>Williams Elementary</p>.
// Most of Life At Lakewood's village pages are still built one by one; a
// village without a row there is read from its live static page.
// Pure but for the page fetch.

import { cleanText, LEVEL_LABEL, SCHOOL_LEVELS, type SchoolLevel } from "@/lib/school-zones/names";
import type { WixCollectionField } from "@/lib/wix/client";

export type PageSchools = Record<SchoolLevel, string>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** The page's text, a line per element. */
function pageLines(html: string): string[] {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n");
  return decode(text)
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
}

/**
 * The schools a Life At Lakewood village page names under "Grade School:",
 * "Middle School:" and "High School:"; null when it names none. Pure;
 * exported for tests.
 */
export function readPageSchools(html: string): PageSchools | null {
  const lines = pageLines(html);
  const out: PageSchools = { elementary: "", middle: "", high: "" };
  for (const level of SCHOOL_LEVELS) {
    const label = `${LEVEL_LABEL[level]}:`;
    const i = lines.findIndex((l) => l.startsWith(label));
    if (i < 0) continue;
    const rest = lines[i].slice(label.length).trim();
    out[level] = rest || (lines[i + 1] ?? "");
  }
  return SCHOOL_LEVELS.some((l) => out[l]) ? out : null;
}

/** A static village page, read live: whether it is there, and the schools it names. A page gone (404) is not there. */
export async function fetchStaticPage(url: string): Promise<{ exists: false } | { exists: true; schools: PageSchools | null }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (res.status === 404 || res.status === 410) return { exists: false };
  if (!res.ok) throw new Error(`the page answered ${res.status}`);
  return { exists: true, schools: readPageSchools(await res.text()) };
}

/** The collection's field for each level's school, found by its name ("Neighborhood Elementary School"). Pure. */
export function schoolFields(fields: WixCollectionField[]): Partial<Record<SchoolLevel, string>> {
  const out: Partial<Record<SchoolLevel, string>> = {};
  const find = (word: RegExp) => fields.find((f) => word.test(f.displayName ?? "") && /school/i.test(f.displayName ?? ""))?.key;
  const elementary = find(/elementary|grade/i);
  const middle = find(/middle/i);
  const high = find(/high/i);
  if (elementary) out.elementary = elementary;
  if (middle) out.middle = middle;
  if (high) out.high = high;
  return out;
}

/** The school a field's paragraph names: "<p ...><strong>Grade School: </strong>Williams Elementary</p>" → "Williams Elementary". Pure. */
export function readSchoolField(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = cleanText(decode(value.replace(/<[^>]+>/g, " ")));
  return text.replace(/^(Grade|Elementary|Middle|High)\s+School\s*:\s*/i, "").trim();
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The field's paragraph naming another school, in the paragraph's own
 * markup when it has the usual shape, else in the collections' usual
 * markup. Pure; exported for tests.
 */
export function writeSchoolField(level: SchoolLevel, school: string, existing: unknown): string {
  // The space after the label, as the paragraph has it: Lakewood's read "</strong> &nbsp;".
  const shaped =
    typeof existing === "string" ? existing.match(/^(\s*<p[^>]*>\s*<strong>[^<]*<\/strong>(?:\s|&nbsp;|\u00a0)*)[\s\S]*?(<\/p>\s*)$/i) : null;
  if (shaped) return `${shaped[1]}${escapeHtml(school)}${shaped[2]}`;
  return `<p class="font_7"><strong>${LEVEL_LABEL[level]}: </strong>${escapeHtml(school)}</p>`;
}
