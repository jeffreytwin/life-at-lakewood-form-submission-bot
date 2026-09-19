// Pure rules for comparing and aligning the Floor Plans V2 collection's
// fields across sites, so every site carries the same schema (Jeff,
// 2026-09-19: Wellen Park and Parrish are the standard; Lakewood follows).
// Wix system fields (_id, _owner, the dates, publish status) belong to Wix
// and are never compared or sent back changed. No IO here, so the rules
// can be tested on their own; the Hub's Settings → Sites page and its align
// route do the fetching and the PUT.

export interface FieldSpec {
  key: string;
  type?: string;
  displayName?: string;
  typeMetadata?: unknown;
  systemField?: boolean;
  [extra: string]: unknown;
}

export interface FieldMismatch {
  key: string;
  reference: string;
  target: string;
}

export interface FieldRelabel {
  key: string;
  from: string;
  to: string;
}

export interface SchemaDiff {
  /** In the reference, not in the target: what alignment adds. */
  missing: FieldSpec[];
  /** In the target only: kept unless their removal is asked for. */
  extra: FieldSpec[];
  /** Same key, different type. Wix cannot change a field's type in place, so these are reported, never touched. */
  mismatched: FieldMismatch[];
  /** Same key and type, different label: alignment takes the reference's label. */
  relabeled: FieldRelabel[];
  /** Keys present in both with the same type. */
  shared: number;
}

export const isSystemField = (f: FieldSpec): boolean => f.systemField === true || f.key.startsWith("_");

/** "TEXT", "REFERENCE→Builders": the type with what it points at, which is what has to match. */
export function describeFieldType(f: FieldSpec): string {
  const meta = f.typeMetadata as { reference?: { referencedCollectionId?: string } } | undefined;
  const ref = meta?.reference?.referencedCollectionId;
  return ref ? `${f.type ?? "?"}→${ref}` : (f.type ?? "?");
}

export function diffFields(reference: FieldSpec[], target: FieldSpec[]): SchemaDiff {
  const ref = reference.filter((f) => !isSystemField(f));
  const tgt = target.filter((f) => !isSystemField(f));
  const tgtByKey = new Map(tgt.map((f) => [f.key, f] as const));
  const refKeys = new Set(ref.map((f) => f.key));
  const diff: SchemaDiff = {
    missing: [],
    extra: tgt.filter((f) => !refKeys.has(f.key)),
    mismatched: [],
    relabeled: [],
    shared: 0,
  };
  for (const r of ref) {
    const t = tgtByKey.get(r.key);
    if (!t) {
      diff.missing.push(r);
      continue;
    }
    if (describeFieldType(r) !== describeFieldType(t)) {
      diff.mismatched.push({ key: r.key, reference: describeFieldType(r), target: describeFieldType(t) });
      continue;
    }
    diff.shared += 1;
    const from = t.displayName ?? "";
    const to = r.displayName ?? "";
    if (to && from !== to) diff.relabeled.push({ key: r.key, from, to });
  }
  return diff;
}

/** What a new field is created from: the reference's key, label, type and what it points at; nothing Wix sets itself. */
function fieldToAdd(f: FieldSpec): FieldSpec {
  return {
    key: f.key,
    ...(f.displayName ? { displayName: f.displayName } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.typeMetadata !== undefined ? { typeMetadata: f.typeMetadata } : {}),
  };
}

export interface Alignment {
  /** The target's full field list to send back: its own fields (relabeled where needed), the reference's missing ones appended. */
  fields: FieldSpec[];
  added: string[];
  removed: string[];
  relabeled: string[];
}

/**
 * The field list that makes the target match the reference. Adding is the
 * default; removing a field deletes its data on every item, so extras go
 * only when asked. A field whose type differs is left alone either way.
 */
export function alignedFields(
  reference: FieldSpec[],
  target: FieldSpec[],
  { removeExtra = false }: { removeExtra?: boolean } = {}
): Alignment {
  const diff = diffFields(reference, target);
  const removeKeys = new Set(removeExtra ? diff.extra.map((f) => f.key) : []);
  const relabel = new Map(diff.relabeled.map((r) => [r.key, r.to] as const));
  const fields = target
    .filter((f) => !removeKeys.has(f.key))
    .map((f) => (relabel.has(f.key) ? { ...f, displayName: relabel.get(f.key) } : f));
  for (const f of diff.missing) fields.push(fieldToAdd(f));
  return { fields, added: diff.missing.map((f) => f.key), removed: [...removeKeys], relabeled: [...relabel.keys()] };
}
