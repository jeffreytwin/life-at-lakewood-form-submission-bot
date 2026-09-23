// A picture as Claude is handed it: fetched here and sent in the request,
// rather than as an address for Anthropic to fetch. Anthropic's fetcher
// keeps to a site's robots.txt, and Dream Finders' turns it away — "This
// URL is disallowed by the website's robots.txt file" — so a request that
// held one of its pictures failed whole, and "Sort the photos" placed none
// of them (2026-09-23).

import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { fetchImage } from "@/lib/floorplans/media";

/** The long side a picture is sent at: enough to tell rooms and near-copies apart, for a fraction of the tokens. */
const SENT_SIDE = 768;

export interface FetchedPicture {
  /** The picture as a JPEG no larger than SENT_SIDE, turned upright. */
  jpeg: Buffer;
  width: number;
  height: number;
}

/** One picture fetched and made small; null when it cannot be fetched or read as an image. */
export async function fetchPicture(url: string): Promise<FetchedPicture | null> {
  const fetched = await fetchImage(url);
  if (!fetched) return null;
  try {
    const { data, info } = await sharp(Buffer.from(fetched.data))
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(SENT_SIDE, SENT_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** Each picture fetched, a few at a time, in the order given. */
export async function fetchPictures(urls: string[], atOnce = 6): Promise<(FetchedPicture | null)[]> {
  const out: (FetchedPicture | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(atOnce, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        out[i] = await fetchPicture(urls[i]);
      }
    })
  );
  return out;
}

/** The picture for a request: its bytes where they were fetched here, else its address for Anthropic to try. */
export function imageBlock(url: string, picture: FetchedPicture | null): Anthropic.ImageBlockParam {
  return picture
    ? { type: "image", source: { type: "base64", media_type: "image/jpeg", data: picture.jpeg.toString("base64") } }
    : { type: "image", source: { type: "url", url } };
}
