import { describe, expect, it } from "vitest";
import { humanizeMessage, modeLabel, plainError, runOutcome } from "@/app/dashboard/listings/format";

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
    expect(runOutcome({ status: "ok", writes_failed: 0, errors: 0, warnings: 0, images_failed: 3 })).toMatchObject({ label: "partial" });
    expect(runOutcome({ status: "error", writes_failed: 0, errors: 1, warnings: 0, error_message: "boom" })).toMatchObject({ label: "failed", title: "Stopped: boom" });
    expect(runOutcome({ status: "running", writes_failed: 0, errors: 0, warnings: 0 }).label).toBe("running");
  });
});

describe("plainError", () => {
  it("turns an engine message into a plain problem and next step", () => {
    const missing = plainError({ kind: "folder_missing", message: 'Life At Parrish: Media Manager folder "ParrishListingPhotos" not found among the root folders; its photos wait until it exists' }, "Life At Parrish");
    expect(missing.problem).toBe('The photo folder "ParrishListingPhotos" is missing on Life At Parrish, so its photos are waiting.');
    expect(missing.nextStep).toMatch(/Create that folder/);

    const guard = plainError({ kind: "mass_delete_guard", message: "Life in Longboat Key: full run wanted to remove 40 of 200 live listings (guard threshold 20); nothing was removed." }, "Life in Longboat Key");
    expect(guard.problem).toBe("The updater wanted to remove 40 of the 200 live listings from Life in Longboat Key at once, so it removed none.");

    const rejected = plainError({ kind: "write_failed", message: "Life At Parrish rejected MFRA1: WDE0007 field too long", listing_id: "MFRA1", address: "1 Main St" }, "Life At Parrish");
    expect(rejected.problem).toBe("Wix would not save this listing on Life At Parrish.");
    expect(rejected.nextStep).toMatch(/Details/);
  });

  it("names the stage a stopped run failed in and notes a repeat", () => {
    const stopped = plainError({ kind: "run_error", message: "Run failed at fetch: MLSGrid 400: The $skip value (84800) is very high" }, null);
    expect(stopped.problem).toBe("An update stopped early while reading the MLS feed. The MLS feed refused the request.");
    const repeat = plainError({ kind: "import_failed", message: "Life At Parrish: importing photos for MFR1 failed: Wix API 500; retried in 30 min; 2 earlier run(s) in the last 6 h hit the same failure, so it is not clearing on its own", listing_id: "MFR1" }, "Life At Parrish");
    expect(repeat.problem).toBe("Photos for listing MFR1 aren't uploading to Life At Parrish. This has happened several times.");
  });

  it("explains an unusable gallery without naming a URI scheme", () => {
    const e = plainError({ kind: "gallery_unusable", message: "Life in Longboat Key: 5 of 5 photo(s) for MFRA1 are not in a form Wix can show, so they were left out of the gallery", listing_id: "MFRA1" }, "Life in Longboat Key");
    expect(e.problem).toBe("Some photos for listing MFRA1 can't be shown on Life in Longboat Key, so they were left off the listing.");
    expect(e.nextStep).toMatch(/site admin/);
    expect(e.problem).not.toMatch(/wix:image|URI|originWidth/);
  });

  it("falls back to the message for a kind it does not know", () => {
    expect(plainError({ kind: "events_dropped", message: "Event buffer cap reached" }, null)).toEqual({ problem: "Event buffer cap reached", nextStep: "Open Details to see what happened." });
  });
});
