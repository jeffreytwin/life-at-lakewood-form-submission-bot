import sharp from "sharp";

/** Max dimension (px) for the thumbnail served in list views. */
export const THUMB_MAX_DIMENSION = 128;

/** JPEG quality for thumbnails — small files, still crisp at 2x on a 36px
 * circle. */
export const THUMB_QUALITY = 78;

/**
 * Resize an image buffer to a square-ish thumbnail. Preserves aspect ratio
 * (no upscaling beyond the original), strips EXIF, and re-encodes as JPEG.
 *
 * Returns the thumbnail buffer.
 */
export async function resizeToThumbnail(input: Buffer): Promise<Buffer> {
  return await sharp(input)
    .rotate() // honor EXIF orientation before stripping metadata
    .resize({
      width: THUMB_MAX_DIMENSION,
      height: THUMB_MAX_DIMENSION,
      fit: "cover",
      position: "attention", // smart crop toward faces / focal points
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer();
}
