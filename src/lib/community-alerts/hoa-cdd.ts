// HOA/CDD Info (Jeff, 2026-11-02): the pages on each site that state HOA
// dues or CDD fees, and a to-do twice a year to check them. CDD fees are
// checked in mid-October: the districts' fiscal year starts October 1, so
// the year's assessments are final by then, just before buyers see them on
// November's tax bill. HOA dues are checked in mid-January: most
// associations' budgets run on the calendar year.
//
// One alert per site, one item per page and fee. The Hub only reminds:
// the frontlines person asks Claude for the current figures by hand (Jeff,
// 2026-11-02: "a standard to-do"), edits the page if they changed, and
// picks Updated or No change. The page list is kept on the HOA/CDD Info
// tab, so a page is added there, not in code; a site with no pages gets
// no alert (Parrish, for now).

import { supabase } from "@/lib/supabase/client";
import { failedAt as failed } from "@/lib/shared/describe-error";
import type { Outcome } from "@/lib/community-alerts/alerts";
import { FEE_LABEL, feeItemKey, type Fee, type FeePage } from "@/lib/community-alerts/checklists";

export { FEE_LABEL, type Fee, type FeePage };

/** Every open HOA/CDD alert of a site shares one subject: a check raised while one is open adds to it. */
const SUBJECT = "hoa_cdd";

export const FEES: Fee[] = ["hoa", "cdd"];

/** The checks the schedule makes (vercel.json): the month, the day, and what is checked. */
export const SCHEDULE: { month: number; day: number; fee: Fee }[] = [
  { month: 1, day: 15, fee: "hoa" },
  { month: 10, day: 15, fee: "cdd" },
];

export interface HoaCddDetail {
  site: string;
  /** What this alert asks about. */
  fees: Fee[];
  trigger: "cron" | "hub";
  pages: FeePage[];
}

/** What the scheduled check asks about in a month (1-12); nothing outside January and October. Pure. */
export function feesDueIn(month: number): Fee[] {
  return SCHEDULE.filter((s) => s.month === month).map((s) => s.fee);
}

