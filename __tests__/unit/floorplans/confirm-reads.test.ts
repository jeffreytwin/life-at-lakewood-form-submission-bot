import { describe, expect, it } from "vitest";
import { confirmChanges, MOST_RUNS_HELD, SIGHTING_DAYS, type Sighting } from "@/lib/floorplans/confirm-reads";
import type { FieldChange } from "@/lib/floorplans/diff";

// A change read twice before anyone is asked about it (Jeff, 2026-10-13).

const photos = (value: string): FieldChange => ({ field: "galleryImages", label: "photos", oldValue: "2 photos · add790f4", newValue: value });
const description = (value: string): FieldChange => ({ field: "description", label: "description", oldValue: "The old words… · 11111111", newValue: value });
const price: FieldChange = { field: "priceDisplay", label: "price", oldValue: "$500,000", newValue: "$510,000" };
const none = new Map<string, string | null>();
const compared = ["price", "description", "photos", "blueprints"];
const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse("2026-10-14T07:00:00Z");

/** Runs one plan through the gate night after night, carrying what each remembers to the next, as the table does. */
function nights(reads: FieldChange[][], every = 1): { queued: string[][]; seen: Map<string, Sighting> } {
  const seen = new Map<string, Sighting>();
  const queued: string[][] = [];
  reads.forEach((changes, night) => {
    const runId = `run-${night}`;
    const now = start + night * every * DAY;
    const gate = confirmChanges(changes, compared, seen, none, runId, now);
    queued.push(gate.confirmed.map((c) => `${c.label}=${c.newValue}`));
    for (const label of gate.forget) seen.delete(label);
    for (const label of gate.interrupted) seen.set(label, { ...seen.get(label)!, newValue: null, runId });
    for (const r of gate.remember) {
      seen.set(r.label, { newValue: r.newValue, runId, runs: r.runs, firstSeenAt: r.firstSeenAt, seenAt: new Date(now).toISOString() });
    }
  });
  return { queued, seen };
}

describe("what a held change is remembered with", () => {
  it("carries the start of its count, so rows kept together are written whole", () => {
    // Photos continuing a count and a description starting one, in the same run.
    const begun = new Date(start - 2 * DAY).toISOString();
    const seen = new Map<string, Sighting>([["photos", { newValue: null, runId: "run-1", runs: 1, firstSeenAt: begun, seenAt: begun }]]);
    const gate = confirmChanges([photos("1 photo · e3422460"), description("New words… · 22222222")], compared, seen, none, "run-2", start);
    expect(gate.remember).toEqual([
      { label: "photos", newValue: "1 photo · e3422460", runs: 2, firstSeenAt: begun },
      { label: "description", newValue: "New words… · 22222222", runs: 1, firstSeenAt: new Date(start).toISOString() },
    ]);
  });
});

describe("a change read twice before anyone is asked about it", () => {
  it("holds a description, photos or drawings read once, and queues them when the next run reads them the same way", () => {
    const { queued, seen } = nights([[photos("1 photo · e3422460"), description("New words… · 22222222")], [photos("1 photo · e3422460"), description("New words… · 22222222")]]);
    expect(queued[0]).toEqual([]);
    expect(queued[1]).toEqual(["photos=1 photo · e3422460", "description=New words… · 22222222"]);
    expect(seen.size).toBe(0);
  });

  it("queues a price, a name or a tour at once, as before", () => {
    const gate = confirmChanges([price], compared, new Map(), none, "run-1", start);
    expect(gate.confirmed).toEqual([price]);
    expect(gate.held).toEqual([]);
  });

  it("does not let one run confirm itself", () => {
    const seen = new Map<string, Sighting>([["photos", { newValue: "1 photo · e3422460", runId: "run-1", runs: 1, firstSeenAt: new Date(start).toISOString(), seenAt: new Date(start).toISOString() }]]);
    expect(confirmChanges([photos("1 photo · e3422460")], compared, seen, none, "run-1", start).confirmed).toEqual([]);
  });

  it("queues at once a change already waiting in the queue with the same value, and refreshes it", () => {
    const waiting = new Map<string, string | null>([["photos", "1 photo · e3422460"]]);
    expect(confirmChanges([photos("1 photo · e3422460")], compared, new Map(), waiting, "run-1", start).confirmed).toHaveLength(1);
    // Not one waiting with another value: that one stays, and this one waits its turn.
    expect(confirmChanges([photos("1 photo · 8a1919b3")], compared, new Map(), waiting, "run-1", start).held).toHaveLength(1);
  });

  it(`puts to a person a field that has differed from the record ${MOST_RUNS_HELD} runs in a row, however it read`, () => {
    const { queued } = nights([[description("A… · aaaaaaaa")], [description("B… · bbbbbbbb")], [description("C… · cccccccc")]]);
    expect(queued.slice(0, MOST_RUNS_HELD - 1).flat()).toEqual([]);
    expect(queued[MOST_RUNS_HELD - 1]).toEqual(["description=C… · cccccccc"]);
  });
});

