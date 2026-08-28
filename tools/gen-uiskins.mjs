/**
 * Builds the Chili skins that make Zero-K's in-game interface match Shiro's.
 *
 *   node tools/gen-uiskins.mjs            # write every skin
 *   node tools/gen-uiskins.mjs slate      # just one
 *   node tools/gen-uiskins.mjs --check    # fail if anything on disk is stale
 *   node tools/gen-uiskins.mjs --pack     # zip each skin for release, with hashes
 *
 * Everything is derived from src/styles/tokens/. Nothing is transcribed, so a
 * palette change in the lobby reaches the game by re-running this.
 *
 * Three things here are not obvious, and each cost a broken build to learn.
 *
 * 1. CHILI HAS TWO MODELS, AND THE CLASS DECIDES WHICH.
 *    Evolved's button carries a real colour and a textured shape; its panel
 *    carries a picture and a near-white tint. That is not inconsistency: a
 *    Zero-K widget may set `backgroundColor = {1,1,1,1}` on a control and rely
 *    on the skin's texture to be the whole appearance - epicmenu's own bar does
 *    exactly that. Chili's merge only fills gaps, so the skin cannot take that
 *    white back. Any class a widget forces white has to be image led, with the
 *    colour baked into the tile. Getting this backwards paints solid white
 *    blocks over the interface.
 *
 * 2. EVERY CLASSNAME EVOLVED DEFINES HAS TO BE DEFINED HERE.
 *    A class this skin omits falls through to `default`, whose inline draw
 *    functions print a caption without checking `noFont` and take the whole
 *    draw down with them. That is what broke the Esc menu: one undefined class
 *    behind epicmenu's Vote Resign entry.
 *
 * 3. OUR OWN TILES NEED A FULL, FORWARD-SLASH PATH.
 *    Chili resolves a bare filename with TranslateFilePaths, which joins it to
 *    the directory VFS.SubDirs reported. For a skin inside the game archive
 *    that is `LuaUI/Widgets/.../evolved/x.png`; for one installed as loose
 *    files it is the native path, with BACKSLASHES, which the texture loader
 *    cannot open. The string is non-nil so nothing errors and nothing paints -
 *    an entire skin of invisible surfaces. Naming the full path here means
 *    TranslateFilePaths finds no match and leaves it alone.
 *
 *    The option prefix is `:c:` (clamp), the same one Evolved uses. `:cn:`
 *    would add nearest filtering, which is what a 3px tile stretched across a
 *    control actually wants, and the engine refuses it: gl.TextureInfo reports
 *    -1x-1 and the texture never loads. Failure is silent, because chili draws
 *    a transparent placeholder while it waits for a load that never lands.
 *
 * 4. A NIL TileImage IS A CRASH, NOT A BLANK.
 *    TextureHandler reaches `filename:byte(1)`, so every image field a draw
 *    function reads must name something. `:cl:empty.png` is the way to say
 *    "nothing here" - it ships with the default skin and is what Evolved uses.
 */
import { deflateSync } from "node:zlib";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = join(ROOT, "src", "styles", "tokens");
const OUT = join(ROOT, "src-tauri", "src", "uiskins");

// ------------------------------------------------------------- palette ----

/**
 * Every skin we build, and the CSS selector its tokens live behind.
 *
 * The dark three only. Paper and Vellum generate correctly and are legible
 * where the skin is in charge, but Zero-K's interface is written for a dark
 * one: a large share of its controls set their own font and their own light
 * text colour, and a skin cannot take those back. On a light ground that is
 * white text on near-white panels - the unit tooltip and the tutorial box
 * among them. Shipping a skin with unreadable copy in it is worse than not
 * shipping it, so the light pair waits for Zero-K to stop hardcoding.
 */
const SKINS = [
  { id: "graphite", name: "ShiroGraphite", label: "Shiro Graphite", sel: '[data-skin="graphite"]' },
  { id: "slate", name: "ShiroSlate", label: "Shiro Slate", sel: '[data-skin="slate"]' },
  { id: "azure", name: "ShiroAzure", label: "Shiro Azure", sel: '[data-skin="azure"]' },
];

function blockOf(text, selector) {
  const re = new RegExp(`${selector.replace(/[[\]"=]/g, ch => "\\" + ch)}\\s*\\{([^}]*)\\}`, "s");
  const m = re.exec(text);
  return m ? m[1] : null;
}

