// What a new village is, for its rows (Jeff, 2026-10-28: "click a button
// for a new village and have the system create a draft row ... and fill
// it out"; "Claude can fill"). Claude reads the builder's and the
// community's own pages with web search and reports the facts the rows
// are written from, as Stillwater's row was filled by hand on 2026-10-28.
// Only what a source says: an amenity is marked only when the village
// itself has it, not the master-planned community around it.

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@/lib/shared/logger";

const MODEL = "claude-opus-5-5";
/** On a refusal, the API re-runs the request on a fallback model it picks by the refusal's category. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const REPORT_TOOL = "report_village";
const MAX_TURNS = 4;

/** The amenities every village collection tracks, under one name each. */
export const AMENITIES = [
  "clubhouse",
  "pool",
  "fitnessCenter",
  "spa",
  "lifestyleDirector",
  "walkingPaths",
  "dogPark",
  "playground",
  "golf",
  "tennis",
  "pickleball",
  "bocce",
  "restaurant",
  "maintenanceIncluded",
  "gated",
  "ageRestricted",
] as const;
export type Amenity = (typeof AMENITIES)[number];

export const HOME_TYPES = ["Single Family", "Villa", "Townhome", "Condominium", "Coach Home"] as const;

export interface VillageResearch {
  found: boolean;
  /** One sentence on what living there is like: the page's subtitle. */
  subtitle: string;
  /** One sentence on what it is, who builds it and where. */
  overview: string;
  /** The About section: two or three short paragraphs, a blank line between. */
  description: string;
  /** A short headline for what sets it apart: "A Spacious & Private Neighborhood". */
  uniqueFeature: string;
  homeTypes: string[];
  builders: string[];
  amenities: Record<Amenity, boolean>;
  /** A paragraph on its amenities. */
  amenitiesDescription: string;
  faq: { question: string; answer: string }[];
  /** A street address in it, or its sales center's, for its school zones; "" when none is published. */
  address: string;
  sources: string[];
}

const REPORT: Anthropic.Beta.BetaTool = {
  name: REPORT_TOOL,
  description: "Report what you found about the neighborhood. Call it once, at the end.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "found",
      "subtitle",
      "overview",
      "description",
      "uniqueFeature",
      "homeTypes",
      "builders",
      "amenities",
      "amenitiesDescription",
      "faq",
      "address",
      "sources",
    ],
    properties: {
      found: { type: "boolean", description: "False when no official source describes this neighborhood." },
      subtitle: { type: "string", description: "One sentence, under 30 words: what living there is like." },
      overview: { type: "string", description: "One sentence: what it is, who builds it, and where it sits." },
      description: {
        type: "string",
        description: "Two or three short paragraphs for the neighborhood page's About section, separated by a blank line. No prices.",
      },
      uniqueFeature: { type: "string", description: "Two to six words naming what sets it apart, title case." },
      homeTypes: { type: "array", items: { type: "string", enum: [...HOME_TYPES] } },
      builders: { type: "array", items: { type: "string" } },
      amenities: {
        type: "object",
        additionalProperties: false,
        required: [...AMENITIES],
        properties: Object.fromEntries(AMENITIES.map((a) => [a, { type: "boolean" }])),
        description: "True only when a source says the neighborhood itself has it (playground includes a tot lot).",
      },
      amenitiesDescription: { type: "string", description: "One paragraph on the neighborhood's own amenities and what is nearby." },
      faq: {
        type: "array",
        description: "Three to six questions a buyer asks (where it is, size, builder and styles, HOA, amenities), answered from the sources.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "answer"],
          properties: { question: { type: "string" }, answer: { type: "string" } },
        },
      },
      address: { type: "string", description: "A street address in the neighborhood, or its sales center, with city and ZIP; empty when none." },
      sources: { type: "array", items: { type: "string" }, description: "The URLs the facts come from." },
    },
  },
};

const SYSTEM =
  "You research one new residential neighborhood for a real estate team's website. " +
  "Use web search, and rely first on the builder's own pages and the master-planned community's official pages, then local news. " +
  "State only what the sources say; leave a fact out rather than guess. " +
  "Mark an amenity only when it belongs to this neighborhood itself, not to the wider community around it. " +
  "Write plainly and warmly for home buyers: no prices (they change), no superlatives a source does not support. " +
  `When you are done, call ${REPORT_TOOL} once.`;

export interface ResearchRequest {
  name: string;
  /** The place the site covers, as a search should name it: "Lakewood Ranch, Florida". */
  place: string;
  builders: string[];
  /** Where the Hub found it, if anywhere. */
  sourceUrl: string | null;
}

/** The request for one neighborhood. Pure; exported for tests. */
export function promptFor(req: ResearchRequest): string {
  return [
    `Neighborhood: ${req.name}`,
    `Place: ${req.place}`,
    req.builders.length ? `Builders named so far: ${req.builders.join(", ")}` : null,
    req.sourceUrl ? `Where it was found: ${req.sourceUrl}` : null,
    "",
    "Find what the builder's and the community's pages say about it, and report it.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** The report, tidied: unknown home types, empty questions and non-links dropped. Pure; exported for tests. */
export function readReport(input: unknown): VillageResearch {
  const r = (input ?? {}) as Record<string, unknown>;
  const amenities = (r.amenities ?? {}) as Record<string, unknown>;
  return {
    found: r.found === true,
    subtitle: str(r.subtitle),
    overview: str(r.overview),
    description: str(r.description),
    uniqueFeature: str(r.uniqueFeature),
    homeTypes: strings(r.homeTypes).filter((t) => (HOME_TYPES as readonly string[]).includes(t)),
    builders: strings(r.builders),
    amenities: Object.fromEntries(AMENITIES.map((a) => [a, amenities[a] === true])) as Record<Amenity, boolean>,
    amenitiesDescription: str(r.amenitiesDescription),
    faq: (Array.isArray(r.faq) ? r.faq : [])
      .map((q) => ({ question: str((q as Record<string, unknown>)?.question), answer: str((q as Record<string, unknown>)?.answer) }))
      .filter((q) => q.question && q.answer),
    address: str(r.address),
    sources: strings(r.sources).filter((u) => /^https?:\/\//.test(u)),
  };
}

/** Claude's research of one neighborhood, to its report. */
export async function researchVillage(req: ResearchRequest): Promise<VillageResearch> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: promptFor(req) }];
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
    logger.info("Village research turn", {
      village: req.name,
      turn,
      stop: response.stop_reason,
      searches: response.usage.server_tool_use?.web_search_requests ?? 0,
    });
    if (response.stop_reason === "refusal") throw new Error(`the research for ${req.name} was declined`);
    const report = response.content.find((b) => b.type === "tool_use" && b.name === REPORT_TOOL);
    if (report && report.type === "tool_use") return readReport(report.input);
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "pause_turn") messages.push({ role: "user", content: `Call ${REPORT_TOOL} now with what you found.` });
  }
  throw new Error(`the research for ${req.name} ended without a report`);
}
