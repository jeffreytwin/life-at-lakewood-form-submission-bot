import { describe, expect, it } from "vitest";
import { humanizeMessage, modeLabel, runOutcome } from "@/app/dashboard/listings/format";

const longboat = { name: "Life in Longboat Key", domain: "lifeinlongboatkey.com", target_collection_id: "HousesforSale2", live_collection_id: "HousesforSale" };

describe("humanizeMessage", () => {
  it("names the location instead of its domain or collection ids, whole tokens only", () => {
    expect(humanizeMessage("Written to HousesforSale2: Bay Isles, $1,250,000, 20 photos", [longboat])).toBe("Written to Life in Longboat Key: Bay Isles, $1,250,000, 20 photos");
    expect(humanizeMessage("lifeinlongboatkey.com: could not re-read HousesforSale", [longboat])).toBe("Life in Longboat Key: could not re-read Life in Longboat Key");
    expect(humanizeMessage("re-import from HousesforSale-DynamicPages", [longboat])).toBe("re-import from HousesforSale-DynamicPages");
    expect(humanizeMessage("nothing to map", [])).toBe("nothing to map");
  });
});

describe("run labels", () => {
  it("calls the incremental mode hourly and leaves the rest alone", () => {
    expect(modeLabel("incremental")).toBe("hourly");
    expect(modeLabel("full")).toBe("full");
    expect(modeLabel(null)).toBe("?");
  });

  it("is ok only when nothing the run tried failed", () => {
    expect(runOutcome({ status: "ok", writes_failed: 0, errors: 0, warnings: 2 }).label).toBe("ok");
    expect(runOutcome({ status: "ok", writes_failed: 200, errors: 1, warnings: 0 })).toMatchObject({ label: "partial", cls: "badge badge-warning" });
    expect(runOutcome({ status: "error", writes_failed: 0, errors: 1, warnings: 0, error_message: "boom" })).toMatchObject({ label: "failed", title: "Stopped: boom" });
    expect(runOutcome({ status: "running", writes_failed: 0, errors: 0, warnings: 0 }).label).toBe("running");
  });
});
