// Announcements (Jeff, 2026-10-17): brand-new neighborhoods announced in a
// place we cover, before they have homes for sale. Once a week Claude
// searches the web for each place, told which neighborhoods we already
// have, and reports the new ones with their sources. Each one not already
// known, ignored, watched or recently dismissed raises an announcement
// alert; the person watches it (watch-list.ts), ignores it, or dismisses
// it. Once a watched one has homes, the daily scan raises it as a new
// neighborhood with the to-do list for adding it.

import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";
import { failedAt as failed, describeError } from "@/lib/shared/describe-error";
import { isQuiet, placeKey, siteContext, SITE_SOURCES } from "@/lib/community-alerts/new-neighborhoods";

const MODEL = "claude-opus-5-5";
/** On a refusal, the API re-runs the request on a fallback model it picks by the refusal's category. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const REPORT_TOOL = "report_neighborhoods";
/** Requests one search may take: the first, then continuing after a pause or a missing report. */
const MAX_TURNS = 4;

/** The place each site covers, as a search for it should name it. */
export const PLACES: Record<string, string> = {
  "lifeatlakewood.com": "Lakewood Ranch, Florida (the master-planned community in Manatee and Sarasota counties)",
  "lifeinwellenpark.com": "Wellen Park, Florida (the master-planned community in Venice / North Port)",
  "lifeatparrish.com": "Parrish, Florida (Manatee County)",
};

export type AnnouncementStatus = "announced" | "coming_soon" | "selling";

export interface Announcement {
  name: string;
  builders: string[];
  status: AnnouncementStatus;
  /** When it is expected to open or start selling, as the source says it; "" when unsaid. */
  opening: string;
  summary: string;
  sources: string[];
}

export interface AnnouncementDetail {
  site: string;
  builders: string[];
  status: AnnouncementStatus;
  opening: string;
  summary: string;
  sources: string[];
  foundAt: string;
}

const REPORT: Anthropic.Beta.BetaTool = {
  name: REPORT_TOOL,
  description:
    "Report the new neighborhoods you found. Call it once, at the end, with every neighborhood that qualifies, or an empty list when none do.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["neighborhoods"],
    properties: {
      neighborhoods: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "builders", "status", "opening", "summary", "sources"],
          properties: {
            name: { type: "string", description: "The neighborhood's name as its developer or builder announces it." },
            builders: { type: "array", items: { type: "string" }, description: "The builders named, if any." },
            status: {
              type: "string",
              enum: ["announced", "coming_soon", "selling"],
              description: "announced: plans made public; coming_soon: an interest list or a date; selling: homes on sale now.",
            },
            opening: { type: "string", description: "When it is expected to open or start selling, as the source says; empty when unsaid." },
            summary: { type: "string", description: "One sentence: what it is and where, from the sources." },
            sources: { type: "array", items: { type: "string" }, description: "The URLs the facts come from." },
          },
        },
      },
    },
  },
};

const SYSTEM =
  "You research new-construction real estate for a team that runs neighborhood websites. " +
  "Find newly announced or coming-soon residential neighborhoods inside one place, using web search. " +
  "Report only neighborhoods that are inside the place itself, not merely nearby, and that were announced or opened in about the last twelve months. " +
  "Leave out every neighborhood on the list the team already covers, under any spelling. " +
  "Rely on the developer's, the builders' and local news sources; do not guess a neighborhood from a single listing. " +
  `When you are done, call ${REPORT_TOOL} once with what you found.`;

/** The request for one place, naming what we already cover. Pure; exported for tests. */
export function promptFor(place: string, covered: string[]): string {
  return [
    `Place: ${place}`,
    "",
    "Neighborhoods we already cover there (leave these out):",
    ...covered.map((n) => `- ${n}`),
    "",
    "Find the new neighborhoods announced or coming soon in this place that are not on the list.",
  ].join("\n");
}

