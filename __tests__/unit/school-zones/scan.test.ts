import { describe, it, expect } from "vitest";
import { fingerprintOf, levelDetails, proposeLevel } from "@/lib/school-zones/scan";
import { cleanPoints } from "@/lib/school-zones/places";
import { readPageSchools, readSchoolField, schoolFields, writeSchoolField } from "@/lib/school-zones/pages";
import type { PointZones } from "@/lib/school-zones/districts";

const zone = (latest: PointZones["latest"], current: PointZones["current"] = latest): PointZones => ({ district: "manatee", latest, current, notes: [] });

describe("a level's schools from its homes' zones", () => {
  it("names a split village's schools by share, as Summerfield's page does", () => {
    // Summerfield: six homes McNeal, three Braden River, one Willis.
    const answers = [
      ...Array(6).fill(["McNeal Elementary"]),
      ...Array(3).fill(["Braden River Elementary"]),
      ["Willis Elementary"],
    ];
    const { names, shares } = proposeLevel(answers);
    expect(names).toEqual(["McNeal Elementary", "Braden River Elementary"]);
    expect(shares).toEqual([
      { name: "McNeal Elementary", homes: 6 },
      { name: "Braden River Elementary", homes: 3 },
      { name: "Willis Elementary", homes: 1 },
    ]);
  });

  it("names one school when one home in seven differs", () => {
    expect(proposeLevel([...Array(6).fill(["Veterans Elementary"]), ["Virgil Mills Elementary"]]).names).toEqual(["Veterans Elementary"]);
  });

  it("names the only school a lone home has, and nothing for no answers", () => {
    expect(proposeLevel([["Rye Ranch Elementary"]]).names).toEqual(["Rye Ranch Elementary"]);
    expect(proposeLevel([undefined, []]).names).toEqual([]);
  });
});

describe("a village's levels", () => {
  const page = { elementary: "Annie Lucy Williams Elementary", middle: "Buffalo Creek Middle", high: "Palmetto High" };

  it("says what changes, and what this year says when the next year differs", () => {
    const answers = Array(4).fill(
      zone(
        { elementary: ["Annie Lucy Williams Elementary"], middle: ["Buffalo Creek Middle"], high: ["Lakewood Ranch High"] },
        { elementary: ["Annie Lucy Williams Elementary"], middle: ["Buffalo Creek Middle"], high: ["Parrish Community High"] }
      )
    );
    const levels = levelDetails(page, answers);
    expect(levels.map((l) => [l.level, l.verdict])).toEqual([
      ["elementary", "same"],
      ["middle", "same"],
      ["high", "rezoned"],
    ]);
    expect(levels[2]).toMatchObject({ page: "Palmetto High", proposed: "Lakewood Ranch High", thisYear: "Parrish Community High" });
    expect(fingerprintOf(levels)).toContain("high:Palmetto High>Lakewood Ranch High");
  });

  it("leaves a level the zones say nothing about as the page has it", () => {
    const levels = levelDetails(page, [zone({ elementary: ["Annie Lucy Williams Elementary"] })]);
    expect(levels[2]).toMatchObject({ verdict: "same", proposed: "Palmetto High" });
  });
});

describe("a village's homes", () => {
  it("drop the ones miles from the rest, and each place counts once", () => {
    const points = cleanPoints([
      { lat: 27.43847, lng: -82.39982, address: "a" },
      { lat: 27.43569, lng: -82.40035, address: "b" },
      { lat: 27.43507, lng: -82.40396, address: "c" },
      { lat: 27.43507, lng: -82.40396, address: "c again" },
      { lat: 27.2525, lng: -82.49647, address: "Palisades, filed wrong" },
    ]);
    expect(points.map((p) => p.address)).toEqual(["c", "b", "a"]);
  });

  it("are spread across the village when there are many", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ lat: 27.4 + i * 0.0005, lng: -82.4, address: String(i) }));
    const points = cleanPoints(many, 10);
    expect(points).toHaveLength(10);
    expect(points[0].address).toBe("0");
    expect(Number(points[9].address)).toBeGreaterThan(30);
  });
});

describe("what a page says now", () => {
  it("reads a Life At Lakewood village page's Schools section", () => {
    const html = `<html><script>var x="High School: no"</script><body><h2>Schools</h2>
      <p><span>Grade School:</span></p><p>McNeal and Braden River Elementary</p>
      <p><span>Middle School:</span></p><p>Nolan and Braden River Middle</p>
      <p>High School:</p><p>Lakewood&nbsp;Ranch High</p></body></html>`;
    expect(readPageSchools(html)).toEqual({
      elementary: "McNeal and Braden River Elementary",
      middle: "Nolan and Braden River Middle",
      high: "Lakewood Ranch High",
    });
    expect(readPageSchools("<p>No schools here</p>")).toBeNull();
  });

  it("reads and writes a collection's school paragraph in its own markup", () => {
    const field = '<p class="font_7"><strong>Grade School: </strong>Annie Lucy Williams Elementary</p>';
    expect(readSchoolField(field)).toBe("Annie Lucy Williams Elementary");
    expect(readSchoolField(undefined)).toBe("");
    expect(writeSchoolField("elementary", "Rye Ranch Elementary", field)).toBe(
      '<p class="font_7"><strong>Grade School: </strong>Rye Ranch Elementary</p>'
    );
    expect(writeSchoolField("high", "Parrish Community High", "")).toBe(
      '<p class="font_7"><strong>High School: </strong>Parrish Community High</p>'
    );
  });

  it("finds the collection's three school fields by name", () => {
    expect(
      schoolFields([
        { key: "title", displayName: "Neighborhood Name" },
        { key: "neighborhoodElementarySchool", displayName: "Neighborhood Elementary School" },
        { key: "neighborhoodMiddleSchool", displayName: "Neighborhood Middle School" },
        { key: "neighborhoodHighSchool", displayName: "Neighborhood High School" },
      ])
    ).toEqual({ elementary: "neighborhoodElementarySchool", middle: "neighborhoodMiddleSchool", high: "neighborhoodHighSchool" });
  });
});
