import { describe, it, expect } from "vitest";
import {
  formatQuoteAttribution,
  buildQuotedText,
  buildQuotedHtml,
  stripQuotedText,
  type QuoteSource,
} from "@/lib/gmail/quote";

const source: QuoteSource = {
  receivedAt: "2026-08-04T19:12:00.000Z", // 3:12 PM ET
  senderName: "John Smith",
  senderEmail: "john@example.com",
  bodyText: "Hi Lynn,\n\nWe are hoping to visit in October.\n\nThanks,\nJohn",
  bodyHtml: null,
};

describe("formatQuoteAttribution", () => {
  it("matches Gmail's reply attribution format in Eastern time", () => {
    expect(formatQuoteAttribution(source)).toBe(
      "On Tue, Aug 4, 2026 at 3:12 PM John Smith <john@example.com> wrote:"
    );
  });

  it("omits the name when unknown", () => {
    expect(
      formatQuoteAttribution({ ...source, senderName: null })
    ).toBe("On Tue, Aug 4, 2026 at 3:12 PM <john@example.com> wrote:");
  });

  it("produces a line the quote stripper recognizes", () => {
    const attribution = formatQuoteAttribution(source);
    expect(/^On .+ wrote:\s*$/.test(attribution)).toBe(true);
  });
});

describe("buildQuotedText", () => {
  it("prefixes every quoted line with '> '", () => {
    const quoted = buildQuotedText(source);
    const lines = quoted.split("\n");
    expect(lines[0]).toMatch(/^On .+ wrote:$/);
    for (const line of lines.slice(1)) {
      expect(line.startsWith("> ")).toBe(true);
    }
  });

  it("nests an existing quote chain one level deeper", () => {
    const nested = buildQuotedText({
      ...source,
      bodyText: "Sounds good!\n\nOn Mon, Aug 3, 2026 at 9:00 AM Lynn <lynn@x.com> wrote:\n> Original text",
    });
    expect(nested).toContain("> > Original text");
  });
});

describe("buildQuotedHtml", () => {
  it("wraps escaped text in Gmail's quote structure", () => {
    const html = buildQuotedHtml({ ...source, bodyText: "1 < 2 & so on" });
    expect(html).toContain('class="gmail_quote"');
    expect(html).toContain('class="gmail_attr"');
    expect(html).toContain("<blockquote");
    expect(html).toContain("1 &lt; 2 &amp; so on");
  });

  it("uses stored HTML when available, unwrapping full documents", () => {
    const html = buildQuotedHtml({
      ...source,
      bodyHtml: "<html><head></head><body><p>Rich text</p></body></html>",
    });
    expect(html).toContain("<p>Rich text</p>");
    expect(html).not.toContain("<head>");
  });
});

describe("stripQuotedText", () => {
  it("round-trips: stripping a built quote returns the reply text alone", () => {
    const reply = "Thanks John!\n\nI'll connect you with our agent.";
    const sent = `${reply}\n\n${buildQuotedText(source)}`;
    expect(stripQuotedText(sent)).toBe(reply);
  });

  it("leaves bodies without quotes untouched", () => {
    expect(stripQuotedText("Just a plain reply.")).toBe("Just a plain reply.");
  });

  it("stops at Original Message separators", () => {
    expect(
      stripQuotedText("Reply text\n-----Original Message-----\nOld stuff")
    ).toBe("Reply text");
  });
});
