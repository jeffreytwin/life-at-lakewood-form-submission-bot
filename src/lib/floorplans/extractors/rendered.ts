/**
 * Whether a page shows no facts at all — the one test that tells a page a
 * fetch cannot read from a page that simply has nothing to list.
 *
 * Richmond American's site (probed 2026-09-22) is the case it was written
 * for: every page of it, the community and all nineteen plans and homes
 * named in its own sitemap, comes back as 240KB of shell with not one
 * price or square footage in it, because the facts arrive over Blazor's
 * wire after the page loads. The same test does two jobs: it tells the
 * plain engine to say so rather than blaming the run, and it tells the
 * rendering engine when a page has finished filling itself in.
 *
 * A price, a size or a bed count anywhere means the page did render, so
 * an empty answer is the page's own truth — a sold-out community, a list
 * that moved. Pure.
 */
export function pageLooksUnrendered(text: string): boolean {
  if (/\$\s?\d{1,3},\d{3}/.test(text)) return false;
  if (/\d[\d,]*\s*(?:sq\.? ?ft|square feet)/i.test(text)) return false;
  if (/\b\d(?:\.\d)?\s*(?:bd|ba|bed|bath)/i.test(text)) return false;
  return true;
}
