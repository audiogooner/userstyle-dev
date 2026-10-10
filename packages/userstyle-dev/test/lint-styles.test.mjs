import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeDeclarations } from "../src/lib/css-normalize.mjs";
import { compileBundleRules, extractStyleRules, queryableSelector } from "../src/lib/css-rules.mjs";
import { lintCrossFile } from "../src/lib/lint-cross-file.mjs";
import {
  lintAllDead,
  lintDeadSelectors,
  loadSnapshotDocument,
  snapshotIdForBundle,
} from "../src/lib/lint-dead-selectors.mjs";
import { lintDuplicates } from "../src/lib/lint-duplicates.mjs";
import { lintRedundantBase } from "../src/lib/lint-redundant-base.mjs";
import { collectFindings, compileLintBundles } from "../src/commands/lint.mjs";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/lint");

function compileFixture(name) {
  return compileBundleRules(join(fixtureDir, name), {
    loadPaths: [fixtureDir],
  });
}

describe("css parser", () => {
  it("skips comment-only Sass parent shells", () => {
    const css = `
      .mainBodyPadding { color: red; }
      .mainBodyPadding { /* Copy column */ }
    `;
    const rules = extractStyleRules(css);
    assert.equal(rules.length, 1);
    assert.match(rules[0].declarations, /color:\s*red/);
  });

  it("captures declarations and nested @media context", () => {
    const css = `
      .box { color: blue; }
      @media only screen and (max-width: 850px) {
        .box { color: red; }
      }
    `;
    const rules = extractStyleRules(css);
    assert.equal(rules.length, 2);
    assert.equal(rules[0].selector, ".box");
    assert.match(rules[0].declarations, /color:\s*blue/);
    assert.deepEqual(rules[0].atRulePath, []);
    assert.equal(rules[1].atRulePath[0], "@media only screen and (max-width: 850px)");
  });

  it("strips comments and splits comma selectors", () => {
    const css = `
      /* skip */
      .foo, .bar { color: red; }
    `;
    const rules = extractStyleRules(css);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].selector, ".foo, .bar");
  });

  it("normalizes declaration order and whitespace", () => {
    const a = normalizeDeclarations(" display: block ; Color: RED !important; ");
    const b = normalizeDeclarations("color:RED!important;display:block");
    assert.equal(a.text, b.text);
    assert.equal(a.count, 2);
    assert.equal(a.text, "color:RED!important;display:block");
  });

  it("maps compiled rules back to SCSS source lines", () => {
    const compiled = compileFixture("dup-selector.scss");
    assert.equal(compiled.rules.length, 2);
    assert.equal(compiled.rules[0].line, 1);
    assert.equal(compiled.rules[1].line, 5);
    assert.match(compiled.rules[0].file, /dup-selector\.scss$/);
  });
});

describe("queryableSelector", () => {
  it("drops hover and pseudo-elements", () => {
    assert.equal(queryableSelector(".present:hover"), ".present");
    assert.equal(queryableSelector(".foo::before"), ".foo");
    assert.equal(queryableSelector("body"), "");
    assert.equal(
      queryableSelector("input[type=checkbox]:focus-visible"),
      "input[type=checkbox]",
    );
  });
});

describe("within-bundle lint", () => {
  it("flags duplicate selectors with different declarations", () => {
    const bundle = compileFixture("dup-selector.scss");
    const findings = lintDuplicates(bundle);
    const dup = findings.filter((item) => item.rule === "duplicate-selector");
    assert.equal(dup.length, 1);
    assert.equal(dup[0].severity, "error");
    assert.equal(dup[0].locations.length, 2);
    assert.equal(dup[0].locations[0].line, 1);
    assert.equal(dup[0].locations[1].line, 5);
  });

  it("flags identical duplicate blocks", () => {
    const bundle = compileFixture("dup-block.scss");
    const findings = lintDuplicates(bundle);
    assert.ok(findings.some((item) => item.rule === "duplicate-block"));
    assert.ok(findings.some((item) => item.rule === "duplicate-selector"));
  });

  it("treats the same selector in @media as a different context", () => {
    const bundle = compileFixture("nested-media.scss");
    const findings = lintDuplicates(bundle);
    const dup = findings.filter((item) => item.rule === "duplicate-selector");
    assert.equal(dup.length, 1);
    assert.match(dup[0].message, /\.box/);
    assert.equal(
      dup[0].locations.every((location) => location.line >= 5),
      true,
    );
  });

  it("ignores same-selector blocks with disjoint properties", () => {
    const bundle = compileFixture("disjoint.scss");
    const findings = lintDuplicates(bundle);
    assert.equal(findings.length, 0);
  });

  it("flags page rules that copy base exactly", () => {
    const base = compileFixture("base.scss");
    const page = compileFixture("base-page.scss");
    const findings = lintRedundantBase(page, base);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "redundant-base");
    assert.match(findings[0].message, /^a /);
  });
});