/** The report's neighborhoods, each with its fields tidied; a nameless one is dropped. Pure; exported for tests. */
export function readReport(input: unknown): Announcement[] {
  const list = (input as { neighborhoods?: unknown })?.neighborhoods;
  if (!Array.isArray(list)) return [];
  const statuses: AnnouncementStatus[] = ["announced", "coming_soon", "selling"];
  return list
    .map((raw) => {
      const n = (raw ?? {}) as Record<string, unknown>;
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
      return {
        name: typeof n.name === "string" ? n.name.trim() : "",
        builders: strings(n.builders),
        status: statuses.includes(n.status as AnnouncementStatus) ? (n.status as AnnouncementStatus) : "announced",
        opening: typeof n.opening === "string" ? n.opening.trim() : "",
        summary: typeof n.summary === "string" ? n.summary.trim() : "",
        sources: strings(n.sources).filter((u) => /^https?:\/\//.test(u)),
      };
    })
    .filter((a) => a.name);
}

/** Claude's search of one place, to its report. Exported for tests. */
export async function searchPlace(client: Anthropic, place: string, covered: string[]): Promise<Announcement[]> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: promptFor(place, covered) }];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const params = {
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      // The SDK's types predate the fallbacks parameter; it is sent as given.
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }, REPORT],
      messages,
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming;
    const response = await client.beta.messages.stream(params).finalMessage();
    logger.info("Announcement search turn", {
      place,
      turn,
      stop: response.stop_reason,
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      searches: response.usage.server_tool_use?.web_search_requests ?? 0,
    });
    if (response.stop_reason === "refusal") throw new Error(`the search for ${place} was declined`);
    const report = response.content.find((b) => b.type === "tool_use" && b.name === REPORT_TOOL);
    if (report && report.type === "tool_use") return readReport(report.input);
    messages.push({ role: "assistant", content: response.content });
    // A paused turn carries on from where it stopped; a turn that ended
    // without the report is asked for it.
    if (response.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: `Call ${REPORT_TOOL} now with what you found (an empty list if nothing qualifies).` });
    }
  }
  throw new Error(`the search for ${place} ended without a report`);
}

export interface AnnouncementScan {
  places: { site: string; found: number; error?: string }[];
  raised: string[];
}

/** Searches every place and raises an alert for each new announcement nobody has dealt with. */
export async function scanAnnouncements(): Promise<AnnouncementScan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
  const client = new Anthropic({ apiKey });
  const result: AnnouncementScan = { places: [], raised: [] };
  const now = new Date();

  for (const domain of Object.keys(SITE_SOURCES)) {
    const place = PLACES[domain];
    const ctx = await siteContext(domain);
    if (!place || !ctx) continue;
    const covered = [...new Set([...ctx.communities.map((c) => c.name), ...ctx.villages.map((v) => v.name)])].sort();
    let found: Announcement[];
    try {
      found = await searchPlace(client, place, covered);
    } catch (error) {
      result.places.push({ site: domain, found: 0, error: describeError(error) });
      logger.warn("Announcement search failed", { site: domain, error: describeError(error) });
      continue;
    }
    result.places.push({ site: domain, found: found.length });

    const [{ data: ignoredRows, error: ignoredError }, { data: watchRows, error: watchError }, { data: alertRows, error: alertError }] =
      await Promise.all([
        supabase.from("ca_ignored_neighborhoods").select("name_key").eq("site_id", ctx.fpSiteId),
        supabase.from("ca_watch_list").select("name_key").eq("site_id", ctx.fpSiteId).eq("status", "watching"),
        supabase
          .from("ca_alerts")
          .select("subject_key, status, resolved_at")
          .in("kind", ["announcement", "new_neighborhood"])
          .eq("site_id", ctx.fpSiteId),
      ]);
    if (ignoredError) throw failed("reading the ignored neighborhoods", ignoredError);
    if (watchError) throw failed("reading the watch list", watchError);
    if (alertError) throw failed("reading the alerts", alertError);
    const ignored = new Set((ignoredRows ?? []).map((r) => r.name_key as string));
    const watched = new Set((watchRows ?? []).map((r) => r.name_key as string));
    const openKeys = new Set((alertRows ?? []).filter((a) => a.status === "open").map((a) => a.subject_key as string));
    const closed = (alertRows ?? []).filter((a) => a.status !== "open") as { subject_key: string; status: string; resolved_at: string | null }[];

    for (const a of found) {
      const key = placeKey(a.name);
      if (!key || ctx.known.has(key) || watched.has(key) || openKeys.has(key)) continue;
      if (isQuiet(key, { ignored, closed, now: now.getTime() })) continue;
      const detail: AnnouncementDetail = {
        site: domain,
        builders: a.builders,
        status: a.status,
        opening: a.opening,
        summary: a.summary,
        sources: a.sources,
        foundAt: now.toISOString(),
      };
      const { error: insertError } = await supabase
        .from("ca_alerts")
        .insert({ kind: "announcement", site_id: ctx.fpSiteId, subject_key: key, name: a.name, detail });
      if (insertError && insertError.code !== "23505") throw failed(`raising ${a.name}'s announcement`, insertError);
      if (!insertError) {
        openKeys.add(key);
        result.raised.push(a.name);
      }
    }
  }
  logger.info("Announcement scan", { places: result.places, raised: result.raised });
  return result;
}
