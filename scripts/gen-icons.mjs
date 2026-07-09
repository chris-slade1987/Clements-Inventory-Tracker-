// Rasterizes public/icons/icon.svg into the PNG sizes the PWA manifest and
// iOS home-screen need. Run: node scripts/gen-icons.mjs
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "public", "icons");
mkdirSync(iconsDir, { recursive: true });

const svg = readFileSync(join(iconsDir, "icon.svg"));

// Maskable icon: same art scaled to 72% on a full-bleed brand background so it
// survives Android's circular / squircle mask crop.
const maskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
     <rect width="512" height="512" fill="#059669"/>
     <g transform="translate(72 72) scale(0.72)">${svg
       .toString()
       .replace(/^<\?xml.*?\?>/, "")
       .replace(/<svg[^>]*>/, "")
       .replace(/<\/svg>\s*$/, "")}</g>
   </svg>`
);

const targets = [
  { input: svg, size: 192, out: "icon-192.png" },
  { input: svg, size: 512, out: "icon-512.png" },
  { input: svg, size: 180, out: "apple-touch-icon.png" },
  { input: maskable, size: 512, out: "icon-maskable-512.png" },
];

for (const { input, size, out } of targets) {
  await sharp(input, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, out));
  console.log("wrote", out, `${size}x${size}`);
}
