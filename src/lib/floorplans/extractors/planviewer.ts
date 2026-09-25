// CPS's plan viewer (planviewer.cpsusa.com), the "Personalize this
// floorplan" frame on Neal Signature's plan pages (2026-09-24). The page
// itself shows no floor plan drawing: the viewer draws each floor from an
// SVG it is handed inside the plan's data, with the options laid over it.
// The data is public — https://planviewer.cpsusa.com/<company>/api/planviewer/<plan>
// answers without a sign-in — and carries the plan's floors, its
// elevations (each a PNG at /api/attachment/<ref_ID>) and its tour, when
// the builder gave one.
//
// A floor has no address of its own to put in a record, so the Hub serves
// it: /api/floorplans/planviewer/<company>/<plan>/<floor>.svg, drawn from
// the same data (src/app/api/floorplans/planviewer). The write-back turns
// an SVG into a PNG before Wix sees it (media.ts), as it does for every
// drawing.

import { logger } from "@/lib/shared/logger";
import type { GalleryMeta } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ORIGIN = "https://planviewer.cpsusa.com";
const SAFE_COMPANY = /^[a-z0-9_-]{1,40}$/i;
const SAFE_PLAN = /^\d{1,12}$/;
const SAFE_FLOOR = /^[A-Za-z0-9_-]{1,60}$/;

export interface PlanViewerRef {
  company: string;
  plan: string;
}

/** The plan viewers a page embeds, once each. Pure. */
export function planViewersIn(html: string): PlanViewerRef[] {
  const seen = new Set<string>();
  const found: PlanViewerRef[] = [];
  for (const m of html.matchAll(/planviewer\.cpsusa\.com\/([a-z0-9_-]+)\/floorplan\/(\d+)/gi)) {
    const key = `${m[1].toLowerCase()}/${m[2]}`;
    if (seen.has(key) || !SAFE_COMPANY.test(m[1]) || !SAFE_PLAN.test(m[2])) continue;
    seen.add(key);
    found.push({ company: m[1].toLowerCase(), plan: m[2] });
  }
  return found;
}

/** Where a plan's data is. Null for a company or plan that is not one. */
export function planViewerDataUrl(ref: PlanViewerRef): string | null {
  if (!SAFE_COMPANY.test(ref.company) || !SAFE_PLAN.test(ref.plan)) return null;
  return `${ORIGIN}/${ref.company}/api/planviewer/${ref.plan}`;
}

/** The plan's data, as the viewer is handed it. */
export async function fetchPlanViewer(ref: PlanViewerRef, timeoutMs = 30_000): Promise<unknown> {
  const url = planViewerDataUrl(ref);
  if (!url) throw new Error(`not a plan viewer plan: ${ref.company}/${ref.plan}`);
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

interface Floorplate {
  id?: unknown;
  svg?: { data?: unknown } | null;
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The floors the plan has, by the names the viewer gives them ("First_Floor"). Pure. */
export function floorsOf(data: unknown): string[] {
  const plates = asRecord(data).floorplates;
  if (!Array.isArray(plates)) return [];
  return plates
    .map((p) => (p as Floorplate).id)
    .filter((id): id is string => typeof id === "string" && SAFE_FLOOR.test(id) && Boolean(floorSvg(data, id)));
}

/** One floor's drawing, as the SVG document the viewer draws. Null when the plan has no such floor. Pure. */
export function floorSvg(data: unknown, floor: string): string | null {
  const plates = asRecord(data).floorplates;
  if (!Array.isArray(plates)) return null;
  const plate = plates.find((p) => (p as Floorplate).id === floor) as Floorplate | undefined;
  const encoded = plate?.svg?.data;
  if (typeof encoded !== "string" || !encoded) return null;
  const svg = Buffer.from(encoded, "base64").toString("utf8");
  return /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(svg) ? svg : null;
}

/** The plan's elevations, each a picture of the outside of the house with the name the builder gave it. Pure. */
export function elevationsOf(ref: PlanViewerRef, data: unknown): { src: string; caption: string | null }[] {
  const list = asRecord(data).elevations;
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => asRecord(e))
    .filter((e) => typeof e.ref_ID === "number" || (typeof e.ref_ID === "string" && SAFE_PLAN.test(e.ref_ID)))
    .map((e) => ({
      src: `${ORIGIN}/${ref.company}/api/attachment/${e.ref_ID}`,
      caption: typeof e.description === "string" && e.description.trim() ? e.description.trim() : null,
    }));
}

/** The tour the builder gave the viewer, when it gave one. Pure. */
export function tourOf(data: unknown): string | null {
  const tour = asRecord(asRecord(data).links).tour3DUrl;
  return typeof tour === "string" && /^https?:\/\//i.test(tour.trim()) ? tour.trim() : null;
}

/** Where the Hub is served from, for addresses a record keeps. Null when the deployment does not say. */
export function hubOrigin(): string | null {
  const explicit = process.env.HUB_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}

/** The address the Hub serves one floor's drawing at. Pure but for the Hub's own address. */
export function floorDrawingUrl(ref: PlanViewerRef, floor: string, origin = hubOrigin()): string | null {
  if (!origin || !SAFE_COMPANY.test(ref.company) || !SAFE_PLAN.test(ref.plan) || !SAFE_FLOOR.test(floor)) return null;
  return `${origin}/api/floorplans/planviewer/${ref.company}/${ref.plan}/${floor}.svg`;
}

/** What the plan viewers a page embeds add to its plan: drawings, elevations and a tour. */
export interface PlanViewerExtras {
  drawings: string[];
  elevations: string[];
  meta: Record<string, GalleryMeta>;
  tour: string | null;
}

/**
 * The drawings, elevations and tour of every plan viewer a page embeds. A
 * viewer that cannot be read adds nothing; the page's own pictures stand.
 */
export async function planViewerExtras(html: string): Promise<PlanViewerExtras> {
  const extras: PlanViewerExtras = { drawings: [], elevations: [], meta: {}, tour: null };
  for (const ref of planViewersIn(html).slice(0, 2)) {
    try {
      const data = await fetchPlanViewer(ref);
      for (const floor of floorsOf(data)) {
        const url = floorDrawingUrl(ref, floor);
        if (url) extras.drawings.push(url);
      }
      for (const e of elevationsOf(ref, data)) {
        extras.elevations.push(e.src);
        extras.meta[e.src] = { caption: e.caption, room: "exterior", kind: "exterior" };
      }
      extras.tour ??= tourOf(data);
    } catch (error) {
      logger.warn("Plan viewer could not be read", {
        company: ref.company,
        plan: ref.plan,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return extras;
}
