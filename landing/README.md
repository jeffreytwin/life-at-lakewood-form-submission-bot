# Life at Lakewood team landing page

One static page for the team: `index.html` and `assets/`. There's no build step and nothing to
install, and it deploys separately from the Hub, whose Next.js app doesn't change.

Preview it locally:

```bash
python3 -m http.server 8000 -d landing
```

Then open http://localhost:8000.

## How it converts

The page is built around one free offer and one form.

- **The offer.** Buyers get a free **Village Match**: their top 3 villages, with current price
  ranges, HOA and CDD fees, homes and floor plans in their budget, quick move-ins and builder
  incentives, and a live video tour for out-of-state buyers, within 24 hours. Builders get a
  **New Construction Match**, and sellers a **home value report** with a prep plan.
- **The form** sits in the hero as four tap-to-answer questions (intent, price, must-haves,
  timeline; sellers get village and timeline) before name, email and mobile phone. Every other
  button on the page jumps into it, already past the questions it answers. A village card
  starts a buyer match with that village attached.
- **Few ways out.** The only links that leave the page go to the Google reviews, the office map
  and the legal pages. The tests enforce that.
- **Proof at the point of action:** the Google rating, agent faces and "no spam, no obligation"
  under the form; the stats, team and reviews further down; a no-pressure promise and
  objection-handling FAQs.
- **Exit offer.** On desktop, a visitor who has been on the page at least 8 seconds and heads
  for the tab bar without starting the form gets one reminder per visit. It never shows on
  touch screens; phones get a sticky call / Village Match bar instead.

### Promises the page makes

Change the copy if any of these isn't how the team works:

- The Village Match, New Construction Match and home value report arrive **within 24 hours**, by
  text and email, from a local agent.
- Their contents, as listed in the offer section.
- Live video tours for out-of-state buyers.
- No obligation and nothing to sign, and contact stops when someone asks.

## Ad campaigns

Add `?intent=sell` or `?intent=build` to an ad's link and the headline, the form's title and
its first question match that ad. Plain links speak to buyers. Keep the usual `utm_*`
parameters on the link too; they travel with the lead.

```text
https://team.lifeatlakewood.com/?intent=sell&utm_source=facebook&utm_campaign=sellers
```

## Before it goes live

1. **Connect the form.** Set `LEAD_ENDPOINT` in the script at the bottom of `index.html` to a
   Zapier Catch Hook, the same way the Wix forms feed Salesforce. Until it's set, the form asks
   visitors to call instead of dropping their details. Each submission posts:
   - `offer` (`Village Match`, `New Construction Match` or `Home Value Report`) and `interest`
     (`buy`, `build`, `sell` or `buy_and_sell`)
   - `price_range`, `must_haves` (comma-separated), `village_interest`, `home_village`, `address`
     and `timeline`, left empty when they don't apply
   - `first_name` and `last_name` (split from the one name field), `email` and `phone`
   - `message`, all the answers in one line for Zaps that map only a message field
   - `source`, `page_url` and `submitted_at`, plus `utm_source`, `utm_medium`, `utm_campaign`,
     `utm_term`, `utm_content`, `gclid` and `fbclid` when the visit came from an ad
2. **Set the live address.** Uncomment the `canonical` tag with the page's URL, and make
   `og:image` absolute (`https://<host>/assets/og-image.jpg`), or Facebook and text-message
   previews won't show the share card.
3. **Analytics.** The page pushes `form_start`, `form_step` (with `form_step` and
   `form_step_number`), `generate_lead`, `exit_offer_shown` and `click_to_call` to `dataLayer`.
   Add the GTM or GA4 snippet to `<head>`, count `generate_lead` as the conversion, and use the
   step events to see where visitors drop out of the form.
4. **Compliance.** The brokerage name sits next to the phone number in the header, the closing
   section and the footer, with the Equal Housing Opportunity and ADA lines from
   lifeatlakewood.com, and the form carries consent language for calls and texts. Have the
   managing broker approve the page, offer included, before running ads.

## Keeping it current

- **Numbers.** The page states 150+ closings (on pace for 2026), 74 reviews, 10 agents and
  45+ villages in the hero, the stats strip, the form, the reviews band and the meta
  description; the review count carries `data-stat="reviews"`. `assets/og-image.jpg` shows the
  review and closing numbers too, so regenerate it when they change.
- **Reviews.** Paste real Google reviews into `REVIEWS` in the script. The first appears under
  the form and all of them in the reviews band. Left empty, both show the rating only.
- **Team.** One `<li class="person">` per person. Photos are the circular headshots from
  lifeatlakewood.com/contact-us, resized to 240×240 WebP in `assets/team/`.

## Hosting

Any static host works. The simplest: a new Vercel project from this repository with **Root
Directory** set to `landing` and the **Other** framework preset (no build command), then a
subdomain such as `team.lifeatlakewood.com` added as a CNAME in Wix DNS.

`__tests__/unit/landing/page.test.ts` checks the structured data, the FAQ markup, the
compliance lines, the links that leave the page, and that every button starts an offer and
step the form has.
