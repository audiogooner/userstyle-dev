import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assembleUserstyle,
  compileFile,
  minifyCss,
  parseDocumentRules,
  userstyleHeader,
} from "../src/compile.mjs";
import { extractStyleRules } from "../src/lib/css-rules.mjs";
import { isSharedBundleFile } from "../src/compile.mjs";

const fixture = "test/fixtures/lint/page-a.scss";
const compressedCss = compileFile(fixture, { style: "compressed" }).trim();

const sampleBundles = [
  {
    file: fixture,
    document: 'url-prefix("https://example.com/index.php?page=tags&s=list")',
    css: compressedCss,
  },
  {
    file: fixture,
    document: 'url("https://example.com/")',
    css: compressedCss,
  },
];

const metadata = {
  name: "Test Theme",
  version: "0.0.0",
  preprocessor: "default",
};

describe("assembleUserstyle compact", () => {
  it("keeps the UserStyle header and document matchers", () => {
    const output = assembleUserstyle(sampleBundles, { compact: true, metadata });
    const header = userstyleHeader(metadata);

    assert.ok(output.startsWith(header));
    assert.match(output, /==UserStyle==/);
    assert.match(output, /@name\s+Test Theme/);

    for (const bundle of sampleBundles) {
      assert.ok(output.includes(`@-moz-document ${bundle.document}{`));
      for (const { kind, value } of parseDocumentRules(bundle.document)) {
        assert.ok(output.includes(`${kind}("${value}")`));
      }
    }
  });

  it("emits one line per document block after the header", () => {
    const output = assembleUserstyle(sampleBundles, { compact: true, metadata });
    const body = output.slice(output.indexOf("==/UserStyle== */")).trim();
    const blocks = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("@-moz-document"));

    assert.equal(blocks.length, sampleBundles.length);
    for (const block of blocks) {
      assert.equal(block.includes("\n"), false);
      assert.match(block, /\{.+\}$/);
    }
  });
});

describe("compressed compile", () => {
  it("emits the same selectors as expanded", () => {
    const expanded = compileFile(fixture, { style: "expanded" });
    const compressed = compileFile(fixture, { style: "compressed" });
    const selectors = (css) =>
      extractStyleRules(css).map((rule) => rule.selector);

    assert.deepEqual(selectors(expanded), selectors(compressed));
  });
});

describe("minifyCss", () => {
  it("shortens values without dropping modern selectors", () => {
    const input =
      ".box:has(> a){margin:0px;background:rgba(0,0,0,0);color:color-mix(in srgb, var(--blue) 50%, transparent)}";
    const out = minifyCss(input);

    assert.ok(out.includes(":has("));
    assert.ok(out.includes("color-mix("));
    assert.ok(!out.includes("0px"));
    assert.ok(!out.includes("rgba(0,0,0,0)"));
    assert.ok(out.length < input.length);
  });
});

describe("isSharedBundleFile", () => {
  it("treats base and chrome bundles as shared", () => {
    assert.equal(isSharedBundleFile("src/base.scss"), true);
    assert.equal(isSharedBundleFile("src/chrome-default.scss"), true);
    assert.equal(isSharedBundleFile("src/pages/help.scss"), false);
  });
});

describe("renderUserscript", () => {
  it("fills site match, origin, and blackout css", async () => {
    const { renderUserscript } = await import("../src/userscript.mjs");
    const { setRoot, loadProjectConfig, root } = await import("../src/context.mjs");
    const dir = mkdtempSync(join(tmpdir(), "userstyle-render-"));
    const previous = root;
    try {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/base.scss"), "body { color: red; }\n");
      writeFileSync(
        join(dir, "style.config.mjs"),
        `export const site = { id: "example", origin: "https://example.com" };
export const metadata = { name: "Example Theme", namespace: "https://example.com" };
export const bundles = [{ file: "src/base.scss", document: 'url-prefix("https://example.com")' }];
export const exportFile = "example.user.css";
export const exportMinFile = "example.min.user.css";
export const snapshotPages = [];
export const blackoutCss = "img { filter: brightness(0); }\\n";
`,
      );
      setRoot(dir);
      const config = await loadProjectConfig();
      const source = renderUserscript(config);
      assert.match(source, /@name\s+Example Theme/);
      assert.match(source, /@match\s+https:\/\/example\.com\/\*/);
      assert.match(source, /@connect\s+example\.com/);
      assert.match(source, /example-dev-overlay/);
      assert.match(source, /filter: brightness\(0\)/);
      assert.equal(source.includes("__SITE_ID__"), false);
      assert.equal(readFileSync(join(dir, "src/base.scss"), "utf8").includes("red"), true);
    } finally {
      setRoot(previous);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
