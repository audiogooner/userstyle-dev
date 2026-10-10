import * as sass from "sass";
import { transform as lightningcss } from "lightningcss";
import { join } from "node:path";
import { getConfig, root } from "./context.mjs";

export function compileFile(file, { style = "expanded" } = {}) {
  return sass.compile(join(root, file), {
    style,
    sourceMap: false,
    loadPaths: [join(root, "src")],
  }).css;
}

export function compileBundles({ style = "expanded", bundles } = {}) {
  const list = bundles || getConfig().bundles || [];
  return list.map((bundle) => ({
    ...bundle,
    css: compileFile(bundle.file, { style }).trim(),
  }));
}

export function parseDocumentRules(document) {
  const rules = [];
  const re = /(url-prefix|url|regexp)\("([^"]+)"\)/g;
  let match;
  while ((match = re.exec(document)) !== null) {
    rules.push({ kind: match[1], value: match[2] });
  }

  if (rules.length === 0) {
    throw new Error(`Unsupported @-moz-document rule: ${document}`);
  }

  return rules;
}

export function parseDocument(document) {
  return parseDocumentRules(document)[0];
}

export function matchesDocument(document, href) {
  if (!href) {
    return true;
  }

  return parseDocumentRules(document).some(({ kind, value }) => {
    if (kind === "url-prefix") {
      return href.startsWith(value);
    }
    if (kind === "regexp") {
      return new RegExp(value).test(href);
    }

    return href === value;
  });
}

export function cssForHref(compiled, href) {
  return compiled
    .filter((bundle) => matchesDocument(bundle.document, href))
    .map((bundle) => bundle.css)
    .join("\n\n");
}

export function bundleId(file) {
  return file.replace(/^src\/(?:pages\/)?/, "").replace(/\.scss$/, "");
}

export function isSharedBundleFile(file) {
  const name = String(file || "")
    .replaceAll("\\", "/")
    .split("/")
    .pop();
  return name === "base.scss" || name.startsWith("chrome-");
}

export function serializeDevBundles(compiled, href) {
  return compiled.map((bundle) => {
    const matches = matchesDocument(bundle.document, href);
    const entry = {
      id: bundleId(bundle.file),
      file: bundle.file,
      document: bundle.document,
      matches,
    };

    if (matches) {
      entry.css = bundle.css;
    }

    return entry;
  });
}

export function userstyleHeader(metadata = getConfig().metadata || {}) {
  const lines = Object.entries(metadata).map(
    ([key, value]) => `@${key.padEnd(15)} ${value}`,
  );

  return `/* ==UserStyle==\n${lines.join("\n")}\n==/UserStyle== */`;
}

export function indent(css, spaces = 2) {
  const pad = " ".repeat(spaces);
  return css
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

export function minifyCss(css) {
  const source = String(css || "").trim();
  if (!source) {
    return "";
  }

  const { code } = lightningcss({
    filename: "bundle.css",
    code: Buffer.from(source),
    minify: true,
  });
  return Buffer.from(code).toString("utf8").trim();
}

export function assembleUserstyle(compiled, { compact = false, metadata } = {}) {
  const sections = compiled.map((bundle) => {
    const css = compact ? minifyCss(bundle.css) : bundle.css.trim();
    if (compact) {
      return `@-moz-document ${bundle.document}{${css}}`;
    }
    return `@-moz-document ${bundle.document} {\n${indent(css)}\n}`;
  });

  return `${userstyleHeader(metadata)}\n\n${sections.join(compact ? "\n" : "\n\n")}\n`;
}
