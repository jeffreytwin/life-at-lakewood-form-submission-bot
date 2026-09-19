import { describe, it, expect } from "vitest";
import { alignedFields, describeFieldType, diffFields, type FieldSpec } from "@/lib/floorplans/collection-schema";

const reference: FieldSpec[] = [
  { key: "_id", type: "TEXT", systemField: true },
  { key: "floorPlanName", type: "TEXT", displayName: "Floor Plan Name" },
  { key: "builder1", type: "REFERENCE", typeMetadata: { reference: { referencedCollectionId: "Builders" } }, displayName: "Builder" },
  { key: "score", type: "NUMBER", displayName: "Score" },
  { key: "notes", type: "TEXT", displayName: "Notes" },
];

const target: FieldSpec[] = [
  { key: "_id", type: "TEXT", systemField: true },
  { key: "_owner", type: "TEXT", systemField: true },
  { key: "floorPlanName", type: "TEXT", displayName: "Plan name" },
  { key: "builder1", type: "REFERENCE", typeMetadata: { reference: { referencedCollectionId: "Builders" } }, displayName: "Builder" },
  { key: "score", type: "ARRAY_STRING", displayName: "Score" },
  { key: "villageSort", type: "TEXT", displayName: "Village sort" },
];

describe("diffFields", () => {
  it("finds what is missing, extra, retyped or relabeled, ignoring system fields", () => {
    const diff = diffFields(reference, target);
    expect(diff.missing.map((f) => f.key)).toEqual(["notes"]);
    expect(diff.extra.map((f) => f.key)).toEqual(["villageSort"]);
    expect(diff.mismatched).toEqual([{ key: "score", reference: "NUMBER", target: "ARRAY_STRING" }]);
    expect(diff.relabeled).toEqual([{ key: "floorPlanName", from: "Plan name", to: "Floor Plan Name" }]);
    expect(diff.shared).toBe(2);
  });

  it("treats a reference to a different collection as a different type", () => {
    const other: FieldSpec = { key: "builder1", type: "REFERENCE", typeMetadata: { reference: { referencedCollectionId: "Villages" } } };
    expect(describeFieldType(other)).toBe("REFERENCE→Villages");
    expect(diffFields([reference[2]], [other]).mismatched).toHaveLength(1);
  });

  it("reports two identical schemas as in sync", () => {
    const diff = diffFields(reference, reference);
    expect(diff).toEqual({ missing: [], extra: [], mismatched: [], relabeled: [], shared: 4 });
  });
});

describe("alignedFields", () => {
  it("keeps the target's fields, relabels shared ones, appends the missing ones and leaves a retyped field alone", () => {
    const { fields, added, removed, relabeled } = alignedFields(reference, target);
    expect(added).toEqual(["notes"]);
    expect(removed).toEqual([]);
    expect(relabeled).toEqual(["floorPlanName"]);
    expect(fields.map((f) => f.key)).toEqual(["_id", "_owner", "floorPlanName", "builder1", "score", "villageSort", "notes"]);
    expect(fields.find((f) => f.key === "floorPlanName")?.displayName).toBe("Floor Plan Name");
    expect(fields.find((f) => f.key === "score")?.type).toBe("ARRAY_STRING");
    // A new field is created from the reference's spec only, nothing Wix sets itself.
    expect(fields.find((f) => f.key === "notes")).toEqual({ key: "notes", displayName: "Notes", type: "TEXT" });
  });

  it("removes the extra fields only when asked", () => {
    const { fields, removed } = alignedFields(reference, target, { removeExtra: true });
    expect(removed).toEqual(["villageSort"]);
    expect(fields.map((f) => f.key)).not.toContain("villageSort");
    expect(fields.map((f) => f.key)).toContain("_owner");
  });

  it("can add without relabeling, or relabel without adding", () => {
    const addOnly = alignedFields(reference, target, { relabel: false });
    expect(addOnly.added).toEqual(["notes"]);
    expect(addOnly.relabeled).toEqual([]);
    expect(addOnly.fields.find((f) => f.key === "floorPlanName")?.displayName).toBe("Plan name");
    const relabelOnly = alignedFields(reference, target, { add: false });
    expect(relabelOnly.added).toEqual([]);
    expect(relabelOnly.relabeled).toEqual(["floorPlanName"]);
    expect(relabelOnly.fields.map((f) => f.key)).not.toContain("notes");
  });

  it("carries a reference field's target collection along", () => {
    const { fields } = alignedFields(reference, [{ key: "floorPlanName", type: "TEXT" }]);
    expect(fields.find((f) => f.key === "builder1")).toEqual({
      key: "builder1",
      displayName: "Builder",
      type: "REFERENCE",
      typeMetadata: { reference: { referencedCollectionId: "Builders" } },
    });
  });
});
