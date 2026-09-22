// Richmond American probe: three things the run is getting wrong (Jeff,
// 2026-09-22) — the community page's "Move-in ready" tab is never opened,
// and neither a home's gallery ("Sage model gallery") nor a plan's
// ("Gallery" with Interiors/Renderings tabs) reaches the plan.
//
// Builder domains are blocked from the working container, so this runs as
// a prebuild step on Vercel, guarded to the working branch; results are
// read from the build logs. Always exits 0, and never fails the build.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-RICH: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const COMMUNITY = 'https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/';
const HOME = 'https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/sage/35630000-0021/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const say = (...parts) => console.log('FP-RICH:', ...parts);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// The build must not hang on a browser that will not start or a page that
// will not settle.
const watchdog = setTimeout(() => {
  say('watchdog fired; giving up');
  process.exit(0);
}, 420_000);

let browser;
try {
  const pack = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = await pack.executablePath();
  say('chromium at', executablePath);
  browser = await puppeteer.launch({ executablePath, args: pack.args, headless: true });
  say('browser started');
} catch (err) {
  say('browser would not start:', String(err?.message ?? err));
  clearTimeout(watchdog);
  process.exit(0);
}

/** Open a page and let it draw itself, the way render.ts does. */
async function open(url) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1440, height: 2400 });
  let quiet = true;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
  } catch (err) {
    quiet = false;
    say('navigate not quiet:', url, String(err?.message ?? err).slice(0, 80));
    await page.waitForSelector('body', { timeout: 5_000 }).catch(() => {});
  }
  await wait(6_000);
  say('opened', url, 'quiet=' + quiet, 'landed=' + page.url());
  return page;
}

/** Every picture the page is showing, and how it names it. */
const pictures = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      out.push({
        src: (img.currentSrc || img.src || src || '').slice(0, 120),
        attr: src ? 'src' : img.getAttribute('data-src') ? 'data-src' : img.getAttribute('srcset') ? 'srcset-only' : 'none',
        shown: img.offsetParent !== null,
      });
    }
    return out;
  });

/** The page as its headings divide it, with the pictures under each. */
const sections = (page) =>
  page.evaluate(() => {
    const out = [];
    let here = { heading: '(top)', level: 0, n: 0, first: [] };
    out.push(here);
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walk.nextNode()) {
      const el = walk.currentNode;
      if (/^H[1-6]$/.test(el.tagName)) {
        here = { heading: (el.textContent || '').trim().slice(0, 60), level: Number(el.tagName[1]), n: 0, first: [] };
        out.push(here);
      } else if (el.tagName === 'IMG') {
        const src = el.currentSrc || el.src;
        if (src && !src.startsWith('data:')) {
          here.n++;
          if (here.first.length < 2) here.first.push(src.slice(0, 100));
        }
      }
    }
    return out.filter((s) => s.n || s.heading !== '(top)');
  });

/** Anything on the page that reads like one of these words. */
const tabs = (page, words) =>
  page.evaluate((want) => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length) continue;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 40) continue;
      if (!want.some((w) => text.toLowerCase().startsWith(w))) continue;
      const a = el.closest('a');
      out.push({
        text,
        tag: el.tagName,
        href: a ? a.getAttribute('href') : null,
        role: el.closest('[role]') ? el.closest('[role]').getAttribute('role') : null,
        cls: String(el.className || '').slice(0, 60),
        up: String(el.parentElement?.className || '').slice(0, 60),
      });
    }
    return out;
  }, words);

/** Click the thing that says this, and say whether anything was found. */
const press = (page, word) =>
  page.evaluate((want) => {
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      if (!text.startsWith(want)) continue;
      const target = el.closest('a,button,[role="tab"],li') || el;
      target.click();
      return target.tagName + '.' + String(target.className || '').slice(0, 40);
    }
    return null;
  }, word);

/** Scroll the whole way down, for the pictures a page only loads in view. */
async function toTheBottom(page) {
  await page.evaluate(async () => {
    const step = 900;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 250));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await wait(3_000);
}

const count = (list) => `${list.length} pictures (${list.filter((p) => p.attr === 'src').length} src, ${list.filter((p) => p.attr === 'data-src').length} data-src, ${list.filter((p) => p.attr === 'srcset-only').length} srcset-only)`;

