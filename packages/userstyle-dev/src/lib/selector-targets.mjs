import { join } from "node:path";
import * as sass from "sass";
import { SourceMapConsumer } from "source-map-js";
import { getConfig, root } from "../context.mjs";
import { matchesDocument } from "../compile.mjs";
import {
  extractStyleRules,
  indexToLineColumn,
  lastCompoundOffset,
  queryableSelector,
  toRepoPath,
} from "./css-rules.mjs";

export {
  extractStyleRules,
  lastCompoundOffset,
  queryableSelector,
} from "./css-rules.mjs";

export function compileSelectorTargets(file) {
  const result = sass.compile(join(root, file), {
    style: "expanded",
    sourceMap: true,
    loadPaths: [join(root, "src")],
  });
  const css = result.css;
  const consumer = new SourceMapConsumer(result.sourceMap);
  const seen = new Set();
  const targets = [];

  for (const rule of extractStyleRules(css)) {
    const query = queryableSelector(rule.selector);
    if (!query) {
      continue;
    }

    const mapAt = rule.index + lastCompoundOffset(rule.selector);
    const generated = indexToLineColumn(css, mapAt);
    const original = consumer.originalPositionFor({
      line: generated.line,
      column: generated.column,
    });
    const sourceFile = toRepoPath(original.source);
    if (!sourceFile || !sourceFile.endsWith(".scss") || !original.line) {
      continue;
    }

    const key = `${sourceFile}:${original.line}:${query}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({
      file: sourceFile,
      line: original.line,
      selector: rule.selector,
      query,
    });
  }

  return targets;
}

export function selectorTargetsForHref(href) {
  const bundles = getConfig().bundles || [];
  const matching = bundles.filter((bundle) =>
    matchesDocument(bundle.document, href || ""),
  );
  const pageFirst = matching.sort((a, b) => {
    const aBase = a.file.endsWith("base.scss") ? 1 : 0;
    const bBase = b.file.endsWith("base.scss") ? 1 : 0;
    return aBase - bBase;
  });

  const seen = new Set();
  const targets = [];
  for (const bundle of pageFirst) {
    for (const target of compileSelectorTargets(bundle.file)) {
      const key = `${target.file}:${target.line}:${target.query}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      targets.push(target);
    }
  }
  return targets;
}
