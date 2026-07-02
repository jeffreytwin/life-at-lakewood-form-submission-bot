# Floor Plan Sync Pipeline

Automation that keeps the Wix Floorplans collections on our community sites
current by scraping builder websites nightly, diffing against our canonical
data, and queueing changes for approval in the Hub.

Full plan: [`docs/FLOOR_PLAN_SYNC_PLAN.md`](../docs/FLOOR_PLAN_SYNC_PLAN.md)

## Layout

- `audit/` — Phase 0 tooling. Fetches our three live sites and builder pages
  from a GitHub Actions runner (the Claude Code sandbox has no egress to
  these domains, so anything that touches the live web runs in Actions),
  and commits snapshots back to the working branch for analysis.
- `audit/snapshots/` — committed output of audit runs (page HTML, extracted
  links, summaries). Working data only — this directory is removed before
  the branch merges.

Later phases add: `engines/` (json_api / fetch_claude / render_claude
extractors), `normalize/`, `diff/`, and the nightly sync workflow.

## Running the site reconnaissance

Trigger the "Floor Plan Audit — Site Recon" workflow (workflow_dispatch) on
this branch. It fetches each site's homepage plus internal pages whose URLs
or link text look build/builder/floor-plan related, then commits:

- `audit/snapshots/<domain>/<slug>.html` — raw page HTML (truncated at 2 MB)
- `audit/snapshots/<domain>/<slug>.links.json` — internal links + anchor text
- `audit/snapshots/summary.json` — per-site fetch results

No external dependencies; plain Node 20.