function declarations(body) {
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const colorsCss = readFileSync(join(TOKENS, "colors.css"), "utf8");
const skinsCss = readFileSync(join(TOKENS, "skins.css"), "utf8");

/* Paper is the base set in colors.css rather than a [data-skin] block, so the
   root declarations are both its palette and the fallback for every other. */
const root = {};
for (const m of colorsCss.matchAll(/:root\s*\{([^}]*)\}/gs)) Object.assign(root, declarations(m[1]));

function paletteFor(skin) {
  const table = { ...root };
  if (skin.sel) Object.assign(table, declarations(blockOf(skinsCss, skin.sel) || ""));
  const seen = new Set();
  const resolve = (value, depth = 0) => {
    let v = String(value).trim();
    while (depth++ < 8) {
      const m = /^var\((--[\w-]+)\)$/.exec(v);
      if (!m) break;
      v = String(table[m[1]] ?? root[m[1]] ?? "").trim();
    }
    return v;
  };
  return new Proxy({}, {
    get: (_, key) => {
      const raw = table[key];
      if (raw === undefined) throw new Error(`${skin.name}: no token ${String(key)}`);
      seen.add(key);
      return resolve(raw);
    },
  });
}

/** A CSS colour as [r, g, b, a] with r/g/b in 0..255. */
function parseColor(css) {
  const s = String(css).trim();
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(s);
  if (fn) return [+fn[1], +fn[2], +fn[3], fn[4] === undefined ? 1 : +fn[4]];
  const hex = s.replace("#", "");
  if (hex.length === 6) {
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  if (hex.length === 3) {
    return [...hex].map(ch => parseInt(ch + ch, 16)).concat(1);
  }
  throw new Error(`cannot read colour ${css}`);
}

/** Chili wants 0..1 RGBA. Trailing zeroes trimmed so the file reads cleanly. */
function lua(rgba) {
  const n = v => String(Math.round(v * 1000) / 1000);
  return `{${n(rgba[0] / 255)}, ${n(rgba[1] / 255)}, ${n(rgba[2] / 255)}, ${n(rgba[3])}}`;
}

/**
 * A translucent token flattened onto the surface it belongs to.
 *
 * Shiro's hover and active tokens are overlays meant to sit on top of a
 * surface. Chili does not layer them: DrawButton REPLACES the fill with
 * focusColor, so a 5.5% white would make a hovered control transparent rather
 * than lighter.
 */
function over(fg, bg) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  return [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
}

// ---------------------------------------------------------------- pngs ----

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A 3x3 RGBA png from a 3x3 grid of colours (null being transparent).
 *
 * 3x3 rather than 1x1 because DrawButton reads `unpack4(obj.tiles)` once and
 * slices both layers by it. At tiles = {1,1,1,1} the corners draw unscaled,
 * each edge stretches along its own axis, and the centre texel covers the rest,
 * which is a hairline frame at any control size.
 */
/** A W x H RGBA canvas. Straight alpha, not premultiplied. */
function canvas(w, h) {
  return { w, h, px: new Float64Array(w * h * 4) };
}

/** Source-over one pixel. `coverage` is how the callers antialias. */
function blend(c, x, y, rgba, coverage = 1) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const a = rgba[3] * coverage;
  if (a <= 0) return;
  const i = (y * c.w + x) * 4;
  const dst = c.px[i + 3];
  const out = a + dst * (1 - a);
  for (let k = 0; k < 3; k++) {
    c.px[i + k] = (rgba[k] * a + c.px[i + k] * dst * (1 - a)) / (out || 1);
  }
  c.px[i + 3] = out;
}

/**
 * How much of the pixel at (x, y) falls inside a rounded rectangle.
 *
 * Sampled on a 4x4 grid rather than solved: these are 16px tiles generated
 * once, and a visibly stepped corner is the whole reason for doing this.
 */
function coverRounded(x, y, x0, y0, x1, y1, r) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      if (px < x0 || py < y0 || px > x1 || py > y1) continue;
      const cx = px < x0 + r ? x0 + r : (px > x1 - r ? x1 - r : px);
      const cy = py < y0 + r ? y0 + r : (py > y1 - r ? y1 - r : py);
      if (cx === px && cy === py) { hits++; continue; }
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r) hits++;
    }
  }
  return hits / 16;
}

