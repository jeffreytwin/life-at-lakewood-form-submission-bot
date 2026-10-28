"use client";

import { useCallback, useEffect, useState } from "react";
import type { AlertView } from "@/lib/community-alerts/alerts";
import type { SoldOutDetail } from "@/lib/community-alerts/sold-out";
import type { NewNeighborhoodDetail } from "@/lib/community-alerts/new-neighborhoods";
import type { ChecksResult } from "@/lib/community-alerts/checks";
import type { AnnouncementDetail } from "@/lib/community-alerts/announcements";
import { siteColors } from "@/app/dashboard/listings/format";
import { emitLeadEvent } from "@/lib/lead-events";
import { COMMUNITY_ALERT_DONE_SOUND, playSound } from "@/lib/notification-sounds";

type Item = AlertView["items"][number];

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const money = (n: number | null | undefined) => (n == null ? null : `$${Math.round(n).toLocaleString("en-US")}`);

/** The place each site covers, as the alerts name it. */
const SITE_PLACE: Record<string, string> = {
  "lifeatlakewood.com": "Lakewood Ranch",
  "lifeinwellenpark.com": "Wellen Park",
  "lifeatparrish.com": "Parrish",
  "lifeinlongboatkey.com": "Longboat Key",
};

/**
 * Each alert wears its site's colour, as Listings and Floor Plans do (Jeff,
 * 2026-10-28: "so I can tell which location it's associated with"): a
 * faint tint and a left border, for a card or a table row.
 */
export function siteStyle(domain: string | null | undefined): React.CSSProperties {
  const colors = siteColors(domain);
  return colors ? { background: colors.tint, borderLeft: `3px solid ${colors.accent}` } : {};
}

/** The site's place name in its colour, the domain on hover. */
export function SiteTag({ domain }: { domain: string | null | undefined }) {
  if (!domain) return <span className="text-muted">—</span>;
  const colors = siteColors(domain);
  return (
    <span
      className="badge"
      title={domain}
      style={colors ? { color: colors.solid, background: colors.tint, border: `1px solid ${colors.accent}` } : undefined}
    >
      {SITE_PLACE[domain.toLowerCase()] ?? domain}
    </span>
  );
}

