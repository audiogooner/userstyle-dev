import { isPartialSource, matchesIgnore, normalizeSelector } from "./css-normalize.mjs";
import { bundleId, isSharedBundleFile } from "../compile.mjs";
import { ruleLocation } from "./lint-duplicates.mjs";

function isPageBundle(bundle) {
  return !isSharedBundleFile(bundle.file) && !isPartialSource(bundle.file);
}

function isPageAuthored(rule, bundle) {
  if (isPartialSource(rule.file)) {
    return false;
  }
  if (!rule.file) {
    return true;
  }
  return rule.file === bundle.file || rule.file.startsWith("src/pages/");
}

function shortName(file) {
  return bundleId(file);
}

function formatSelectors(rules) {
  const seen = [];
  for (const rule of rules) {
    const sel = normalizeSelector(rule.selector);
    if (!seen.includes(sel)) {
      seen.push(sel);
    }
  }
  return seen.slice(0, 4).join(" + ") + (seen.length > 4 ? " + …" : "");
}

function sequenceKey(rules) {
  return rules
    .map((rule) => `${normalizeSelector(rule.selector)}@@${rule.declFingerprint}`)
    .join("||");
}

function clusterFinding(key, entries, kind) {
  const files = [...new Set(entries.map((entry) => entry.bundle.file))];
  const sample = entries[0].rules;
  const locations = entries.flatMap((entry) =>
    entry.rules.map((rule) => ruleLocation(rule, entry.bundle.file)),
  );
  const names = files.map(shortName);
  return {
    rule: "duplicate-declarations",
    severity: "warning",
    message:
      kind === "sequence"
        ? `${formatSelectors(sample)} appears as a ${sample.length}-rule sequence in ${files.length} files (${names.join(", ")}) — consider a shared mixin`
        : `${formatSelectors(sample)} shares a ${sample[0].declarationCount}-declaration block across ${files.length} files (${names.join(", ")}) — consider a shared mixin`,
    locations,
    meta: { key, files, kind },
  };
}

export function lintCrossFile(bundles, config = {}) {
  const minDecl = config.minDeclarationsForCrossFile ?? 4;
  const minFiles = config.minFilesForCrossFile ?? 2;
  const ignoreFingerprints = config.ignoreRules?.["duplicate-declarations"] || [];
  const pageBundles = bundles.filter(isPageBundle);
  const findings = [];

  const byDecl = new Map();
  for (const bundle of pageBundles) {
    for (const rule of bundle.rules) {
      if (!isPageAuthored(rule, bundle)) {
        continue;
      }
      if (rule.declarationCount < minDecl) {
        continue;
      }
      if (matchesIgnore(rule.declFingerprint, ignoreFingerprints)) {
        continue;
      }
      const list = byDecl.get(rule.declFingerprint);
      const entry = { bundle, rules: [rule] };
      if (list) {
        list.push(entry);
      } else {
        byDecl.set(rule.declFingerprint, [entry]);
      }
    }
  }

  for (const [key, entries] of byDecl) {
    const files = new Set(entries.map((entry) => entry.bundle.file));
    if (files.size < minFiles) {
      continue;
    }
    findings.push(clusterFinding(key, entries, "block"));
  }

  const sequences = new Map();
  for (const bundle of pageBundles) {
    const authored = bundle.rules.filter((rule) => isPageAuthored(rule, bundle));
    const maxLen = Math.min(8, authored.length);
    for (let len = 2; len <= maxLen; len += 1) {
      for (let i = 0; i + len <= authored.length; i += 1) {
        const window = authored.slice(i, i + len);
        const key = sequenceKey(window);
        if (matchesIgnore(key, ignoreFingerprints)) {
          continue;
        }
        const list = sequences.get(key);
        const entry = { bundle, rules: window, len };
        if (list) {
          list.push(entry);
        } else {
          sequences.set(key, [entry]);
        }
      }
    }
  }

  const sequenceFindings = [];
  for (const [key, entries] of sequences) {
    const files = new Set(entries.map((entry) => entry.bundle.file));
    if (files.size < minFiles) {
      continue;
    }
    sequenceFindings.push(clusterFinding(key, entries, "sequence"));
  }

  sequenceFindings.sort((a, b) => b.meta.key.length - a.meta.key.length);
  const kept = [];
  for (const finding of sequenceFindings) {
    const covered = kept.some(
      (existing) =>
        existing.meta.key.includes(finding.meta.key) &&
        finding.meta.files.every((file) => existing.meta.files.includes(file)),
    );
    if (!covered) {
      kept.push(finding);
    }
  }

  findings.push(...kept);
  return findings;
}
