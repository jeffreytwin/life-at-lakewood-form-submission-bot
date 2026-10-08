import { describe, it, expect } from "vitest";
import { readingPrompts } from "@/lib/floorplans/extractors/claude-extract";

// What Claude is told when it reads a page, pinned. A saved read is kept
// under a version, not under the words of the prompt (page-reads.ts), so a
// change to the words would otherwise go out without any page being read
// the new way. When this fails, decide which pages the change needs read
// again, then pin the new digest:
//  - a change made for one builder: raise that builder in
//    BUILDER_READ_VERSIONS (page-reads.ts), and only its pages are read
//    again, a few dollars;
//  - a change every builder's pages need: raise READ_VERSION, and every
//    page is read again on the next run, some $20–25 a sync;
//  - a change no saved read needs (it only helps pages read from now on):
//    raise neither;
//  - a change of model (READ_MODEL): raise neither, the model is part of
//    the variant a read is kept under, so every page is read again once
//    anyway (2026-10-08: Sonnet 5 to Haiku 5.5).
const PINNED = "3342b0ee0c50882d22ece1eef00cff7a374b6b5d7090750d7e061c52a6f9fef4";

describe("what Claude is told when it reads a page (2026-10-07)", () => {
  it("is pinned, so a change to it is a choice of which pages to read again", () => {
    expect(
      readingPrompts(),
      "The reading prompt changed. Raise the builder it was made for in BUILDER_READ_VERSIONS, or READ_VERSION if every page needs reading again (page-reads.ts), then pin the new digest here."
    ).toBe(PINNED);
  });
});
