const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  routing: "Routing",
  accepted: "Accepted",
  owned_by_other: "Owned by Other",
  failed: "Failed",
  manual: "Manual",
};

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}
