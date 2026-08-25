/* Render an SVG to a PNG at a given size, using the browser that is already a
   dependency of the e2e suite. Tauri wants raster icons and the logos arrived
   as vectors; this is the one step between them.

   Usage: node render-icon.mjs <in.svg> <out.png> <size> [color]

   The optional colour is what `currentColor` resolves to. logo-mark.svg draws
   itself in `currentColor` so the client can tint it per skin, which leaves it
   black in a browser that was told nothing - and black on transparent is
   invisible on the surfaces that want it white. */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const [svgPath, outPath, sizeArg, colorArg] = process.argv.slice(2);
const size = Number(sizeArg || 256);
const svg = readFileSync(svgPath, "utf8");

/* The colour is interpolated into a stylesheet, so it is checked rather than
   trusted: a stray brace would silently produce a differently-styled icon
   instead of an error. */
if (colorArg && !/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(colorArg)) {
  throw new Error(`not a colour: ${colorArg}`);
}
const color = colorArg ? `html{color:${colorArg}}` : "";

async function launch() {
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* try the next one */
    }
  }
  return chromium.launch();
}

const browser = await launch();
const page = await browser.newPage({
  viewport: { width: size, height: size },
  deviceScaleFactor: 1,
});
// Transparent background: an app icon must not carry a white square with it.
await page.setContent(
  `<style>html,body{margin:0;padding:0;background:transparent}
   ${color}
   svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
);
await page.screenshot({ path: outPath, omitBackground: true });
await browser.close();
console.log(`${outPath} ${size}x${size}${colorArg ? ` ${colorArg}` : ""}`);
