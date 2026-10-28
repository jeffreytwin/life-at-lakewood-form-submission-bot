import { describe, it, expect } from "vitest";
import {
  amenityLevelOf,
  amenityOf,
  detailAmenityFields,
  detailAmenityIcons,
  faqHtml,
  isBlank,
  pageAmenityFields,
  planDetailsRow,
  planPagesRow,
  type FieldInfo,
} from "@/lib/villages/fill";
import { readReport, promptFor, AMENITIES, type VillageResearch } from "@/lib/villages/research";
import { indexRows } from "@/lib/villages/collections";
import type { WixDataItem } from "@/lib/wix/client";

const yesNo = (yes: boolean) => `<p class="${yes ? "font_8" : "font_9"}" style="text-align: right">${yes ? "Yes" : "No"}</p>`;
const label = (text: string, yes: boolean) => `<p class="${yes ? "font_8" : "font_9"}">${text}</p>`;

// Life At Lakewood's Dynamic Village Pages, as its export names the fields.
const PAGE_FIELDS: FieldInfo[] = [
  { key: "title", displayName: "Village Name" },
  { key: "villageTitle", displayName: "Village Title" },
  { key: "villageSubtitle", displayName: "Village Subtitle" },
  { key: "aboutVillageTitle", displayName: "About Village Title" },
  { key: "aboutVillageDescription", displayName: "About Village Description" },
  { key: "uniqueVillageFeature", displayName: "Unique Village Feature" },
  { key: "homeTypes", displayName: "Home Types" },
  { key: "villageElementarySchool", displayName: "Village Elementary School" },
  { key: "villageMiddleSchool", displayName: "Village Middle School" },
  { key: "villageHighSchool", displayName: "Village High School" },
  { key: "homesForSaleLink", displayName: "Homes for Sale Link" },
  { key: "notSeeingFloorPlanStatement", displayName: "Not Seeing Floor Plan Statement" },
  { key: "amenitiesTitle", displayName: "Amenities Title" },
  { key: "poolText", displayName: "Pool Text" },
  { key: "poolTextYesOrNo", displayName: "Pool Text - Yes or No" },
  { key: "poolImage", displayName: "Pool Image" },
  { key: "poolImageAltText", displayName: "Pool Image Alt Text" },
  { key: "gatedText", displayName: "Gated Text" },
  { key: "gatedTextYesOrNo", displayName: "Gated Text - Yes or No" },
  { key: "gatedImage", displayName: "Gated Image" },
  { key: "pickleball", displayName: "Pickleball" },
  { key: "pickleballTextYesOrNo", displayName: "Pickleball Text - Yes or No" },
  { key: "pickleballImage", displayName: "Pickleball Image" },
  { key: "golfText", displayName: "Golf Text" },
  { key: "golfTextYesOrNo", displayName: "Golf Text - Yes or No" },
  { key: "golfImage", displayName: "Golf Image" },
  { key: "ageRestrictedText", displayName: "Age Restricted Text" },
  // Wix named this one after the field it was copied from.
  { key: "maintenanceIncludedTextYesOrNo1", displayName: "Age Restricted Text - Yes or No" },
  { key: "ageRestrictedImage", displayName: "Age Restricted Image" },
  { key: "amenitiesSubtext1", displayName: "Amenities Subtext 1" },
  { key: "faq", displayName: "FAQ" },
  { key: "faqTitle", displayName: "FAQ Title" },
  { key: "sortVillageName", displayName: "Sort - Village Name" },
  { key: "interactiveMapAltText", displayName: "Interactive Map Alt Text" },
  { key: "village", displayName: "Village", type: "REFERENCE" },
];

