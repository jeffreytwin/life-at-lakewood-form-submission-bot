import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// The team landing page is static HTML, so it's read as text: what search
// engines and a broker's compliance review see.
const DIR = join(__dirname, "../../../landing");
const html = readFileSync(join(DIR, "index.html"), "utf8");

const text = (fragment: string) =>
  fragment.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
  (m) => JSON.parse(m[1])
);

describe("team landing page", () => {
  it("emits no review or rating markup of its own", () => {
    // docs/SEO_STRATEGY.md §2: self-served Review/aggregateRating markup is a
    // manual-action risk. The page states the Google rating in text only.
    expect(JSON.stringify(jsonLd)).not.toMatch(/aggregateRating|"review"|"Review"/);
  });

  it("marks up exactly the FAQs the page shows", () => {
    const faq = jsonLd.find((doc) => doc["@type"] === "FAQPage");
    const marked = faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => ({
      q: q.name,
      a: q.acceptedAnswer.text,
    }));
    const shown = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map(
      (m) => ({ q: text(m[1]), a: text(m[2]) })
    );
    expect(shown.length).toBeGreaterThan(0);
    expect(marked).toEqual(shown);
  });

  it("names the brokerage with the phone number in the header and the footer", () => {
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    for (const block of [header, footer]) {
      expect(block).toContain("Coldwell Banker Realty");
      expect(block).toContain('href="tel:+19417774049"');
    }
    expect(footer).toContain("Equal Housing Opportunity");
    expect(footer).toContain("not affiliated with the official developers of Lakewood Ranch");
  });

  it("states one review count everywhere", () => {
    const counts = new Set([...html.matchAll(/data-stat="reviews"[^>]*>(\d+)</g)].map((m) => m[1]));
    expect(counts.size).toBe(1);
    const [count] = counts;
    expect(html).toContain(`${count} five-star Google reviews and on pace`);
  });

  it("links only to sections and files that exist", () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(anchors.filter((id) => !ids.has(id))).toEqual([]);

    const assets = [...html.matchAll(/(?:src|href|content)="(assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.filter((path) => !existsSync(join(DIR, path)))).toEqual([]);
  });
});