/** Fill a rounded rect, optionally shading `top` to `bottom` down the tile. */
function fillRounded(c, x0, y0, x1, y1, r, top, bottom) {
  for (let y = 0; y < c.h; y++) {
    /* The shade runs over the tile's own height. With 9-slice the centre row
       stretches, so a gradient only survives in a band that is not the centre,
       which is why the sheen treatment gives its top band real height. */
    const t = bottom ? Math.min(1, Math.max(0, (y - y0) / Math.max(1, y1 - y0))) : 0;
    const col = bottom ? [0, 1, 2, 3].map(k => top[k] + (bottom[k] - top[k]) * t) : top;
    for (let x = 0; x < c.w; x++) {
      const cov = coverRounded(x, y, x0, y0, x1, y1, r);
      if (cov > 0) blend(c, x, y, col, cov);
    }
  }
}

/** Stroke a rounded rect: the area between the shape and the shape inset. */
function strokeRounded(c, x0, y0, x1, y1, r, width, rgba) {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const outer = coverRounded(x, y, x0, y0, x1, y1, r);
      const inner = coverRounded(x, y, x0 + width, y0 + width, x1 - width, y1 - width,
        Math.max(0, r - width));
      const cov = outer - inner;
      if (cov > 0.002) blend(c, x, y, rgba, cov);
    }
  }
}

function png(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(c.h * (1 + c.w * 4));
  let p = 0;
  const b = v => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < c.h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < c.w; x++) {
      const i = (y * c.w + x) * 4;
      raw[p++] = b(c.px[i]);
      raw[p++] = b(c.px[i + 1]);
      raw[p++] = b(c.px[i + 2]);
      raw[p++] = b(c.px[i + 3] * 255);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const WHITE = [255, 255, 255, 1];

/* A debugging palette. Every surface a class paints gets its own loud colour,
   so one screenshot says which classes draw and which are missing, instead of
   another round of reasoning about which control is which. */
const DEBUG = process.argv.includes("--debug");
const LOUD = {
  "panel_bk.png":    [255,   0, 255, 1],
  "window_bk.png":   [255, 200,   0, 1],
  "sunken_bk.png":   [  0, 200, 255, 1],
  "selected_bk.png": [  0, 255,  80, 1],
};

/**
 * The treatments, which is the whole design question.
 *
 * 9-slice sets the limits: corners draw unscaled, edges stretch along one axis,
 * the centre texel stretches both ways. A corner radius and an edge detail are
 * therefore free, while anything that varies down a panel's height has to live
 * in a band tall enough not to be the centre.
 */
const TREATMENTS = {
  /* Square, opaque, one hairline. What the first build shipped. */
  flat: { size: 3, slice: 1, radius: 0, alpha: 1, sheen: 0, inner: 0 },
  /* A 4px radius and a little translucency, so the battlefield reads faintly
     through a panel instead of it sitting on top like a sticker. */
  soft: { size: 16, slice: 6, radius: 4, alpha: 0.93, sheen: 0, inner: 0 },
  /* The same, with a light band down the first 34px. Below that the centre
     texel takes over, so a tall panel shades at the top and is flat after. */
  sheen: { size: 16, height: 72, slice: 6, sliceTop: 34, radius: 4, alpha: 0.93,
    sheen: 0.06, inner: 0 },
  /* Architectural: nearly square, opaque, an outer rule at full strength and an
     inner one at a fifth, which reads as thickness rather than as two lines. */
  inset: { size: 16, slice: 6, radius: 2, alpha: 1, sheen: 0, inner: 0.22 },
};

const TREATMENT = (() => {
  const flag = process.argv.find(a => a.startsWith("--treatment="));
  const name = flag ? flag.slice("--treatment=".length) : "sheen";
  if (!TREATMENTS[name]) {
    console.error(`unknown treatment ${name}. Known: ${Object.keys(TREATMENTS).join(", ")}`);
    process.exit(1);
  }
  return { name, ...TREATMENTS[name] };
})();

/** A filled tile in one colour, carrying the treatment's shape. */
function surfaceTile(rgba) {
  const t = TREATMENT;
  const w = t.size;
  const h = t.height || t.size;
  const c = canvas(w, h);
  const base = [rgba[0], rgba[1], rgba[2], rgba[3] * t.alpha];
  if (t.sheen > 0) {
    const lift = 255 * t.sheen;
    const top = [
      Math.min(255, base[0] + lift), Math.min(255, base[1] + lift),
      Math.min(255, base[2] + lift), base[3],
    ];
    fillRounded(c, 0, 0, w, h, t.radius, top, base);
  } else {
    fillRounded(c, 0, 0, w, h, t.radius, base);
  }
  return png(c);
}

/** A frame tile: white, so `gl.Color` decides what colour the rule is. */
function frameTile({ openBottom = false } = {}) {
  const t = TREATMENT;
  const w = t.size;
  const h = t.height || t.size;
  const c = canvas(w, h);
  if (t.size === 3) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        if (x === 1 && y === 1) continue;
        if (openBottom && y === 2) continue;
        blend(c, x, y, WHITE, 1);
      }
    }
    return png(c);
  }
  strokeRounded(c, 0, 0, w, h, t.radius, 1, WHITE);
  if (t.inner > 0) {
    strokeRounded(c, 1, 1, w - 1, h - 1, Math.max(0, t.radius - 1), 1,
      [255, 255, 255, t.inner]);
  }
  if (openBottom) {
    const cut = t.slice;
    for (let y = h - cut; y < h; y++) {
      for (let x = 0; x < w; x++) c.px[(y * c.w + x) * 4 + 3] = 0;
    }
  }
  return png(c);
}

