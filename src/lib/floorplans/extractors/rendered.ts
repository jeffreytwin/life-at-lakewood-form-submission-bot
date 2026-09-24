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

/**
 * Whether a page is a bot check standing in front of the page asked for:
 * Cloudflare's "Just a moment..." with "Performing security verification".
 * Neal Signature's plan pages give only that, even in the browser, and a
 * run that read it as the plan's page would have proposed taking every
 * photo off the plan (2026-09-24). A page that merely carries the check's
 * script, as Lakewood Ranch's own pages do, is not one. Pure.
 */
export function pageIsBotCheck(html: string): boolean {
  if (/<title[^>]*>\s*Just a moment\.\.\.\s*<\/title>/i.test(html)) return true;
  return /Performing security verification|Verify you are human by completing|Checking (?:if the site connection is secure|your browser before accessing)/i.test(html);
}
