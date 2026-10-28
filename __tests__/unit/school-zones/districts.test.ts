import { describe, it, expect } from "vitest";
import { lookupLinks, pointInRings, readZoneServices, schoolYearLabel, schoolYearOf, zoneName } from "@/lib/school-zones/districts";

describe("the school year", () => {
  it("turns over in August", () => {
    expect(schoolYearOf(new Date(2026, 9, 1))).toBe(2026);
    expect(schoolYearOf(new Date(2026, 6, 15))).toBe(2026);
    expect(schoolYearOf(new Date(2027, 2, 1))).toBe(2026);
    expect(schoolYearLabel(2027)).toBe("2027-28");
    expect(schoolYearLabel(2099)).toBe("2099-00");
  });
});

describe("a point in a zone", () => {
  const square = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const hole = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ];

  it("is inside, outside, or in a hole", () => {
    expect(pointInRings(5, 2, [square])).toBe(true);
    expect(pointInRings(11, 5, [square])).toBe(false);
    expect(pointInRings(5, 5, [square, hole])).toBe(false);
  });
});

describe("Sarasota's zone services", () => {
  it("are read by level and year from their names", () => {
    const services = readZoneServices([
      { name: "2027_Elementary_School_Zones_shp", type: "FeatureServer" },
      { name: "2027_Middle_School_Zones", type: "FeatureServer" },
      { name: "Elementary__Zone_2026", type: "FeatureServer" },
      { name: "High__Zone_2026", type: "FeatureServer" },
      { name: "highschoolzone_highschoolzones", type: "FeatureServer" },
      { name: "SkyeRanch", type: "FeatureServer" },
      { name: "Middle__Zone_2026_shp", type: "MapServer" },
    ]);
    expect(services).toEqual([
      { name: "2027_Elementary_School_Zones_shp", level: "elementary", year: 2027 },
      { name: "2027_Middle_School_Zones", level: "middle", year: 2027 },
      { name: "Elementary__Zone_2026", level: "elementary", year: 2026 },
      { name: "High__Zone_2026", level: "high", year: 2026 },
    ]);
  });

  it("name their school under whichever field the year used", () => {
    expect(zoneName({ school_nam: "Taylor Ranch Elementary Zone" })).toBe("Taylor Ranch Elementary Zone");
    expect(zoneName({ FID: 6, Sch_na_vis: "Wellen Park High" })).toBe("Wellen Park High");
    expect(zoneName({ objectid: 2, school_name: "Venice Middle Zone" })).toBe("Venice Middle Zone");
    expect(zoneName({ FID: 1, label: "Booker Middle Zone" })).toBe("Booker Middle Zone");
    expect(zoneName({ FID: 1 })).toBeNull();
  });

  it("link each level to the district's lookup page for its year", () => {
    const links = lookupLinks(
      [
        { title: "2027-28 Elementary Attendance Zone Lookup", url: "https://e27" },
        { title: "2026-27 Middle School Zones", url: "https://m26" },
        { title: "2027-28 Middle School Attendance Zone Lookup", url: "https://m27" },
      ],
      { elementary: 2027, middle: 2027, high: 2026 }
    );
    expect(links.elementary).toBe("https://e27");
    expect(links.middle).toBe("https://m27");
    expect(links.high).toMatch(/scsb\.maps\.arcgis\.com\/home\/search/);
  });
});
