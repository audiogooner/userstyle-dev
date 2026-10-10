import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { scaffold } from "../src/scaffold.mjs";
import { loadProjectConfig, root, setRoot } from "../../userstyle-dev/src/context.mjs";
import { runDoctor } from "../../userstyle-dev/src/commands/doctor.mjs";
import { executeLint } from "../../userstyle-dev/src/commands/lint.mjs";

describe("create-userstyle", () => {
  it("scaffolds a project that passes userstyle-dev check", async () => {
    const parent = mkdtempSync(join(tmpdir(), "create-userstyle-"));
    const dir = join(parent, "rule34-catppuccin");
    const previous = root;
    try {
      const created = await scaffold({
        dir,
        origin: "https://rule34.xxx",
        name: "Rule34 Catppuccin",
        author: "Test",
      });
      assert.equal(created.id, "rule34");
      setRoot(dir);
      await loadProjectConfig();
      const doctor = runDoctor();
      assert.deepEqual(
        doctor.errors.map((item) => item.message),
        [],
      );
      const lint = executeLint(["--no-json"]);
      assert.equal(lint.totals.errors, 0);
    } finally {
      setRoot(previous);
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
