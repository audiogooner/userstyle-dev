import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { root } from "../context.mjs";

export function defaultReportPath() {
  return join(root, "lint-results.json");
}

export function summarizeFindings(findings, skippedDead = []) {
  let errors = 0;
  let warnings = 0;
  const byRule = {};
  for (const finding of findings) {
    if (finding.severity === "error") {
      errors += 1;
    } else {
      warnings += 1;
    }
    byRule[finding.rule] = (byRule[finding.rule] || 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      errors,
      warnings,
      findings: findings.length,
      deadSelectorSkipped: skippedDead.length,
    },
    byRule,
    skippedDead,
    findings,
  };
}

function formatLocation(location) {
  return `${location.file}:${location.line}`;
}

export function formatReport(report, { jsonPath, verbose = false } = {}) {
  const lines = [
    `lint:styles — ${report.totals.errors} errors, ${report.totals.warnings} warnings`,
    "",
  ];

  const groups = new Map();
  for (const finding of report.findings) {
    const key = `${finding.severity}:${finding.rule}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(finding);
  }

  const keys = [...groups.keys()].sort((a, b) => {
    const aErr = a.startsWith("error") ? 0 : 1;
    const bErr = b.startsWith("error") ? 0 : 1;
    return aErr - bErr || a.localeCompare(b);
  });

  for (const key of keys) {
    const items = groups.get(key);
    const [severity, rule] = key.split(":");
    const label = severity === "error" ? "ERROR" : "WARN ";
    lines.push(`${label}  ${rule} (${items.length})`);
    if (severity !== "error" && !verbose) {
      lines.push("");
      continue;
    }
    for (const finding of items) {
      const primary = finding.locations[0];
      const where = primary ? `${formatLocation(primary)}  ` : "";
      lines.push(`       ${where}${finding.message}`);
      if (finding.locations.length > 1) {
        const extras = finding.locations
          .slice(1)
          .map((location) => formatLocation(location))
          .join(", ");
        lines.push(`       also ${extras}`);
      }
    }
    lines.push("");
  }

  if (report.skippedDead.length) {
    const noSnapshot = report.skippedDead.filter(
      (item) => item.reason === "no-snapshot",
    );
    if (noSnapshot.length) {
      lines.push(
        `dead-selector: ${noSnapshot.length} bundles skipped (no snapshot)`,
      );
      for (const item of noSnapshot) {
        lines.push(`       ${item.file}`);
      }
      lines.push("");
    }
  }

  if (!verbose && report.totals.warnings > 0) {
    lines.push("Pass --verbose to list warnings.");
    lines.push("");
  }

  if (jsonPath) {
    lines.push(`JSON written to ${jsonPath}`);
  }
  return lines.join("\n");
}

export function writeReport(report, dest = defaultReportPath()) {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
}
