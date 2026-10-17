"use client";

import { useCallback, useEffect, useState } from "react";
import CommunityAlertTabs from "./tabs";
import type { AlertView } from "@/lib/community-alerts/alerts";
import type { SoldOutDetail } from "@/lib/community-alerts/sold-out";

type Item = AlertView["items"][number];

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

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

/**
 * Community Alerts (Jeff, 2026-10-17): a neighborhood whose new-build
 * inventory reached zero, and the website work that calls for, as a
 * to-do list. An alert closes when its list is finished or when it is
 * dismissed with a reason; nothing clears it on its own.
 */
export default function CommunityAlertsPage() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/internal/community-alerts?scope=open")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.alerts)) {
          setAlerts(data.alerts.filter((a: AlertView) => a.kind === "sold_out"));
          setError(null);
        } else setError(data?.error ?? "Failed to load");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function checkNow() {
    setChecking(true);
    setCheckNote(null);
    try {
      const res = await fetch("/api/internal/community-alerts/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setCheckNote(data?.error ?? `HTTP ${res.status}`);
      else
        setCheckNote(
          `Checked ${data.communities} communities. ` +
            (data.raised?.length ? `Sold out: ${data.raised.join(", ")}.` : "Nothing new sold out.") +
            (data.seeded ? ` ${data.seeded} seen for the first time (remembered, no alerts).` : "")
        );
    } catch (e) {
      setCheckNote(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
      load();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Community Alerts</h2>
          <p className="text-muted">
            When a neighborhood&apos;s new-build inventory reaches zero, an alert appears here with the website work a
            sell-out calls for. Check items off as they&apos;re done; the alert closes when every item is done or marked
            N/A, or when you dismiss it with a reason. Checked twice an hour.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={checkNow} disabled={checking}>
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
      <CommunityAlertTabs />
      {checkNote && (
        <div className="card text-sm" style={{ marginBottom: 12 }}>
          {checkNote}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state">No neighborhood has sold out. Finished and dismissed alerts are under History.</div>
      ) : (
        alerts.map((a) => <AlertCard key={a.id} alert={a} onChange={load} />)
      )}
    </div>
  );
}

function AlertCard({ alert, onChange }: { alert: AlertView; onChange: () => void }) {
  const detail = alert.detail as unknown as SoldOutDetail;
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setProblem(null);
    const failed = await patch(alert.id, body);
    if (failed) setProblem(failed);
    setBusy(false);
    onChange();
  }

  const { settled, total } = alert.progress;
  const pages = detail.pages;

  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--warning)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{alert.name}</strong>
        <span className="badge badge-warning">sold out</span>
        <span className="text-muted text-sm">
          {detail.site} · raised {when(alert.createdAt)}
        </span>
        <span className="fp-progress" title={`${settled} of ${total} done or N/A`}>
          {settled} of {total} done
          <span className="fp-progress-track">
            <span className="fp-progress-fill" style={{ width: `${total ? Math.round((settled / total) * 100) : 0}%` }} />
          </span>
        </span>
      </div>

      {detail.inventoryBack && (
        <div className="text-sm" style={{ marginTop: 8, color: "var(--warning)" }}>
          ⚠ Homes are listed again ({detail.livePlans} on the site). If this was a false alarm, dismiss the alert.
        </div>
      )}

      <div className="text-sm" style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {pages?.neighborhood && (
          <a href={pages.neighborhood} target="_blank" rel="noreferrer">
            Neighborhood page ↗
          </a>
        )}
        {pages?.homesForSale ? (
          <a href={pages.homesForSale} target="_blank" rel="noreferrer">
            Homes-for-sale page ↗
          </a>
        ) : (
          pages && <span className="text-muted">Homes-for-sale page: not found automatically</span>
        )}
        {(detail.builders ?? []).map((b, i) =>
          b.url ? (
            <a key={i} href={b.url} target="_blank" rel="noreferrer">
              {b.name}&apos;s page ↗
            </a>
          ) : null
        )}
      </div>
      {pages === null && (
        <div className="text-muted text-sm" style={{ marginTop: 4 }}>
          No listings neighborhood on {detail.site} matches &ldquo;{alert.name}&rdquo;, so its pages could not be linked.
          Listings → Neighborhoods is where it would be added.
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {alert.items.map((item) => (
          <ItemRow key={item.key} item={item} busy={busy} act={(body) => act({ item: item.key, ...body })} />
        ))}
      </div>

      {problem && (
        <div className="text-sm" style={{ marginTop: 8, color: "var(--danger)" }}>
          {problem}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {dismissing ? (
          <>
            <input
              className="form-input"
              style={{ flex: 1, minWidth: 220 }}
              placeholder="Why? (e.g. false alarm: the builder's page changed)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
            <button className="btn btn-sm btn-danger" disabled={busy || !reason.trim()} onClick={() => act({ dismiss: reason })}>
              Dismiss
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => setDismissing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn-sm btn-secondary" onClick={() => setDismissing(true)}>
            Dismiss…
          </button>
        )}
      </div>
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
