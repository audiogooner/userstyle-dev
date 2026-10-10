import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blackoutCss,
  getConfig,
  serverHost,
  serverPort,
  siteOf,
} from "./context.mjs";
import { pageIdFunctionSource } from "./page-id.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = join(here, "browser/userscript.js");

export function devOrigin(config = getConfig()) {
  return `http://${serverHost(config)}:${serverPort(config)}`;
}

export function overlayId(config = getConfig()) {
  return `${siteOf(config).id}-dev-overlay`;
}

export function renderUserscript(config = getConfig()) {
  const site = siteOf(config);
  const metadata = config.metadata || {};
  const matchLines = site.match
    .map((match) => `// @match       ${match}`)
    .join("\n");
  let source = readFileSync(templatePath, "utf8");
  source = source.replace("// @match       __MATCH__", matchLines);
  source = source.replaceAll("__STYLE_NAME__", metadata.name || site.id);
  source = source.replaceAll("__NAMESPACE__", metadata.namespace || site.origin);
  source = source.replaceAll("__SITE_ID__", site.id);
  source = source.replaceAll("__DEV_ORIGIN__", devOrigin(config));
  source = source.replaceAll("__CONNECT_HOST__", site.host);
  source = source.replaceAll("__SITE_ORIGIN__", site.origin);
  source = source.replace("__BLACKOUT_CSS_JSON__", JSON.stringify(blackoutCss(config)));
  return source;
}

export function capturePrelude(config = getConfig()) {
  const site = siteOf(config);
  return `var USERSTYLE_DEV = ${JSON.stringify({
    siteId: site.id,
    overlayId: overlayId(config),
  })};
var projectPageIdFromUrl = ${pageIdFunctionSource(config)};
`;
}
