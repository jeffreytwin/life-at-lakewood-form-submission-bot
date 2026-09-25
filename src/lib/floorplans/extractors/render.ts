import type { Browser, Page } from "puppeteer-core";
import { logger } from "@/lib/shared/logger";
import { pageIsBotCheck, pageLooksUnrendered } from "@/lib/floorplans/extractors/rendered";

/**
 * A real browser, for the builders whose pages are empty without one.
 *
 * Richmond American's site is the reason this exists (Jeff, 2026-09-22):
 * it is a Blazor app, and every page of it — the community, all eight
 * plans, all eleven homes — fetches as 240KB of shell and fills itself in
 * afterwards over Blazor's own wire. There is nothing in the HTML for the
 * plain engine to read, on any page, so no amount of tuning the reader
 * helps. Only a browser sees that site.
 *
 * Renting one is not free, so it is per-builder: a connection is switched
 * to the "render_claude" method and everything downstream is unchanged —
 * the same distillation, the same reads, the same diff. One browser
 * serves a whole run and is closed at the end of it.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** How long to give a page to draw itself before taking what it has. */
const SETTLE_MS = 20_000;
/** How often to look at what the page is showing while it fills in. */
const POLL_MS = 500;
/** A page that will not even load in this long is not going to. */
const NAVIGATE_MS = 45_000;
/** The longest a page is given to stop fetching once it has loaded. */
const QUIET_MS = 15_000;

/** How long a bot check in front of a page is given to let the browser through. */
const BOT_CHECK_MS = 10_000;

let browser: Browser | null = null;
let starting: Promise<Browser> | null = null;
/** Runs using the browser now; it is closed when the last of them ends. */
let users = 0;

/**
 * A browser for one run, with a budget of its own. Runs in the same
 * process share one browser — two connections run at once from the Hub
 * can land on the same function instance — so it is started once and
 * closed only when the last run using it ends; before this, the first run
 * to finish closed the browser under the other. Past its budget a run's
 * pages are refused: the list pages come first, so what is refused is a
 * plan's extras, which the caller already treats as optional.
 */
export async function withRenderer<T>(
  budgetMs: number,
  work: (render: (url: string, opts?: RenderOptions) => Promise<{ url: string; html: string; pressed: string | null }>) => Promise<T>
): Promise<T> {
  users += 1;
  const deadline = Date.now() + budgetMs;
  try {
    return await work((url, opts) => renderPage(url, opts, deadline));
  } finally {
    users -= 1;
    if (users === 0) await closeRenderer();
  }
}

/**
 * Where Chromium is. On Vercel it is the one @sparticuz/chromium unpacks
 * into /tmp; in development it is whatever the machine already has, named
 * by PUPPETEER_EXECUTABLE_PATH or CHROME_PATH.
 */
async function chromium(): Promise<{ executablePath: string; args: string[]; headless: boolean }> {
  const local = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (local) return { executablePath: local, args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: true };
  const pack = (await import("@sparticuz/chromium")).default;
  return {
    executablePath: await pack.executablePath(),
    args: pack.args,
    headless: true,
  };
}

