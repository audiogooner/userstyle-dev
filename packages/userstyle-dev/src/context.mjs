import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export let root = process.cwd();
let projectConfig = null;
let lintConfig = null;
let revision = 0;

export function setRoot(next) {
  root = next;
  projectConfig = null;
  lintConfig = null;
}

export function hasConfig() {
  return projectConfig != null;
}

export function getConfig() {
  if (!projectConfig) {
    throw new Error(
      `No style.config.mjs loaded. Run userstyle-dev from a userstyle project (cwd: ${root}).`,
    );
  }
  return projectConfig;
}

export function getLintConfig() {
  return lintConfig || defaultLintConfig(siteIdOr("userstyle"));
}

function siteIdOr(fallback) {
  const id = projectConfig?.site?.id;
  return id ? String(id) : fallback;
}

export function defaultLintConfig(siteId = "userstyle") {
  return {
    minDeclarationsForCrossFile: 4,
    minFilesForCrossFile: 2,
    ignoreSelectors: [":root", "html", "body"],
    ignoreFiles: [],
    ignoreRules: {
      "duplicate-declarations": [],
      "dead-selector": [`#${siteId}-dev-overlay`, `#${siteId}-dev-overlay *`],
    },
    snapshotMap: {},
  };
}

export function siteOf(config = getConfig()) {
  const site = config.site;
  if (!site?.id || !site?.origin) {
    throw new Error("style.config.mjs must export site.id and site.origin");
  }
  const origin = String(site.origin).replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`site.origin is not a URL: ${site.origin}`);
  }
  const match = site.match
    ? Array.isArray(site.match)
      ? site.match
      : [site.match]
    : [`${origin}/*`];
  return {
    id: String(site.id),
    origin,
    match: match.map(String),
    host: parsed.host,
  };
}

export function serverHost(config = getConfig()) {
  return config.host || "127.0.0.1";
}

export function serverPort(config = getConfig()) {
  return Number(process.env.PORT) || Number(config.port) || 3847;
}

export function snapshotGapMs(config = getConfig()) {
  const value = Number(config.snapshotGapMs);
  if (!Number.isFinite(value) || value < 0) {
    return 2000;
  }
  return value;
}

export function blackoutCss(config = getConfig()) {
  if (typeof config.blackoutCss === "string" && config.blackoutCss.trim()) {
    return config.blackoutCss;
  }
  return `img, video, canvas {
  filter: contrast(0) brightness(0.22) !important;
}
`;
}

export async function loadProjectConfig() {
  const file = join(root, "style.config.mjs");
  if (!existsSync(file)) {
    throw new Error(
      `No style.config.mjs in ${root}. Run userstyle-dev from a userstyle project.`,
    );
  }
  const url = pathToFileURL(file);
  url.searchParams.set("revision", String(++revision));
  projectConfig = await import(url.href);
  siteOf(projectConfig);
  lintConfig = await loadLintFile();
  return projectConfig;
}

async function loadLintFile() {
  const file = join(root, "style.lint.config.mjs");
  if (!existsSync(file)) {
    return null;
  }
  const url = pathToFileURL(file);
  url.searchParams.set("revision", String(revision));
  const loaded = await import(url.href);
  return loaded.default || loaded;
}
