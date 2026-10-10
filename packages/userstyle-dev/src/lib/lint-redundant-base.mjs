import { isIgnoredSelector, isPartialSource } from "./css-normalize.mjs";
import { ruleLocation } from "./lint-duplicates.mjs";

export function lintRedundantBase(pageBundle, baseBundle, config = {}) {
  if (!baseBundle?.rules?.length) {
    return [];
  }

  const baseFingerprints = new Set(baseBundle.rules.map((rule) => rule.fingerprint));
  const findings = [];

  for (const rule of pageBundle.rules) {
    if (isPartialSource(rule.file)) {
      continue;
    }
    if (isIgnoredSelector(rule.selector, config)) {
      continue;
    }
    if (!baseFingerprints.has(rule.fingerprint)) {
      continue;
    }
    findings.push({
      rule: "redundant-base",
      severity: "warning",
      message: `${rule.selector} repeats an identical base.scss rule`,
      locations: [ruleLocation(rule, pageBundle.file)],
    });
  }

  return findings;
}
