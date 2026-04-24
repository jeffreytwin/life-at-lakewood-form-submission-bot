import { describe, it, expect } from "vitest";
import { parseEmailAddress, parseEmailList } from "@/lib/gmail/sync-sent";

describe("parseEmailAddress", () => {
  it("extracts email from '\"Name\" <email>' format", () => {
    expect(parseEmailAddress('"Liz Gasich" <liz@example.com>')).toBe("liz@example.com");
  });

  it("returns raw address when there's no angle-bracket wrapper", () => {
    expect(parseEmailAddress("liz@example.com")).toBe("liz@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(parseEmailAddress("  liz@example.com  ")).toBe("liz@example.com");
  });
});

describe("parseEmailList", () => {
  it("returns empty array for empty string", () => {
    expect(parseEmailList("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseEmailList("   ")).toEqual([]);
  });

  it("parses a single address", () => {
    expect(parseEmailList("liz@example.com")).toEqual(["liz@example.com"]);
  });

  it("parses multiple addresses separated by commas", () => {
    expect(parseEmailList("liz@example.com, justin@example.com")).toEqual([
      "liz@example.com",
      "justin@example.com",
    ]);
  });

  it("parses addresses with display-name wrappers", () => {
    expect(
      parseEmailList('"Liz Gasich" <liz@example.com>, "Justin Tarica" <justin@example.com>')
    ).toEqual(["liz@example.com", "justin@example.com"]);
  });

  it("handles mixed formats", () => {
    expect(
      parseEmailList('liz@example.com, "Justin Tarica" <justin@example.com>')
    ).toEqual(["liz@example.com", "justin@example.com"]);
  });
});
