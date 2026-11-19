import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { ALL_CHARACTER_IDS, HOLIDAYS, dressFor, getCharacter } from "@/lib/bot-characters";
import type { BotCharacter, CharacterId } from "@/lib/bot-characters";
import type { LeadEvent } from "@/lib/lead-events";

/**
 * Jeff, 2026-11-19: a character wearing one of the hats mixes holiday lines
 * in with their everyday ones.
 */

const accepted: LeadEvent = {
  type: "accepted",
  leadName: "Robert Carnation",
  agentName: "Michelle Klamrzynski",
  agentGender: "female",
};

const always = () => 0;
const never = () => 0.99;

// An ordinary day, so getCharacter hands back the character with no hat on.
const plain = {} as Record<CharacterId, BotCharacter>;
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T17:00:00Z"));
  for (const id of ALL_CHARACTER_IDS) plain[id] = getCharacter(id);
});
afterAll(() => {
  vi.useRealTimers();
});

describe.each(ALL_CHARACTER_IDS)("%s in a hat", (id) => {
  it("keeps every everyday greeting and adds holiday ones", () => {
    for (const { id: holiday } of HOLIDAYS) {
      const dressed = dressFor(plain[id], holiday);
      for (const line of plain[id].welcomeMessages) expect(dressed.welcomeMessages).toContain(line);
      expect(dressed.welcomeMessages.length).toBeGreaterThan(plain[id].welcomeMessages.length);
    }
  });

  it("sets the holiday greetings apart, for the first line after the page loads", () => {
    // Jeff, 2026-11-19: in a holiday window the first line of every refresh
    // is a holiday line.
    for (const { id: holiday } of HOLIDAYS) {
      const dressed = dressFor(plain[id], holiday);
      const festive = dressed.holidayWelcomeMessages ?? [];
      expect(festive.length).toBeGreaterThan(0);
      for (const line of festive) {
        expect(dressed.welcomeMessages).toContain(line);
        expect(dressed.holidayOfLine?.(line)).toBe(holiday);
      }
    }
    expect(plain[id].holidayWelcomeMessages).toBeUndefined();
  });

  it("has different greetings for each holiday", () => {
    const added = HOLIDAYS.map(({ id: holiday }) =>
      dressFor(plain[id], holiday).welcomeMessages.slice(plain[id].welcomeMessages.length)
    ).flat();
    expect(new Set(added).size).toBe(added.length);
  });

  it("says the holiday line some of the time and the everyday line the rest", () => {
    for (const { id: holiday } of HOLIDAYS) {
      const everyday = plain[id].getMessage(accepted);
      expect(dressFor(plain[id], holiday, never).getMessage(accepted)).toBe(everyday);
      expect(dressFor(plain[id], holiday, always).getMessage(accepted)).not.toBe(everyday);
    }
  });

  it("still says who the lead went to on a holiday line", () => {
    for (const { id: holiday } of HOLIDAYS) {
      const msg = dressFor(plain[id], holiday, always).getMessage(accepted);
      expect(msg).toContain("Robert Carnation");
      expect(msg).toContain("Michelle Klamrzynski");
    }
  });

  it("still says the floor plan queue is what was cleared", () => {
    for (const { id: holiday } of HOLIDAYS) {
      const msg = dressFor(plain[id], holiday, always).getMessage({ type: "floorplans_cleared", leadName: "" });
      expect(msg).toMatch(/floor plan/i);
    }
  });

  it("has a holiday line for every celebration, bad data, form submission and email event", () => {
    // Jeff, 2026-11-19. The celebration events are the ones RoutingToggle
    // plays the celebration animation for.
    const events: LeadEvent[] = [
      accepted,
      { type: "new", leadName: "" },
      { type: "done", leadName: "" },
      { type: "bad_data", leadName: "Robert Carnation" },
      { type: "email_draft_new", leadName: "" },
      { type: "email_draft_approved", leadName: "" },
      { type: "email_sent", leadName: "" },
      { type: "floorplans_cleared", leadName: "" },
      { type: "community_sold_out_done", leadName: "", communityName: "Star Farms" },
      { type: "community_new_neighborhood_done", leadName: "", communityName: "Star Farms" },
      { type: "community_schools_done", leadName: "", communityName: "Star Farms" },
      { type: "community_fee_check_done", leadName: "", communityName: "Star Farms" },
      { type: "war_room_task_done", leadName: "Robert Carnation" },
    ];
    for (const { id: holiday } of HOLIDAYS) {
      const festive = dressFor(plain[id], holiday, always);
      for (const event of events) {
        const msg = festive.getMessage(event);
        expect(msg, `${holiday} ${event.type}`).not.toBe(plain[id].getMessage(event));
        expect(festive.holidayOfLine?.(msg, event)).toBe(holiday);
        // Whoever or wherever the event is about is still named.
        if (event.leadName) expect(msg).toContain(event.leadName);
        if (event.communityName) expect(msg).toContain(event.communityName);
      }
      expect(festive.getMessage({ type: "bad_data", leadName: "X" })).toMatch(/bad data/i);
      expect(festive.getMessage({ type: "email_draft_new", leadName: "" })).toMatch(/email/i);
    }
  });

  it("keeps the everyday line for an event with no holiday line", () => {
    const failed: LeadEvent = { type: "failed", leadName: "Robert Carnation" };
    for (const { id: holiday } of HOLIDAYS) {
      expect(dressFor(plain[id], holiday, always).getMessage(failed)).toBe(plain[id].getMessage(failed));
    }
  });

  it("knows which of its lines are holiday ones, so the bubble can color them", () => {
    // Jeff, 2026-11-19: a holiday line gets its holiday's outline color.
    for (const { id: holiday } of HOLIDAYS) {
      const festive = dressFor(plain[id], holiday, always);
      const everyday = dressFor(plain[id], holiday, never);
      expect(festive.holidayOfLine?.(festive.getMessage(accepted), accepted)).toBe(holiday);
      expect(everyday.holidayOfLine?.(everyday.getMessage(accepted), accepted)).toBeNull();
      const greetings = festive.welcomeMessages;
      expect(festive.holidayOfLine?.(greetings[greetings.length - 1])).toBe(holiday);
      expect(festive.holidayOfLine?.(greetings[0])).toBeNull();
    }
    expect(plain[id].holidayOfLine).toBeUndefined();
  });

  it("says nothing festive with no hat on", () => {
    expect(dressFor(plain[id], null, always)).toBe(plain[id]);
    const hatless = { ...plain[id], holidayGifs: undefined };
    const dressed = dressFor(hatless, "santa", always);
    expect(dressed.welcomeMessages).toEqual(plain[id].welcomeMessages);
    expect(dressed.getMessage(accepted)).toBe(plain[id].getMessage(accepted));
  });
});
