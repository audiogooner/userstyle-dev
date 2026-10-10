import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { getConfig, siteOf } from "../context.mjs";
import { orderSnapshotPages, resolveExplore, seedFor } from "../explore.mjs";
import { pageIdForUrl } from "../page-id.mjs";
import {
  collectInventory,
  outlineTree,
  serializeHtml,
  slimDocument,
  stylesheetHrefs,
  stylesheetName,
} from "../lib/slim-document.mjs";
import { pagesDir, writeSnapshot } from "../lib/snapshot-io.mjs";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchSnapshots(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`Fetch public page snapshots.

  userstyle-dev snapshot
  userstyle-dev snapshot --only tags-list
  userstyle-dev snapshot --force

Live (Alt+Shift+S) captures are skipped unless --force is set.
Logged-in pages stay userscript-only.`);
    return;
  }

  const config = getConfig();
  const origin = siteOf(config).origin;
  const catalog = config.snapshotPages || [];
  let entries = orderSnapshotPages(catalog);
  if (args.only) {
    entries = entries.filter((entry) => entry.id === args.only);
    if (!entries.length) {
      throw new Error(`Unknown snapshot id: ${args.only}`);
    }
  }

  const htmlCache = new Map();
  const cssCache = new Map();

  async function fetchText(url) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,text/css,*/*" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.text();
  }

  async function htmlFor(url) {
    if (!htmlCache.has(url)) {
      htmlCache.set(url, await fetchText(url));
    }
    return htmlCache.get(url);
  }

  async function resolveUrl(entry) {
    if (entry.explore) {
      const seed = seedFor(entry, catalog);
      return resolveExplore(await htmlFor(seed), entry.explore, origin);
    }
    if (entry.url) {
      return entry.url;
    }
    throw new Error(`Unknown snapshot entry: ${entry.id}`);
  }

  async function capturePage(url, forcedId) {
    const html = await htmlFor(url);
    const { document } = parseHTML(html);
    const sheetHrefs = stylesheetHrefs(document, url);
    const { root: slimRoot, notes } = slimDocument(document);
    const inventory = collectInventory(slimRoot);
    const outline = outlineTree(slimRoot);
    const id = forcedId || pageIdForUrl(url, config);
    const title = document.querySelector("title")?.textContent?.trim() ?? "";
    const capturedAt = new Date().toISOString();

    const stylesheets = [];
    for (const href of sheetHrefs) {
      const name = stylesheetName(href);
      if (!cssCache.has(name)) {
        try {
          cssCache.set(name, await fetchText(href));
        } catch (error) {
          notes.push(`failed to fetch CSS ${href}: ${error.message}`);
          continue;
        }
      }
      stylesheets.push({ name, css: cssCache.get(name), url: href });
    }

    const pageHtml = serializeHtml(slimRoot, {
      id,
      url,
      title,
      capturedAt,
      source: "fetch",
      stylesheets: stylesheets.map((sheet) => sheet.name),
      notes,
    });

    const meta = writeSnapshot({
      id,
      url,
      title,
      html: pageHtml,
      classes: inventory.classes,
      ids: inventory.ids,
      notes,
      stylesheets,
      source: "fetch",
      capturedAt,
      outline,
    });

    const extra = notes.length ? notes.join("; ") : "kept in full";
    console.log(
      `  ${meta.id.padEnd(18)} ${String(meta.classes.length).padStart(3)} classes  ${extra}`,
    );
  }

  console.log(`Fetching page snapshots from ${origin}…`);

  const skippedLogin = [];
  const skippedLive = [];
  for (const entry of entries) {
    if (entry.userscriptOnly) {
      skippedLogin.push(entry);
      continue;
    }
    if (!args.force && existingSource(entry.id) === "live") {
      skippedLive.push(entry);
      continue;
    }
    try {
      const url = await resolveUrl(entry);
      await capturePage(url, entry.id);
    } catch (error) {
      console.error(`  FAIL ${entry.id || entry.url}: ${error.message}`);
    }
    await wait(250);
  }

  if (skippedLive.length) {
    console.log(
      `\nKept live captures (pass --force to overwrite with a public fetch):\n${skippedLive
        .map((entry) => `  ${entry.id}`)
        .join("\n")}`,
    );
  }

  if (skippedLogin.length) {
    console.log(
      `\nUserscript-only (open the page, Alt+Shift+S or Snapshot all):\n${skippedLogin
        .map((entry) => `  ${entry.id}  ${entry.url || `explore:${entry.explore?.from}`}`)
        .join("\n")}`,
    );
  }

  console.log("Done. See snapshots/INDEX.md");
}

function existingSource(id) {
  const metaPath = join(pagesDir(), `${id}.json`);
  if (!existsSync(metaPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")).source || null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { force: false, only: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") {
      args.force = true;
    } else if (arg === "--only") {
      args.only = argv[++i];
    } else if (arg.startsWith("--only=")) {
      args.only = arg.slice("--only=".length);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
