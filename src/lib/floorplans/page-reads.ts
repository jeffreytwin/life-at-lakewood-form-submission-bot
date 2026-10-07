// A builder page read once. Every night the sync read every plan's own
// page again and paid Claude to say what it says, though most pages say
// the same thing night after night (Jeff, 2026-09-29: the cost per run
// is high). What Claude last read off a page is kept here (fp_page_reads,
// migration 077) with a digest of the text the page distilled to: a page
// that distills to the same text is not read again, and the remembered
// facts stand in for the call. Everything a run reads off the page's own
// markup — its galleries, its drawings, its tour — is still read every
// night, so a new photo is still seen.
//
// What is remembered is keyed on the page's address and on a variant: the
// model that read it, the way it was asked (a list for its plans or its
// homes, a plan's page with or without its photos) and a version — the
// read version and the builder's own (readVersion). It used to be a
// digest of the prompt itself, so every word changed in it, even one
// meant for a single builder, read every builder's pages again: some
// $20–25 a sync, five times on 2026-10-06 (Jeff, 2026-10-07: a Sync that
// finds no changes should not cost $20). A fix for one builder now raises
// that builder's version and reads only its pages again; one that every
// page needs read again raises READ_VERSION. A test pins the prompt
// (claude-extract-prompts.test.ts), so a change to it cannot go out
// without someone choosing between the two.
// A read older than a month is made again whatever the digest says, as a
// safety valve. A table that cannot be read costs the memory, never the
// run, the way fp_photo_rooms does (photo-rooms.ts).

import { createHash } from "node:crypto";
import { supabase } from "@/lib/supabase/client";
import { logger } from "@/lib/shared/logger";

export type ReadKind = "plan" | "list";

/** A read this old is made again even where the page reads the same. */
export const REREAD_AFTER_DAYS = 30;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A picture or link marker as distill() writes it. */
const MARKER = /\[(IMG|LINK) ([^\]\s]+)\]/g;

/**
 * The text a page distilled to, as it is compared from one night to the
 * next: a query string or fragment on a picture's or a link's address is
 * dropped (a cache-buster or a tracking code is not the page changing),
 * and on a plan's own page the links go entirely — the facts read off it
 * do not use them, and a builder's menus carry hundreds. A list's links
 * stay: they are its plans' own pages. Whitespace is one space. Pure.
 */