const waterbury = {
  _publishStatus: "PUBLISHED",
  title: "Waterbury Park",
  sortVillageName: "Waterbury Park",
  villageTitle: "Homes for Sale in Waterbury Park",
  villageSubtitle: "Waterbury Park offers comfy, well-designed houses and a calm, park-like setting right in Lakewood Ranch.",
  aboutVillageTitle: "About Waterbury Park",
  aboutVillageDescription: "Waterbury Park is a small, gated neighborhood of only 21 homesites by Neal Signature Homes.",
  notSeeingFloorPlanStatement: "Can't find a floor plan at Waterbury Park that fits your needs? Explore other new construction options in Lakewood Ranch.",
  amenitiesTitle: "Waterbury Park",
  villageElementarySchool: '<p class="font_7"><strong>Grade School:</strong> &nbsp;Willis Elementary</p>',
  homesForSaleLink: "https://lifeatlakewood.com/village/waterbury-park",
  poolText: label("Pool", false),
  poolTextYesOrNo: yesNo(false),
  poolImage: "wix:image://v1/pool-2.png",
  poolImageAltText: "Pool Icon",
  gatedText: label("Gated", true),
  gatedTextYesOrNo: yesNo(true),
  gatedImage: "wix:image://v1/gate-1.png",
  pickleball: label("Pickleball", false),
  pickleballTextYesOrNo: yesNo(false),
  pickleballImage: "wix:image://v1/pickleball-2.png",
  maintenanceIncludedTextYesOrNo1: yesNo(false),
  amenitiesSubtext1: '<p class="font_8"><a href="https://www.lifeatlakewood.com/amenities"><u><strong>Compare to Other Villages</strong></u></a></p>',
  faqTitle: "Frequently Asked Questions About Waterbury Park",
  interactiveMapAltText: "A map of Waterbury Park",
};
const nautique = {
  _publishStatus: "PUBLISHED",
  title: "Nautique at Waterside",
  sortVillageName: "Nautique",
  villageTitle: "Homes for Sale in Nautique",
  poolText: label("Pool", true),
  poolTextYesOrNo: yesNo(true),
  poolImage: "wix:image://v1/pool-1.png",
  poolImageAltText: "Pool Icon",
  gatedText: label("Gated", false),
  gatedTextYesOrNo: yesNo(false),
  gatedImage: "wix:image://v1/gate-2.png",
  pickleball: label("Pickleball", true),
  pickleballTextYesOrNo: yesNo(true),
  pickleballImage: "wix:image://v1/pickleball-1.png",
  amenitiesSubtext1: waterbury.amenitiesSubtext1,
};

const research = (amenities: Partial<Record<(typeof AMENITIES)[number], boolean>> = {}): VillageResearch => ({
  found: true,
  subtitle: "Stillwater offers quiet, gated living with preserve views.",
  overview: "Stillwater is a gated village of 105 Lennar homes in Lakewood Ranch.",
  description: "Stillwater is a boutique gated village.\n\nIts homes back onto preserves.",
  uniqueFeature: "A Gated Preserve Setting",
  homeTypes: ["Single Family"],
  builders: ["Lennar"],
  amenities: Object.fromEntries(AMENITIES.map((a) => [a, amenities[a] ?? false])) as VillageResearch["amenities"],
  amenitiesDescription: "A gated entry, with Lakewood Ranch's parks and trails nearby.",
  faq: [{ question: "Who builds Stillwater?", answer: "Lennar." }],
  address: "",
  sources: ["https://www.lennar.com/stillwater"],
});

describe("blank", () => {
  it("is missing, empty, or a paragraph with nothing in it", () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank('<p class="font_7"><br></p>')).toBe(true);
    expect(isBlank("&nbsp;")).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank("Gated")).toBe(false);
    expect(isBlank(false)).toBe(false);
  });
});

