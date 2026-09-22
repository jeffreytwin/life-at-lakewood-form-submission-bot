import { describe, expect, it } from "vitest";
import { describeError, failedAt } from "@/lib/shared/describe-error";

describe("describeError", () => {
  it("says what a Supabase error was, which String() will not", () => {
    // A Reset failed three times and logged "[object Object]" each time
    // (Jeff, 2026-09-22).
    const postgrest = {
      message: 'update or delete on table "fp_pending_changes" violates foreign key constraint',
      details: "Key (id)=(abc) is still referenced from table fp_follow_up_tasks.",
      hint: null,
      code: "23503",
    };
    expect(String(postgrest)).toBe("[object Object]");
    expect(describeError(postgrest)).toBe(
      'update or delete on table "fp_pending_changes" violates foreign key constraint — ' +
        "Key (id)=(abc) is still referenced from table fp_follow_up_tasks. (23503)"
    );
  });

  it("keeps an Error's message, and what caused it", () => {
    expect(describeError(new Error("fetch failed"))).toBe("fetch failed");
    expect(describeError(new Error("fetch failed", { cause: new Error("ECONNRESET") })))
      .toBe("fetch failed: ECONNRESET");
  });

  it("keeps the number when that is all a gateway gave", () => {
    // A Reset said only "Bad Request": a gateway refusing an address too
    // long, not the database (Jeff, 2026-09-22).
    expect(describeError({ message: "Bad Request", status: 400 })).toBe("Bad Request (400)");
  });

  it("says which step it was", () => {
    expect(failedAt("releasing its pictures", { message: "Bad Request", status: 400 }).message).toBe(
      "releasing its pictures: Bad Request (400)"
    );
  });

  it("falls back to the object itself, then to the value", () => {
    expect(describeError({ status: 502 })).toBe('{"status":502}');
    expect(describeError("plain trouble")).toBe("plain trouble");
    expect(describeError(null)).toBe("null");
  });
});
