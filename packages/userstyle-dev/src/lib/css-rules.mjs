import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";
import { SourceMapConsumer } from "source-map-js";
import { root } from "../context.mjs";
import { normalizeDeclarations, normalizeSelector, ruleFingerprint } from "./css-normalize.mjs";

const NEST_AT = new Set([
  "media",
  "supports",
  "layer",
  "container",
  "scope",
  "document",
  "-moz-document",
]);

const SKIP_QUERY = /^(?:html|body|\*|\:root)$/i;

const DROP_PSEUDO =
  /::(?:before|after|placeholder|marker|backdrop|file-selector-button|selection|first-line|first-letter|grammar-error|spelling-error|-moz-focus-inner)\b/gi;

const DROP_STATE =
  /:(?:hover|focus-visible|focus-within|focus|active|visited|target|checked|disabled|enabled|invalid|valid|optional|required|read-write|read-only|placeholder-shown|default|indeterminate|out-of-range|in-range|empty|fullscreen|modal|popover-open)\b/gi;

export function extractStyleRules(css) {
  const rules = [];
  let i = 0;
  const n = css.length;

  function skipSpaceAndComments() {
    while (i < n) {
      const c = css[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i += 1;
        continue;
      }
      if (c === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      break;
    }
  }

  function skipString(quote) {
    i += 1;
    while (i < n) {
      if (css[i] === "\\") {
        i += 2;
        continue;
      }
      if (css[i] === quote) {
        i += 1;
        return;
      }
      i += 1;
    }
  }

  function skipBlock() {
    readBlockBody();
  }

  function readBlockBody() {
    if (css[i] !== "{") {
      return "";
    }
    i += 1;
    const start = i;
    let depth = 1;
    while (i < n && depth > 0) {
      const c = css[i];
      if (c === '"' || c === "'") {
        skipString(c);
        continue;
      }
      if (c === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          const body = css.slice(start, i);
          i += 1;
          return body;
        }
      }
      i += 1;
    }
    return css.slice(start);
  }

  function parseRules(stopOnClose, atRulePath) {
    while (i < n) {
      skipSpaceAndComments();
      if (i >= n) {
        return;
      }
      if (stopOnClose && css[i] === "}") {
        return;
      }

      if (css[i] === "@") {
        const atStart = i;
        i += 1;
        while (i < n && /[A-Za-z0-9_-]/.test(css[i])) {
          i += 1;
        }
        const atName = css.slice(atStart + 1, i).toLowerCase();
        while (i < n && css[i] !== "{" && css[i] !== ";") {
          if (css[i] === '"' || css[i] === "'") {
            skipString(css[i]);
            continue;
          }
          i += 1;
        }
        if (css[i] === ";") {
          i += 1;
          continue;
        }
        if (css[i] !== "{") {
          continue;
        }
        if (NEST_AT.has(atName)) {
          const prelude = css.slice(atStart, i).replace(/\s+/g, " ").trim();
          i += 1;
          parseRules(true, [...atRulePath, prelude]);
          if (css[i] === "}") {
            i += 1;
          }
        } else {
          skipBlock();
        }
        continue;
      }

      const selStart = i;
      while (i < n) {
        const c = css[i];
        if (c === '"' || c === "'") {
          skipString(c);
          continue;
        }
        if (c === "/" && css[i + 1] === "*") {
          const end = css.indexOf("*/", i + 2);
          i = end < 0 ? n : end + 2;
          continue;
        }
        if (c === "{" || c === "}") {
          break;
        }
        i += 1;
      }
      if (css[i] !== "{") {
        if (stopOnClose && css[i] === "}") {
          return;
        }
        i += 1;
        continue;
      }

      const selector = css.slice(selStart, i).replace(/\s+/g, " ").trim();
      const declarations = readBlockBody().trim();
      if (selector) {
        const normalized = normalizeDeclarations(declarations);
        if (normalized.count === 0) {
          continue;
        }
        rules.push({
          selector,
          declarations,
          declarationsNormalized: normalized.text,
          fingerprint: ruleFingerprint(
            selector,
            atRulePath,
            normalized.text,
          ),
          declFingerprint: normalized.text,
          declarationCount: normalized.count,
          atRulePath,
          index: selStart,
        });
      }
    }
  }

  parseRules(false, []);
  return rules;
}

export function queryableSelector(selector) {
  const parts = [];
  for (const raw of splitSelectors(selector)) {
    const cleaned = raw
      .replace(DROP_PSEUDO, "")
      .replace(DROP_STATE, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned || isSkippedQueryPart(cleaned)) {
      continue;
    }
    parts.push(cleaned);
  }
  return parts.join(", ");
}

function isSkippedQueryPart(part) {
  if (SKIP_QUERY.test(part)) {
    return true;
  }
  if (/(^|\s)\*$/.test(part)) {
    return true;
  }
  return /^[a-z][a-z0-9]*$/i.test(part);
}

export function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === '"' || c === "'") {
      i += 1;
      while (i < selector.length && selector[i] !== c) {
        if (selector[i] === "\\") {
          i += 1;
        }
        i += 1;
      }
      continue;
    }
    if (c === "(" || c === "[") {
      depth += 1;
    } else if (c === ")" || c === "]") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

export function lastCompoundOffset(selector) {
  const first = splitSelectors(selector)[0] || selector;
  let depth = 0;
  let last = 0;
  for (let i = 0; i < first.length; i += 1) {
    const c = first[i];
    if (c === "(" || c === "[") {
      depth += 1;
    } else if (c === ")" || c === "]") {
      depth -= 1;
    } else if (depth === 0 && /[ >+~]/.test(c)) {
      let j = i + 1;
      while (j < first.length && /[ >+~]/.test(first[j])) {
        j += 1;
      }
      last = j;
      i = j - 1;
    }
  }
  return last;
}

export function indexToLineColumn(css, index) {
  let line = 1;
  let column = 0;
  const end = Math.min(index, css.length);
  for (let i = 0; i < end; i += 1) {
    if (css[i] === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export function toRepoPath(source) {
  if (!source) {
    return null;
  }
  let file = source;
  if (file.startsWith("file://")) {
    file = fileURLToPath(file);
  }
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || rel.startsWith("node_modules/")) {
    return null;
  }
  return rel;
}

export function compileBundleRules(file, options = {}) {
  const abs = isAbsolute(file) ? file : join(root, file);
  const result = sass.compile(abs, {
    style: "expanded",
    sourceMap: true,
    loadPaths: options.loadPaths ?? [join(root, "src")],
  });
  const css = result.css;
  const consumer = new SourceMapConsumer(result.sourceMap);
  const bundleFile = toRepoPath(abs) || file;
  const rules = [];

  for (const rule of extractStyleRules(css)) {
    const mapAt = rule.index + lastCompoundOffset(rule.selector);
    const generated = indexToLineColumn(css, mapAt);
    const original = consumer.originalPositionFor({
      line: generated.line,
      column: generated.column,
    });
    const sourceFile = toRepoPath(original.source);
    rules.push({
      ...rule,
      selector: normalizeSelector(rule.selector),
      file: sourceFile,
      line: original.line || null,
      column: original.column ?? null,
      bundleFile,
    });
  }

  return { css, rules, file: bundleFile };
}
