// The Floor Plans queue as its list shows it (Jeff, 2026-09-26). Pure.

/**
 * A row as the list shows it. The builder's own picture sets, what was
 * said about each photo and the run's notes are most of a queued record —
 * two of the queue's three megabytes, sent again every few seconds while
 * approvals run (Jeff, 2026-09-26) — and only the edit overlay reads them,
 * which asks for its one plan whole (changes/[id]). The first photo keeps
 * its caption, for the table's preview.
 */
export function forTheList<T extends { proposed_record?: unknown }>(row: T): T {
  const rec = row.proposed_record as Record<string, unknown> | null | undefined;
  if (!rec || typeof rec !== "object") return row;
  const { scrapedGalleryImages: _a, scrapedBlueprintImages: _b, raw: _c, galleryMeta, ...kept } = rec;
  void _a;
  void _b;
  void _c;
  const first = Array.isArray(kept.galleryImages) ? (kept.galleryImages[0] as string | undefined) : undefined;
  const meta = galleryMeta as Record<string, unknown> | undefined;
  return { ...row, proposed_record: { ...kept, ...(first && meta?.[first] ? { galleryMeta: { [first]: meta[first] } } : {}) } };
}
