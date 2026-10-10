import { getConfig } from "./context.mjs";
import { pageIdFromUrl } from "./lib/slim-document.mjs";

export function pageIdForUrl(href, config = getConfig()) {
  if (typeof config.pageIdFromUrl === "function") {
    return config.pageIdFromUrl(href);
  }
  return pageIdFromUrl(href);
}

export function pageIdFunctionSource(config = getConfig()) {
  if (typeof config.pageIdFromUrl !== "function") {
    return "null";
  }
  return `(${config.pageIdFromUrl.toString()})`;
}
