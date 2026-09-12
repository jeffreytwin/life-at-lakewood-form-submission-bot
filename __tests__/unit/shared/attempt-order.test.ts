import { describe, it, expect } from "vitest";
import { attemptsNewestFirst } from "@/lib/shared/attempt-order";

function attempt(attempt_number: number, created_at: string | null, agent: string) {
  return { attempt_number, created_at, agent: { name: agent } };
}

describe("attemptsNewestFirst", () => {
  it("orders a single routing cycle by attempt number regardless of input order", () => {
    // The lead behind the report: four attempts in one cycle.
    const attempts = [
      attempt(3, "2026-09-12T19:30:23.190Z", "Chris Kern"),
      attempt(1, "2026-09-12T19:22:26.692Z", "Justin Tarica"),
      attempt(4, "2026-09-12T19:30:40.914Z", "Michael Dailey"),
      attempt(2, "2026-09-12T19:26:21.784Z", "Michelle Klamrzynski"),
    ];

    const sorted = attemptsNewestFirst(attempts);

    expect(sorted.map((a) => a.attempt_number)).toEqual([4, 3, 2, 1]);
    expect(sorted[0].agent.name).toBe("Michael Dailey");
    expect(sorted[1].agent.name).toBe("Chris Kern");
  });

  it("puts a retried lead's fresh attempt ahead of the old cycle's higher numbers", () => {
    // Retry restarts numbering at 1, so the new cycle's #1 is the newest
    // attempt even though the old cycle reached #3.
    const attempts = [
      attempt(1, "2026-06-01T14:00:00Z", "Liz Gasich"),
      attempt(2, "2026-06-01T14:04:00Z", "Lorin Cabrera"),
      attempt(3, "2026-06-01T14:08:00Z", "Chris Kern"),
      attempt(1, "2026-06-01T16:30:00Z", "Liz Gasich"),
    ];

    const sorted = attemptsNewestFirst(attempts);

    expect(sorted[0]).toEqual(attempt(1, "2026-06-01T16:30:00Z", "Liz Gasich"));
    expect(sorted[1].agent.name).toBe("Chris Kern");
  });

  it("falls back to attempt number when rows carry no usable time", () => {
    const attempts = [
      attempt(1, null, "Justin Tarica"),
      attempt(3, "not a date", "Chris Kern"),
      attempt(2, null, "Michelle Klamrzynski"),
    ];

    expect(attemptsNewestFirst(attempts).map((a) => a.attempt_number)).toEqual([3, 2, 1]);
  });

  it("does not mutate its input and tolerates a missing list", () => {
    const attempts = [
      attempt(2, "2026-06-01T14:04:00Z", "Lorin Cabrera"),
      attempt(1, "2026-06-01T14:00:00Z", "Liz Gasich"),
    ];
    const before = [...attempts];

    attemptsNewestFirst(attempts);

    expect(attempts).toEqual(before);
    expect(attemptsNewestFirst(null)).toEqual([]);
    expect(attemptsNewestFirst(undefined)).toEqual([]);
  });
});