/** The next scheduled check of each fee, on or after `now`'s day, as YYYY-MM-DD. Pure. */
export function nextChecks(now: Date): { fee: Fee; date: string }[] {
  const today = now.toISOString().slice(0, 10);
  return SCHEDULE.map((s) => {
    const md = `${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`;
    const year = now.getUTCFullYear();
    const date = `${year}-${md}` >= today ? `${year}-${md}` : `${year + 1}-${md}`;
    return { fee: s.fee, date };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** What the alert is called: what is checked, and when it was raised. Pure. */
export function checkName(fees: Fee[], at: Date): string {
  const what = FEES.filter((f) => fees.includes(f))
    .map((f) => f.toUpperCase())
    .join(" & ");
  return `${what} fee check, ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** The pages to check for these fees, each with the fees it states among them. Pure. */
export function pagesFor(pages: FeePageRow[], fees: Fee[]): FeePage[] {
  return pages
    .map((p) => ({ id: p.id, label: p.label, url: p.url, fees: FEES.filter((f) => fees.includes(f) && p[f]) }))
    .filter((p) => p.fees.length > 0);
}

/** An open alert's pages with a new check's added: a page once, with every fee either asks about. Pure. */
export function mergePages(current: FeePage[], incoming: FeePage[]): FeePage[] {
  const merged = current.map((p) => ({ ...p, fees: [...p.fees] }));
  for (const page of incoming) {
    const have = merged.find((p) => p.id === page.id);
    if (!have) merged.push({ ...page, fees: [...page.fees] });
    else have.fees = FEES.filter((f) => have.fees.includes(f) || page.fees.includes(f));
  }
  return merged;
}

// ============================================================
// THE PAGE LIST
// ============================================================

interface FeePageRow {
  id: string;
  site_id: string;
  label: string;
  url: string;
  hoa: boolean;
  cdd: boolean;
  created_at: string;
}

/** The last time a page's fee was checked off, and how. */
export interface LastCheck {
  at: string;
  choice: string | null;
  note: string | null;
}

export interface FeePageView {
  id: string;
  site: string | null;
  label: string;
  url: string;
  hoa: boolean;
  cdd: boolean;
  createdAt: string;
  last: Partial<Record<Fee, LastCheck>>;
}

/** The latest check of each page and fee, from every HOA/CDD alert's items, open or closed. */
async function lastChecks(): Promise<Map<string, LastCheck>> {
  const { data, error } = await supabase
    .from("ca_alerts")
    .select("id, ca_alert_items(item_key, done_at, choice, note)")
    .eq("kind", "hoa_cdd");
  if (error) throw failed("reading the HOA/CDD checks", error);
  const latest = new Map<string, LastCheck>();
  for (const alert of (data ?? []) as unknown as { ca_alert_items: { item_key: string; done_at: string | null; choice: string | null; note: string | null }[] }[]) {
    for (const item of alert.ca_alert_items ?? []) {
      if (!item.done_at) continue;
      const seen = latest.get(item.item_key);
      if (!seen || seen.at < item.done_at) latest.set(item.item_key, { at: item.done_at, choice: item.choice, note: item.note });
    }
  }
  return latest;
}

export async function listFeePages(): Promise<FeePageView[]> {
  const [{ data, error }, latest] = await Promise.all([
    supabase.from("ca_fee_pages").select("id, site_id, label, url, hoa, cdd, created_at, fp_sites:site_id(domain)").order("created_at"),
    lastChecks(),
  ]);
  if (error) throw failed("reading the HOA/CDD pages", error);
  return ((data ?? []) as unknown as (FeePageRow & { fp_sites: { domain: string } | null })[]).map((r) => {
    const last: FeePageView["last"] = {};
    for (const fee of FEES) {
      const check = latest.get(feeItemKey(r.id, fee));
      if (check) last[fee] = check;
    }
    return {
      id: r.id,
      site: r.fp_sites?.domain ?? null,
      label: r.label,
      url: r.url,
      hoa: r.hoa,
      cdd: r.cdd,
      createdAt: r.created_at,
      last,
    };
  });
}

/** The sites a page can be added to. */
export async function feeSites(): Promise<string[]> {
  const { data, error } = await supabase.from("fp_sites").select("domain").order("domain");
  if (error) throw failed("reading the sites", error);
  return (data ?? []).map((r) => r.domain as string).filter(Boolean);
}

/** A page's address as it is kept: a full http(s) URL, or null. Pure. */
export function cleanUrl(raw: string): string | null {
  const text = raw.trim();
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface NewFeePage {
  domain: string;
  label: string;
  url: string;
  hoa: boolean;
  cdd: boolean;
}

export async function addFeePage(page: NewFeePage): Promise<Outcome> {
  const label = page.label.trim().slice(0, 200);
  const url = cleanUrl(page.url);
  if (!label) return { ok: false, status: 400, error: "Give the page a name" };
  if (!url) return { ok: false, status: 400, error: "Give the page's full address, starting https://" };
  if (!page.hoa && !page.cdd) return { ok: false, status: 400, error: "Say whether it states HOA dues, CDD fees or both" };
  const { data: site, error } = await supabase.from("fp_sites").select("id").eq("domain", page.domain).maybeSingle();
  if (error) throw failed("reading the site", error);
  if (!site) return { ok: false, status: 404, error: `No site ${page.domain}` };
  const { error: insertError } = await supabase.from("ca_fee_pages").insert({ site_id: site.id, label, url, hoa: page.hoa, cdd: page.cdd });
  if (insertError?.code === "23505") return { ok: false, status: 409, error: "That page is on the list already" };
  if (insertError) throw failed("adding the page", insertError);
  return { ok: true };
}

/** Changes which fees a page states. */
export async function updateFeePage(id: string, change: { hoa?: boolean; cdd?: boolean }): Promise<Outcome> {
  const { data: current, error } = await supabase.from("ca_fee_pages").select("hoa, cdd").eq("id", id).maybeSingle();
  if (error) throw failed("reading the page", error);
  if (!current) return { ok: false, status: 404, error: "No page by that id" };
  const hoa = change.hoa ?? current.hoa;
  const cdd = change.cdd ?? current.cdd;
  if (!hoa && !cdd) return { ok: false, status: 400, error: "A page states HOA dues, CDD fees or both; remove it instead" };
  const { error: updateError } = await supabase.from("ca_fee_pages").update({ hoa, cdd }).eq("id", id);
  if (updateError) throw failed("updating the page", updateError);
  return { ok: true };
}

/** Takes a page off the list; an open alert keeps its item for it. */
export async function removeFeePage(id: string): Promise<Outcome> {
  const { data, error } = await supabase.from("ca_fee_pages").delete().eq("id", id).select("id");
  if (error) throw failed("removing the page", error);
  if (!data?.length) return { ok: false, status: 404, error: "No page by that id" };
  return { ok: true };
}

// ============================================================
// RAISING THE CHECK
// ============================================================

export interface FeeCheckResult {
  fees: Fee[];
  /** Sites given a new alert. */
  raised: string[];
  /** Sites whose open alert was added to. */
  added: string[];
  /** Sites with no page stating these fees. */
  noPages: string[];
}

/**
 * Raises the check for these fees on every site with a page stating them:
 * a new alert, or the open one with the new pages and fees added (it is
 * never raised twice), its items as they were.
 */
export async function raiseFeeCheck(fees: Fee[], trigger: HoaCddDetail["trigger"], now = new Date()): Promise<FeeCheckResult> {
  const result: FeeCheckResult = { fees, raised: [], added: [], noPages: [] };
  const [{ data: sites, error: sitesError }, { data: pages, error: pagesError }] = await Promise.all([
    supabase.from("fp_sites").select("id, domain").order("domain"),
    supabase.from("ca_fee_pages").select("id, site_id, label, url, hoa, cdd, created_at").order("created_at"),
  ]);
  if (sitesError) throw failed("reading the sites", sitesError);
  if (pagesError) throw failed("reading the HOA/CDD pages", pagesError);

  for (const site of (sites ?? []) as { id: string; domain: string }[]) {
    const incoming = pagesFor(((pages ?? []) as FeePageRow[]).filter((p) => p.site_id === site.id), fees);
    if (incoming.length === 0) {
      result.noPages.push(site.domain);
      continue;
    }
    const { data: open, error } = await supabase
      .from("ca_alerts")
      .select("id, detail")
      .eq("kind", "hoa_cdd")
      .eq("site_id", site.id)
      .eq("subject_key", SUBJECT)
      .eq("status", "open")
      .maybeSingle();
    if (error) throw failed(`reading ${site.domain}'s open HOA/CDD check`, error);

    if (open) {
      const detail = open.detail as HoaCddDetail;
      const allFees = FEES.filter((f) => detail.fees?.includes(f) || fees.includes(f));
      const merged: HoaCddDetail = { ...detail, fees: allFees, pages: mergePages(detail.pages ?? [], incoming) };
      const { error: updateError } = await supabase
        .from("ca_alerts")
        .update({ detail: merged, name: checkName(allFees, now), updated_at: now.toISOString() })
        .eq("id", open.id);
      if (updateError) throw failed(`adding to ${site.domain}'s HOA/CDD check`, updateError);
      result.added.push(site.domain);
      continue;
    }

    const detail: HoaCddDetail = { site: site.domain, fees, trigger, pages: incoming };
    const { error: insertError } = await supabase.from("ca_alerts").insert({
      kind: "hoa_cdd",
      site_id: site.id,
      subject_key: SUBJECT,
      name: checkName(fees, now),
      detail,
    });
    // Raised a moment ago by another run: that one stands.
    if (insertError?.code === "23505") result.added.push(site.domain);
    else if (insertError) throw failed(`raising ${site.domain}'s HOA/CDD check`, insertError);
    else result.raised.push(site.domain);
  }
  return result;
}
