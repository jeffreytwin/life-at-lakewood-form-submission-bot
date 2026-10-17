import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { promptFor, readReport, searchPlace } from "@/lib/community-alerts/announcements";

const usage = { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } };
const report = (neighborhoods: unknown[]) => ({
  stop_reason: "tool_use",
  usage,
  content: [{ type: "tool_use", id: "t1", name: "report_neighborhoods", input: { neighborhoods } }],
});

/** A client whose responses are given in order; it keeps every request it was sent. */
function fakeClient(responses: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          // The request as it stood when sent: the loop goes on adding to its messages.
          sent.push({ ...params, messages: [...(params.messages as unknown[])] });
          const next = responses.shift();
          return { finalMessage: async () => next };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const seaflower = {
  name: " Seaflower ",
  builders: ["Neal Communities", ""],
  status: "coming_soon",
  opening: "Spring 2027",
  summary: "A Neal community in Lakewood Ranch.",
  sources: ["https://example.com/seaflower", "not a url"],
};

describe("promptFor", () => {
  it("names the place and every neighborhood already covered", () => {
    const prompt = promptFor("Parrish, Florida", ["Oakfield", "Seaire"]);
    expect(prompt).toContain("Parrish, Florida");
    expect(prompt).toContain("- Oakfield");
    expect(prompt).toContain("- Seaire");
  });
});

describe("readReport", () => {
  it("tidies each neighborhood and drops what is not a link", () => {
    expect(readReport({ neighborhoods: [seaflower] })).toEqual([
      {
        name: "Seaflower",
        builders: ["Neal Communities"],
        status: "coming_soon",
        opening: "Spring 2027",
        summary: "A Neal community in Lakewood Ranch.",
        sources: ["https://example.com/seaflower"],
      },
    ]);
  });

  it("drops a nameless one and reads an unknown status as announced", () => {
    const read = readReport({ neighborhoods: [{ name: "" }, { name: "X", status: "rumored" }] });
    expect(read).toHaveLength(1);
    expect(read[0].status).toBe("announced");
  });

  it("is empty for a report that is not one", () => {
    expect(readReport(null)).toEqual([]);
    expect(readReport({ neighborhoods: "none" })).toEqual([]);
  });
});

describe("searchPlace", () => {
  it("asks once, with web search and the report tool, and reads the report", async () => {
    const { client, sent } = fakeClient([report([seaflower])]);
    const found = await searchPlace(client, "Lakewood Ranch, Florida", ["Star Farms"]);
    expect(found.map((f) => f.name)).toEqual(["Seaflower"]);
    expect(sent).toHaveLength(1);
    const tools = sent[0].tools as { type?: string; name: string }[];
    expect(tools.map((t) => t.name)).toEqual(["web_search", "report_neighborhoods"]);
    expect(tools[0].type).toBe("web_search_20260209");
    expect(sent[0].model).toBe("claude-opus-5-5");
  });

  it("carries on after a paused turn, sending the turn back as it was", async () => {
    const paused = { stop_reason: "pause_turn", usage, content: [{ type: "text", text: "searching" }] };
    const { client, sent } = fakeClient([paused, report([])]);
    expect(await searchPlace(client, "Parrish, Florida", [])).toEqual([]);
    expect(sent).toHaveLength(2);
    const messages = sent[1].messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("asks for the report when a turn ends without it", async () => {
    const ended = { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Here is what I found." }] };
    const { client, sent } = fakeClient([ended, report([seaflower])]);
    expect((await searchPlace(client, "Parrish, Florida", [])).map((f) => f.name)).toEqual(["Seaflower"]);
    const messages = sent[1].messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("fails on a declined search, and on one that never reports", async () => {
    const declined = { stop_reason: "refusal", usage, content: [] };
    await expect(searchPlace(fakeClient([declined]).client, "Parrish, Florida", [])).rejects.toThrow(/declined/);
    const ended = { stop_reason: "end_turn", usage, content: [] };
    await expect(searchPlace(fakeClient([ended, ended, ended, ended]).client, "Parrish, Florida", [])).rejects.toThrow(/without a report/);
  });
});
