// Richmond American probe, round three: does the fix actually work?
//
// Rounds one and two found the shape of it. This one runs the mechanism
// the engine now uses — the same exact-label press, the same walk up to
// the block with a heading, the same "Load more" loop, the same injection
// of what the tabs swapped away — and then reads the result the way
// plan-page.ts reads it, so the answer is what the engine will see and
// not a near-enough imitation.
//
// Guarded to the working branch; results are read from the build logs.
// Always exits 0.

const PROBE_BRANCH = 'claude/stock-luxury-homes-connection-x2ieo8';

const branch = process.env.VERCEL_GIT_COMMIT_REF;
if (branch !== PROBE_BRANCH) {
  console.log(`FP-RICH: branch ${branch ?? '(none)'} is not ${PROBE_BRANCH}; skipping.`);
  process.exit(0);
}

const COMMUNITY = 'https://www.richmondamerican.com/florida/tampa-new-homes/parrish/estates-at-rivers-edge/';
const PLAN = COMMUNITY + 'slate/';
const HOME = COMMUNITY + 'sage/35630000-0021/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// The engine's own lists.
const HOMES_TAB = ['move-in ready', 'move-in ready homes', 'quick move-in', 'quick move-ins',
  'quick move-in homes', 'available homes', 'homes for sale', 'inventory homes'];
const PICTURE_TABS = ['interiors', 'interior', 'exteriors', 'exterior', 'renderings', 'rendering',
  'photos', 'photo gallery', 'gallery', 'images', 'elevations'];
const NOT_PICTURES = '(tour|video|map|matterport|3-? ?d|film|walk-?through|floor ?plan)';
const MORE_LABELS = ['load more', 'view more', 'show more', 'see more', 'load all', 'view all', 'see all'];

const say = (...parts) => console.log('FP-RICH:', ...parts);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const watchdog = setTimeout(() => {
  say('watchdog fired; giving up');
  process.exit(0);
}, 420_000);

let browser;
try {
  const pack = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;
  browser = await puppeteer.launch({ executablePath: await pack.executablePath(), args: pack.args, headless: true });
  say('browser started');
} catch (err) {
  say('browser would not start:', String(err?.message ?? err));
  clearTimeout(watchdog);
  process.exit(0);
}

// ---- what render.ts does, verbatim enough to trust ----------------------

const pressOne = (page, labels) =>
  page.evaluate((want) => {
    const bare = (text) => (text ?? '').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = new Set(want.map(bare));
    const here = location.href.split('#')[0];
    for (const el of document.querySelectorAll('button, [role="tab"], a')) {
      const label = bare(el.textContent);
      if (!wanted.has(label)) continue;
      const href = el.getAttribute('href');
      if (el.tagName === 'A' && href && !href.startsWith('#')) {
        try {
          if (new URL(href, location.href).href.split('#')[0] !== here) continue;
        } catch { continue; }
      }
      el.click();
      return label;
    }
    return null;
  }, labels);

const openGalleries = (page) =>
  page.evaluate(async (want, more, avoid, budget) => {
    const until = Date.now() + budget;
    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
    const bare = (text) => (text ?? '').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const notPictures = new RegExp(avoid, 'i');
    const wanted = new Set(want);
    const moreWanted = new Set(more);

    const boxOf = (el) => {
      let box = el.parentElement;
      for (let n = 0; n < 8 && box; n++) {
        if (box.querySelector('h1, h2, h3, h4')) return box;
        box = box.parentElement;
      }
      return el.parentElement ?? el;
    };
    const drawTheRest = async (box) => {
      for (let n = 0; n < 5 && Date.now() < until; n++) {
        const button = [...box.querySelectorAll('button, a')].find((el) => moreWanted.has(bare(el.textContent)));
        if (!button) return;
        button.click();
        await sleep(1_200);
      }
    };
    const pictures = (box) =>
      [...box.querySelectorAll('img')]
        .map((img) => ({ src: img.src || img.currentSrc, alt: img.getAttribute('alt') || img.getAttribute('title') || '' }))
        .filter((p) => p.src && !p.src.startsWith('data:') && !/\.svg(\?|$)/i.test(p.src));

    const tabs = [...document.querySelectorAll('button, [role="tab"]')].filter((el) => {
      const label = bare(el.textContent);
      return Boolean(label) && wanted.has(label) && !notPictures.test(label);
    });

    const gathered = new Map();
    const pressedTabs = [];
    for (const tab of tabs) {
      if (Date.now() > until) break;
      const box = boxOf(tab);
      pressedTabs.push(bare(tab.textContent) + ' -> ' + (box.tagName + '.' + String(box.className || '')).slice(0, 50));
      tab.click();
      await sleep(1_500);
      await drawTheRest(box);
      const found = gathered.get(box) ?? new Map();
      for (const picture of pictures(box)) if (!found.has(picture.src)) found.set(picture.src, picture);
      gathered.set(box, found);
    }
    await drawTheRest(document);

    let added = 0;
    for (const [box, found] of gathered) {
      const keep = document.createElement('div');
      keep.setAttribute('data-gathered', 'gallery');
      for (const picture of found.values()) {
        const img = document.createElement('img');
        img.setAttribute('data-src', picture.src);
        if (picture.alt) img.setAttribute('alt', picture.alt);
        keep.appendChild(img);
        added++;
      }
      box.appendChild(keep);
    }
    return { added, pressedTabs };
  }, PICTURE_TABS, MORE_LABELS, NOT_PICTURES, 25_000);

