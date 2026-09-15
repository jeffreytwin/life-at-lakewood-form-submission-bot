"use client";

/** A run's warning and error counts as coloured tags; a dash when it had neither. */
export default function RunTags({ warnings, errors }: { warnings: number; errors: number }) {
  if (!warnings && !errors) return <span className="text-muted">—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {warnings > 0 && (
        <span className="badge badge-warning" style={{ textTransform: "none" }}>
          {warnings} warning{warnings === 1 ? "" : "s"}
        </span>
      )}
      {errors > 0 && (
        <span className="badge badge-danger" style={{ textTransform: "none" }}>
          {errors} error{errors === 1 ? "" : "s"}
        </span>
      )}
    </span>
  );
}
