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
// What is remembered is keyed on the page's address and on a variant: a
// digest of the prompt, the tool and the model that read it, so a change
// to any of them reads every page afresh on its own, with no version to
// bump. A list read for its homes and the same page read for its plans
// are two variants of one address, kept apart.
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

/** The digest of how a page is read: the model, the tool and the prompt around the page. Pure. */
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

/** Keeps what Claude read off a page, for the next run to reuse while the page reads the same. */
export async function rememberRead(url: string, kind: ReadKind, digest: string, variant: string, facts: unknown, model: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("fp_page_reads")
      .upsert({ url, kind, digest, variant, facts, model, read_at: new Date().toISOString(), hits: 0 }, { onConflict: "url,kind,variant" });
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
