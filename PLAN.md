# Integration & Testing Plan — Form Submission Hub

## How the System Works (Quick Summary)

Your existing Zaps handle the **Wix → Salesforce** pipeline (find/create record, determine owner, send SMS, update record). The Form Submission Hub sits **in the middle of Step 5 (Send SMS)** — it replaces the Twilio + Path logic inside each Zap with intelligent round-robin routing, scoring, escalation, and tracking.

The integration point is simple: **each Zap adds a "Webhooks by Zapier" step that POSTs to our `/api/webhooks/zapier` endpoint** right after the Salesforce find/create steps. Our system then handles all the SMS routing. The Zap's existing Twilio steps and Salesforce update steps get replaced by our system's logic.

---

## Phase 0: Pre-Work (During Business Hours — Safe)

These are all non-disruptive setup tasks with zero production impact.

### 0A. Add Environment Variables to Vercel
Go to **Vercel → Settings → Environment Variables** and add:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL | Already discussed |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase key | Already discussed |
| `TWILIO_ACCOUNT_SID` | existing Twilio SID | Same Twilio account your Zaps use |
| `TWILIO_AUTH_TOKEN` | existing Twilio token | Same account |
| `TWILIO_PHONE_NUMBER` | **a NEW Twilio number** | See note below |
| `ZAPIER_WEBHOOK_SECRET` | generate a random string | Shared secret so only your Zaps can call our webhook |
| `CRON_SECRET` | generate a random string | For the timeout checker cron job |
| `ADMIN_API_KEY` | generate a random string | For admin API endpoints |
| `LOGIN_USERNAME` | your login email | For the dashboard |
| `LOGIN_PASSWORD` | your login password | For the dashboard |
| `FRONTLINES_AGENT_PHONE` | frontlines agent phone | Gets notified of owned leads + fallbacks |
| `ZAPIER_CATCH_HOOK_ACCEPTANCE` | (set in Phase 2) | Zapier Catch Hook URL for SF owner updates |

**Important — Twilio Phone Number:**
- **Option A (Recommended):** Buy a **new Twilio number** for the Hub so agents can distinguish "routing bot" texts from existing Zap texts during the transition. This prevents confusion if both systems send SMS at the same time.
- **Option B:** Reuse your existing number, but ONLY after fully cutting over (Phase 3).

### 0B. Run the Database Migrations
In **Supabase SQL Editor**, run each migration file in order (001 through 011). These create the tables for locations, agents, leads, routing attempts, audit log, etc.

### 0C. Seed Locations & Agents via the Dashboard
Once the DB is up and Vercel has env vars:
1. Log into the dashboard
2. Go to **Locations** → add each community (e.g., "Life At Lakewood - Lake Nona", etc.)
3. Go to **Agents** → add each sales agent with their phone number, location specialties, and Salesforce User IDs

### 0D. Configure Twilio Inbound Webhook
In **Twilio Console → Phone Numbers → [your new number]**:
- Set the **"A message comes in"** webhook to: `https://your-app.vercel.app/api/webhooks/twilio/inbound` (POST)
- Set the **Status callback** to: `https://your-app.vercel.app/api/webhooks/twilio/status` (POST)

### 0E. Set Up the Cron Job
In **Vercel → Settings → Cron Jobs** (or via `vercel.json`):
- Add a cron that hits `GET /api/cron/check-timeouts` every 1-2 minutes
- Include the `Authorization: Bearer <CRON_SECRET>` header

---

## Phase 1: Shadow Testing (After Hours — No Disruption)

**Goal:** Verify the entire pipeline works end-to-end WITHOUT touching any live Zaps.

### 1A. Create a Test Zap
Build a new, **standalone test Zap** (not connected to any live Wix forms):
1. **Trigger:** "Webhooks by Zapier — Catch Hook" (manual trigger)
2. **Action:** "Webhooks by Zapier — POST" to `https://your-app.vercel.app/api/webhooks/zapier`

The POST body should match this format:
```json
{
  "webhook_secret": "<your ZAPIER_WEBHOOK_SECRET>",
  "location": "Life At Lakewood - Lake Nona",
  "form_name": "Contact Us",
  "salesforce_record_id": null,
  "owner_name": null,
  "first_name": "Test",
  "last_name": "Lead",
  "email": "test@example.com",
  "phone": "555-123-4567",
  "message": "Testing the routing system"
}
```

### 1B. Test Each Scenario
Run through these test cases by triggering the test Zap:

| # | Scenario | What to verify |
|---|----------|----------------|
| 1 | Basic routing | Lead appears in dashboard, agent gets SMS, reply YES → accepted |
| 2 | Decline + escalation | Reply NO → next agent gets SMS |
| 3 | Timeout + follow-up | Don't reply → follow-up SMS after timeout → don't reply again → escalated |
| 4 | Owned lead | Set `owner_name` to a non-agent name → frontlines gets notification |
| 5 | All agents exhausted | Decline from all agents → manual fallback notification |
| 6 | Routing paused | Pause routing in dashboard → submit lead → should queue as "paused" |
| 7 | Quiet hours | Test during configured quiet hours → deferred follow-up |
| 8 | Duplicate check | Send same `salesforce_record_id` twice → second should be skipped |

