import { describe, it, expect } from "vitest";
import { getCharacter, ALL_CHARACTER_IDS } from "@/lib/bot-characters";
import type { LeadEvent } from "@/lib/lead-events";

/**
 * The status monitor fills `agentName` with the agent who holds the lead
 * now. On a re-route that is the agent the lead is going TO; the one who
 * timed out or declined arrives as `previousAgentName`. Every character's
 * lines have to read the event the same way, or the bubble names the
 * wrong person.
 */
const NEW_AGENT = "Michelle Klamrzynski";
const PREVIOUS_AGENT = "Justin Tarica";

const reroute: LeadEvent = {
  type: "reroute",
  leadName: "Robert Carnation",
  agentName: NEW_AGENT,
  agentGender: "female",
  previousAgentName: PREVIOUS_AGENT,
};

describe.each(ALL_CHARACTER_IDS)("%s", (id) => {
  const character = getCharacter(id);

  it("names the agent being pinged on the routing line", () => {
    const msg = character.getMessage({
      type: "routing",
      leadName: "Robert Carnation",
      agentName: NEW_AGENT,
      agentGender: "female",
    });
    expect(msg).toContain(NEW_AGENT);
  });

  it("names the agent being chased on the follow-up line", () => {
    const msg = character.getMessage({
      type: "followup",
      leadName: "Robert Carnation",
      agentName: NEW_AGENT,
      agentGender: "female",
    });
    expect(msg).toContain(NEW_AGENT);
  });

  it("names the agent the lead is going to on the re-route line", () => {
    expect(character.getMessage(reroute)).toContain(NEW_AGENT);
  });

  it("never casts the new agent as the one who went quiet", () => {
    const msg = character.getMessage(reroute);
    // If the line names the agent who dropped the lead at all, it must be
    // the previous agent, and the new agent must come after that.
    for (const phrase of ["didn't bite", "didn't pick up", "hasn't responded"]) {
      if (!msg.includes(phrase)) continue;
      expect(msg.indexOf(PREVIOUS_AGENT)).toBeGreaterThanOrEqual(0);
      expect(msg.indexOf(PREVIOUS_AGENT)).toBeLessThan(msg.indexOf(phrase));
      expect(msg.indexOf(NEW_AGENT)).toBeGreaterThan(msg.indexOf(phrase));
    }
  });
});

describe("bigboss re-route line", () => {
  const bigboss = getCharacter("bigboss");

  it("blames the previous agent and hands off to the new one", () => {
    expect(bigboss.getMessage(reroute)).toBe(
      "Justin Tarica didn't bite, Colonel. Switching to Michelle Klamrzynski. Plenty of wildlife out here."
    );
  });

  it("still reads sensibly when the monitor cannot name the previous agent", () => {
    const msg = bigboss.getMessage({ ...reroute, previousAgentName: undefined });
    expect(msg).toBe(
      "The last operator didn't bite, Colonel. Switching to Michelle Klamrzynski. Plenty of wildlife out here."
    );
  });

  it("falls back when neither agent is known", () => {
    const msg = bigboss.getMessage({
      type: "reroute",
      leadName: "Robert Carnation",
    });
    expect(msg).toBe(
      "The last operator didn't bite, Colonel. Switching to a fresh hand. Plenty of wildlife out here."
    );
  });
});