/** Distance from a point to a line segment. */
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len = vx * vx + vy * vy;
  const t = len ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len)) : 0;
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The dropdown chevron.
 *
 * Drawn rather than omitted because Evolved reserves 24px on a combobox's
 * right for it, and a skin that leaves the field empty has that reservation
 * read as a box with too much space in it.
 */
function arrowTile() {
  const n = 16;
  const c = canvas(n, n);
  const half = 0.9;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let cov = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = x + (sx + 0.5) / 3;
          const py = y + (sy + 0.5) / 3;
          const d = Math.min(
            segDist(px, py, n * 0.28, n * 0.42, n * 0.5, n * 0.63),
            segDist(px, py, n * 0.5, n * 0.63, n * 0.72, n * 0.42));
          if (d <= half) cov++;
        }
      }
      if (cov > 0) blend(c, x, y, WHITE, cov / 9);
    }
  }
  return png(c);
}

/**
 * The checkbox, as two baked tiles.
 *
 * DrawCheckbox does NOT tint by backgroundColor: it uses white, or focusColor
 * while hovered. A white fill tile therefore paints a white square, which is
 * why the boxes looked wrong. The surface has to be in the art.
 */
function checkBoxTile(fill, line) {
  const n = 16;
  const c = canvas(n, n);
  fillRounded(c, 0, 0, n, n, 3, fill);
  strokeRounded(c, 0, 0, n, n, 3, 1, line);
  return png(c);
}

/**
 * The tick, drawn only when checked.
 *
 * White, because the same white tint applies. Two strokes rather than a glyph
 * so it stays crisp at the 13px Zero-K asks for.
 */
function checkTickTile() {
  const n = 16;
  const c = canvas(n, n);
  const half = 1.15;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = x + (sx + 0.5) / 3;
          const py = y + (sy + 0.5) / 3;
          const d = Math.min(
            segDist(px, py, n * 0.26, n * 0.52, n * 0.44, n * 0.70),
            segDist(px, py, n * 0.44, n * 0.70, n * 0.76, n * 0.31));
          if (d <= half) hits++;
        }
      }
      if (hits > 0) blend(c, x, y, WHITE, hits / 9);
    }
  }
  return png(c);
}

/** The `tiles` value the skin declares, matching the treatment's geometry. */
function sliceLua() {
  const t = TREATMENT;
  return `{${t.slice}, ${t.sliceTop || t.slice}, ${t.slice}, ${t.slice}}`;
}

