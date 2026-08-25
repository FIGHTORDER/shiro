#!/usr/bin/env node
/**
 * The two images Shiro's loading screen draws, built from art the client
 * already ships.
 *
 *   node tools/gen-loadscreen-art.mjs          # rebuild both
 *   node tools/gen-loadscreen-art.mjs --check  # fail if they have drifted
 *
 * Both are white on transparent, because the load screen tints them with
 * `gl.Color` rather than shipping one file per state - the plate at 13%, the
 * mark at 100%. They are committed rather than built during the Rust
 * compile: `loadscreen.rs` reaches them with `include_bytes!`, so they have to
 * exist before cargo runs, and the release workflow builds the binary on a
 * runner that has no reason to own a browser.
 *
 * The mark is `logo-mark.svg`, which draws in `currentColor` and so comes out
 * black unless told otherwise. Rasterising it needs a browser, which is why it
 * goes through tools/render-icon.mjs - the same path the app icons take.
 *
 * The plate is `glaive-sidelit.png`, drawn dark for a light client. It is an
 * *indexed* PNG - 64 palette entries and a tRNS alpha table - so inverting it
 * is 192 bytes of palette rather than 1.1 megapixels of image. That is why
 * there is no decoder in here: the pixel data is never touched, the alpha
 * table is never touched, and the result is provably the same image with every
 * colour inverted. Round-tripping it through a canvas would have re-encoded
 * every pixel to arrive at exactly this.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RENDER_ICON = join(ROOT, "tools", "render-icon.mjs");

const SOURCE_PLATE = join(ROOT, "src", "assets", "art", "glaive-sidelit.png");
const SOURCE_MARK = join(ROOT, "src", "assets", "logo-mark.svg");

/* Beside main.lua, because these three files ship together or not at all: the
   addon draws two textures it did not put there. */
const OUT = join(ROOT, "src-tauri", "src", "loadscreen");
const PLATE = join(OUT, "shiro-glaive-plate.png");
const MARK = join(OUT, "shiro-mark.png");
const MARK_SIZE = 256;

const SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Every chunk in a PNG, as {type, at, length} - `at` is the length field. */
function* chunks(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    yield { type: png.toString("latin1", at + 4, at + 8), at, length };
    at += 12 + length;
  }
}

const body = (png, chunk) => png.subarray(chunk.at + 8, chunk.at + 8 + chunk.length);

function find(png, type) {
  for (const chunk of chunks(png)) if (chunk.type === type) return chunk;
  return null;
}

/** The same image with every palette colour inverted and every alpha kept. */
function inverted(png) {
  const ihdr = find(png, "IHDR");
  const plte = find(png, "PLTE");
  // Byte 9 of IHDR is the colour type; 3 is "indexed", which is the whole
  // reason this can be done without decoding anything.
  if (!ihdr || !plte || body(png, ihdr)[9] !== 3) {
    throw new Error(
      "glaive-sidelit.png is no longer an indexed PNG, so inverting its palette is "
      + "no longer the same as inverting the image. This needs a real decoder now.",
    );
  }
  const out = Buffer.from(png);
  const first = plte.at + 8;
  const last = first + plte.length;
  for (let i = first; i < last; i++) out[i] = 255 - out[i];
  // The CRC covers the type field as well as the data, and a wrong one makes
  // the file unreadable rather than merely wrong.
  out.writeUInt32BE(crc32(out.subarray(plte.at + 4, last)), last);
  return out;
}

/** Mean luminance of the palette, weighted by how opaque each entry is. */
function brightness(png) {
  const plte = body(png, find(png, "PLTE"));
  const trnsChunk = find(png, "tRNS");
  const trns = trnsChunk ? body(png, trnsChunk) : null;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < plte.length / 3; i++) {
    const alpha = trns && i < trns.length ? trns[i] : 255;
    sum += (0.2126 * plte[i * 3] + 0.7152 * plte[i * 3 + 1] + 0.0722 * plte[i * 3 + 2]) * alpha;
    weight += alpha;
  }
  return weight ? sum / weight : 0;
}

function size(png) {
  const ihdr = body(png, find(png, "IHDR"));
  return { width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4) };
}

const read = path => (existsSync(path) ? readFileSync(path) : null);

if (process.argv.includes("--check")) {
  const failures = [];

  const want = inverted(readFileSync(SOURCE_PLATE));
  const have = read(PLATE);
  if (!have || !have.equals(want)) {
    failures.push(`${PLATE} does not match an inversion of ${SOURCE_PLATE}`);
  }

  /* The mark cannot be re-rendered here - that needs a browser, and this check
     runs in `npm test` on machines and runners that have no reason to have
     one. So it is checked for being the right picture at the right size, which
     catches the failures that actually happen: a missing file, a truncated
     one, or a size the addon's square no longer matches. */
  const mark = read(MARK);
  if (!mark) {
    failures.push(`${MARK} is missing`);
  } else {
    const { width, height } = size(mark);
    if (width !== MARK_SIZE || height !== MARK_SIZE) {
      failures.push(`${MARK} is ${width}x${height}, not ${MARK_SIZE}x${MARK_SIZE}`);
    }
  }

  if (failures.length) {
    for (const line of failures) console.error(line);
    console.error("\nrun: node tools/gen-loadscreen-art.mjs");
    process.exit(1);
  }
  console.log(`load screen art up to date (plate byte-for-byte, mark ${MARK_SIZE}x${MARK_SIZE})`);
} else {
  mkdirSync(OUT, { recursive: true });

  const source = readFileSync(SOURCE_PLATE);
  const plate = inverted(source);
  writeFileSync(PLATE, plate);
  const { width, height } = size(plate);
  console.log(
    `${PLATE} ${width}x${height} - palette ${brightness(source).toFixed(1)} -> `
    + `${brightness(plate).toFixed(1)} of 255`,
  );

  const rendered = spawnSync(
    process.execPath,
    [RENDER_ICON, SOURCE_MARK, MARK, String(MARK_SIZE), "#ffffff"],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (rendered.status !== 0) {
    console.error("could not render the mark - render-icon.mjs needs a browser it can launch");
    process.exit(1);
  }
}
