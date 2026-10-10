import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { root } from "../context.mjs";
import { safePageId } from "./snapshot-io.mjs";

export function previewsDir() {
  return join(root, "snapshots/previews");
}

function indexPath() {
  return join(previewsDir(), "index.json");
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_SHOTS = 80;

function emptyIndex() {
  return { pages: {}, entries: [] };
}

export function readPreviewIndex() {
  if (!existsSync(indexPath())) {
    return emptyIndex();
  }
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), "utf8"));
    return {
      pages: parsed.pages || {},
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return emptyIndex();
  }
}

function writePreviewIndex(index) {
  mkdirSync(previewsDir(), { recursive: true });
  writeFileSync(indexPath(), `${JSON.stringify(index, null, 2)}\n`);
}

function imageName(file, line, selector) {
  const hash = createHash("sha1")
    .update(`${file}:${line}:${selector}`)
    .digest("hex")
    .slice(0, 12);
  return `${hash}.png`;
}

export function writeSnapshotPreviews({ id, capturedAt, shots = [] }) {
  const pageId = safePageId(id);
  const list = Array.isArray(shots) ? shots.slice(0, MAX_SHOTS) : [];
  const pageDir = join(previewsDir(), pageId);
  rmSync(pageDir, { recursive: true, force: true });
  mkdirSync(pageDir, { recursive: true });

  const entries = [];
  for (const shot of list) {
    if (!shot || typeof shot.png !== "string" || !shot.file) {
      continue;
    }
    const png = Buffer.from(shot.png, "base64");
    if (!png.length || png.length > MAX_IMAGE_BYTES) {
      continue;
    }
    const line = Number(shot.line) || 1;
    const selector = String(shot.selector || shot.query || "");
    const name = imageName(shot.file, line, selector);
    writeFileSync(join(pageDir, name), png);
    entries.push({
      pageId,
      file: String(shot.file).replaceAll("\\", "/"),
      line,
      selector,
      query: String(shot.query || ""),
      image: `${pageId}/${name}`,
      width: Number(shot.width) || 0,
      height: Number(shot.height) || 0,
      cssWidth: Number(shot.cssWidth) || 0,
      cssHeight: Number(shot.cssHeight) || 0,
    });
  }

  const index = readPreviewIndex();
  index.pages[pageId] = {
    capturedAt: capturedAt || new Date().toISOString(),
    count: entries.length,
  };
  index.entries = [
    ...index.entries.filter((entry) => entry.pageId !== pageId),
    ...entries,
  ];
  writePreviewIndex(index);

  return { id: pageId, count: entries.length };
}