/** The tiles one skin ships, by filename. */
function tilesFor(p) {
  return {
    // Colour led: white, so `gl.Color` decides what it becomes.
    "fill.png": surfaceTile(WHITE),
    "border.png": frameTile(),
    "border_tab.png": frameTile({ openBottom: true }),
    "arrow.png": arrowTile(),
    "check_box.png": checkBoxTile(
      DEBUG ? LOUD["sunken_bk.png"] : parseColor(p["--surface-sunken"]),
      parseColor(p["--w-32"])),
    "check_tick.png": checkTickTile(),
    /* Image led: the appearance is baked in, because the widgets using these
       classes set backgroundColor to white and the skin cannot take it back. */
    "panel_bk.png": surfaceTile(DEBUG ? LOUD["panel_bk.png"] : parseColor(p["--surface-panel"])),
    "window_bk.png": surfaceTile(DEBUG ? LOUD["window_bk.png"] : parseColor(p["--surface-base"])),
    "sunken_bk.png": surfaceTile(DEBUG ? LOUD["sunken_bk.png"] : parseColor(p["--surface-sunken"])),
    "selected_bk.png": surfaceTile(DEBUG ? LOUD["selected_bk.png"] : parseColor(p["--surface-selected"])),
  };
}

// --------------------------------------------------------------- skin -----

/* Every class Evolved defines, with the draw function it gives each one. A
   class missing from this list falls through to `default`, whose inline draws
   crash on a captioned noFont control. `null` means Evolved sets no
   DrawControl either, so `default`'s is correct for it. */
const CLASSES = [
  ["button", "DrawButton", "control"],
  ["button_hidden", "DrawButton", "flat"],
  ["button_tiny", "DrawButton", "control"],
  ["overlay_button", "DrawButton", "control"],
  ["overlay_button_tiny", "DrawButton", "control"],
  ["button_square", "DrawButton", "control"],
  ["button_tab", "DrawButton", "tab"],
  ["button_large", "DrawButton", "control"],
  ["button_highlight", "DrawButton", "selected"],
  ["action_button", "DrawButton", "control"],
  ["option_button", "DrawButton", "control"],
  ["negative_button", "DrawButton", "danger"],
  ["button_disabled", "DrawButton", "disabled"],
  ["panel_button", "DrawPanel", "panel"],
  ["panel_button_rounded", "DrawPanel", "panel"],
  ["combobox", "DrawComboBox", "control"],
  ["combobox_window", null, "comboWindow"],
  ["combobox_scrollpanel", null, "comboScroll"],
  ["combobox_item", null, "comboItem"],
  ["checkbox", "DrawCheckbox", "sunkenControl"],
  ["editbox", "DrawEditBox", "input"],
  ["textbox", "DrawEditBox", "text"],
  ["imagelistview", "DrawBackground", "sunken"],
  ["imagelistviewitem", null, "flat"],
  ["panel", "DrawPanel", "panel"],
  ["panel_internal", "DrawPanel", "panel"],
  ["panelSmall", "DrawPanel", "panel"],
  ["overlay_panel", "DrawPanel", "panel"],
  ["progressbar", "DrawProgressbar", "progress"],
  ["multiprogressbar", null, "progress"],
  ["scrollpanel", "DrawScrollPanel", "scroll"],
  ["trackbar", "DrawTrackbar", "track"],
  ["treeview", null, "sunken"],
  ["window", "DrawWindow", "window"],
  ["main_window", "DrawWindow", "window"],
  ["main_window_small", "DrawWindow", "window"],
  ["main_window_small_tall", "DrawWindow", "window"],
  ["main_window_small_flat", "DrawWindow", "window"],
  ["main_window_small_very_flat", "DrawWindow", "window"],
  ["main_window_tall", "DrawWindow", "window"],
  ["window_black", "DrawWindow", "window"],
  ["line", "DrawLine", "line"],
  ["tabbar", null, "flat"],
  ["tabbaritem", "DrawTabBarItem", "tab"],
];

