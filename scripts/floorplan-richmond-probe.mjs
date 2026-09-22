// Richmond American probe, round two.
//
// Round one found the shape of it (build 310c144): the community's
// "Move-in ready" homes are behind a <button> that changes nothing in the
// address bar, and a plan's "Gallery" heading has no pictures under it at
// all until a tab is pressed — the tab that opens is "Interactive Tours",
// which is an embed, not photographs. Pressing "Interiors (11)" put six
// pictures on the page, and a home's "Sage model gallery" draws six
// thumbnails of its own.
//
// So round two asks the three things the fix turns on: where the other
// five pictures are, whether the page names a full-size copy of each
// thumbnail, and whether the captions under them ("Bedroom", "Kitchen")
// are in the markup beside the picture.
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

async function open(url) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1440, height: 2400 });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
  } catch {
    await page.waitForSelector('body', { timeout: 5_000 }).catch(() => {});
  }
  await wait(5_000);
  await page.evaluate(async () => {
    for (let n = 1; n <= 12; n++) {
      if (window.innerHeight * n > document.body.scrollHeight) break;
      window.scrollTo(0, window.innerHeight * n);
      await new Promise((r) => setTimeout(r, 250));
    }
    window.scrollTo(0, 0);
  });
  await wait(2_000);
  say('opened', url);
  return page;
}

const press = (page, word) =>
  page.evaluate((want) => {
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length) continue;
      const text = (el.textContent || '').trim().toLowerCase();
      if (!text.startsWith(want)) continue;
      const target = el.closest('a,button,[role="tab"],li') || el;
      target.click();
      return true;
    }
    return false;
  }, word);

/** The section a heading opens, as markup and as its parts. */
const gallery = (page, heading) =>
  page.evaluate((want) => {
    const head = [...document.querySelectorAll('h1,h2,h3,h4')].find((h) =>
      (h.textContent || '').trim().toLowerCase().includes(want)
    );
    if (!head) return { found: false };
    // The block that holds both the heading and the pictures.
    let box = head.parentElement;
    for (let n = 0; n < 6 && box; n++) {
      if (box.querySelectorAll('img').length >= 2) break;
      box = box.parentElement;
    }
    box = box || head.parentElement;
    const pictures = [...box.querySelectorAll('img')].map((img) => {
      const holder = img.closest('figure,li,div');
      return {
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
        cap: (holder?.innerText || '').trim().slice(0, 40),
        up: String(img.parentElement?.className || '').slice(0, 40),
      };
    });
    const controls = [...box.querySelectorAll('button,a,[role="button"]')]
      .map((el) => ({
        t: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 40),
        href: el.getAttribute('href'),
      }))
      .filter((c) => c.t || c.cls);
    return {
      found: true,
      heading: head.textContent.trim().slice(0, 40),
      box: String(box.className || '').slice(0, 60),
      pictures,
      controls: controls.slice(0, 18),
      markup: box.outerHTML.replace(/\s+/g, ' ').slice(0, 1800),
    };
  }, heading);

/** For each thumbnail, the other spellings of the same picture the page names. */
const siblings = (page, pictures) =>
  page.evaluate((srcs) => {
    const html = document.documentElement.outerHTML;
    return srcs.map((src) => {
      const id = (src || '').match(/media-(\d+)/)?.[1];
      if (!id) return { src, id: null, forms: [] };
      const forms = [...new Set((html.match(new RegExp(`[^"'\\s]*media-${id}[^"'\\s]*`, 'g')) || []))];
      return { src: src.slice(-40), id, forms: forms.slice(0, 6).map((f) => f.slice(-46)) };
    });
  }, pictures);

// ---- a plan's gallery, tab by tab ---------------------------------------
try {
  const page = await open(PLAN);
  for (const tab of ['interiors', 'renderings', 'exteriors', 'floor plan']) {
    const pressed = await press(page, tab);
    if (!pressed) {
      say('plan has no', tab, 'tab');
      continue;
    }
    await wait(3_500);
    const seen = await gallery(page, 'gallery');
    say(`plan "${tab}" ->`, seen.found ? `${seen.pictures.length} pictures in .${seen.box}` : 'no gallery heading');
    if (!seen.found) continue;
    say(`plan "${tab}" pictures:`, JSON.stringify(seen.pictures));
    say(`plan "${tab}" controls:`, JSON.stringify(seen.controls));
    if (tab === 'interiors') {
      say('plan interiors markup:', seen.markup);
      say('plan interiors siblings:', JSON.stringify(await siblings(page, seen.pictures.map((p) => p.src))));
      // Is the rest of the eleven behind a control, or further down?
      for (const more of ['view all', 'view more', 'see all', 'load more', 'next']) {
        if (await press(page, more)) {
          await wait(3_000);
          const after = await gallery(page, 'gallery');
          say(`plan after "${more}":`, after.pictures?.length ?? 0, 'pictures',
              JSON.stringify((after.pictures ?? []).map((p) => (p.src || '').slice(-30))));
        }
      }
      const arrows = await page.evaluate(() => {
        const box = [...document.querySelectorAll('h1,h2,h3')].find((h) => /gallery/i.test(h.textContent || ''))?.closest('section,div');
        const next = box && [...box.querySelectorAll('button,a')].find((b) => /next|right|›|>/i.test((b.getAttribute('aria-label') || b.className || '')));
        if (!next) return 'none';
        next.click();
        return next.tagName + '.' + String(next.className).slice(0, 30);
      });
      say('plan gallery next-control:', arrows);
      await wait(3_000);
      const after = await gallery(page, 'gallery');
      say('plan after next-control:', after.pictures?.length ?? 0, 'pictures');
    }
  }
  await page.close();
} catch (err) {
  say('plan failed:', String(err?.message ?? err));
}

// ---- a home's gallery ---------------------------------------------------
try {
  const page = await open(HOME);
  const seen = await gallery(page, 'model gallery');
  say('home gallery ->', seen.found ? `${seen.pictures.length} pictures in .${seen.box}` : 'no gallery heading');
  if (seen.found) {
    say('home pictures:', JSON.stringify(seen.pictures));
    say('home controls:', JSON.stringify(seen.controls));
    say('home markup:', seen.markup);
    say('home siblings:', JSON.stringify(await siblings(page, seen.pictures.map((p) => p.src))));
    for (const more of ['view all', 'view more', 'see all', 'load more']) {
      if (await press(page, more)) {
        await wait(3_000);
        const after = await gallery(page, 'model gallery');
        say(`home after "${more}":`, after.pictures?.length ?? 0, 'pictures');
      }
    }
  }
  // What the page says about the home itself, for the list read.
  say('home text:', JSON.stringify(await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    return main.innerText.replace(/\s+/g, ' ').slice(0, 700);
  })));
  await page.close();
} catch (err) {
  say('home failed:', String(err?.message ?? err));
}

say('done');
clearTimeout(watchdog);
await browser.close().catch(() => {});
process.exit(0);
