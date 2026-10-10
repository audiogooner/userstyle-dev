import { isIgnoredSelector, matchesIgnore, normalizeSelector } from "./css-normalize.mjs";

function propertyNames(rule) {
  if (!rule.declarationsNormalized) {
    return [];
  }
  return rule.declarationsNormalized
    .split(";")
    .map((part) => part.split(":")[0])
    .filter(Boolean);
}

function hasOverlappingProperties(rules) {
  const seen = new Set();
  for (const rule of rules) {
    for (const name of propertyNames(rule)) {
      if (seen.has(name)) {
        return true;
      }
      seen.add(name);
    }
  }
  return false;
}

export function ruleLocation(rule, bundleFile) {
  return {
    file: rule.file || rule.bundleFile || bundleFile,
    line: rule.line || 1,
    selector: rule.selector,
  };
}

export function lintDuplicates(bundle, config = {}) {
  const findings = [];
  const ignoreSelectors = [
    ...(config.ignoreSelectors || []),
    ...(config.ignoreRules?.["duplicate-selector"] || []),
  ];
  const bySelector = new Map();

  for (const rule of bundle.rules) {
    if (isIgnoredSelector(rule.selector, { ignoreSelectors })) {
      continue;
    }
    if (matchesIgnore(rule.selector, config.ignoreRules?.["duplicate-selector"])) {
      continue;
    }
    const key = `${rule.atRulePath.join("\n")}@@${normalizeSelector(rule.selector)}`;
    const group = bySelector.get(key);
    if (group) {
      group.push(rule);
    } else {
      bySelector.set(key, [rule]);
    }
  }

  for (const group of bySelector.values()) {
    if (group.length < 2 || !hasOverlappingProperties(group)) {
      continue;
    }

    const selector = group[0].selector;
    const locations = group.map((rule) => ruleLocation(rule, bundle.file));
    findings.push({
      rule: "duplicate-selector",
      severity: "error",
      message: `${selector} is declared ${group.length} times in the same context; later rules override earlier ones`,
      locations,
    });

    const byFingerprint = new Map();
    for (const rule of group) {
      const list = byFingerprint.get(rule.fingerprint);
      if (list) {
        list.push(rule);
      } else {
        byFingerprint.set(rule.fingerprint, [rule]);
      }
    }

    for (const copies of byFingerprint.values()) {
      if (copies.length < 2) {
        continue;
      }
      findings.push({
        rule: "duplicate-block",
        severity: "error",
        message: `${copies[0].selector} repeats an identical declaration block`,
        locations: copies.map((rule) => ruleLocation(rule, bundle.file)),
      });
    }
  }

  return findings;
}