describe("an amenity, by any collection's label", () => {
  it("reads the same across the sites' names for it", () => {
    expect(amenityOf("Village Spa")).toBe("spa");
    expect(amenityOf("Spa Services")).toBe("spa");
    expect(amenityOf("Bar or Restaurant")).toBe("restaurant");
    expect(amenityOf("Tot Lot")).toBe("playground");
    expect(amenityOf("Playground")).toBe("playground");
    expect(amenityOf("55+")).toBe("ageRestricted");
    expect(amenityOf("Age Restricted")).toBe("ageRestricted");
    expect(amenityOf("Gated")).toBe("gated");
    expect(amenityOf("Lifestyle Activities")).toBe("lifestyleDirector");
  });

  it("finds each amenity's three fields by their display names, whatever Wix keyed them", () => {
    const fields = pageAmenityFields(PAGE_FIELDS);
    expect(fields.get("pool")).toEqual({ text: "poolText", yesNo: "poolTextYesOrNo", image: "poolImage" });
    expect(fields.get("pickleball")).toEqual({ text: "pickleball", yesNo: "pickleballTextYesOrNo", image: "pickleballImage" });
    expect(fields.get("ageRestricted")).toEqual({ text: "ageRestrictedText", yesNo: "maintenanceIncludedTextYesOrNo1", image: "ageRestrictedImage" });
  });
});

describe("a new village's Dynamic Village Pages row", () => {
  const plan = (current: Record<string, unknown> | null = null, amenities = { gated: true, golf: true }) =>
    planPagesRow({
      fields: PAGE_FIELDS,
      rows: [nautique, waterbury, { _publishStatus: "DRAFT", title: "Stillwater" }],
      current,
      name: "Stillwater",
      research: research(amenities),
      schools: { elementary: "Gullett Elementary", middle: "Dr Mona Jain Middle", high: "Lakewood Ranch High" },
      fixed: { title: "Stillwater", sortVillageName: "Stillwater", village: "vd-id" },
      fallbackIcons: { golf: { yes: "wix:image://v1/golf-1.png", no: "wix:image://v1/golf-2.png" } },
    });

  it("writes the research where the page shows it", () => {
    const row = plan();
    expect(row.villageSubtitle).toBe("Stillwater offers quiet, gated living with preserve views.");
    expect(row.aboutVillageDescription).toContain("boutique gated village");
    expect(row.uniqueVillageFeature).toBe("A Gated Preserve Setting");
    expect(row.homeTypes).toBe("Single Family Homes");
    expect(row.faq).toBe('<p class="font_7"><strong>Who builds Stillwater?</strong><br>\nLennar.</p>');
    expect(row.village).toBe("vd-id");
  });

  it("copies each amenity as a row where it reads the same has it, icon and all", () => {
    const row = plan();
    expect(row.gatedTextYesOrNo).toBe(yesNo(true));
    expect(row.gatedImage).toBe("wix:image://v1/gate-1.png");
    expect(row.poolTextYesOrNo).toBe(yesNo(false));
    expect(row.poolImage).toBe("wix:image://v1/pool-2.png");
    expect(row.pickleballImage).toBe("wix:image://v1/pickleball-2.png");
    expect(row.maintenanceIncludedTextYesOrNo1).toBe(yesNo(false));
  });

  it("writes an amenity no row shows yet in the collections' own convention, with Village Details' icon", () => {
    const row = plan();
    expect(row.golfTextYesOrNo).toBe(yesNo(true));
    expect(row.golfText).toBe(label("Golf", true));
    expect(row.golfImage).toBe("wix:image://v1/golf-1.png");
  });

  it("changes a published row's boilerplate to the new name, and copies what every published row shares", () => {
    const row = plan();
    expect(row.villageTitle).toBe("Homes for Sale in Stillwater");
    expect(row.aboutVillageTitle).toBe("About Stillwater");
    expect(row.notSeeingFloorPlanStatement).toBe(
      "Can't find a floor plan at Stillwater that fits your needs? Explore other new construction options in Lakewood Ranch."
    );
    expect(row.amenitiesTitle).toBe("Stillwater");
    expect(row.faqTitle).toBe("Frequently Asked Questions About Stillwater");
    expect(row.interactiveMapAltText).toBe("A map of Stillwater");
    expect(row.poolImageAltText).toBe("Pool Icon");
    expect(row.amenitiesSubtext1).toBe(waterbury.amenitiesSubtext1);
  });

  it("writes the schools in the collection's own markup", () => {
    const row = plan();
    expect(row.villageElementarySchool).toBe('<p class="font_7"><strong>Grade School:</strong> &nbsp;Gullett Elementary</p>');
    expect(row.villageHighSchool).toBe('<p class="font_7"><strong>High School: </strong>Lakewood Ranch High</p>');
  });

  it("leaves links, and never another village's prose, and never a field already filled", () => {
    const row = plan({ villageSubtitle: "Jeff's own words", uniqueVillageFeature: "" });
    expect(row.homesForSaleLink).toBeUndefined();
    expect(row.villageSubtitle).toBeUndefined();
    expect(row.uniqueVillageFeature).toBe("A Gated Preserve Setting");
    const bare = planPagesRow({ fields: PAGE_FIELDS, rows: [waterbury, nautique], current: null, name: "Stillwater", research: null, schools: null, fixed: {} });
    expect(bare.aboutVillageDescription).toBeUndefined();
    expect(bare.villageSubtitle).toBeUndefined();
  });
});