describe("a second reading the same night (Jeff, 2026-10-14: why wait an entire day)", () => {
  const seen = new Map<string, Sighting>([
    ["photos", { newValue: "1 photo · e3422460", runId: "run-1", runs: 1, firstSeenAt: new Date(start).toISOString(), seenAt: new Date(start).toISOString() }],
    ["description", { newValue: "New words… · 22222222", runId: "run-1", runs: 1, firstSeenAt: new Date(start).toISOString(), seenAt: new Date(start).toISOString() }],
  ]);

  it("confirms what reads the same way again, and leaves the rest as the first reading left it", () => {
    const gate = confirmChanges([photos("1 photo · e3422460"), description("Other words… · 33333333")], compared, seen, none, "run-1b", start + 3_600_000, { secondReading: true });
    expect(gate.confirmed).toEqual([photos("1 photo · e3422460")]);
    expect(gate.forget).toEqual(["photos"]);
    expect(gate.held).toEqual([description("Other words… · 33333333")]);
    // Not remembered, not counted as a run: the description keeps its first sighting.
    expect(gate.remember).toEqual([]);
    expect(gate.interrupted).toEqual([]);
  });

  it("does not forget a held field it read the record's way: that is a reading, not the record changing", () => {
    const gate = confirmChanges([], compared, seen, none, "run-1b", start + 3_600_000, { secondReading: true });
    expect(gate.forget).toEqual([]);
    expect(gate.interrupted).toEqual([]);
  });

  it("still queues a price at once", () => {
    expect(confirmChanges([price], compared, seen, none, "run-1b", start, { secondReading: true }).confirmed).toEqual([price]);
  });
});

describe("a reading that comes and goes (David Weekley's Truman, 2 photos and 1, Oct 6-13)", () => {
  // One elevation read, then both (the record: no change), and so on.
  const truman = [[photos("1 photo · e3422460")], [], [photos("1 photo · 8a1919b3")], [], [photos("1 photo · 8a1919b3")], [], [photos("1 photo · e3422460")]];

  it("is not read the same way twice when the record's reading came between", () => {
    const { queued, seen } = nights(truman.slice(0, 3));
    expect(queued.flat()).toEqual([]);
    expect(seen.get("photos")).toMatchObject({ newValue: "1 photo · 8a1919b3", runs: 2 });
  });

  it(`reaches a person on its ${MOST_RUNS_HELD}rd night within ${SIGHTING_DAYS} days, not every other night, so a record that holds the wrong reading is set right`, () => {
    const { queued } = nights(truman);
    expect(queued.map((q) => q.length)).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(queued[4]).toEqual(["photos=1 photo · 8a1919b3"]);
  });

  it(`starts over once ${SIGHTING_DAYS} days have gone by without it`, () => {
    // A reading every eight days: never three within two weeks.
    const { queued, seen } = nights([[photos("1 photo · e3422460")], [photos("1 photo · 8a1919b3")], [photos("1 photo · e3422460")], [photos("1 photo · 8a1919b3")]], 8);
    expect(queued.flat()).toEqual([]);
    expect(seen.get("photos")?.runs).toBe(2);
  });

  it("keeps what it held through a run that did not read the field, and forgets it once out of date", () => {
    const seen = new Map<string, Sighting>([
      ["photos", { newValue: "1 photo · e3422460", runId: "run-1", runs: 1, firstSeenAt: new Date(start).toISOString(), seenAt: new Date(start).toISOString() }],
      ["description", { newValue: "New words… · 22222222", runId: "run-1", runs: 1, firstSeenAt: new Date(start).toISOString(), seenAt: new Date(start).toISOString() }],
    ]);
    // The page went unread: the run said nothing about the description.
    const gate = confirmChanges([], ["price", "photos"], seen, none, "run-2", start + DAY);
    expect(gate.interrupted).toEqual(["photos"]);
    expect(gate.forget).toEqual([]);
    expect(gate.remember).toEqual([]);
    const later = confirmChanges([], ["price", "photos"], seen, none, "run-3", start + (SIGHTING_DAYS + 1) * DAY);
    expect(later.forget).toEqual(["photos"]);
  });
});
