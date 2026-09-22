import type { Browser, Page } from "puppeteer-core";
import { logger } from "@/lib/shared/logger";
import { pageLooksUnrendered } from "@/lib/floorplans/extractors/rendered";

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

let browser: Browser | null = null;
let deadline = Infinity;

/**
 * How long this run may spend in the browser. A rendered page takes
 * seconds rather than milliseconds, and a community with twenty of them
 * would otherwise outlive the function it runs in and be killed with
 * nothing written down. Past the budget, a page is refused: the list
 * pages come first, so what is refused is a plan's extras, which the
 * caller already treats as optional.
 */
export function renderBudget(ms: number): void {
  deadline = Date.now() + ms;
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
  const { executablePath, args, headless } = await chromium();
  const puppeteer = await import("puppeteer-core");
  browser = await puppeteer.default.launch({ executablePath, args, headless });
  logger.info("Floor plan renderer started", { executablePath });
  return browser;
}

/** Ends the run's browser. Safe to call when none was started. */
export async function closeRenderer(): Promise<void> {
  const open = browser;
  browser = null;
  deadline = Infinity;
  if (!open) return;
  try {
    await open.close();
  } catch (error) {
    logger.warn("Floor plan renderer would not close", {
      error: error instanceof Error ? error.message : String(error),
    });
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
const SCROLL_STEPS = 30;

async function seeWholePage(page: Page): Promise<void> {
  await page.evaluate(async (steps: number) => {
    const step = window.innerHeight || 1000;
    for (let n = 0; n < steps; n++) {
      const y = step * (n + 1);
      if (y > document.body.scrollHeight) break;
      window.scrollTo(0, y);
      await new Promise((done) => setTimeout(done, 250));
    }
    window.scrollTo(0, 0);
  }, SCROLL_STEPS);
  // The last pictures asked for are still on their way.
  await new Promise((done) => setTimeout(done, 1_500));
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
export async function renderPage(url: string): Promise<{ url: string; html: string }> {
  if (Date.now() > deadline) throw new Error(`out of rendering time before ${url}`);
  const page = await (await open()).newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1440, height: 2400 });
    // Wait for the page to stop fetching, not merely to exist. Asking
    // whether any facts are on the page yet is not enough on its own:
    // Perry's community pages print a summary in their HTML ("3,100 -
    // 5,300 Sq. Ft.") and draw the plans afterwards, so a page that has
    // shown one fact may still be loading the ones that matter (Jeff,
    // 2026-09-22). A page that never goes quiet — a chat widget, a poll —
    // is taken as it stands rather than failing.
    let quiet = true;
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATE_MS });
    } catch {
      quiet = false;
      await page.waitForSelector("body", { timeout: 5_000 }).catch(() => {});
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

    const html = await page.content();
    logger.info("Floor plan page rendered", { url, quiet, ready, bytes: html.length });
    return { url: page.url(), html };
  } finally {
    await page.close().catch(() => {});
  }
}
