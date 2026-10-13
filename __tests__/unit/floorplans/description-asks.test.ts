import { describe, expect, it } from "vitest";
import { aboutThePlan, asksOrFinePrint, carriesPlanFacts, descriptionChanged, fieldChanges, mergeForUpdate, sameDescription, withEntities, withPlainDescription } from "@/lib/floorplans/diff";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Descriptions from the queue that were approved night after night with
// nothing about the plan changed (Jeff, 2026-10-13).

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "interlude",
  name: "Interlude",
  price: 700000,
  priceDisplay: "$700,000",
  beds: "5",
  baths: "4.5",
  sqft: 3000,
  garages: "3 car",
  homeType: "Single-Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.mihomes.com/new-homes/florida/southwest-florida/venice/palmera-at-wellen-park/interlude-plan",
  galleryImages: ["https://dam.mihomes.com/media/2503415/50421.jpeg"],
  blueprintImages: [],
  ...over,
});

const labels = (current: NormalizedPlan, run: NormalizedPlan) => fieldChanges(current, run).map((c) => c.label);

describe("M/I's Interlude: a contact line that comes and goes has the rest reworded (2026-10-07 to 10-13)", () => {
  const opening =
    "The Interlude Plan is a 4 & 5-bedroom, 3& 4.5-bathroom, single-story home with over 3,000 square feet of flexible living space. Featuring a 3-car garage, a flex room, and a spacious lanai, this home is ideal for those who love to entertain.";
  const middle =
    "The Interlude features a split floorplan, with the main living space creating a buffer between your owners suite and the 3 additional bedrooms. Step into your owners suite and into the en-suite owners bathroom to find a luxurious retreat.";
  // The builder's page, read with its two contact lines...
  const withAsks = `${opening} Learn more about this impressive plan by contacting us today to schedule your tour! ${middle} Contact us today to learn how to personalize the Interlude to fit your wants and needs!`;
  // ...which say "us", so the whole of it is reworded in the third person...
  const reworded = `${opening} Learn more about this impressive plan by contacting M/I Homes today to schedule a tour! ${middle
    .replace(/your owners suite/g, "the owners suite")} Contact M/I Homes today to learn how to personalize the Interlude to fit your wants and needs!`;
  // ...and read without them, the builder's words as they stand.
  const withoutAsks = `${opening} ${middle}`;

  const rewordedRecord = plan({ description: reworded, raw: { descriptionOriginal: withAsks } });
  const plainRecord = plan({ description: withoutAsks });

  it("is not a change either way", () => {
    expect(labels(plainRecord, rewordedRecord)).toEqual([]);
    expect(labels(rewordedRecord, plainRecord)).toEqual([]);
    expect(descriptionChanged(plainRecord, rewordedRecord)).toBe(false);
    // Nor with the stray quote one read ended on (2026-10-09).
    expect(labels(plainRecord, plan({ description: reworded, raw: { descriptionOriginal: `${withAsks}"` } }))).toEqual([]);
  });

  it("is still a change when the plan's own sentences change", () => {
    const fewerRooms = withoutAsks.replace("the 3 additional bedrooms", "the 2 additional bedrooms");
    expect(labels(plainRecord, plan({ description: fewerRooms }))).toEqual(["description"]);
    const kitchen = withoutAsks.replace("a flex room, and a spacious lanai", "a flex room, a summer kitchen and a spacious lanai");
    expect(labels(plainRecord, plan({ description: kitchen }))).toEqual(["description"]);
  });
});