/** The colour and image fields one kind of class carries. */
function fieldsFor(kind, p, skinName) {
  const T = f => `":c:${TREE}/${skinName}/${f}"`;
  /* Evolved's paddings, because Zero-K's widgets are sized against them.
     Setting none leaves Control's {5,5,5,5} everywhere, which is why content
     sat close to the edge and the boxes read wrong. */
  const PAD = {
    control: "{10, 10, 10, 10}",
    window: "{13, 13, 13, 13}",
    scroll: "{5, 5, 5, 0}",
    tab: "{1, 1, 1, 2}",
  };
  const hover = lua(over(p["--surface-hover"], p["--surface-panel"]));
  const press = lua(over(p["--surface-active"], p["--surface-panel"]));
  /* One step stronger than the lobby uses for each. Shiro's hairlines read
     against a controlled ground; over a battlefield a 7% white is not there,
     and a panel with no visible edge floats rather than sits. */
  const border = DEBUG ? "{1, 0, 0, 1}" : lua(parseColor(p["--w-20"]));
  const hair = DEBUG ? "{1, 0, 0, 1}" : lua(parseColor(p["--w-12"]));
  const white = "{1, 1, 1, 1}";

  /* Image led. backgroundColor stays white because a widget may force it
     there anyway, and the tile carries the surface. */
  const imageLed = tile => ({
    TileImageBK: T(tile),
    TileImageFG: T("border.png"),
    tiles: sliceLua(),
    backgroundColor: white,
    borderColor: hair,
  });

  /* Colour led. The tile is white and the colour decides, which is what lets
     hover, press and selection be palette values rather than more art. */
  const colorLed = (bg, bd) => ({
    TileImageBK: T("fill.png"),
    TileImageFG: T("border.png"),
    tiles: sliceLua(),
    backgroundColor: bg,
    focusColor: hover,
    pressBackgroundColor: press,
    selectedColor: lua(parseColor(p["--surface-selected"])),
    borderColor: bd || border,
  });

  switch (kind) {
    case "panel": return imageLed("panel_bk.png");
    /* `color`, not `backgroundColor`: DrawWindow tints its one layer with
       obj.color and falls back to opaque white when a skin leaves it unset.
       That fallback is what put a solid bar behind the chat, whose own panels
       already ask for {0,0,0,0} and got painted over anyway.

       A window here is a frame around content that carries its own surface, so
       it can be mostly out of the way. Dialogs still read, because their rows
       and panels are opaque; chat, which has nothing but text inside, becomes
       text on the battlefield. A widget setting its own colour still wins. */
    case "window": return { ...imageLed("window_bk.png"), TileImage: T("window_bk.png"),
      color: "{1, 1, 1, 0}",
      padding: PAD.window, captionColor: lua(parseColor(p["--text-mid"])) };
    case "sunken": return imageLed("sunken_bk.png");
    case "selected": return imageLed("selected_bk.png");
    case "control": return { TileImageArrow: T("arrow.png"), padding: PAD.control,
      ...colorLed(DEBUG ? "{0.2, 0.2, 1, 1}" : lua(parseColor(p["--surface-panel"]))) };
    /* The box and the tick are their own art, and `boxsize` is not optional:
       Evolved sets 13 and a skin that leaves it unset gets whatever Chili
       defaults to, which is how the boxes disappeared. */
    case "sunkenControl": return {
      TileImageBK: T("check_box.png"), TileImageFG: T("check_tick.png"),
      TileImageBK_round: T("check_box.png"), TileImageFG_round: T("check_tick.png"),
      tiles: "{3, 3, 3, 3}",
      boxsize: "13",
      focusColor: "{1, 1, 1, 1}",
      textColor: lua(parseColor(p["--text-body"])) };
    /* A field: no fill, just a rule. Evolved sets its editbox background to
       alpha 0 for the same reason - over a battlefield a filled input is a
       slab, and the border alone says where to type. */
    case "input": return {
      TileImageBK: T("fill.png"), TileImageFG: T("border.png"), tiles: sliceLua(),
      padding: PAD.control,
      backgroundColor: "{1, 1, 1, 0}",
      focusColor: "{1, 1, 1, 0}",
      borderColor: border,
      cursorColor: lua(parseColor(p["--text-hi"])),
      selectionColor: lua(parseColor(p["--surface-selected"])) };
    /* A TextBox is Zero-K's chat line. It carries no surface at all: chat is
       text on the battlefield, and anything behind it is a bar nobody asked
       for. Border and focus are transparent, as Evolved has them. */
    case "text": return {
      TileImageBK: '":cl:empty.png"', TileImageFG: '":cl:empty.png"',
      tiles: sliceLua(),
      backgroundColor: "{1, 1, 1, 0}",
      borderColor: "{0, 0, 0, 0}",
      focusColor: "{0, 0, 0, 0}",
      selectionColor: lua(parseColor(p["--surface-selected"])) };
    case "tab": return { ...colorLed(lua(parseColor(p["--surface-base"]))),
      TileImageFG: T("border_tab.png"), padding: PAD.tab };
    case "danger": return colorLed(lua(parseColor(p["--surface-panel"])),
      lua(parseColor(p["--signal-danger"])));
    case "disabled": return { ...colorLed(lua(parseColor(p["--surface-panel"])), hair),
      disabledColor: lua(parseColor(p["--text-faint"])) };
    /* Nothing painted, but named: a nil image is a crash, not a blank. */
    /* A dropdown is three controls with no DrawControl of their own. Evolved
       resolves them with `clone`, which MergeProperties recurses into; without
       it they inherit nothing that draws and the popup is invisible.

       `color` goes back to opaque here: windows carry nothing so that chat is
       text on the battlefield, but a dropdown is a list that has to be read
       against whatever is behind it. */
    case "comboWindow": return { clone: '"window"', color: "{1, 1, 1, 1}",
      TileImage: T("panel_bk.png"), tiles: sliceLua(),
      padding: "{4, 3, 3, 4}", borderColor: border };
    case "comboScroll": return { clone: '"scrollpanel"',
      borderColor: "{1, 1, 1, 0}", padding: "{0, 0, 0, 0}" };
    case "comboItem": return { clone: '"button"', borderColor: "{1, 1, 1, 0}",
      focusColor: hover, selectedColor: lua(parseColor(p["--surface-selected"])) };
    case "flat": return { TileImageBK: '":cl:empty.png"', TileImageFG: '":cl:empty.png"',
      tiles: sliceLua(), backgroundColor: white,
      focusColor: hover, selectedColor: lua(parseColor(p["--surface-selected"])) };
    case "line": return { TileImage: T("fill.png"), tiles: sliceLua(),
      backgroundColor: hair, borderColor: hair, color: hair };
    case "progress": return { TileImageBK: T("sunken_bk.png"), TileImageFG: T("border.png"),
      tiles: sliceLua(), backgroundColor: white, borderColor: hair,
      color: lua(parseColor(p["--signal-warn"])) };
    case "track": return { TileImageBK: T("sunken_bk.png"), TileImageFG: '":cl:empty.png"',
      TileImage: T("sunken_bk.png"), TileImageV: T("sunken_bk.png"),
      KnobTileImage: T("fill.png"), HTileImage: T("sunken_bk.png"),
      HKnobTileImage: T("fill.png"), StepImage: '":cl:empty.png"',
      ThumbImage: T("fill.png"),
      tiles: sliceLua(), backgroundColor: white,
      borderColor: hair, color: lua(parseColor(p["--text-mid"])) };
    case "scroll": return { BackgroundTileImage: T("sunken_bk.png"), bkgndtiles: sliceLua(),
      BorderTileImage: T("border.png"), bordertiles: sliceLua(),
      TileImage: T("panel_bk.png"), tiles: sliceLua(), htiles: sliceLua(),
      HTileImage: T("panel_bk.png"),
      KnobTileImage: T("fill.png"), HKnobTileImage: T("fill.png"),
      TileImageBK: T("sunken_bk.png"), TileImageFG: '":cl:empty.png"',
      backgroundColor: white, borderColor: hair,
      padding: PAD.scroll,
      KnobColor: lua(parseColor(p["--text-low"])),
      KnobColorSelected: lua(parseColor(p["--text-mid"])) };
    default: throw new Error(`unknown kind ${kind}`);
  }
}

