import { runDoctor } from "./doctor.mjs";
import { executeLint } from "./lint.mjs";

export function runCheck() {
  const doctor = runDoctor();
  const lint = executeLint(["--no-json"]);
  if (doctor.errors.length > 0 || lint.totals.errors > 0) {
    process.exitCode = 1;
  }
  return { doctor, lint };
}
