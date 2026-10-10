import { getConfig, getLintConfig, root } from "../context.mjs";
import { matchesIgnore } from "../lib/css-normalize.mjs";
import { compileBundleRules } from "../lib/css-rules.mjs";
import { lintCrossFile } from "../lib/lint-cross-file.mjs";
import { lintAllDead } from "../lib/lint-dead-selectors.mjs";
import { lintDuplicates } from "../lib/lint-duplicates.mjs";
import { lintRedundantBase } from "../lib/lint-redundant-base.mjs";
import {
  formatReport,
  summarizeFindings,
  writeReport,
} from "../lib/lint-report.mjs";
import { bundleId } from "../compile.mjs";
import { join } from "node:path";

export function compileLintBundles(bundleList, options = {}) {
  return bundleList.map((bundle) => {
    const compiled = compileBundleRules(bundle.file, options);
    return {
      ...bundle,
      ...compiled,
      id: bundleId(bundle.file),
    };
  });
}

export function collectFindings(compiled, config = {}) {
  const findings = [];
  const usable = compiled.filter(
    (bundle) => !matchesIgnore(bundle.file, config.ignoreFiles),
  );
  const base = usable.find((bundle) => bundle.file.endsWith("base.scss"));

  for (const bundle of usable) {
    findings.push(...lintDuplicates(bundle, config));
    if (base && bundle !== base) {
      findings.push(...lintRedundantBase(bundle, base, config));
    }
  }

  findings.push(...lintCrossFile(usable, config));

  const dead = lintAllDead(usable, config);
  findings.push(...dead.findings);

  return { findings, skippedDead: dead.skipped };
}

export function runLint(options = {}) {
  const bundleList = options.bundles || getConfig().bundles || [];
  const config = options.config || getLintConfig();
  const compiled = compileLintBundles(bundleList, options);
  const { findings, skippedDead } = collectFindings(compiled, config);
  return summarizeFindings(findings, skippedDead);
}

export function executeLint(argv = []) {
  const verbose = argv.includes("--verbose") || argv.includes("-v");
  const writeJson = !argv.includes("--no-json");
  const report = runLint();
  const jsonPath = join(root, "lint-results.json");
  if (writeJson) {
    writeReport(report, jsonPath);
  }
  console.log(
    formatReport(report, {
      jsonPath: writeJson ? jsonPath : undefined,
      verbose,
    }),
  );
  return report;
}