/* Where the tiles live, as the VFS spells it. The installer rewrites the tree
   for the copy that goes into the new chili. */
const TREE = "LuaUI/Widgets/chili_old/Skins";

function skinLua(skin, p) {
  const L = [];
  const w = s => L.push(s);
  w(`--// ${skin.name}, the in-game half of Shiro's ${skin.label.replace("Shiro ", "")} skin.`);
  w("--//");
  w("--// Generated by tools/gen-uiskins.mjs from src/styles/tokens/.");
  w("--// Every class Evolved defines is defined here, because a class this skin");
  w("--// omits falls through to `default`, whose inline draw functions crash on a");
  w("--// captioned control that carries noFont.");
  w("");
  w(`Spring.Echo("Shiro: ${skin.name} skin.lua loaded from " .. tostring(SKINDIR))`);
  w("");
  w("local skin = {");
  w(`\tinfo = { name = "${skin.name}", version = "1.0", author = "Shiro" },`);
  w("}");
  w("");
  w("--// Merged into every control after its own class.");
  w("skin.general = {");
  w(`\ttextColor       = ${lua(parseColor(p["--text-body"]))},`);
  w(`\tborderColor     = ${lua(parseColor(p["--w-12"]))},`);
  w(`\tdisabledColor   = ${lua(parseColor(p["--text-faint"]))},`);
  w("\tborderThickness = 1,");
  w("\tfont = {");
  /* No face of our own, deliberately. Shipping Instrument Sans works - the
     engine loads it - but Zero-K sets objectOverrideFont on a great deal of
     its interface, so it reaches only part of the text: counted in a running
     game, 23 controls took the skin's face and 98 kept the engine's. A UI in
     two typefaces reads worse than one in Zero-K's, and it would cost 194 KB
     in every skin to get there. Colour and size still come from here. */
  w(`\t\tcolor   = ${lua(parseColor(p["--text-hi"]))},`);
  w("\t\tsize    = 13,");
  w("\t\toutline = false,");
  w("\t\tshadow  = false,");
  w("\t},");
  w("}");
  w("");
  w("skin.icons = {");
  w('\timageplaceholder = ":cl:placeholder.png",');
  w("}");
  w("");
  for (const [cls, draw, kind] of CLASSES) {
    const fields = fieldsFor(kind, p, skin.name);
    if (draw) fields.DrawControl = draw;
    w(`skin.${cls} = {`);
    const width = Math.max(...Object.keys(fields).map(k => k.length));
    for (const [k, v] of Object.entries(fields)) w(`\t${k.padEnd(width)} = ${v},`);
    w("}");
    w("");
  }
  w("skin.control = skin.general");
  w("");
  w("return skin");
  w("");
  return L.join("\n");
}

