#!/usr/bin/env node
/**
 * Serves dist/ with the packaged Content-Security-Policy, so the CSP can be
 * tested before it reaches a Windows machine.
 *
 * The policy is read straight out of tauri.conf.json - the point is to catch a
 * policy that blanks the window, which is a miserable thing to discover from an
 * installer. WebView2 is Chromium, so a Chromium here enforces the same rules.
 * The one thing it cannot check is the `ipc:` scheme, which only exists inside
 * Tauri.
 *
 *   npm run build && node tools/e2e/serve-csp.mjs   # then load http://localhost:1421
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 1421);

const conf = JSON.parse(await readFile(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
const csp = conf.app?.security?.csp;

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  const file = join(DIST, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    if (csp) res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`dist/ on http://localhost:${PORT}`);
  console.log(csp ? `CSP: ${csp}` : "CSP: none set in tauri.conf.json");
});
