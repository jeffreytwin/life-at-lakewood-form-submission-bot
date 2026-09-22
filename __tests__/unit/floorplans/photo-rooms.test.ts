import { describe, expect, it } from "vitest";
import { PHOTO_LABELS, batches, sortByRooms, type PhotoLabel } from "@/lib/floorplans/photo-rooms";
import { ROOM_ORDER } from "@/lib/floorplans/types";

const pic = (name: string) => `https://fabrik.blob.core.windows.net/public/${name}_md.jpg`;

/** The labels Claude may answer with, as a map from picture to label. */
const labelled = (pairs: [string, PhotoLabel | null][]) => new Map(pairs);

describe("PHOTO_LABELS", () => {
  it("is every room the gallery order knows, plus the one that leads", () => {
    // "primary" is a position, not a room, so "front" stands in for it.
    expect(PHOTO_LABELS).toContain("front");
    expect(PHOTO_LABELS).not.toContain("primary");
    for (const room of ROOM_ORDER) {
      if (room !== "primary") expect(PHOTO_LABELS).toContain(room);
    }
  });
});

describe("batches", () => {
  it("splits the pictures into requests, keeping order", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([1, 2], 5)).toEqual([[1, 2]]);
    expect(batches([], 5)).toEqual([]);
  });
});

describe("sortByRooms", () => {
  it("leads with the front of the house, then the rooms, then the other outside views", () => {
    const urls = [pic("a"), pic("b"), pic("c"), pic("d"), pic("e"), pic("f")];
    const [aerial, bath, front, kitchen, lanai, living] = urls;
    const ordered = sortByRooms(urls, labelled([
      [aerial, "exterior"],
      [bath, "bathroom"],
      [front, "front"],
      [kitchen, "kitchen"],
      [lanai, "outdoor"],
      [living, "living"],
    ]));
    expect(ordered.urls).toEqual([front, kitchen, living, lanai, bath, aerial]);
    expect(ordered.meta[front].kind).toBe("primary");
    expect(ordered.meta[aerial].room).toBe("exterior");
  });

  it("keeps one front picture as the lead and files the rest as exteriors", () => {
    const urls = [pic("a"), pic("b"), pic("c")];
    const [firstFront, secondFront, kitchen] = urls;
    const ordered = sortByRooms(urls, labelled([
      [firstFront, "front"],
      [secondFront, "front"],
      [kitchen, "kitchen"],
    ]));
    expect(ordered.urls).toEqual([firstFront, kitchen, secondFront]);
    expect(ordered.meta[secondFront].kind).toBe("exterior");
  });

  it("keeps the pictures it could not place in their own order, after the rooms", () => {
    const urls = [pic("a"), pic("b"), pic("c"), pic("d")];
    const [unplacedFirst, kitchen, unplacedSecond, exterior] = urls;
    const ordered = sortByRooms(urls, labelled([
      [unplacedFirst, null],
      [kitchen, "kitchen"],
      [unplacedSecond, null],
      [exterior, "exterior"],
    ]));
    expect(ordered.urls).toEqual([kitchen, unplacedFirst, unplacedSecond, exterior]);
    expect(ordered.meta[unplacedFirst].room).toBeNull();
  });

  it("reads nothing into a file name when the picture itself said nothing", () => {
    // "0bed8fcc" is a media store's id, not a bedroom, and a picture Claude
    // looked at and could not place does not fall back to guessing.
    const opaque = pic("0bed8fcc-430d-480c-919f-a55d52c53bd8");
    const kitchen = pic("plain");
    const ordered = sortByRooms([opaque, kitchen], labelled([[opaque, null], [kitchen, "kitchen"]]));
    expect(ordered.urls).toEqual([kitchen, opaque]);
    expect(ordered.meta[opaque].room).toBeNull();
  });

  it("leaves a gallery nothing was read from in the order it came", () => {
    const urls = [pic("a"), pic("b"), pic("c")];
    expect(sortByRooms(urls, new Map()).urls).toEqual(urls);
  });

  it("drops a repeated picture rather than showing it twice", () => {
    const kitchen = pic("k");
    const ordered = sortByRooms([kitchen, kitchen], labelled([[kitchen, "kitchen"]]));
    expect(ordered.urls).toEqual([kitchen]);
  });
});