describe("a new village's Village Details row", () => {
  const detail = (title: string, on: string[], level: string) => {
    const row: Record<string, unknown> = { _publishStatus: "PUBLISHED", title, amenityLevel: level };
    const list: [string, string, number][] = [
      ["pool", "Pool", 1],
      ["gate", "Gated", 12],
      ["golf", "Golf", 8],
      ["tennis", "Tennis", 5],
    ];
    for (const [stem, text, n] of list) {
      const yes = on.includes(stem);
      row[`${stem}V2`] = label(text, yes);
      row[`${stem}V3`] = yesNo(yes);
      row[`amenities${n}Description`] = text;
      row[`amenitiesImage${n}`] = `wix:image://v1/${stem}-${yes ? 1 : 2}.png`;
    }
    return row;
  };
  const rows = [detail("Harmony", ["pool"], "Low"), detail("Lakewood National", ["pool", "gate", "golf", "tennis"], "Extraordinary"), detail("Indigo", ["pool", "gate"], "Medium")];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r))), "description", "villagesDescription", "homeTypes", "showAll", "amenitiesDropdownNew", "amenityLevelDropdown", "buttonLink", "homesForSaleLink", "villageElementarySchool", "villageMiddleSchool", "villageHighSchool", "villagesTitle"];

  it("finds its amenities by their V2 and V3 fields", () => {
    expect([...detailAmenityFields(keys).keys()].sort()).toEqual(["gated", "golf", "pool", "tennis"]);
    expect(detailAmenityIcons(keys, rows).gated).toEqual({ yes: "wix:image://v1/gate-1.png", no: "wix:image://v1/gate-2.png" });
  });

  it("is filled from the research, its amenities and filters as the other villages write them", () => {
    const row = planDetailsRow({
      keys,
      rows,
      current: { title: "Stillwater", _publishStatus: "DRAFT" },
      name: "Stillwater",
      research: research({ gated: true }),
      schools: { elementary: "Gullett Elementary", middle: "", high: "Lakewood Ranch High" },
      schoolKeys: { elementary: "villageElementarySchool", middle: "villageMiddleSchool", high: "villageHighSchool" },
      schoolTemplates: { elementary: '<p class="font_7"><strong>Grade School:</strong> &nbsp;Willis Elementary</p>' },
      pageUrl: "https://www.lifeatlakewood.com/village/stillwater",
    });
    expect(row.title).toBeUndefined();
    expect(row.villagesTitle).toBe("Stillwater");
    expect(row.description).toBe("Stillwater offers quiet, gated living with preserve views.");
    expect(row.villagesDescription).toBe("Stillwater is a gated village of 105 Lennar homes in Lakewood Ranch.");
    expect(row.gateV3).toBe(yesNo(true));
    expect(row.amenitiesImage12).toBe("wix:image://v1/gate-1.png");
    expect(row.tennisV3).toBe(yesNo(false));
    expect(row.amenitiesImage5).toBe("wix:image://v1/tennis-2.png");
    // Every village has a pool here: no row to copy its No from, so the convention, and no icon.
    expect(row.poolV3).toBe(yesNo(false));
    expect(row.poolV2).toBe(label("Pool", false));
    expect(row.amenitiesImage1).toBeUndefined();
    expect(row.showAll).toBe("Show All Amenities, Gated");
    expect(row.amenitiesDropdownNew).toEqual(["Gated Community"]);
    expect(row.amenityLevel).toBe("Low");
    expect(row.villageElementarySchool).toBe('<p class="font_7"><strong>Grade School:</strong> &nbsp;Gullett Elementary</p>');
    expect(row.villageMiddleSchool).toBeUndefined();
    expect(row.buttonLink).toBe("https://www.lifeatlakewood.com/village/stillwater");
  });
});