// ---- and what plan-page.ts does with the result --------------------------

/** sectionsOf, as the reader has it: headings, and the images under each. */
function sectionsOf(html) {
  const attr = (tag, name) => tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
  const readable = (h) => h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const marks = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    marks.push({ at: m.index ?? 0, heading: { level: Number(m[1]), text: readable(m[2]) } });
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], 'src') || attr(m[0], 'data-src');
    if (!src || src.startsWith('data:')) continue;
    marks.push({ at: m.index ?? 0, image: { src, alt: attr(m[0], 'alt') ?? '' } });
  }
  marks.sort((a, b) => a.at - b.at);
  const sections = [{ heading: '', level: 0, images: [] }];
  for (const mark of marks) {
    if (mark.heading) sections.push({ heading: mark.heading.text, level: mark.heading.level, images: [] });
    else sections[sections.length - 1].images.push(mark.image);
  }
  return sections;
}

async function open(url, press) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1440, height: 2400 });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const kind = r.resourceType();
    if (kind === 'image' || kind === 'media' || kind === 'font') r.abort().catch(() => {});
    else r.continue().catch(() => {});
  });
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
  } catch {
    await page.waitForSelector('body', { timeout: 5_000 }).catch(() => {});
  }
  await wait(1_500);
  await page.evaluate(async (steps) => {
    for (let n = 0; n < steps; n++) {
      const y = (window.innerHeight || 1000) * (n + 1);
      if (y > document.body.scrollHeight) break;
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
  }, 12);
  await wait(1_500);
  let pressed = null;
  if (press) {
    pressed = await pressOne(page, press);
    if (pressed) {
      await wait(3_000);
    }
  }
  const opened = await openGalleries(page);
  const html = await page.content();
  say(`opened ${url} in ${Date.now() - started}ms pressed=${pressed} gathered=${opened.added} tabs=${JSON.stringify(opened.pressedTabs)}`);
  return { page, html, pressed };
}

// ---- a plan: the gallery the reader will see ----------------------------
try {
  const { page, html } = await open(PLAN);
  for (const section of sectionsOf(html)) {
    if (!section.images.length) continue;
    say(`plan h${section.level} "${section.heading}" -> ${section.images.length}`,
        JSON.stringify(section.images.slice(0, 14).map((i) => `${i.src.split('/').pop()} [${i.alt.slice(0, 32)}]`)));
  }
  await page.close();
} catch (err) {
  say('plan failed:', String(err?.message ?? err));
}

// ---- a home: the same ---------------------------------------------------
try {
  const { page, html } = await open(HOME);
  for (const section of sectionsOf(html)) {
    if (!section.images.length) continue;
    say(`home h${section.level} "${section.heading}" -> ${section.images.length}`,
        JSON.stringify(section.images.slice(0, 8).map((i) => `${i.src.split('/').pop()} [${i.alt.slice(0, 32)}]`)));
  }
  await page.close();
} catch (err) {
  say('home failed:', String(err?.message ?? err));
}

// ---- the community, with its homes tab pressed --------------------------
try {
  const { page, html, pressed } = await open(COMMUNITY, HOMES_TAB);
  const text = await page.evaluate(() => {
    const body = document.body.innerText.replace(/\s+/g, ' ');
    const at = body.search(/Ready for move-in|Sale price|Lot \d+/i);
    return at < 0 ? body.slice(0, 200) : body.slice(Math.max(0, at - 300), at + 900);
  });
  say('community pressed:', pressed);
  say('community homes text:', JSON.stringify(text));
  const homes = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('a')].map((a) => a.href))].filter((h) => /\/\d{8}-\d{4}\/?$/.test(h)).length
  );
  say('community home links after press:', homes, 'html', html.length, 'bytes');
  await page.close();
} catch (err) {
  say('community failed:', String(err?.message ?? err));
}

say('done');
clearTimeout(watchdog);
await browser.close().catch(() => {});
process.exit(0);
