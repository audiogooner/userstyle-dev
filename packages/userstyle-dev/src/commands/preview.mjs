import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const src = join(packageRoot, "editor/selector-preview");

export function installPreview() {
  const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  const extDir =
    process.env.CURSOR_EXTENSIONS_DIR || join(homedir(), ".cursor", "extensions");
  const dest = join(extDir, `${pkg.publisher}.${pkg.name}-${pkg.version}`);
  const stalePrefixes = [
    "userstyle-dev.userstyle-selector-preview-",
    "gelbooru-userstyle.selector-preview-",
    "gelbooru-userstyle.gelbooru-selector-preview-",
  ];

  function removePath(target) {
    if (!existsSync(target)) {
      return;
    }
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      unlinkSync(target);
    } else {
      rmSync(target, { recursive: true, force: true });
    }
  }

  mkdirSync(extDir, { recursive: true });

  for (const name of readdirSync(extDir)) {
    const isStalePrefix = stalePrefixes.some((prefix) => name.startsWith(prefix));
    if (!isStalePrefix) {
      continue;
    }
    const target = join(extDir, name);
    if (target !== dest) {
      removePath(target);
    }
  }

  removePath(dest);
  symlinkSync(src, dest);
  console.log(`Linked ${dest}`);
  console.log(`     -> ${src}`);
  console.log("Reload the Cursor window (Developer: Reload Window) to pick it up.");
  console.log("Then Alt+Shift+S on a styled page to capture selector screenshots.");
}
