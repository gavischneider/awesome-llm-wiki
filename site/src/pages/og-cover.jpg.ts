/**
 * Generates the 1200x630 Open Graph / social preview image from the supplied
 * "Awesome LLM Wiki" cover artwork at build time.
 */
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const COVER_PATH = new URL('src/assets/brand/cover.png', `file://${process.cwd()}/`);

/**
 * Crops the 16:9 cover to the 1.91:1 ratio social networks expect. The crop is
 * centred, which keeps both the brain mark and the title fully in frame.
 * @returns JPEG image response.
 */
export const GET: APIRoute = async () => {
  const jpeg = await sharp(await readFile(COVER_PATH))
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg' } });
};
