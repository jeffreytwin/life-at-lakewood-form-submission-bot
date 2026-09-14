import { describe, it, expect } from "vitest";
import { errorMessage } from "@/lib/shared/errors";

describe("errorMessage", () => {
  it("uses the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a string as is", () => {
    expect(errorMessage("plain failure")).toBe("plain failure");
  });

  it("reads the message off a Supabase gateway error object", () => {
    // What supabase-js hands back when the API gateway answers 504: a plain
    // object, not an Error, so String() would print "[object Object]".
    expect(errorMessage({ message: "Gateway Timeout" })).toBe("Gateway Timeout");
  });

  it("appends the code and details of a PostgREST error", () => {
    expect(
      errorMessage({
        message: "JSON object requested, multiple (or no) rows returned",
        code: "PGRST116",
        details: "The result contains 0 rows",
        hint: null,
      })
    ).toBe(
      "JSON object requested, multiple (or no) rows returned (PGRST116; The result contains 0 rows)"
    );
  });

  it("serializes an object that has no message", () => {
    expect(errorMessage({ status: 502, body: "Bad Gateway" })).toBe(
      '{"status":502,"body":"Bad Gateway"}'
    );
  });

  it("stringifies primitives and nullish values", () => {
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(42)).toBe("42");
  });
});
