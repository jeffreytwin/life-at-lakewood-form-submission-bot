// Auto-discovers the builder's community page URL for a connection, so
// onboarding a connection is one click — no URL pasting. Sources, in order:
// audit-stored candidate URLs, the builder's sitemap, homepage links. The
// best-scoring candidate is verified by fetching it and checking the
// community name actually appears on the page.

import { logger } from "@/lib/shared/logger";
import { normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Community name variants to match against URLs: with and without the
 * site-area prefix ("Waterside - Wild Blue" → wild-blue), dashless too. */
function nameKeys(communityName: string): string[] {
  const parts = communityName.split(/\s*-\s*/);
  const bases = [communityName, parts[parts.length - 1]];
  const keys = new Set<string>();
  for (const b of bases) {
    const k = normKey(b);
    if (k.length >= 4) {
      keys.add(k);
      keys.add(k.replace(/-/g, ""));
    }
  }
  return [...keys];
}

function score(url: string, keys: string[]): number {
  const u = normKey(url);
  let best = 0;
  for (const k of keys) {
    if (u.includes(k)) best = Math.max(best, k.length * 10 - url.length / 20);
  }
  return best;
}

async function sitemapUrls(baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const urls: string[] = [];
  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const xml = await fetchText(origin + path);
    if (!xml) continue;
    let locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (locs.length && locs.every((l) => /\.xml(\?|$)/.test(l))) {
      const children = locs.slice(0, 4);
      locs = [];
      for (const child of children) {
        const c = await fetchText(child);
        if (c) locs.push(...[...c.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]));
      }
    }
    if (locs.length) return locs;
  }
  return urls;
}

export async function discoverCommunityUrl(
  builder: { base_url: string | null; engine_config: Record<string, unknown> | null },
  communityName: string
): Promise<string | null> {
  if (!builder.base_url) return null;
  const keys = nameKeys(communityName);
  const candidates = new Map<string, number>();

  const addCandidates = (urls: string[]) => {
    for (const url of urls) {
      const s = score(url, keys);
      if (s > 0) candidates.set(url, Math.max(candidates.get(url) ?? 0, s));
    }
  };

  // 1. Audit-stored candidates (community pages + sitemap matches).
  const cfg = builder.engine_config ?? {};
  addCandidates([
    ...((cfg.candidateUrls as string[]) ?? []),
    ...((cfg.sitemapMatches as string[]) ?? []),
  ]);

  // 2. Sitemap sweep.
  if (candidates.size === 0) addCandidates(await sitemapUrls(builder.base_url));

  // 3. Homepage links.
  if (candidates.size === 0) {
    const html = await fetchText(builder.base_url);
    if (html) {
      const links = [...html.matchAll(/href=["']([^"'#]+)["']/gi)]
        .map((m) => {
          try {
            return new URL(m[1], builder.base_url!).href;
          } catch {
            return null;
          }
        })
        .filter((u): u is string => Boolean(u));
      addCandidates(links);
    }
  }

  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  // Verify: the page must actually mention the community by name.
  for (const url of ranked.slice(0, 3)) {
    const html = await fetchText(url);
    if (!html) continue;
    const lower = html.toLowerCase();
    const nameParts = communityName.split(/\s*-\s*/);
    const shortName = nameParts[nameParts.length - 1].toLowerCase();
    if (lower.includes(shortName)) {
      logger.info("Discovered community URL", { communityName, url });
      return url;
    }
  }
  return null;
}
