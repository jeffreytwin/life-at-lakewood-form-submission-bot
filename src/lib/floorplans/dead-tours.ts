// A Matterport tour whose model is gone shows a visitor an error page. A
// model goes when the builder takes it down, often when the model home
// sells: the tour audit of 2026-10-02 found thirteen, on 57 plans and
// homes across Lennar, Cardel, Dream Finders, WestBay, Mattamy, Pulte and
// Adams (Jeff: "clear out the confirmed dead links"). Every run asks
// Matterport once for each model it carries, and a model Matterport says
// it does not have comes off the plans and homes that show it, as gone
// (tourStated), so the queue proposes taking it off the site. Only that
// answer counts: a model that could not be asked about is kept.

import { logger } from "@/lib/shared/logger";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const GRAPH = "https://my.matterport.com/api/mp/models/graph";

/** The Matterport model a tour shows, or null for a tour on another host. Pure; exported for tests. */
export function matterportModel(url: string | null | undefined): string | null {
  return (url ?? "").match(/matterport\.com\/(?:show\/?\?(?:[^#]*&)?m=|models\/|discover\/space\/)([A-Za-z0-9]{6,})/i)?.[1] ?? null;
}

/** What Matterport answers for a model: gone only when it says "not.found". Pure; exported for tests. */
export function isGone(answer: unknown): boolean {
  const a = answer as { data?: { model?: unknown }; errors?: { extensions?: { code?: string } }[] } | null;
  return !a?.data?.model && Boolean(a?.errors?.some((e) => e?.extensions?.code === "not.found"));
}

/** The models of these plans that Matterport no longer has. A question that fails says nothing. */
export async function goneModels(plans: NormalizedPlan[], fetcher: typeof fetch = fetch): Promise<Set<string>> {
  const ids = [...new Set(plans.map((p) => matterportModel(p.virtualTourUrl)).filter((id): id is string => Boolean(id)))];
  const gone = new Set<string>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const res = await fetcher(GRAPH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: `{ model(id: ${JSON.stringify(id)}) { state } }` }),
            signal: AbortSignal.timeout(10_000),
          });
          if (isGone(await res.json())) gone.add(id);
        } catch (error) {
          logger.warn("Matterport model could not be checked", { id, error: error instanceof Error ? error.message : String(error) });
        }
      }
    })
  );
  return gone;
}

/** The plans and homes without a tour whose model is gone, the tour's still with it. Pure; exported for tests. */
export function withoutDeadTours(plans: NormalizedPlan[], gone: Set<string>): NormalizedPlan[] {
  if (!gone.size) return plans;
  return plans.map((p) => {
    const id = matterportModel(p.virtualTourUrl);
    return id && gone.has(id) ? { ...p, virtualTourUrl: null, virtualTourImage: null, tourStated: true } : p;
  });
}
