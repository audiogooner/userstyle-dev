import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig, root } from "../context.mjs";
import { assembleUserstyle, compileBundles } from "../compile.mjs";

export function exportUserstyle() {
  const config = getConfig();
  const expanded = compileBundles();
  const compressed = compileBundles({ style: "compressed" });
  const metadata = config.metadata;
  const files = [
    [config.exportFile, assembleUserstyle(expanded, { metadata })],
    [
      config.exportMinFile,
      assembleUserstyle(compressed, { compact: true, metadata }),
    ],
  ];

  const written = [];
  for (const [rel, contents] of files) {
    if (!rel) {
      throw new Error("style.config.mjs must export exportFile and exportMinFile");
    }
    writeFileSync(join(root, rel), contents);
    written.push({ file: rel, bytes: Buffer.byteLength(contents) });
  }

  for (const { file, bytes } of written) {
    const kb = (bytes / 1024).toFixed(1);
    console.log(`Exported UserStyle → ${file} (${kb} KB)`);
  }
  return written;
}
