#!/usr/bin/env node
import { loadProjectConfig } from "./context.mjs";
import { runCheck } from "./commands/check.mjs";
import { startDev } from "./commands/dev.mjs";
import { runDoctor } from "./commands/doctor.mjs";
import { exportUserstyle } from "./commands/export.mjs";
import { executeLint } from "./commands/lint.mjs";
import { installPreview } from "./commands/preview.mjs";
import { fetchSnapshots } from "./commands/snapshot.mjs";

const help = `userstyle-dev <command>

  dev              Live-inject server and publish the UserStyle on each build
  export           Write expanded and minified UserStyle files
  doctor           Check bundles, pages, and snapshot catalog
  lint             Lint selectors against snapshots
  check            doctor + lint
  snapshot         Fetch public page snapshots (--only id, --force)
  preview:install  Symlink the selector-hover editor extension

Run from a directory that contains style.config.mjs.
`;

const command = process.argv[2];
const rest = process.argv.slice(3);

if (!command || command === "--help" || command === "-h") {
  console.log(help);
  process.exit(0);
}

try {
  if (command === "preview:install") {
    installPreview();
  } else if (command === "dev") {
    await loadProjectConfig();
    await startDev();
  } else if (command === "export") {
    await loadProjectConfig();
    exportUserstyle();
  } else if (command === "doctor") {
    await loadProjectConfig();
    const report = runDoctor();
    if (report.errors.length > 0) {
      process.exitCode = 1;
    }
  } else if (command === "lint") {
    await loadProjectConfig();
    const report = executeLint(rest);
    if (report.totals.errors > 0) {
      process.exitCode = 1;
    }
  } else if (command === "check") {
    await loadProjectConfig();
    runCheck();
  } else if (command === "snapshot") {
    await loadProjectConfig();
    await fetchSnapshots(rest);
  } else {
    console.error(`Unknown command: ${command}\n`);
    console.error(help);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