describe("contact lines and fine print, wherever they stand", () => {
  it("Kolter's Rosemary: a New Home Guide, homesite premiums and a tour, at the end one night and gone the next (2026-10-07)", () => {
    const body =
      "You can personalize the Rosemary floorplan with various structural options, including a 4' Garage Extension, Suite 3 in lieu of Club Room, second floor Bonus Room and more. 2020 MSBIA Parade of Homes Award Winner for Best Overall, Best Kitchen, Best Master Suite and Best Architectural Detail.";
    const withAsks =
      "You can personalize the Rosemary floorplan with various structural options, including a 4' Garage Extension, Suite 3 in lieu of Club Room, second floor Bonus Room and more. To learn about all the ways you can have this home built around you, contact your Cresswind Lakewood Ranch New Home Guide. 2020 MSBIA Parade of Homes Award Winner for Best Overall, Best Kitchen, Best Master Suite and Best Architectural Detail. Homesites, given their appeal and location within the community, may carry an additional cost. This cost is not reflected in the base price of this floorplan. Please schedule an online or in-person tour for details.";
    expect(sameDescription(withAsks, body)).toBe(true);
    expect(labels(plan({ description: withAsks }), plan({ description: body }))).toEqual([]);
  });

  it("Neal's White Star: a 'find out more' traded for a price note (2026-10-08)", () => {
    const body =
      "With 3 bedrooms, 2 baths, and 2,064 sq. ft. of open living space, the White Star is a home built for entertaining guests or daily relaxation. The master suite is the perfect retreat for owners.";
    const before = `${body} Find out more about White Star in Sarasota’s Boca Royale and explore your options.`;
    const after = `${body} Base price does not include the homesite premium or design options.`;
    expect(labels(plan({ description: before }), plan({ description: after }))).toEqual([]);
  });

  it("still reads a changed number in what is left as a change (DRB's Sabal, 4,000 to 4,064 sq. ft., 2026-10-05)", () => {
    const sabal = (sqft: string) =>
      `The Sabal is a beautifully designed home with up to 4 bedrooms and up to ${sqft} sq. ft. of living space. Choose from Key West, Modern, or Contemporary exterior styles. Please schedule a tour today.`;
    expect(labels(plan({ description: sabal("4,000") }), plan({ description: sabal("4,064") }))).toEqual(["description"]);
  });

  it("still reads other words as a change, its contact line aside (David Weekley's MAGBEE II, 2026-10-08)", () => {
    const before = "Offering 1,864 square feet of thoughtfully designed living space, this 3-bedroom, 2.5-bath residence includes a two-car garage and a screened-in lanai.";
    const after = `Offering 1,864 square feet of expertly designed living space, this 3-bedroom, 2.5-bath residence includes a two-car garage and a screened-in lanai. Contact the David Weekley Homes at North River Ranch Team to learn more about this new home for sale in Parrish, FL!`;
    expect(labels(plan({ description: before }), plan({ description: after }))).toEqual(["description"]);
    // The contact line alone is not.
    expect(labels(plan({ description: after.replace("expertly", "thoughtfully") }), plan({ description: before }))).toEqual([]);
  });

  it("knows the asks and the fine print, and leaves what describes the home", () => {
    for (const ask of [
      "Contact us today to schedule your tour!",
      "Call today to schedule a private tour.",
      "Come by and visit Boca Royale in Venice and learn more about the Sea Star and other plans.",
      "Call or email us today for more information about your new home in Parrish, FL.",
      "Ask about our limited-time incentives.",
      "*Base price does not include homesite premium or design options.",
      "Photos are for illustrative purposes only and may show upgraded features.",
      "Prices, plans and availability are subject to change without notice.",
      "Disclaimer: Square footages are approximate.",
    ]) {
      expect(asksOrFinePrint(ask), ask).toBe(true);
    }
    for (const said of [
      "As guests come in, they are greeted by a bright foyer and a formal dining room.",
      "The design speaks to modern Florida living.",
      "Visit the community pool and clubhouse just steps from your door.",
      "Discover more space in the bonus room upstairs.",
      "The kitchen calls for entertaining, with an island that seats six.",
      "MOVE IN READY – Vision 2 at Windward – Homesite #478.",
      "Floor plan highlights: Kitchen island, Den, Loft, Upstairs laundry room.",
    ]) {
      expect(asksOrFinePrint(said), said).toBe(false);
    }
  });

  it("keeps every sentence that says something about the plan", () => {
    expect(aboutThePlan("A split plan with a den. Call today to schedule a tour. A lanai runs the width of the home.")).toBe(
      "A split plan with a den. A lanai runs the width of the home."
    );
    expect(aboutThePlan("Contact us today!")).toBe("");
    // A text that is all asks is not the same as another one.
    expect(sameDescription("Contact us today!", "Schedule your tour today!")).toBe(false);
  });

  it("never drops a sentence that names a number or a room, however it asks", () => {
    expect(carriesPlanFacts("Call (941) 555-1234 or email us today to schedule your tour.")).toBe(false);
    expect(carriesPlanFacts("Visit our sales office today.")).toBe(false);
    expect(carriesPlanFacts("Learn how the flex room converts to a 5th bedroom.")).toBe(true);
    expect(carriesPlanFacts("Call 941-555-1234 about the 2 remaining homesites.")).toBe(true);
    const body = "The Avalon is a single-story home with an open great room, a split plan and a covered lanai across the back.";
    for (const [was, now] of [
      ["It is the perfect place to call home, with 4 bedrooms and a home office.", "It is the perfect place to call home, with 3 bedrooms and a home office."],
      ["The kitchen is set up for entertaining, with a walk-through pantry to the 2-car garage.", "The kitchen is set up for entertaining, with a walk-through pantry to the 3-car garage."],
      ["Don't miss the oversized lanai with a summer kitchen.", "Don't miss the oversized lanai with an outdoor shower."],
      ["This homesite offers premium upgrades including a pool.", "This homesite offers premium upgrades including a fire pit."],
      ["Picture yourself in the bonus room, which may include a wet bar.", "Picture yourself in the bonus room, which may include a home theater."],
      ["Learn how the flex room converts to a 5th bedroom.", "Learn how the flex room converts to a 4th bedroom."],
      ["Note: the third-car garage is standard.", "Note: the third-car garage is optional."],
      ["* 4 bedrooms\n* 3 baths", "* 3 bedrooms\n* 2 baths"],
      ["Ask about the optional elevator and media room.", "Ask about the optional elevator and game room."],
    ]) {
      expect(sameDescription(`${body} ${was}`, `${body} ${now}`), now).toBe(false);
    }
  });

  it("reads past a date in fine print", () => {
    const body = "The Avalon is a single-story home with an open great room, a split plan and a covered lanai across the back.";
    expect(carriesPlanFacts("Prices effective 10/08/2026 and subject to change.")).toBe(false);
    expect(carriesPlanFacts("Pricing as of October 8, 2026 is subject to change without notice.")).toBe(false);
    expect(sameDescription(`${body} Prices effective 10/08/2026 and subject to change.`, `${body} Prices effective 10/13/2026 and subject to change.`)).toBe(true);
  });
});

