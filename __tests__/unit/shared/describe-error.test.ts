import { describe, expect, it } from "vitest";
import { describeError } from "@/lib/shared/describe-error";

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

  it("falls back to the object itself, then to the value", () => {
    expect(describeError({ status: 502 })).toBe('{"status":502}');
    expect(describeError("plain trouble")).toBe("plain trouble");
    expect(describeError(null)).toBe("null");
  });
});