// --------------------------------------------------------------- write ----

const args = process.argv.slice(2);
const check = args.includes("--check");
const pack = args.includes("--pack");
const only = args.find(a => !a.startsWith("--"));
const wanted = only ? SKINS.filter(s => s.id === only || s.name === only) : SKINS;
if (!wanted.length) {
  console.error(`no skin called ${only}. Known: ${SKINS.map(s => s.id).join(", ")}`);
  process.exit(1);
}

let stale = 0;
for (const skin of wanted) {
  const p = paletteFor(skin);
  const dir = join(OUT, skin.name);
  const files = { ...tilesFor(p), "skin.lua": Buffer.from(skinLua(skin, p), "utf8") };
  if (!check) mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const buf = data;
    const path = join(dir, name);
    if (check) {
      const have = existsSync(path) ? readFileSync(path) : null;
      if (!have || !have.equals(buf)) {
        console.error(`stale or missing: ${path}`);
        stale++;
      }
    } else {
      writeFileSync(path, buf);
    }
  }
  if (!check) {
    console.log(`${skin.name}: ${CLASSES.length} classes, ${Object.keys(files).length - 1} tiles`);
  }
}

if (pack) {
  /* One zip per skin, flat, because the installer flattens on unpack and a
     nested directory would simply be dropped. The hash printed here is what
     goes in the catalogue, and it is taken from the file that will be
     uploaded rather than from the directory it came from. */
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const out = join(ROOT, "dist-uiskins");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const skin of wanted) {
    const dir = join(OUT, skin.name);
    const version = "1.0.0";
    const zip = join(out, `shiro-uiskin-${skin.id}-${version}.zip`);
    execFileSync("powershell", ["-NoProfile", "-Command",
      `Compress-Archive -Path '${join(dir, "*")}' -DestinationPath '${zip}'`]);
    const buf = readFileSync(zip);
    const hash = createHash("sha256").update(buf).digest("hex");
    console.log(`${skin.name}`);
    console.log(`  file    ${zip}`);
    console.log(`  tag     uiskin-${skin.id}-${version}`);
    console.log(`  sha256  ${hash}`);
    console.log(`  url     https://github.com/FIGHTORDER/shiro/releases/download/uiskin-${skin.id}-${version}/${basename(zip)}`);
  }
} else if (check) {
  if (stale) {
    console.error(`${stale} file(s) out of date. Run: node tools/gen-uiskins.mjs`);
    process.exit(1);
  }
  console.log(`skins up to date (${wanted.length})`);
}