describe("the same words written another way", () => {
  it("reads a page's entities as the characters they stand for (Starlight's Odyssey, 2026-10-09)", () => {
    const written =
      "You enter the home and are immediately welcomed into the open family room, kitchen, and dining area&mdash;designed for comfortable, connected living. Just off the family room, you&rsquo;ll find access to the two-car garage.";
    const decoded =
      "You enter the home and are immediately welcomed into the open family room, kitchen, and dining area—designed for comfortable, connected living. Just off the family room, you'll find access to the two-car garage.";
    expect(withEntities("owners&#8217; suite &amp; den&#x2019;s")).toBe("owners’ suite & den’s");
    expect(withEntities("&notanentity; stays, and AT&T; too")).toBe("&notanentity; stays, and AT&T; too");
    // Neal Signature's Kingfisher 2, its ampersand spelled out (2026-10-13).
    expect(withEntities("a beautiful ownersand#8217; retreat")).toBe("a beautiful owners’ retreat");
    // Read with the characters, the record's entities are not proposed back.
    expect(labels(plan({ description: decoded }), plan({ description: written }))).toEqual([]);
  });

  it("puts right, once, a description the site shows with its entities as typed (DRB's Eider, 2026-10-13)", () => {
    const coded = "The Eider offers the space, comfort, and versatility today&rsquo;s homebuyers are looking for, with a powder room&mdash;and a 2-car garage.";
    const plain = withPlainDescription(plan({ description: coded, raw: { descriptionOriginal: coded } }));
    expect(plain.description).toBe("The Eider offers the space, comfort, and versatility today’s homebuyers are looking for, with a powder room—and a 2-car garage.");
    expect(plain.raw?.descriptionOriginal).toBe(plain.description);
    expect(labels(plan({ description: coded }), plain)).toEqual(["description"]);
    // Once put right, it stays: the next reading is the record's.
    expect(labels(plain, withPlainDescription(plan({ description: coded })))).toEqual([]);
    // Reworded in the third person, the builder's words are what match.
    const ours = "Our Eider offers the space, comfort, and versatility today&rsquo;s homebuyers are looking for, with a powder room and a 2-car garage.";
    const current = plan({ description: "The Eider by DRB Homes offers the space and comfort today&rsquo;s homebuyers want, with a powder room and a 2-car garage.", raw: { descriptionOriginal: ours } });
    const run = withPlainDescription(plan({ description: "DRB Homes' Eider gives today's homebuyers space and comfort, with a powder room and a 2-car garage.", raw: { descriptionOriginal: ours } }));
    expect(labels(current, run)).toEqual(["description"]);
    expect(labels(run, run)).toEqual([]);
  });

  it("reads a run's reading cut off in a word as the rest of it (Neal Signature's Seaside 2, 2026-10-13)", () => {
    const whole = "The Seaside 2 welcomes you home for an at-home vacation. Through the double doors, the great room opens to the lanai, and a club room";
    expect(sameDescription(`${whole} sits off the foyer.`, whole.slice(0, -2))).toBe(true);
    // A record that was cut off is put right.
    expect(sameDescription(whole.slice(0, -2), `${whole} sits off the foyer.`)).toBe(false);
    // Nor is a number, a word that ends a sentence, or a longer word in the record a cut.
    const base = "The Seaside 2 welcomes you home for an at-home vacation. Through the double doors, the great room opens to the lanai.";
    for (const [record, run] of [
      [`${base} Move-in ready Feb 15`, `${base} Move-in ready Feb 1`],
      [`${base} On Homesite 124`, `${base} On Homesite 12`],
      [`${base} Ready in 35 days.`, `${base} Ready in 3.`],
      [`${base} Upstairs is a loft`, `${base} Upstairs is a lofted ceiling`],
    ]) {
      expect(sameDescription(record, run), run).toBe(false);
    }
  });

  it("leaves a word that only looks like a spelled-out entity, and reads one written twice over", () => {
    expect(withEntities("Brand#1; Highland#9; 2 car garage")).toBe("Brand#1; Highland#9; 2 car garage");
    expect(withEntities("today&amp;rsquo;s homebuyers")).toBe("today’s homebuyers");
  });

  it("reads the same highlights in another order as the same, and a changed highlight as a change", () => {
    const a = "Floor plan highlights: Spacious great room, Loft, Flex Space, Upstairs laundry room, 2-car garage.";
    const b = "Floor plan highlights: Loft, Spacious great room, Upstairs laundry room, Flex Space, 2-car garage.";
    expect(sameDescription(a, b)).toBe(true);
    expect(sameDescription(a, b.replace("2-car", "3-car"))).toBe(false);
    expect(sameDescription("This home has 3 bedrooms, 2 baths and a den.", "This home has 2 bedrooms, 3 baths and a den.")).toBe(false);
  });

  it("reads a room moved from one list to another as a change", () => {
    expect(sameDescription("Included: pool, summer kitchen. Optional: 3-car garage, loft.", "Included: 3-car garage, loft. Optional: pool, summer kitchen.")).toBe(false);
    expect(sameDescription("First floor: kitchen, den, office. Second floor: loft, bedroom.", "First floor: kitchen, den. Second floor: loft, bedroom, office.")).toBe(false);
    expect(sameDescription("First floor - owner's suite, study. Second floor - 3 bedrooms, loft.", "First floor - 3 bedrooms, loft. Second floor - owner's suite, study.")).toBe(false);
    // Opening hours head no list.
    expect(sameDescription("Highlights: Loft, Den, Pool. Models open 10:00 to 6:00.", "Highlights: Den, Pool, Loft. Models open 10:00 to 6:00.")).toBe(true);
  });
});

describe("a description kept as it stands keeps the builder's words it was read from", () => {
  it("does not hand the record the run's original with the record's description", () => {
    const current = plan({
      description: "The Interlude by M/I Homes is a single-story home with a split plan and a flex room.",
      raw: { descriptionOriginal: "Our Interlude is a single-story home with a split plan and a flex room." },
    });
    const run = plan({
      description: "The Interlude by M/I Homes now adds a bonus room upstairs, a summer kitchen and a larger lanai.",
      raw: { descriptionOriginal: "Our Interlude now adds a bonus room upstairs, a summer kitchen and a larger lanai.", lot: "7" },
      priceDisplay: "$719,000",
    });
    expect(descriptionChanged(current, run)).toBe(true);
    // Held for a second reading (or rejected): another approval writes the record's own.
    const merged = mergeForUpdate(current, run, ["description"]);
    expect(merged.description).toBe(current.description);
    expect(merged.raw).toEqual({ descriptionOriginal: "Our Interlude is a single-story home with a split plan and a flex room.", lot: "7" });
    expect(merged.priceDisplay).toBe("$719,000");
    // And the next run still sees the builder's new words as a change.
    expect(descriptionChanged(merged, run)).toBe(true);
  });
});
