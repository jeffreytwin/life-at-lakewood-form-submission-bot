import { describe, expect, it } from "vitest";
import { LISTINGS_ALERT_SOUND, NEW_LEAD_SOUND, SOUNDS, STATUS_SOUNDS } from "@/lib/notification-sounds";

/**
 * Jeff, 2026-09-16: the alert is the "a person is needed" sound. A lead
 * that falls to manual needs someone; bad data needs nothing, so the two
 * swapped sounds.
 */
describe("status sounds", () => {
  it("plays the alert when a lead needs a person and the quieter tone for bad data", () => {
    expect(STATUS_SOUNDS.manual).toBe(SOUNDS.alert);
    expect(STATUS_SOUNDS.failed).toBe(SOUNDS.alert);
    expect(STATUS_SOUNDS.bad_data).toBe(SOUNDS.manual);
    expect(STATUS_SOUNDS.bad_data).not.toBe(SOUNDS.alert);
  });

  it("keeps the celebration and codec sounds where they were", () => {
    expect(STATUS_SOUNDS.accepted).toBe(SOUNDS.victory);
    expect(STATUS_SOUNDS.owned_by_other).toBe(SOUNDS.victory);
    expect(STATUS_SOUNDS.routing).toBe(SOUNDS.codec);
    expect(NEW_LEAD_SOUND).toBe(SOUNDS.newForm);
  });

  it("gives a listings problem the same alert a lead needing a person gets", () => {
    expect(LISTINGS_ALERT_SOUND).toBe(SOUNDS.alert);
  });
});
