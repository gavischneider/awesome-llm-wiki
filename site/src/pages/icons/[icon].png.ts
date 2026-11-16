/**
 * Generates favicon and app-icon PNGs from the square brand logo at build
 * time, so only the original artwork is kept in the repository.
 */
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const SIZES = [32, 180, 192, 512];
const LOGO_PATH = new URL('src/assets/brand/logo-square.png', `file://${process.cwd()}/`);

/**
 * Lists the icon files to generate.
 * @returns One route per icon size, e.g. /icons/icon-192.png.
 */
export function getStaticPaths() {
  return SIZES.map((size) => ({ params: { icon: `icon-${size}` }, props: { size } }));
}

/**
 * Resizes the logo to the requested square size.
 * @returns PNG image response.
 */
export const GET: APIRoute = async ({ props }) => {
  const png = await sharp(await readFile(LOGO_PATH))
    .resize(props.size, props.size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