async function patch(id: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`/api/internal/community-alerts/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.error ?? `HTTP ${res.status}`;
}

/** The open alerts of one kind, loaded and reloaded. */
export function useOpenAlerts(kind: AlertView["kind"]) {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/internal/community-alerts?scope=open")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.alerts)) {
          setAlerts(data.alerts.filter((a: AlertView) => a.kind === kind));
          setError(null);
        } else setError(data?.error ?? "Failed to load");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  return { alerts, loading, error, load };
}

/** What a check found, in a sentence or two. Pure. */
function describeCheck(data: ChecksResult): string {
  const parts = [
    `Checked ${data.soldOut.communities} communities. ` +
      (data.soldOut.raised.length ? `Sold out: ${data.soldOut.raised.join(", ")}.` : "Nothing new sold out."),
  ];
  const scan = data.newNeighborhoods;
  if (scan) {
    for (const s of scan.sources) {
      parts.push(
        s.error ? `${s.source} (${s.site}): could not be read — ${s.error}` : `${s.source}: ${s.homes} homes in ${s.neighborhoods} neighborhoods.`
      );
    }
    parts.push(scan.raised.length ? `New neighborhoods: ${scan.raised.join(", ")}.` : "No new neighborhoods.");
    if (scan.watchFound.length) parts.push(`Off the watch list: ${scan.watchFound.join(", ")}.`);
  }
  return parts.join(" ");
}

/** The page's heading, with the Check now button. */
export function AlertsHeader({ intro, onChecked }: { intro: React.ReactNode; onChecked: () => void }) {
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function checkNow() {
    setChecking(true);
    setNote(null);
    try {
      const res = await fetch("/api/internal/community-alerts/check", { method: "POST" });
      const data = await res.json();
      setNote(res.ok ? describeCheck(data) : (data?.error ?? `HTTP ${res.status}`));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
      onChecked();
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">{intro}</p>
        </div>
        <button className="btn btn-secondary" onClick={checkNow} disabled={checking} title="Every check, the home finders included">
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
      {note && <NoteBar text={note} />}
    </>
  );
}

function NoteBar({ text }: { text: string }) {
  return (
    <div className="card text-sm" style={{ marginBottom: 12 }}>
      {text}
    </div>
  );
}

function PageLinks({ pages }: { pages: SoldOutDetail["pages"] }) {
  if (!pages) return null;
  return (
    <>
      {pages.neighborhood && (
        <a href={pages.neighborhood} target="_blank" rel="noreferrer">
          Neighborhood page ↗
        </a>
      )}
      {pages.homesForSale ? (
        <a href={pages.homesForSale} target="_blank" rel="noreferrer">
          Homes-for-sale page ↗
        </a>
      ) : (
        <span className="text-muted">Homes-for-sale page: not found automatically</span>
      )}
    </>
  );
}

function SoldOutSummary({ alert }: { alert: AlertView }) {
  const detail = alert.detail as unknown as SoldOutDetail;
  return (
    <>
      {detail.inventoryBack && (
        <div className="text-sm" style={{ marginTop: 8, color: "var(--warning)" }}>
          ⚠ Homes are listed again ({detail.livePlans} on the site). If this was a false alarm, dismiss the alert.
        </div>
      )}
      <div className="text-sm" style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <PageLinks pages={detail.pages} />
        {(detail.builders ?? []).map((b, i) =>
          b.url ? (
            <a key={i} href={b.url} target="_blank" rel="noreferrer">
              {b.name}&apos;s page ↗
            </a>
          ) : null
        )}
      </div>
      {detail.pages === null && (
        <div className="text-muted text-sm" style={{ marginTop: 4 }}>
          No listings neighborhood on {detail.site} matches &ldquo;{alert.name}&rdquo;, so its pages could not be linked.
          Listings → Neighborhoods is where it would be added.
        </div>
      )}
    </>
  );
}

function NewNeighborhoodSummary({ alert }: { alert: AlertView }) {
  const detail = alert.detail as unknown as NewNeighborhoodDetail;
  const low = money(detail.priceLow);
  const high = money(detail.priceHigh);
  const prices = low && high ? (low === high ? low : `${low} – ${high}`) : null;
  return (
    <>
      <div className="text-sm" style={{ marginTop: 8 }}>
        <strong>
          {detail.source?.startsWith("new-build engine")
            ? `${detail.homes} floor plan${detail.homes === 1 ? "" : "s"}, no village page`
            : `${detail.homes} home${detail.homes === 1 ? "" : "s"} for sale`}
        </strong>
        {prices && <> · {prices}</>}
        {detail.builders?.length > 0 && <> · {detail.builders.join(", ")}</>}
      </div>
      <div className="text-muted text-sm" style={{ marginTop: 2 }}>
        Found on the{" "}
        {detail.sourceUrl ? (
          <a href={detail.sourceUrl} target="_blank" rel="noreferrer">
            {detail.source} ↗
          </a>
        ) : (
          detail.source
        )}{" "}
        · first seen {when(detail.firstSeenAt)} · last seen {when(detail.lastSeenAt)}
      </div>
      {detail.pages && (
        <div className="text-sm" style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <PageLinks pages={detail.pages} />
        </div>
      )}
    </>
  );
}

const KIND_BADGE: Record<AlertView["kind"], string> = {
  sold_out: "sold out",
  new_neighborhood: "new neighborhood",
  announcement: "announced",
};
const KIND_BADGE_CLASS: Record<AlertView["kind"], string> = {
  sold_out: "badge-warning",
  new_neighborhood: "badge-info",
  announcement: "badge-purple",
};

const STATUS_LABEL: Record<AnnouncementDetail["status"], string> = {
  announced: "Announced",
  coming_soon: "Coming soon",
  selling: "Selling",
};

function AnnouncementSummary({ alert }: { alert: AlertView }) {
  const detail = alert.detail as unknown as AnnouncementDetail;
  return (
    <>
      <div className="text-sm" style={{ marginTop: 8 }}>
        <strong>{STATUS_LABEL[detail.status] ?? "Announced"}</strong>
        {detail.opening && <> · opening {detail.opening}</>}
        {detail.builders?.length > 0 && <> · {detail.builders.join(", ")}</>}
      </div>
      {detail.summary && <div style={{ marginTop: 4 }}>{detail.summary}</div>}
      {detail.sources?.length > 0 && (
        <div className="text-sm" style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {detail.sources.slice(0, 4).map((u, i) => {
            let host = u;
            try {
              host = new URL(u).hostname.replace(/^www\./, "");
            } catch {
              // Shown as given.
            }
            return (
              <a key={i} href={u} target="_blank" rel="noreferrer">
                {host} ↗
              </a>
            );
          })}
        </div>
      )}
      <div className="text-muted text-sm" style={{ marginTop: 4 }}>
        Found by the weekly web search on {when(detail.foundAt)}. No homes for sale yet: Watch it and the daily scan raises it
        as a new neighborhood once homes are listed.
      </div>
    </>
  );
}

export function AlertCard({ alert, onChange }: { alert: AlertView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<"dismiss" | "ignore" | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const site = String(alert.detail?.site ?? "");

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setProblem(null);
    const failed = await patch(alert.id, body);
    if (failed) setProblem(failed);
    setBusy(false);
    onChange();
  }

  /**
   * The list finished, the person says it's done (Jeff, 2026-10-28): the
   * character celebrates and says so, the fireworks go up, the victory
   * plays, and the card stays a moment to say where it went.
   */
  async function complete() {
    setBusy(true);
    setProblem(null);
    const failed = await patch(alert.id, { complete: true });
    setBusy(false);
    if (failed) {
      setProblem(failed);
      onChange();
      return;
    }
    setCompleted(true);
    playSound(COMMUNITY_ALERT_DONE_SOUND);
    emitLeadEvent({
      type: alert.kind === "sold_out" ? "community_sold_out_done" : "community_new_neighborhood_done",
      leadName: "",
      communityName: alert.name,
    });
    setTimeout(onChange, 2500);
  }

  const { settled, total, complete: listDone } = alert.progress;
  const canIgnore = alert.kind !== "sold_out";
  const canWatch = alert.kind === "announcement";

  return (
    <div className="card" style={{ marginBottom: 12, ...siteStyle(site) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{alert.name}</strong>
        <SiteTag domain={site} />
        <span className={`badge ${KIND_BADGE_CLASS[alert.kind]}`}>{KIND_BADGE[alert.kind]}</span>
        <span className="text-muted text-sm">raised {when(alert.createdAt)}</span>
        {total > 0 && (
          <span className="fp-progress" title={`${settled} of ${total} done or N/A`}>
            {settled} of {total} done
            <span className="fp-progress-track">
              <span className="fp-progress-fill" style={{ width: `${Math.round((settled / total) * 100)}%` }} />
            </span>
          </span>
        )}
      </div>

      {alert.kind === "sold_out" ? (
        <SoldOutSummary alert={alert} />
      ) : alert.kind === "announcement" ? (
        <AnnouncementSummary alert={alert} />
      ) : (
        <NewNeighborhoodSummary alert={alert} />
      )}

      {total > 0 && (
        <div style={{ marginTop: 12 }}>
          {alert.items.map((item) => (
            <ItemRow key={item.key} item={item} busy={busy} act={(body) => act({ item: item.key, ...body })} />
          ))}
        </div>
      )}

      {problem && (
        <div className="text-sm" style={{ marginTop: 8, color: "var(--danger)" }}>
          {problem}
        </div>
      )}

      {completed ? (
        <div className="text-sm" style={{ marginTop: 12, color: "var(--success)", fontWeight: 600 }}>
          🎉 Mission complete. {alert.name} is closed and kept under History.
        </div>
      ) : listDone && !closing ? (
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={busy} onClick={complete}>
            ✓ Mark complete
          </button>
          <span className="text-sm" style={{ color: "var(--success)" }}>
            Every item is done or N/A. Mark it complete to close it.
          </span>
        </div>
      ) : null}

      {!completed && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {closing ? (
            <>
              <input
                className="form-input"
                style={{ flex: 1, minWidth: 220 }}
                placeholder={
                  closing === "ignore"
                    ? "Why? (optional, e.g. outside the area we cover)"
                    : canIgnore
                      ? "Why? (e.g. not ready yet)"
                      : "Why? (e.g. false alarm: the builder's page changed)"
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
              <button
                className="btn btn-sm btn-danger"
                disabled={busy || (closing === "dismiss" && !reason.trim())}
                onClick={() => act(closing === "ignore" ? { ignore: reason } : { dismiss: reason })}
              >
                {closing === "ignore" ? "Ignore" : "Dismiss"}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setClosing(null);
                  setReason("");
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {canWatch && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={() => act({ watch: true })}
                  title="Put it on the watch list; the daily scan raises it once homes are for sale"
                >
                  Watch for homes
                </button>
              )}
              {canIgnore && (
                <button className="btn btn-sm btn-secondary" onClick={() => setClosing("ignore")} title="Never raise this neighborhood again">
                  Ignore…
                </button>
              )}
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setClosing("dismiss")}
                title={canIgnore ? "Close it for now: raised again in 30 days if homes are still listed" : "Close it without the list done"}
              >
                Dismiss…
              </button>
              {canIgnore && (
                <span className="text-muted text-sm">
                  Ignore never asks again; Dismiss asks again in 30 days{canWatch ? " if it turns up again" : " if homes are still listed"}.
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, busy, act }: { item: Item; busy: boolean; act: (body: Record<string, unknown>) => void }) {
  const state = item.state;
  const done = Boolean(state?.done_at);
  const na = Boolean(state?.not_applicable);
  const [note, setNote] = useState("");
  const [editingNote, setEditingNote] = useState(false);

  function editNote() {
    setNote(state?.note ?? "");
    setEditingNote(true);
  }

  const byHub = done && item.auto && !state?.by_hand;

  return (
    <div style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)", alignItems: "flex-start" }}>
      <input
        type="checkbox"
        style={{ marginTop: 3, width: 16, height: 16 }}
        checked={done}
        disabled={busy || na || (Boolean(item.choices) && !done)}
        title={item.choices && !done ? "Pick an answer" : undefined}
        onChange={(e) => act({ done: e.target.checked })}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ textDecoration: na ? "line-through" : undefined, color: done || na ? "var(--text-muted)" : undefined }}>
          {item.label}
          {byHub && <span className="badge badge-success" style={{ marginLeft: 6 }}>checked by the Hub</span>}
          {item.auto && !done && !na && <span className="badge badge-muted" style={{ marginLeft: 6 }}>checks itself</span>}
          {na && <span className="badge badge-muted" style={{ marginLeft: 6 }}>N/A</span>}
        </div>
        {item.hint && <div className="text-muted text-sm" style={{ marginTop: 2 }}>{item.hint}</div>}
        {item.choices && !na && (
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {item.choices.map((c) => {
              const picked = state?.choice === c.value && done;
              return (
                <button
                  key={c.value}
                  className={`btn btn-sm ${picked ? "btn-primary" : "btn-secondary"}`}
                  disabled={busy}
                  onClick={() => act(picked ? { done: false } : { done: true, choice: c.value })}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
        {editingNote ? (
          <input
            className="form-input"
            style={{ marginTop: 6 }}
            placeholder="Note"
            value={note}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onBlur={() => {
              setEditingNote(false);
              if (note !== (state?.note ?? "")) act({ note });
            }}
          />
        ) : (
          state?.note && (
            <div className="text-sm" style={{ marginTop: 4 }}>
              📝 {state.note}
            </div>
          )
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button className="btn btn-sm btn-secondary" disabled={busy} onClick={editNote}>
          {state?.note ? "Edit note" : "Note"}
        </button>
        <button
          className="btn btn-sm btn-secondary"
          disabled={busy}
          title={na ? "This item applies after all" : "This item doesn't apply to this neighborhood"}
          onClick={() => act({ notApplicable: !na })}
        >
          {na ? "Applies" : "N/A"}
        </button>
      </div>
    </div>
  );
}
