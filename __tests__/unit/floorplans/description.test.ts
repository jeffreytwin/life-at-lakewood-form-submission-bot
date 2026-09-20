import { describe, it, expect } from "vitest";
import { rewriteKey, speaksAsOwner } from "@/lib/floorplans/description";

describe("speaksAsOwner", () => {
  it("hears the builder speaking as the owner: we, our, us and their contractions, as whole words", () => {
    expect(speaksAsOwner("Our Lori plan features a great room.")).toBe(true);
    expect(speaksAsOwner("We've designed every detail. Contact us today.")).toBe(true);
    expect(speaksAsOwner("This is ours to share.")).toBe(true);
    expect(speaksAsOwner("The Lori plan features a great room with your family in mind.")).toBe(false);
    expect(speaksAsOwner("Hours of sunshine on the lanai; flowers by the entry.")).toBe(false);
  });

  it("does not mistake the country, or nothing, for the builder", () => {
    expect(speaksAsOwner("Built to US standards.")).toBe(false);
    expect(speaksAsOwner(null)).toBe(false);
    expect(speaksAsOwner("")).toBe(false);
  });
});

describe("rewriteKey", () => {
  it("is the builder and the exact text, so the same description is reworded once", () => {
    expect(rewriteKey("Toll Brothers", "Our Lori plan.")).toBe(rewriteKey("Toll Brothers", "Our Lori plan."));
    expect(rewriteKey("Toll Brothers", "Our Lori plan.")).not.toBe(rewriteKey("Lennar", "Our Lori plan."));
    expect(rewriteKey("Toll Brothers", "Our Lori plan.")).not.toBe(rewriteKey("Toll Brothers", "Our Lori plan"));
    expect(rewriteKey("Toll Brothers", "x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
