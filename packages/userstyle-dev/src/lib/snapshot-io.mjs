import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getConfig, hasConfig, root, siteOf } from "../context.mjs";

export function snapshotsDir() {
  return join(root, "snapshots");
}

export function pagesDir() {
  return join(snapshotsDir(), "pages");
}

export function cssDir() {
  return join(snapshotsDir(), "css");
}

export function ensureSnapshotDirs() {
  mkdirSync(pagesDir(), { recursive: true });
  mkdirSync(cssDir(), { recursive: true });
}

export function safePageId(id) {
  const cleaned = String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!cleaned) {
    throw new Error("invalid snapshot id");
  }
  return cleaned;
}

export function writeSnapshot({
  id,
  url,
  title,
  html,
  classes = [],
  ids = [],
  notes = [],
  stylesheets = [],
  source = "fetch",
  capturedAt,
  outline = "",
}) {
  ensureSnapshotDirs();
  const pageId = safePageId(id);
  const sheets = Array.isArray(stylesheets) ? stylesheets : [];
  const meta = {
    id: pageId,
    url,
    title,
    capturedAt: capturedAt || new Date().toISOString(),
    source,
    classes: classes || [],
    ids: (ids || []).filter((value) => !/^p\d+$/.test(value)),
    stylesheets: sheets.map((sheet) =>
      typeof sheet === "string" ? sheet : sheet.name,
    ),
    notes: notes || [],
  };

  writeFileSync(
    join(pagesDir(), `${pageId}.html`),
    html.endsWith("\n") ? html : `${html}\n`,
  );
  writeFileSync(
    join(pagesDir(), `${pageId}.json`),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  writeFileSync(
    join(pagesDir(), `${pageId}.outline.txt`),
    outline.endsWith("\n") ? outline : `${outline}\n`,
  );

  for (const sheet of sheets) {
    if (!sheet || typeof sheet === "string" || !sheet.css) {
      continue;
    }
    const name =
      String(sheet.name || "style.css").replace(/[^a-zA-Z0-9._-]/g, "") ||
      "style.css";
    writeFileSync(join(cssDir(), name), sheet.css);
  }

  writeIndex();
  return { ...meta, htmlPath: `snapshots/pages/${pageId}.html` };
}

function catalogPages() {
  if (!hasConfig()) {
    return [];
  }
  return getConfig().snapshotPages || [];
}

export function writeIndex() {
  ensureSnapshotDirs();
  const pages = listPages();
  const captured = new Set(pages.map((page) => page.id));
  const cssFiles = readdirSync(cssDir())
    .filter((name) => name.endsWith(".css"))
    .sort();
  const origin = hasConfig() ? siteOf(getConfig()).origin : "the site";

  const rows = pages.map((page) => {
    const sheets = (page.stylesheets || [])
      .map((name) => `[${name}](css/${name})`)
      .join(", ");
    return `| ${page.id} | ${page.url || ""} | [html](pages/${page.id}.html) · [outline](pages/${page.id}.outline.txt) · [meta](pages/${page.id}.json) | ${page.classes?.length ?? 0} | ${sheets || "—"} |`;
  });

  const pending = catalogPages()
    .filter((page) => !captured.has(page.id))
    .map((page) => {
      const how = page.userscriptOnly
        ? "open while logged in, then Alt+Shift+S or Snapshot all"
        : "`npm run snapshot:fetch`";
      const target = page.url || `explore from ${page.explore?.from || "?"}`;
      return `- **${page.id}** — ${target} (${how})`;
    });

  const missing = pages.length
    ? ""
    : `_No pages captured yet. Run \`npm run snapshot:fetch\` or press Alt+Shift+S on ${origin}._`;

  const pendingBlock = pending.length
    ? `\n## Not captured yet\n\n${pending.join("\n")}\n`
    : "";

  const body = `# Page snapshots

Slimmed live-DOM captures of ${origin}, plus original site CSS. Use these when writing selectors.

Media \`src\` values are stripped, script bodies are emptied (tags stay so \`nth-child\` matches the live tree), and long repeated lists are collapsed to a few examples. Header/nav and named chrome ids are kept intact.

## Pages

| Page | URL | Files | Classes | Site CSS |
|------|-----|-------|---------|----------|
${rows.join("\n") || "| — | | | | |"}${missing ? `\n\n${missing}` : ""}${pendingBlock}

## Site CSS

${cssFiles.map((name) => `- [${name}](css/${name})`).join("\n") || "_None yet._"}

## Capture

- Public pages: \`npm run snapshot:fetch\` (\`--only <id>\`, \`--force\` to overwrite a live capture)
- Any page (logged-in too): with \`npm run dev\` running, open the page and press **Alt+Shift+S**
- All catalog pages: overlay **All** (live queue; explorers read links from seed pages)
`;

  writeFileSync(join(snapshotsDir(), "INDEX.md"), body);
}

export function listPages() {
  ensureSnapshotDirs();
  return readdirSync(pagesDir())
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(pagesDir(), name), "utf8")));
}
