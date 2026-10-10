import { createServer } from "node:http";
import { readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
import {
  getConfig,
  loadProjectConfig,
  root,
  serverHost,
  serverPort,
  siteOf,
  snapshotGapMs as readSnapshotGapMs,
} from "../context.mjs";
import {
  assembleUserstyle,
  compileBundles,
  cssForHref,
  serializeDevBundles,
} from "../compile.mjs";
import { catalogPages } from "../explore.mjs";
import { writeSnapshot } from "../lib/snapshot-io.mjs";
import { selectorTargetsForHref } from "../lib/selector-targets.mjs";
import { writeSnapshotPreviews } from "../lib/snapshot-previews.mjs";
import { capturePrelude, devOrigin, renderUserscript } from "../userscript.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageSrc = join(here, "..");
const slimPath = join(packageSrc, "lib/slim-document.mjs");
const capturePath = join(packageSrc, "browser/snapshot-capture.js");
const html2canvasPath = require.resolve("html2canvas/dist/html2canvas.min.js");

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

let compiled = [];
let generation = 0;
let compileError = null;
let snapshotCatalog = [];
let snapshotGapMs = 2000;

async function compile() {
  try {
    const config = await loadProjectConfig();
    const nextCompiled = compileBundles();
    writeFileSync(join(root, config.exportFile), assembleUserstyle(nextCompiled));
    compiled = nextCompiled;
    snapshotCatalog = catalogPages(
      config.snapshotPages || [],
      siteOf(config).origin,
    );
    snapshotGapMs = readSnapshotGapMs(config);
    compileError = null;
    generation += 1;
    console.log(
      `[${timestamp()}] compiled and published ${config.exportFile} (${generation})`,
    );
  } catch (error) {
    compileError = error.message;
    console.error(`[${timestamp()}] compile error:\n${error.message}`);
  }
}

function captureDriver() {
  const slim = readFileSync(slimPath, "utf8").replaceAll(/^export /gm, "");
  const driver = readFileSync(capturePath, "utf8");
  const html2canvasSrc = readFileSync(html2canvasPath, "utf8");
  return (
    capturePrelude() +
    "var html2canvas = (function () {\n" +
    "  var module = { exports: {} };\n" +
    "  var exports = module.exports;\n" +
    "  var define;\n" +
    html2canvasSrc +
    "\n  return module.exports;\n" +
    "})();\n" +
    slim +
    "\n" +
    driver +
    "\n"
  );
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => void fn(...args), ms);
  };
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function hrefFrom(url) {
  return url.searchParams.get("href") ?? "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function landingPage() {
  const config = getConfig();
  const site = siteOf(config);
  const origin = devOrigin(config);
  const userscript = `${origin}/dev.user.js`;
  const name = config.metadata?.name || site.id;
  const errorBlock = compileError
    ? `<pre class="err">${escapeHtml(compileError)}</pre>`
    : "";
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — dev</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    font: 15px/1.45 ui-sans-serif, system-ui, sans-serif;
    background: #1e1e2e;
    color: #cdd6f4;
  }
  main { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
  h1 { font-size: 1.25rem; font-weight: 650; }
  a { color: #89b4fa; }
  ol { padding-left: 1.2rem; }
  li { margin: 0.4rem 0; }
  kbd, code, pre {
    font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  kbd, code {
    padding: 0.1em 0.35em;
    background: #313244;
    border-radius: 6px;
  }
  pre {
    padding: 0.75rem 1rem;
    overflow: auto;
    background: #313244;
    border-radius: 6px;
  }
  .err { color: #f38ba8; }
  .hint { color: #6c7086; font-size: 0.9rem; }
</style>
<main>
  <h1>${escapeHtml(name)} — live inject</h1>
  ${errorBlock}
  <ol>
    <li>Install the userscript in Violentmonkey:<br>
      <a href="${userscript}">${userscript}</a></li>
    <li>Open <a href="${site.origin}">${escapeHtml(site.host)}</a> — edits under <code>src/</code> reload automatically</li>
    <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> toggles the overlay (or restores it if hidden)</li>
    <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> captures a snapshot and selector hover previews</li>
    <li>Overlay <strong>All</strong> walks every catalog page (explorers read links from seed pages)</li>
  </ol>
  <p class="hint">Disable any installed copy of the exported UserStyle while developing.
  Generation ${generation}${compileError ? " · last good CSS still served" : ""}.</p>
</main>
`;
}

function readBody(req, maxBytes = MAX_SNAPSHOT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("snapshot too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleSnapshot(req, res) {
  const payload = JSON.parse(await readBody(req));
  const result = writeSnapshot(payload);
  console.log(`[${timestamp()}] snapshot ${result.id}`);
  send(res, 200, JSON.stringify(result), "application/json; charset=utf-8");
}

async function handleSnapshotPreviews(req, res) {
  const payload = JSON.parse(await readBody(req, MAX_PREVIEW_BYTES));
  const result = writeSnapshotPreviews(payload);
  console.log(`[${timestamp()}] previews ${result.id} (${result.count})`);
  send(res, 200, JSON.stringify(result), "application/json; charset=utf-8");
}

export async function startDev() {
  await compile();
  const host = serverHost();
  const port = serverPort();
  const config = getConfig();
  const site = siteOf(config);

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      res.end();
      return;
    }

    if (url.pathname === "/style.css") {
      send(res, 200, cssForHref(compiled, hrefFrom(url)), "text/css; charset=utf-8");
      return;
    }

    if (url.pathname === "/dev.json") {
      const clientGen = Number(url.searchParams.get("generation"));
      if (Number.isFinite(clientGen) && clientGen > 0 && clientGen === generation) {
        send(
          res,
          200,
          JSON.stringify({ generation, unchanged: true, error: compileError }),
          "application/json; charset=utf-8",
        );
        return;
      }

      send(
        res,
        200,
        JSON.stringify({
          generation,
          error: compileError,
          bundles: serializeDevBundles(compiled, hrefFrom(url)),
        }),
        "application/json; charset=utf-8",
      );
      return;
    }

    if (url.pathname === "/queue-log") {
      console.log(`[${timestamp()}] queue ${url.searchParams.get("msg") || ""}`);
      send(res, 200, "ok", "text/plain; charset=utf-8");
      return;
    }

    if (url.pathname === "/snapshot-capture.js") {
      send(res, 200, captureDriver(), "text/javascript; charset=utf-8");
      return;
    }

    if (url.pathname === "/snapshot-catalog") {
      send(
        res,
        200,
        JSON.stringify({ pages: snapshotCatalog, gapMs: snapshotGapMs }),
        "application/json; charset=utf-8",
      );
      return;
    }

    if (url.pathname === "/selector-targets") {
      try {
        const targets = selectorTargetsForHref(hrefFrom(url));
        send(res, 200, JSON.stringify(targets), "application/json; charset=utf-8");
      } catch (error) {
        console.error(`[${timestamp()}] selector-targets:`, error.message);
        send(
          res,
          500,
          JSON.stringify({ error: error.message }),
          "application/json; charset=utf-8",
        );
      }
      return;
    }

    if (url.pathname === "/snapshot" && req.method === "POST") {
      handleSnapshot(req, res).catch((error) => {
        console.error(`[${timestamp()}] snapshot error:`, error.message);
        if (!res.headersSent) {
          send(
            res,
            400,
            JSON.stringify({ error: error.message }),
            "application/json; charset=utf-8",
          );
        }
      });
      return;
    }

    if (url.pathname === "/snapshot-previews" && req.method === "POST") {
      handleSnapshotPreviews(req, res).catch((error) => {
        console.error(`[${timestamp()}] preview error:`, error.message);
        if (!res.headersSent) {
          send(
            res,
            400,
            JSON.stringify({ error: error.message }),
            "application/json; charset=utf-8",
          );
        }
      });
      return;
    }

    if (url.pathname === "/dev.user.js") {
      send(res, 200, renderUserscript(), "text/javascript; charset=utf-8");
      return;
    }

    if (url.pathname === "/") {
      try {
        send(res, 200, landingPage(), "text/html; charset=utf-8");
      } catch (error) {
        send(res, 500, escapeHtml(error.message), "text/plain; charset=utf-8");
      }
      return;
    }

    send(res, 404, "Not found\n", "text/plain; charset=utf-8");
  });

  const rebuild = debounce(compile, 80);
  watch(join(root, "src"), { recursive: true }, rebuild);
  watch(join(root, "style.config.mjs"), rebuild);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other dev server, or set PORT=…`,
      );
      process.exit(1);
    }
    throw error;
  });

  server.listen(port, host, () => {
    const origin = devOrigin();
    console.log(`
${config.metadata?.name || site.id} — live inject
  Open  ${origin}
  1. Install the userscript in Violentmonkey:
       ${origin}/dev.user.js
  2. Open ${site.origin} — source and bundle config edits reload automatically
  3. Alt+Shift+D toggles the dev overlay (or restores it if hidden)
  4. Alt+Shift+S captures a slimmed DOM snapshot and selector hover previews
  5. Overlay All walks every snapshotPages entry (explorers read links from seed pages)
  6. The latest UserStyle is published to ${config.exportFile} after every successful build
`);
  });
}
