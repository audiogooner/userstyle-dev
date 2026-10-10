import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { bundleId, isSharedBundleFile } from "../compile.mjs";
import { isIgnoredSelector, isPartialSource, matchesIgnore } from "./css-normalize.mjs";
import { queryableSelector, splitSelectors } from "./css-rules.mjs";
import { ruleLocation } from "./lint-duplicates.mjs";
import { pagesDir } from "./snapshot-io.mjs";

export function snapshotIdForBundle(file, config = {}, existsFn) {
  const mapped = config.snapshotMap?.[file];
  const id = mapped || bundleId(file);
  const check = existsFn || ((candidate) => existsSync(join(pagesDir(), `${candidate}.html`)));
  if (id && check(id)) {
    return id;
  }
  return null;
}

export function loadSnapshotDocument(snapshotId, html) {
  const source =
    html ??
    readFileSync(join(pagesDir(), `${snapshotId}.html`), "utf8");
  return parseHTML(source).document;
}

function querySafe(document, selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return undefined;
  }
}

function shouldIgnoreDeadPart(part, query, config) {
  if (isIgnoredSelector(part, config)) {
    return true;
  }
  const patterns = config.ignoreRules?.["dead-selector"] || [];
  return matchesIgnore(part, patterns) || matchesIgnore(query, patterns);
}

export function lintDeadSelectors(bundle, document, snapshotId, config = {}) {
  const findings = [];

  for (const rule of bundle.rules) {
    if (isPartialSource(rule.file)) {
      continue;
    }
    const parts = splitSelectors(rule.selector);
    let queryable = 0;
    let matched = 0;
    const queries = [];

    for (const part of parts) {
      const query = queryableSelector(part);
      if (!query) {
        continue;
      }
      if (shouldIgnoreDeadPart(part, query, config)) {
        continue;
      }
      queries.push(query);
      const result = querySafe(document, query);
      if (result === undefined) {
        continue;
      }
      queryable += 1;
      if (result) {
        matched += 1;
      }
    }

    if (queryable === 0) {
      continue;
    }
    if (matched > 0) {
      continue;
    }
    // `:has()` is often optional UI or a slimmed snapshot gap, not a dead rule.
    if (queries.every((query) => query.includes(":has("))) {
      continue;
    }

    findings.push({
      rule: "dead-selector",
      severity: "warning",
      message: `${rule.selector} — no match in snapshot ${snapshotId}`,
      locations: [ruleLocation(rule, bundle.file)],
    });
  }

  return findings;
}

export function lintAllDead(bundles, config = {}, options = {}) {
  const findings = [];
  const skipped = [];
  const load =
    options.loadDocument ||
    ((snapshotId) => loadSnapshotDocument(snapshotId));
  const exists = options.snapshotExists;

  for (const bundle of bundles) {
    if (isSharedBundleFile(bundle.file)) {
      skipped.push({ file: bundle.file, reason: "shared-bundle" });
      continue;
    }
    const snapshotId = snapshotIdForBundle(bundle.file, config, exists);
    if (!snapshotId) {
      skipped.push({ file: bundle.file, reason: "no-snapshot" });
      continue;
    }
    const document = load(snapshotId);
    findings.push(...lintDeadSelectors(bundle, document, snapshotId, config));
  }

  return { findings, skipped };
}
