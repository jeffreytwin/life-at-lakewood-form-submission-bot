import { describe, it, expect } from "vitest";
import { cleanText, combineSchools, compareLevel, displayName, sameSchool, splitSchools } from "@/lib/school-zones/names";

describe("a district's name for a school, as the sites write it", () => {
  it("spells out Manatee's abbreviations and drops a K-8's grades", () => {
    expect(displayName("manatee", "Gullett ES")).toBe("Gullett Elementary");
    expect(displayName("manatee", "Nolan MS")).toBe("Nolan Middle");
    expect(displayName("manatee", "Lakewood Ranch HS")).toBe("Lakewood Ranch High");
    expect(displayName("manatee", "Parrish Community HS")).toBe("Parrish Community High");
    expect(displayName("manatee", "Lake Manatee K-8 (K-5)")).toBe("Lake Manatee K-8");
    expect(displayName("manatee", "Lake Manatee K-8 (6-8)")).toBe("Lake Manatee K-8");
  });

  it("keeps the fuller names the pages already use", () => {
    expect(displayName("manatee", "Jain MS")).toBe("Dr Mona Jain Middle");
    expect(displayName("manatee", "Williams ES")).toBe("Annie Lucy Williams Elementary");
    expect(displayName("manatee", "Harvey K-8 at Copperstone (PK-3)")).toBe("Barbara A. Harvey K-8 at Copperstone");
  });

  it("drops Sarasota's Zone, and reads its K-8s and casing as the pages do", () => {
    expect(displayName("sarasota", "Tatum Ridge Elementary Zone")).toBe("Tatum Ridge Elementary");
    expect(displayName("sarasota", "Mcintosh Middle Zone")).toBe("McIntosh Middle");
    expect(displayName("sarasota", "Booker High Zone")).toBe("Booker High");
    expect(displayName("sarasota", "Brentwood Elementary School Zone")).toBe("Brentwood Elementary");
    expect(displayName("sarasota", "NEW Garden Elementary Zone")).toBe("Garden Elementary");
    expect(displayName("sarasota", "Skye Ranch School")).toBe("Skye Ranch K-8");
    expect(displayName("sarasota", "Laurel Nokomis K-8 Zone")).toBe("Laurel Nokomis K-8");
  });
});

describe("the same school, however it is written", () => {
  it("matches a short name to a fuller one", () => {
    expect(sameSchool("Williams Elementary", "Annie Lucy Williams Elementary")).toBe(true);
    expect(sameSchool("Parrish Community High School", "Parrish Community High")).toBe(true);
    expect(sameSchool("Wellen Park High School", "Wellen Park High")).toBe(true);
  });

  it("tells different schools apart", () => {
    expect(sameSchool("Virgil Mills Elementary", "Annie Lucy Williams Elementary")).toBe(false);
    expect(sameSchool("Palmetto High", "Parrish Community High")).toBe(false);
    expect(sameSchool("Wellen Park Elementary School", "Taylor Ranch Elementary")).toBe(false);
  });

  it("reads the collections' narrow no-break spaces as spaces", () => {
    expect(cleanText("Annie Lucy Williams Elementary")).toBe("Annie Lucy Williams Elementary");
  });
});

describe("a level with more than one school", () => {
  it("is written the way the Lakewood pages write it", () => {
    expect(combineSchools(["McNeal Elementary", "Braden River Elementary"])).toBe("McNeal and Braden River Elementary");
    expect(combineSchools(["Barbara A. Harvey K-8 at North River Ranch", "Buffalo Creek Middle"])).toBe(
      "Barbara A. Harvey K-8 at North River Ranch and Buffalo Creek Middle"
    );
    expect(combineSchools(["Gullett Elementary"])).toBe("Gullett Elementary");
  });

  it("is read back into its schools", () => {
    expect(splitSchools("McNeal and Braden River Elementary")).toEqual(["McNeal Elementary", "Braden River Elementary"]);
    expect(splitSchools("Nolan and Braden River Middle")).toEqual(["Nolan Middle", "Braden River Middle"]);
    expect(splitSchools("")).toEqual([]);
  });
});

describe("a page's school against the district's", () => {
  it("is the same when the text is", () => {
    expect(compareLevel("Gullett Elementary", "Gullett Elementary")).toBe("same");
    expect(compareLevel("Annie Lucy Williams Elementary", "Annie Lucy Williams Elementary")).toBe("same");
    expect(compareLevel("McNeal and Braden River Elementary", "McNeal and Braden River Elementary")).toBe("same");
  });

  it("is renamed when only the writing differs", () => {
    expect(compareLevel("Williams Elementary", "Annie Lucy Williams Elementary")).toBe("renamed");
    expect(compareLevel("Parrish Community High School", "Parrish Community High")).toBe("renamed");
    expect(compareLevel("Braden River and McNeal Elementary", "McNeal and Braden River Elementary")).toBe("renamed");
  });

  it("is rezoned when the school is another", () => {
    expect(compareLevel("Palmetto High", "Parrish Community High")).toBe("rezoned");
    expect(compareLevel("Wellen Park Middle School", "Venice Middle")).toBe("rezoned");
    expect(compareLevel("McNeal Elementary", "McNeal and Braden River Elementary")).toBe("rezoned");
  });
});