describe("cross-file lint", () => {
  it("warns when a 4-declaration block is copied across pages", () => {
    const bundles = [
      { file: "src/pages/page-a.scss", ...compileFixture("page-a.scss") },
      { file: "src/pages/page-b.scss", ...compileFixture("page-b.scss") },
    ];
    const findings = lintCrossFile(bundles, {
      minDeclarationsForCrossFile: 4,
      minFilesForCrossFile: 2,
    });
    const blocks = findings.filter((item) => item.meta?.kind === "block");
    assert.ok(blocks.length >= 1);
    assert.equal(blocks[0].severity, "warning");
    assert.match(blocks[0].message, /shared mixin/);
  });

  it("warns on a copied consecutive rule sequence", () => {
    const bundles = [
      { file: "src/pages/page-a.scss", ...compileFixture("page-a.scss") },
      { file: "src/pages/page-b.scss", ...compileFixture("page-b.scss") },
    ];
    const findings = lintCrossFile(bundles);
    const sequences = findings.filter((item) => item.meta?.kind === "sequence");
    assert.ok(sequences.length >= 1);
    assert.match(sequences[0].message, /sequence/);
  });
});

describe("dead selectors", () => {
  it("warns on selectors that miss the snapshot and skips hover-only extras", () => {
    const bundle = compileFixture("dead.scss");
    const html = readFileSync(join(fixtureDir, "dead.html"), "utf8");
    const document = loadSnapshotDocument("dead", html);
    const findings = lintDeadSelectors(bundle, document, "dead");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, "dead-selector");
    assert.equal(findings[0].severity, "warning");
    assert.match(findings[0].message, /missing-element/);
  });

  it("ignores mapped snapshots that are not on disk", () => {
    assert.equal(
      snapshotIdForBundle(
        "src/pages/wiki.scss",
        { snapshotMap: { "src/pages/wiki.scss": "wiki-list" } },
        () => false,
      ),
      null,
    );
  });

  it("skips dead-selector lint when the snapshot file is missing", () => {
    const bundle = compileFixture("dead.scss");
    bundle.file = "src/pages/wiki.scss";
    const result = lintAllDead(
      [bundle],
      { snapshotMap: { "src/pages/wiki.scss": "wiki-list" } },
      { snapshotExists: () => false },
    );
    assert.equal(result.findings.length, 0);
    assert.equal(result.skipped[0]?.reason, "no-snapshot");
  });

  it("honors dead-selector ignore globs", () => {
    const bundle = compileFixture("dead.scss");
    const html = readFileSync(join(fixtureDir, "dead.html"), "utf8");
    const document = loadSnapshotDocument("dead", html);
    const findings = lintDeadSelectors(bundle, document, "dead", {
      ignoreRules: { "dead-selector": [".missing-element"] },
    });
    assert.equal(findings.length, 0);
  });
});

describe("collectFindings integration", () => {
  it("aggregates fixture findings with expected counts", () => {
    const compiled = compileLintBundles(
      [
        { file: join(fixtureDir, "base.scss"), document: 'url-prefix("https://example.test")' },
        { file: join(fixtureDir, "base-page.scss"), document: 'url("https://example.test/page")' },
        { file: join(fixtureDir, "dup-selector.scss"), document: 'url("https://example.test/dup")' },
      ],
      { loadPaths: [fixtureDir] },
    );
    const { findings } = collectFindings(compiled, {
      minDeclarationsForCrossFile: 4,
      minFilesForCrossFile: 2,
      ignoreSelectors: [":root", "html", "body"],
      ignoreRules: { "dead-selector": [] },
      snapshotMap: {},
    });
    assert.ok(findings.some((item) => item.rule === "duplicate-selector"));
    assert.ok(findings.some((item) => item.rule === "redundant-base"));
  });
});