/** The run's browser, started on first use. */
async function open(): Promise<Browser> {
  if (browser?.connected) return browser;
  starting ??= (async () => {
    const { executablePath, args, headless } = await chromium();
    const puppeteer = await import("puppeteer-core");
    const opened = await puppeteer.default.launch({ executablePath, args, headless });
    logger.info("Floor plan renderer started", { executablePath });
    browser = opened;
    return opened;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** Ends the browser. Safe to call when none was started. */
async function closeRenderer(): Promise<void> {
  const open = browser;
  browser = null;
  if (!open) return;
  try {
    await open.close();
  } catch (error) {
    logger.warn("Floor plan renderer would not close", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The browser forgets what a site told it: the cookies that would go with
 * a request for this address, and the site's own storage. Only that site's,
 * so a page of another builder open at the same moment keeps its own.
 */
async function forgetSite(page: Page, url: string): Promise<void> {
  const cdp = await page.createCDPSession();
  try {
    const { cookies } = (await cdp.send("Network.getCookies", { urls: [url] })) as {
      cookies: { name: string; domain: string; path: string }[];
    };
    for (const c of cookies) await cdp.send("Network.deleteCookies", { name: c.name, domain: c.domain, path: c.path });
    await cdp.send("Storage.clearDataForOrigin", { origin: new URL(url).origin, storageTypes: "local_storage,session_storage,indexeddb,cache_storage" });
  } catch (error) {
    logger.warn("Floor plan renderer could not clear a site's cookies", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** What a page is showing right now, as a person would read it. */
const shownText = (page: Page) => page.evaluate(() => document.body?.innerText ?? "");

/**
 * Walk the page to the bottom, so it loads the pictures it only loads
 * when somebody looks at them. Richmond American's galleries are eleven
 * photographs and arrived as two, because nothing here had ever scrolled
 * (Jeff, 2026-09-22). Bounded: a page that grows as it is scrolled — a
 * feed, an endless list — is walked a fixed distance and no further.
 */
const SCROLL_STEPS = 12;

async function seeWholePage(page: Page): Promise<void> {
  await page.evaluate(async (steps: number) => {
    const step = window.innerHeight || 1000;
    for (let n = 0; n < steps; n++) {
      const y = step * (n + 1);
      if (y > document.body.scrollHeight) break;
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 200));
    }
    window.scrollTo(0, 0);
  }, SCROLL_STEPS);
  // The last pictures asked for are still on their way.
  await new Promise((done) => setTimeout(done, 1_500));
}

/**
 * Press the page's own control for one of these, and say which. A label
 * is matched as the page writes it bar the count it carries — "Interiors
 * (11)" is the interiors — and only a control that stays on this page
 * counts: a tab is a button, or a link to an anchor of its own page, and
 * the site's navigation is neither.
 */
async function pressOne(page: Page, labels: readonly string[]): Promise<string | null> {
  return page.evaluate((want: string[]) => {
    const bare = (text: string | null) =>
      (text ?? "")
        .replace(/\s*\(\d+\)\s*$/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const wanted = new Set(want.map(bare));
    const here = location.href.split("#")[0];
    for (const el of document.querySelectorAll('button, [role="tab"], a')) {
      const label = bare(el.textContent);
      if (!wanted.has(label)) continue;
      const href = el.getAttribute("href");
      if (el.tagName === "A" && href && !href.startsWith("#")) {
        try {
          if (new URL(href, location.href).href.split("#")[0] !== here) continue;
        } catch {
          continue;
        }
      }
      (el as HTMLElement).click();
      return label;
    }
    return null;
  }, labels as string[]);
}

/**
 * What a builder calls the tab that holds photographs, and what it calls
 * the tabs that hold something else. Richmond American's plan pages open
 * on "Interactive Tours", which is an embed, so the eleven interiors and
 * the elevation behind "Interiors (11)" and "Renderings (1)" were never
 * on the page at all when it was read (Jeff, 2026-09-22).
 */
const PICTURE_TABS = [
  "interiors",
  "interior",
  "exteriors",
  "exterior",
  "renderings",
  "rendering",
  "photos",
  "photo gallery",
  "gallery",
  "images",
  "elevations",
];
const NOT_PICTURES = "(tour|video|map|matterport|3-? ?d|film|walk-?through|floor ?plan)";

/** And what it calls the button that draws the rest of a gallery. */
const MORE_LABELS = ["load more", "view more", "show more", "see more", "load all", "view all", "see all"];

/** How long the whole unfolding may take, per page. */
const GALLERY_MS = 25_000;

/**
 * Unfold a page's galleries: press the tabs that hold photographs, press
 * whatever draws the rest of each one, and put back what the tabs swapped
 * away. A gallery keeps only the tab showing at the time, so the pictures
 * gathered along the way are added to the block they came from — as
 * `data-src`, which the reader understands (plan-page.ts) and the browser
 * does not fetch a second time.
 *
 * Every step is bounded, and a page with no such tabs and no such button
 * is left exactly as it was.
 */
async function openGalleries(page: Page): Promise<number> {
  return page.evaluate(
    async (want: string[], more: string[], avoid: string, budget: number) => {
      const until = Date.now() + budget;
      const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const bare = (text: string | null) =>
        (text ?? "")
          .replace(/\s*\(\d+\)\s*$/, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const notPictures = new RegExp(avoid, "i");
      const wanted = new Set(want);
      const moreWanted = new Set(more);

      /** The block a control belongs to: the nearest part of the page with a heading of its own. */
      const boxOf = (el: Element): Element => {
        let box = el.parentElement;
        for (let n = 0; n < 8 && box; n++) {
          if (box.querySelector("h1, h2, h3, h4")) return box;
          box = box.parentElement;
        }
        return el.parentElement ?? el;
      };

      /** Draw the rest of this gallery, while there is a button that says so. */
      const drawTheRest = async (box: ParentNode) => {
        for (let n = 0; n < 5 && Date.now() < until; n++) {
          const button = [...box.querySelectorAll("button, a")].find((el) =>
            moreWanted.has(bare(el.textContent))
          );
          if (!button) return;
          (button as HTMLElement).click();
          await sleep(1_200);
        }
      };

      const pictures = (box: ParentNode) =>
        [...box.querySelectorAll("img")]
          .map((img) => ({
            // The address the markup gives, not the one the window's
            // width picked: Richmond offers a thumbnail between 1057 and
            // 1641 pixels, and the browser is 1440 wide (Jeff, 2026-09-22).
            src: img.src || img.currentSrc,
            alt: img.getAttribute("alt") || img.getAttribute("title") || "",
          }))
          .filter((p) => p.src && !p.src.startsWith("data:") && !/\.svg(\?|$)/i.test(p.src));

      const tabs = [...document.querySelectorAll('button, [role="tab"]')].filter((el) => {
        const label = bare(el.textContent);
        return Boolean(label) && wanted.has(label) && !notPictures.test(label);
      });

      const gathered = new Map<Element, Map<string, { src: string; alt: string }>>();
      for (const tab of tabs) {
        if (Date.now() > until) break;
        const box = boxOf(tab);
        (tab as HTMLElement).click();
        await sleep(1_500);
        await drawTheRest(box);
        const found = gathered.get(box) ?? new Map();
        for (const picture of pictures(box)) if (!found.has(picture.src)) found.set(picture.src, picture);
        gathered.set(box, found);
      }

      // A gallery with no tabs at all can still be holding pictures back.
      await drawTheRest(document);

      let added = 0;
      for (const [box, found] of gathered) {
        const keep = document.createElement("div");
        keep.setAttribute("data-gathered", "gallery");
        for (const picture of found.values()) {
          const img = document.createElement("img");
          img.setAttribute("data-src", picture.src);
          if (picture.alt) img.setAttribute("alt", picture.alt);
          keep.appendChild(img);
          added++;
        }
        box.appendChild(keep);
      }
      return added;
    },
    PICTURE_TABS,
    MORE_LABELS,
    NOT_PICTURES,
    GALLERY_MS
  );
}

/** What a browser may be asked to do with a page beyond reading it. */
export interface RenderOptions {
  /** Press the page's own control for one of these before reading it. */
  press?: readonly string[];
}

/**
 * The page's markup, once it has stopped moving. A page can send itself
 * somewhere else after it has drawn — Richmond American's did, and the
 * read failed with "Execution context was destroyed" (2026-09-23) — so a
 * read that loses its page waits for the next one to arrive and reads
 * that, twice at most.
 */
async function settledContent(page: Page): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.content();
    } catch (error) {
      const moved = /context was destroyed|navigat/i.test(error instanceof Error ? error.message : String(error));
      if (!moved || attempt >= 2) throw error;
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15_000 }).catch(() => {});
      await page.waitForSelector("body", { timeout: 5_000 }).catch(() => {});
    }
  }
}

/**
 * The page's HTML once it has drawn itself, and the address it settled on.
 *
 * "Drawn itself" is the same test the plain engine uses to tell an empty
 * page from an empty community: a price, a size or a bed count anywhere.
 * A page that never shows one is handed over as it stands after the
 * settle window — a genuinely empty community reads the same either way,
 * and the caller is better placed to say so.
 */
export async function renderPage(
  url: string,
  opts: RenderOptions = {},
  deadline = Infinity
): Promise<{ url: string; html: string; pressed: string | null }> {
  if (Date.now() > deadline) throw new Error(`out of rendering time before ${url}`);
  const page = await (await open()).newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1440, height: 2400 });
    // The pictures themselves are never wanted here — only their
    // addresses, which are in the markup either way — and a page of
    // twenty-eight photographs spends most of its load fetching them
    // (Jeff, 2026-09-22). Refusing them makes a page quiet sooner and
    // leaves more of the run's budget for the pages after it. A lazy
    // gallery still fills in: what it swaps in is the address.
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const kind = request.resourceType();
      if (kind === "image" || kind === "media" || kind === "font") request.abort().catch(() => {});
      else request.continue().catch(() => {});
    });
    // Wait for the page to stop fetching, not merely to exist. Asking
    // whether any facts are on the page yet is not enough on its own:
    // Perry's community pages print a summary in their HTML ("3,100 -
    // 5,300 Sq. Ft.") and draw the plans afterwards, so a page that has
    // shown one fact may still be loading the ones that matter (Jeff,
    // 2026-09-22). A page that never goes quiet — a chat widget, a poll —
    // is taken as it stands rather than failing.
    //
    // Quiet within QUIET_MS, though: a page with a chat widget or a poll
    // never goes quiet, and waiting out the whole navigation for each of
    // Richmond's plan pages cost half a minute a page (2026-09-23). The
    // facts check below is what says the page has drawn.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATE_MS }).catch(async () => {
      await page.waitForSelector("body", { timeout: 5_000 }).catch(() => {});
    });
    const quiet = await page
      .waitForNetworkIdle({ idleTime: 500, concurrency: 2, timeout: QUIET_MS })
      .then(() => true)
      .catch(() => false);

    // A bot check in front of the page sometimes lets a browser through
    // after a few seconds; one that does not is not the page, and saying
    // so leaves what an earlier run found alone (diff.ts, pageUnread).
    // Neal Signature's lets a browser's first visit through and stops every
    // page after it, for as long as the browser keeps the site's cookies;
    // with them cleared, each page is a first visit again (2026-09-24).
    for (let attempt = 0; ; attempt++) {
      const checkUntil = Date.now() + BOT_CHECK_MS;
      while (pageIsBotCheck(await page.content().catch(() => "")) && Date.now() < checkUntil) {
        await new Promise((done) => setTimeout(done, POLL_MS));
      }
      if (!pageIsBotCheck(await page.content().catch(() => ""))) break;
      if (attempt >= 1 || Date.now() + BOT_CHECK_MS > deadline) {
        throw new Error(`${url}: stopped at the site's bot check ("Just a moment...")`);
      }
      await forgetSite(page, url);
      await page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATE_MS }).catch(() => {});
      await page.waitForNetworkIdle({ idleTime: 500, concurrency: 2, timeout: QUIET_MS }).catch(() => {});
    }

    // And then the backstop, for a page still filling in after it went
    // quiet: wait until it shows a price, a size or a bed count.
    const until = Date.now() + SETTLE_MS;
    let ready = false;
    while (Date.now() < until) {
      if (!pageLooksUnrendered(await shownText(page).catch(() => ""))) {
        ready = true;
        break;
      }
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
    // A moment more once the facts appear: the first price on the page is
    // rarely the last, and the rest arrive in the same breath.
    if (ready) await new Promise((done) => setTimeout(done, 1_500));

    // And then down the page, for the pictures it loads only in view.
    await seeWholePage(page).catch((error) => {
      logger.warn("Floor plan page would not scroll", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // A page that keeps part of itself behind a tab: press it, let what
    // it draws arrive, and walk the page again for what that loaded.
    let pressed: string | null = null;
    if (opts.press?.length) {
      pressed = await pressOne(page, opts.press).catch(() => null);
      if (pressed) {
        await new Promise((done) => setTimeout(done, 3_000));
        await seeWholePage(page).catch(() => {});
      }
    }

    // And then the galleries, which keep their pictures behind tabs of
    // their own and behind a "Load more".
    const gathered = await openGalleries(page).catch((error) => {
      logger.warn("Floor plan page galleries would not open", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    });

    const html = await settledContent(page);
    logger.info("Floor plan page rendered", { url, quiet, ready, pressed, gathered, bytes: html.length });
    return { url: page.url(), html, pressed };
  } finally {
    await page.close().catch(() => {});
  }
}