export function normalizedText(kind: ReadKind, content: string): string {
  return content
    .replace(MARKER, (_, what: string, url: string) => {
      if (kind === "plan" && what === "LINK") return " ";
      return `[${what} ${url.replace(/[?#].*$/, "")}]`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** The digest a page's text is remembered by. Pure. */
export function digestOf(kind: ReadKind, content: string): string {
  return sha(normalizedText(kind, content));
}

/**
 * The version of every builder's reads. Raised, every page is read again
 * on the next run, at some $20–25 a sync: only for a change to how pages
 * are read that every builder's pages need.
 */
export const READ_VERSION = 1;

/**
 * The version of one builder's reads, by its name on fp_builders. Raised,
 * that builder's pages, and only theirs, are read again on the next run:
 * for a change to the prompt made for that builder ("David Weekley Homes":
 * 2 after a fix to how its sizes are read). A builder not named here is
 * at 0.
 */
export const BUILDER_READ_VERSIONS: Record<string, number> = {};

/** The version a builder's reads are kept under: the read version and the builder's own. Pure. */
export function readVersion(builder: string | null | undefined): string {
  return `${READ_VERSION}.${(builder && BUILDER_READ_VERSIONS[builder]) || 0}`;
}

/** The digest of how a page is read: the model, the way it is asked and the version (readVersion). Pure. */
export function variantOf(kind: ReadKind, parts: Record<string, unknown>): string {
  return sha(`${kind}\n${JSON.stringify(parts)}`);
}

export interface ReadRow {
  digest: string;
  variant: string;
  read_at: string;
}

/** Whether a remembered read still answers for a page: same text, same way of reading it, not too old. Pure. */
export function reusable(row: ReadRow | null | undefined, digest: string, variant: string, now = Date.now()): boolean {
  if (!row || row.digest !== digest || row.variant !== variant) return false;
  const at = Date.parse(row.read_at);
  return Number.isFinite(at) && now - at < REREAD_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

export interface RememberedRead<T> {
  facts: T;
  model: string;
  readAt: string;
}

/** What was read off this page before, where it still answers for the page (reusable); null otherwise. */
export async function rememberedRead<T>(url: string, kind: ReadKind, digest: string, variant: string): Promise<RememberedRead<T> | null> {
  try {
    const { data, error } = await supabase
      .from("fp_page_reads")
      .select("digest, variant, facts, model, read_at, hits")
      .eq("url", url)
      .eq("kind", kind)
      .eq("variant", variant)
      .maybeSingle();
    if (error) {
      logger.warn("Remembered page read could not be looked up", { url, error: error.message });
      return null;
    }
    if (!reusable(data, digest, variant)) return null;
    // Best effort, and not waited for: the count is for curiosity.
    void supabase
      .from("fp_page_reads")
      .update({ hits: (data!.hits ?? 0) + 1 })
      .eq("url", url)
      .eq("kind", kind)
      .eq("variant", variant)
      .then(() => undefined, () => undefined);
    return { facts: data!.facts as T, model: data!.model, readAt: data!.read_at };
  } catch (error) {
    logger.warn("Remembered page read could not be looked up", { url, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Where two readings of a page differ (changeBetween). */
export interface TextChange {
  /** Where the texts part, in characters from the start. */
  at: number;
  was: number;
  now: number;
  /** The changed stretch of the earlier text, with some words either side. */
  before: string;
  /** The same stretch of the later text. */
  after: string;
}

/** Words kept either side of the changed stretch, and the most of it kept. */
const CONTEXT = 80;
const SNIPPET = 400;

/**
 * Where two readings of a page differ: the stretch that changed, from
 * each, with some words either side; null when they read the same. Kept
 * with the read (fp_page_reads.last_change, migration 078) so a page that
 * is read again night after night says what keeps changing on it — a
 * feed, a counter, a random number — without anyone fetching it by hand
 * (2026-09-30: Medallion's pages, which will not answer a fetch from
 * outside). Pure.
 */
export function changeBetween(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const most = Math.min(before.length, after.length);
  let at = 0;
  while (at < most && before[at] === after[at]) at++;
  let tail = 0;
  while (tail < most - at && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const stretch = (text: string) => {
    const piece = text.slice(Math.max(0, at - CONTEXT), Math.min(text.length, text.length - tail + CONTEXT));
    return piece.length > SNIPPET ? `${piece.slice(0, SNIPPET / 2)} … ${piece.slice(-SNIPPET / 2)}` : piece;
  };
  return { at, was: before.length, now: after.length, before: stretch(before), after: stretch(after) };
}

/**
 * Keeps what Claude read off a page, for the next run to reuse while the
 * page reads the same. Given the page's content, keeps the text it was
 * digested from too, and where an earlier text was kept, what changed
 * between the two (changeBetween).
 */
export async function rememberRead(url: string, kind: ReadKind, digest: string, variant: string, facts: unknown, model: string, content?: string): Promise<void> {
  try {
    const read_at = new Date().toISOString();
    const row: Record<string, unknown> = { url, kind, digest, variant, facts, model, read_at, hits: 0 };
    if (typeof content === "string") {
      const text = normalizedText(kind, content);
      row.text = text;
      const { data } = await supabase.from("fp_page_reads").select("text").eq("url", url).eq("kind", kind).eq("variant", variant).maybeSingle();
      const previous = (data as { text?: unknown } | null)?.text;
      const change = typeof previous === "string" ? changeBetween(previous, text) : null;
      if (change) {
        row.last_change = { when: read_at, ...change };
        logger.info("Page read again: its text changed", { url, kind, ...change });
      }
    }
    const { error } = await supabase.from("fp_page_reads").upsert(row, { onConflict: "url,kind,variant" });
    if (error) logger.warn("Page read could not be remembered", { url, error: error.message });
  } catch (error) {
    logger.warn("Page read could not be remembered", { url, error: error instanceof Error ? error.message : String(error) });
  }
}

/** How many addresses go into one request; a URL has a length. */
const FORGET_BATCH = 50;

/** Forgets the reads of these pages, so the next run reads them from the builder's site again (Reset, connection-clear.ts). */
export async function forgetReads(urls: (string | null | undefined)[]): Promise<number> {
  const wanted = [...new Set(urls.filter((u): u is string => typeof u === "string" && u.length > 0))];
  let forgotten = 0;
  for (let i = 0; i < wanted.length; i += FORGET_BATCH) {
    const batch = wanted.slice(i, i + FORGET_BATCH);
    const { data, error } = await supabase.from("fp_page_reads").delete().in("url", batch).select("url");
    if (error) {
      logger.warn("Page reads could not be forgotten", { count: batch.length, error: error.message });
      continue;
    }
    forgotten += data?.length ?? 0;
  }
  return forgotten;
}
