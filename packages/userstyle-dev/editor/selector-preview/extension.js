const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { enclosingSelector, normalizeSelector } = require("./scss-scope");

let cache = { root: "", mtime: -1, data: null };
let output;

function activate(context) {
  output = vscode.window.createOutputChannel("Userstyle previews");
  output.appendLine("Selector preview activated");

  context.subscriptions.push(
    output,
    vscode.languages.registerHoverProvider(
      [
        { language: "scss", scheme: "file" },
        { language: "css", scheme: "file" },
      ],
      {
        provideHover(document, position) {
          return provideSelectorHover(document, position);
        },
      },
    ),
  );
}

function provideSelectorHover(document, position) {
  const root = repoRoot(document.uri.fsPath);
  if (!root) {
    return undefined;
  }

  const rel = path.relative(root, document.uri.fsPath).replaceAll("\\", "/");
  if (!rel.startsWith("src/") || !rel.endsWith(".scss")) {
    return undefined;
  }

  const index = loadIndex(root);
  if (!index?.entries?.length) {
    log(`no preview index (${rel}:${position.line + 1})`);
    return undefined;
  }

  const scope = enclosingSelector(
    document.getText(),
    document.offsetAt(position),
    (offset) => document.positionAt(offset).line + 1,
  );
  if (!scope) {
    return undefined;
  }

  const entry = matchEntry(index, rel, scope);
  if (!entry) {
    log(`no match ${rel}:${scope.line} ${scope.selector}`);
    return undefined;
  }

  const abs = path.join(root, "snapshots/previews", entry.image);
  if (!fs.existsSync(abs)) {
    log(`missing image ${abs}`);
    return undefined;
  }

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;
  md.appendMarkdown(`\`${entry.selector}\`\n\n`);
  md.appendMarkdown(imageMarkdown(abs, entry));
  md.appendMarkdown(`\n\n_${escapeMd(entry.pageId)}_`);

  log(`hover ${rel}:${scope.line} -> ${entry.image}`);
  return new vscode.Hover(md);
}

function imageMarkdown(abs, entry) {
  const png = fs.readFileSync(abs);
  const natural = pngSize(png) || {
    width: Number(entry.width) || 320,
    height: Number(entry.height) || 80,
  };
  const size = hoverDisplaySize(entry, natural);
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  return `<img src="${dataUri}" width="${size.width}" height="${size.height}" alt="" />`;
}

function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89) {
    return null;
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function hoverDisplaySize(entry, natural) {
  const maxW = 280;
  const maxH = 140;
  const minShort = 24;
  const cssW = Number(entry.cssWidth) || 0;
  const cssH = Number(entry.cssHeight) || 0;
  let width = cssW > 0 ? cssW : natural.width;
  let height = cssH > 0 ? cssH : natural.height;
  if (!width || !height) {
    return {
      width: Math.min(maxW, natural.width || maxW),
      height: Math.min(maxH, natural.height || maxH),
    };
  }
  const short = Math.min(width, height);
  if (short < minShort && short > 0) {
    const boost = minShort / short;
    width *= boost;
    height *= boost;
  }
  const fit = Math.min(1, maxW / width, maxH / height);
  return {
    width: Math.max(1, Math.round(width * fit)),
    height: Math.max(1, Math.round(height * fit)),
  };
}

function repoRoot(filePath) {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 16; i += 1) {
    if (fs.existsSync(path.join(dir, "style.config.mjs"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

function loadIndex(root) {
  const indexPath = path.join(root, "snapshots/previews/index.json");
  try {
    const mtime = fs.statSync(indexPath).mtimeMs;
    if (cache.data && cache.root === root && cache.mtime === mtime) {
      return cache.data;
    }
    const data = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    cache = { root, mtime, data };
    return data;
  } catch {
    cache = { root, mtime: -1, data: null };
    return null;
  }
}

function matchEntry(index, file, scope) {
  const rows = index.entries.filter((entry) => entry.file === file);
  if (!rows.length) {
    return undefined;
  }

  const pageId = pageIdFromFile(file);
  const prefer = (a, b) => {
    if (pageId) {
      if (a.pageId === pageId && b.pageId !== pageId) {
        return -1;
      }
      if (b.pageId === pageId && a.pageId !== pageId) {
        return 1;
      }
    }
    const aAt = index.pages?.[a.pageId]?.capturedAt || "";
    const bAt = index.pages?.[b.pageId]?.capturedAt || "";
    return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
  };

  const exact = rows.filter((entry) => entry.line === scope.line).sort(prefer);
  if (exact.length) {
    return exact[0];
  }

  const normalized = normalizeSelector(scope.full);
  const bySelector = rows
    .filter(
      (entry) =>
        normalizeSelector(entry.selector) === normalized ||
        normalizeSelector(entry.query) === normalized,
    )
    .sort(prefer);
  if (bySelector.length) {
    return bySelector[0];
  }

  const nearby = rows
    .filter((entry) => entry.line <= scope.line && scope.line - entry.line <= 2)
    .sort((a, b) => b.line - a.line || prefer(a, b));
  return nearby[0];
}

function pageIdFromFile(file) {
  const match = file.match(/^src\/pages\/([^/]+)\.scss$/);
  return match ? match[1] : null;
}

function escapeMd(value) {
  return String(value).replaceAll("_", "\\_");
}

function log(message) {
  output?.appendLine(message);
}

function deactivate() {}

module.exports = { activate, deactivate };
