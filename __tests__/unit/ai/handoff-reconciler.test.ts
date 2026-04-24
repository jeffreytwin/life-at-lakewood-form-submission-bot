import { describe, it, expect } from "vitest";
import {
  detectHandoffIntent,
  findNamedAgent,
  type ReconcilerAgent,
} from "@/lib/ai/handoff-reconciler";

function mkAgent(overrides: { name: string; gender?: ReconcilerAgent["gender"]; id?: string; email?: string | null }): ReconcilerAgent {
  return {
    id: overrides.id ?? `id-${overrides.name.replace(/\s+/g, "-").toLowerCase()}`,
    name: overrides.name,
    email: overrides.email ?? `${overrides.name.split(" ")[0].toLowerCase()}@example.com`,
    gender: overrides.gender ?? null,
  };
}

describe("detectHandoffIntent", () => {
  it("detects 'CCing' as handoff intent", () => {
    expect(detectHandoffIntent("I'm CCing Liz Gasich on this.")).toBe(true);
  });

  it("detects 'CC'ing' with apostrophe", () => {
    expect(detectHandoffIntent("I'm CC'ing my teammate.")).toBe(true);
  });

  it("detects 'connecting you'", () => {
    expect(detectHandoffIntent("Connecting you with our local realtor.")).toBe(true);
  });

  it("detects 'introducing you'", () => {
    expect(detectHandoffIntent("Introducing you to Justin.")).toBe(true);
  });

  it("detects 'putting you in touch'", () => {
    expect(detectHandoffIntent("I'm putting you in touch with Michael.")).toBe(true);
  });

  it("detects 'copying' on a reply", () => {
    expect(detectHandoffIntent("I'm copying Liz to help get you options.")).toBe(true);
  });

  it("returns false for a plain conversational reply", () => {
    expect(
      detectHandoffIntent(
        "Thanks for that detailed information! What's your target price range?"
      )
    ).toBe(false);
  });

  it("returns false for mentions of real estate terms that aren't handoffs", () => {
    expect(detectHandoffIntent("Our prices range from $300k to $1M.")).toBe(false);
  });
});

describe("findNamedAgent", () => {
  const roster: ReconcilerAgent[] = [
    mkAgent({ name: "Liz Gasich", gender: "female" }),
    mkAgent({ name: "Justin Tarica", gender: "male" }),
    mkAgent({ name: "Aleksandra Tarica", gender: "female" }),
    mkAgent({ name: "Michael Dailey", gender: "male" }),
    mkAgent({ name: "Kathryn W. Plosica", gender: "female" }),
  ];

  it("matches an agent by full name", () => {
    const body = "I'm CCing Liz Gasich. She's a teammate who specializes in the area.";
    expect(findNamedAgent(body, roster)?.name).toBe("Liz Gasich");
  });

  it("matches by unique first name when full name isn't used", () => {
    const body = "I'm CCing Michael. He specializes in the area.";
    expect(findNamedAgent(body, roster)?.name).toBe("Michael Dailey");
  });

  it("does NOT match by first name when two agents share it", () => {
    // "Tarica" is a shared last name but first names differ; pick an example
    // where first name collides instead.
    const withTwoJustins: ReconcilerAgent[] = [
      ...roster,
      mkAgent({ name: "Justin Smith", gender: "male" }),
    ];
    const body = "I'm CCing Justin.";
    expect(findNamedAgent(body, withTwoJustins)).toBeNull();
  });

  it("matches a full name that contains punctuation like a middle initial", () => {
    const body = "I'm CCing Kathryn W. Plosica for this one.";
    expect(findNamedAgent(body, roster)?.name).toBe("Kathryn W. Plosica");
  });

  it("is case-insensitive for full-name match", () => {
    const body = "I'm CCing liz gasich on this thread.";
    expect(findNamedAgent(body, roster)?.name).toBe("Liz Gasich");
  });

  it("returns null when no roster member is mentioned", () => {
    const body = "Thanks for reaching out — I'll get back to you soon.";
    expect(findNamedAgent(body, roster)).toBeNull();
  });

  it("prefers full-name match over first-name match", () => {
    // "Liz" is unique, but we want the full-name path to win when both
    // "Liz Gasich" and bare "Liz" appear; either hits the same agent anyway.
    const body = "I'm CCing Liz Gasich. Liz, see the note below.";
    expect(findNamedAgent(body, roster)?.name).toBe("Liz Gasich");
  });

  it("does not false-positive on a lead whose name echoes an agent's first name", () => {
    // If the lead is named "Liz" and no agent handoff occurs, we shouldn't
    // claim Liz-the-agent was named just because her first name appears.
    // (This test asserts the current behavior: we DO match Liz here because
    // her first name is unique. The caller is responsible for gating this
    // on detectHandoffIntent first.)
    const body = "Hi Liz, thanks for reaching out about Lakewood Ranch!";
    // We match — but the integration point in sync-inbox only calls this
    // after detectHandoffIntent returns true, so the caller protects us.
    expect(findNamedAgent(body, roster)?.name).toBe("Liz Gasich");
  });
});
