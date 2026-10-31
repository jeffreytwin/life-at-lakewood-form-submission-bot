# Life at Lakewood team landing page

One static page for the team: `index.html` and `assets/`. There's no build step and nothing to
install, and it deploys separately from the Hub, whose Next.js app doesn't change.

Preview it locally:

```bash
python3 -m http.server 8000 -d landing
```

Then open http://localhost:8000.

## Before it goes live

1. **Connect the form.** Set `LEAD_ENDPOINT` in the script at the bottom of `index.html` to a
   Zapier Catch Hook, the same way the Wix forms feed Salesforce. Until it's set, the form asks
   visitors to call the office instead of dropping their details. Each submission posts
   `interest` (`buy`, `build`, `sell` or `buy_and_sell`), `first_name`, `last_name`, `email`,
   `phone`, `timeline`, `message`, `source`, `page_url` and `submitted_at`, plus `utm_source`,
   `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid` and `fbclid` when the visit
   came from an ad.
2. **Set the live address.** Uncomment the `canonical` tag with the page's URL, and make
   `og:image` absolute (`https://<host>/assets/og-image.jpg`), or Facebook and text-message
   previews won't show the share card.
3. **Analytics.** A successful submission pushes `{ event: "generate_lead" }` to `dataLayer`.
   Add the GTM or GA4 snippet to `<head>` to count it as a conversion.
4. **Compliance.** The brokerage name sits next to the phone number in the header, the contact
   section and the footer, with the Equal Housing Opportunity and ADA lines from
   lifeatlakewood.com. Have the managing broker approve the page before running ads.

## Keeping it current

- **Numbers.** The page states 150+ closings (on pace for 2026), 74 reviews, 10 agents and
  45+ villages in the hero, the stats strip, the reviews band and the meta description; the
  review count carries `data-stat="reviews"`. `assets/og-image.jpg` shows the review and
  closing numbers too, so regenerate it when they change.
- **Reviews.** Paste real Google reviews into `REVIEWS` in the script to show quote cards under
  the rating. Left empty, the section shows the rating and a link to the Google profile.
- **Team.** One `<li class="person">` per person. Photos are the circular headshots from
  lifeatlakewood.com/contact-us, resized to 240×240 WebP in `assets/team/`.

## Hosting

Any static host works. The simplest: a new Vercel project from this repository with **Root
Directory** set to `landing` and the **Other** framework preset (no build command), then a
subdomain such as `team.lifeatlakewood.com` added as a CNAME in Wix DNS.

`__tests__/unit/landing/page.test.ts` checks the structured data, the FAQ markup and the
compliance lines.