### 1C. Test the Acceptance → Salesforce Loop
1. Create a **Zapier Catch Hook** (this is a new Zap):
   - Trigger: "Webhooks by Zapier — Catch Hook"
   - Action: Salesforce — Update Record (set the lead owner to the accepting agent's SF User ID)
2. Copy the Catch Hook URL into the `ZAPIER_CATCH_HOOK_ACCEPTANCE` env var in Vercel
3. Test: submit a lead with a real `salesforce_record_id`, accept it → verify SF record owner updates

---

## Phase 2: One-Zap Pilot (After Hours — Minimal Risk)

**Goal:** Wire up ONE real Zap to flow through the Hub, while keeping the others untouched.

### 2A. Pick the Lowest-Volume Zap
Start with **Zap 3: Contact Form (Contact Us)** — it has a single Wix form and is a good baseline.

### 2B. Modify the Zap (After Hours)
In the existing "Contact Form (Contact Us)" Zap:

**Current flow:**
```
Wix Form → SF Find → Paths (frontlines?) → Twilio SMS → Filter → SF Update
```

**New flow:**
```
Wix Form → SF Find → Webhook POST to Hub → (Hub handles SMS + escalation + SF update)
```

Specifically:
1. Keep **Step 1** (Wix Forms trigger) — unchanged
2. Keep **Step 2** (Salesforce Find Record) — unchanged
3. **Replace Steps 3-11** with a single "Webhooks by Zapier — POST" action:
   - URL: `https://your-app.vercel.app/api/webhooks/zapier`
   - Method: POST
   - Body: Map the Wix form fields + Salesforce results to our payload schema
   - Map the SF `Owner.Name` to `owner_name` (this replaces the Path A/B frontlines check)
   - Map the SF record ID to `salesforce_record_id` (this replaces the Filter + Update steps)

### 2C. Test with a Real Form Submission
1. Submit a real test via the Wix "Contact Us" form
2. Watch it flow through: Zap triggers → Hub receives → agent gets SMS → reply → SF updated
3. Monitor the **dashboard** and **Vercel logs** for any errors

### 2D. Run Overnight
Leave it running overnight/over a weekend. Monitor the dashboard for any leads that come in. Verify:
- All leads show in the Form Submissions page
- Routing attempts are logged correctly
- SMS messages match expected format
- Salesforce records get updated on acceptance

---

## Phase 3: Full Rollout (After Pilot Confidence — After Hours)

### 3A. Map Each Zap's Fields
Each Zap has slightly different Wix form fields. Create a mapping document:

| Zap | form_name value | Extra fields |
|-----|----------------|--------------|
| Zap 1 (Build) | "Lot Availability" / "Join Interest List" / "Contact Us (Build)" / "Get the Details" | floor_plan, village, builder, timeline |
| Zap 2 (Buying) | "Contact Us (Buy)" | property_address, price, home_type |
| Zap 3 (Contact Us) | "Contact Us" | message |
| Zap 4 (Builder Page) | "Builder Page" | builder |
| Zap 5 (Realtor Page) | "Realtor Connect" | message |

### 3B. Migrate Remaining Zaps (One at a Time)
For each remaining Zap (1, 2, 4, 5):
1. Edit the Zap after hours
2. Replace the Path + Twilio + Filter + SF Update steps with the webhook POST
3. Map the form-specific fields
4. Test with a manual form submission
5. Verify in the dashboard
6. Move to the next Zap

### 3C. Decommission Old Steps
Once all 5 Zaps are routing through the Hub and you've verified a few days of successful operation:
- Remove the old Twilio steps from each Zap (they're already bypassed)
- If using a separate Twilio number, you can now switch to the original number if desired

---

## Phase 4: Production Monitoring

### Daily (First Week)
- Check the dashboard Overview for error rates
- Verify Vercel function logs for any 500s
- Confirm cron job is running (check timeout processing)
- Spot-check a few leads: SMS received? Responses processed?

### Weekly (Ongoing)
- Review the Audit Log for any `manual_fallback` events (agents exhausted)
- Check agent scoring weights — adjust if distribution seems off
- Review the Simulation page to validate scoring behavior

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Hub goes down | Leads still land in Salesforce via the Zap's Step 2. You'd just miss the SMS routing. Re-enable old Zap steps as emergency rollback. |
| Agent doesn't get SMS | Cron job catches timeouts → escalates to next agent → eventually hits manual fallback with frontlines notification |
| Wrong SF owner update | `ZAPIER_CATCH_HOOK_ACCEPTANCE` only fires on explicit agent acceptance. Salesforce record ID must match. |
| Duplicate leads | De-duplication check on `salesforce_record_id` prevents double-processing |

## Emergency Rollback
If anything goes wrong during pilot:
1. **Pause routing** in the dashboard (leads still get saved, just not routed)
2. Re-enable the original Twilio/Path steps in the affected Zap
3. Investigate via the Audit Log and Vercel logs

---

## Timeline Suggestion

| When | What |
|------|------|
| **Today/Tomorrow** | Phase 0 — env vars, DB migrations, seed data, Twilio setup |
| **Tomorrow evening** | Phase 1 — shadow testing with test Zap |
| **Next business day evening** | Phase 2 — pilot with Contact Us Zap |
| **After 2-3 days of clean pilot** | Phase 3 — roll out remaining Zaps one by one |
| **Ongoing** | Phase 4 — monitoring |