describe("the amenity level", () => {
  it("reads as the level whose villages have about as many amenities", () => {
    const rows = [
      { count: 2, level: "Low" },
      { count: 4, level: "Low" },
      { count: 7, level: "Medium" },
      { count: 9, level: "Medium*" },
      { count: 10, level: "High" },
      { count: 11, level: "High*" },
      { count: 13, level: "Extraordinary" },
      { count: 14, level: "Extraordinary" },
    ];
    expect(amenityLevelOf(1, rows)).toBe("Low");
    expect(amenityLevelOf(8, rows)).toBe("Medium");
    expect(amenityLevelOf(11, rows)).toBe("High");
    expect(amenityLevelOf(14, rows)).toBe("Extraordinary");
    expect(amenityLevelOf(3, [])).toBeNull();
  });
});

describe("the FAQ", () => {
  it("is a paragraph per question with a blank one between, its text escaped", () => {
    expect(faqHtml([{ question: "A & B?", answer: "Yes <really>." }, { question: "C?", answer: "No." }])).toBe(
      '<p class="font_7"><strong>A &amp; B?</strong><br>\nYes &lt;really&gt;.</p>\n<p class="font_7"><br></p>\n<p class="font_7"><strong>C?</strong><br>\nNo.</p>'
    );
  });
});

describe("the research report", () => {
  it("is tidied: unknown home types, empty questions and non-links dropped, every amenity a yes or no", () => {
    const r = readReport({
      found: true,
      subtitle: " Quiet. ",
      homeTypes: ["Single Family", "Castle"],
      amenities: { gated: true, pool: "yes" },
      faq: [{ question: "Q?", answer: "A." }, { question: "", answer: "x" }],
      sources: ["https://lennar.com", "lennar.com"],
    });
    expect(r.subtitle).toBe("Quiet.");
    expect(r.homeTypes).toEqual(["Single Family"]);
    expect(r.amenities.gated).toBe(true);
    expect(r.amenities.pool).toBe(false);
    expect(Object.keys(r.amenities)).toHaveLength(AMENITIES.length);
    expect(r.faq).toEqual([{ question: "Q?", answer: "A." }]);
    expect(r.sources).toEqual(["https://lennar.com"]);
  });

  it("asks about the village by name and place, with what the Hub knows of it", () => {
    const p = promptFor({ name: "Stillwater", place: "Lakewood Ranch, Florida", builders: ["Lennar"], sourceUrl: null });
    expect(p).toContain("Neighborhood: Stillwater");
    expect(p).toContain("Builders named so far: Lennar");
    expect(p).not.toContain("Where it was found");
  });
});

describe("a collection's rows", () => {
  it("are found by any name and by their Village reference, a published row before a draft", () => {
    const items = [
      { id: "d", dataCollectionId: "HousesforSale-DynamicPages", data: { _publishStatus: "DRAFT", title: "Stillwater", village: "vd1" } },
      { id: "p", dataCollectionId: "HousesforSale-DynamicPages", data: { _publishStatus: "PUBLISHED", title: "Stillwater" } },
      { id: "w", dataCollectionId: "HousesforSale-DynamicPages", data: { title: "Waterbury Park", villageReferenceName: "Waterbury Park", village: { _id: "vd2" } } },
    ];
    const { byName, byRef } = indexRows(items as unknown as WixDataItem[], ["title", "villageReferenceName"], "village");
    expect(byName.get("stillwater")?.id).toBe("p");
    expect(byRef.get("vd1")?.id).toBe("d");
    expect(byRef.get("vd2")?.id).toBe("w");
  });
});