async function look(page, label) {
  const before = await pictures(page);
  say(label, 'before scrolling:', count(before));
  await toTheBottom(page);
  const after = await pictures(page);
  say(label, 'after scrolling: ', count(after));
  const html = await page.content();
  say(label, 'html', html.length, 'bytes,', (html.match(/<img\b/gi) || []).length, '<img>,',
      (html.match(/background-image/gi) || []).length, 'background-image');
  for (const s of await sections(page)) {
    if (s.n) say(label, `  h${s.level} "${s.heading}" -> ${s.n} pictures`, s.first.join(' | '));
    else say(label, `  h${s.level} "${s.heading}"`);
  }
  return after;
}

// ---- the community page, and the tab the run never opens ----------------
try {
  const page = await open(COMMUNITY);
  say('community tabs:', JSON.stringify(await tabs(page, ['plans to build', 'move-in ready', 'models'])));
  const text = await page.evaluate(() => document.body.innerText.slice(0, 600));
  say('community text head:', JSON.stringify(text));

  const pressed = await press(page, 'move-in ready');
  say('pressed move-in ready ->', pressed);
  await wait(6_000);
  say('community landed after press:', page.url());
  const after = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('a')]
      .map((a) => ({ text: (a.textContent || '').trim().slice(0, 40), href: a.getAttribute('href') || '' }))
      .filter((r) => /lot\s*\d+/i.test(r.text) || /\/\d{8}-\d{4}\/?$/.test(r.href));
    return { body: document.body.innerText.slice(0, 900), rows: rows.slice(0, 14) };
  });
  say('move-in ready rows:', JSON.stringify(after.rows));
  say('move-in ready text:', JSON.stringify(after.body));

  const links = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('a')].map((a) => a.href))]
      .filter((h) => h.includes('/estates-at-rivers-edge/') && !h.endsWith('/estates-at-rivers-edge/'))
      .slice(0, 20)
  );
  say('community plan links:', JSON.stringify(links));
  await page.close();
} catch (err) {
  say('community failed:', String(err?.message ?? err));
}

// ---- does the tab have an address of its own? ---------------------------
for (const candidate of [
  COMMUNITY + '?tab=move-in-ready',
  COMMUNITY + 'move-in-ready/',
  COMMUNITY + '#move-in-ready',
  COMMUNITY + 'quick-move-in/',
]) {
  try {
    const page = await open(candidate);
    const seen = await page.evaluate(() => ({
      tab: [...document.querySelectorAll('*')]
        .filter((el) => !el.children.length && /^(plans to build|move-in ready|models)$/i.test((el.textContent || '').trim()))
        .map((el) => ({ t: el.textContent.trim(), c: String(el.className || '').slice(0, 40) })),
      ready: (document.body.innerText.match(/Ready for move-in/gi) || []).length,
      head: document.body.innerText.slice(0, 300),
    }));
    say('candidate', candidate, '->', JSON.stringify(seen));
    await page.close();
  } catch (err) {
    say('candidate', candidate, 'failed:', String(err?.message ?? err));
  }
}

// ---- a home's page: "Sage model gallery" --------------------------------
try {
  const page = await open(HOME);
  await look(page, 'home');
  await page.close();
} catch (err) {
  say('home failed:', String(err?.message ?? err));
}

// ---- a plan's page: "Gallery" with Interiors / Renderings tabs ----------
try {
  const page = await open(COMMUNITY + 'slate/');
  say('plan gallery tabs:', JSON.stringify(await tabs(page, ['interactive tours', 'video', 'interiors', 'renderings'])));
  const shown = await look(page, 'plan');
  for (const tab of ['interiors', 'renderings']) {
    const pressed = await press(page, tab);
    await wait(4_000);
    const now = await pictures(page);
    say(`plan after pressing ${tab} (${pressed}):`, count(now), 'new:',
        now.filter((p) => !shown.some((s) => s.src === p.src)).length);
  }
  await page.close();
} catch (err) {
  say('plan failed:', String(err?.message ?? err));
}

say('done');
clearTimeout(watchdog);
await browser.close().catch(() => {});
process.exit(0);
