// Small display helpers shared by the Listings pages.

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return fmtDateTime(iso);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function megabytes(bytes: number | null | undefined): string {
  return `${((bytes ?? 0) / 1e6).toFixed(1)} MB`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`;
}

export function levelBadge(level: string): string {
  if (level === "error") return "badge badge-danger";
  if (level === "warn") return "badge badge-warning";
  return "badge badge-muted";
}

export function writeModeBadge(mode: string): { cls: string; label: string } {
  if (mode === "live") return { cls: "badge badge-success", label: "Live" };
  if (mode === "paused") return { cls: "badge badge-muted", label: "Paused" };
  return { cls: "badge badge-info", label: "Shadow" };
}

/** Reads a JSON error body when the response is not ok, else null. */
export async function responseError(res: Response): Promise<string | null> {
  if (res.ok) return null;
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
