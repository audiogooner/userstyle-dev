import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = join(here, "../template");
const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));

export function siteIdFromOrigin(origin) {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const label = host.split(".")[0] || "site";
  const id = label.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return id || "site";
}

function packageName(dir, id) {
  const base = dir.split("/").pop() || id;
  const name = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  return name || id;
}

function styleConfig({ id, origin, name, author, port }) {
  const hostLabel = new URL(origin).hostname;
  return `export const port = ${port};
export const host = "127.0.0.1";

export const site = {
  id: ${JSON.stringify(id)},
  origin: ${JSON.stringify(origin)},
  match: [${JSON.stringify(`${origin}/*`)}],
};

export const metadata = {
  name: ${JSON.stringify(name)},
  version: "0.1.0",
  description: ${JSON.stringify(`A dark theme for ${hostLabel} using the Catppuccin Mocha color palette`)},
  author: ${JSON.stringify(author || "")},
  preprocessor: "default",
  namespace: ${JSON.stringify(origin)},
};

export const exportFile = ${JSON.stringify(`${id}.user.css`)};
export const exportMinFile = ${JSON.stringify(`${id}.min.user.css`)};

export const bundles = [
  {
    file: "src/base.scss",
    document: ${JSON.stringify(`url-prefix("${origin}")`)},
  },
];

export const snapshotPages = [];
`;
}

function lintConfig(id) {
  return `export default {
  minDeclarationsForCrossFile: 4,
  minFilesForCrossFile: 2,
  ignoreSelectors: [":root", "html", "body"],
  ignoreFiles: [],
  ignoreRules: {
    "duplicate-declarations": [],
    "dead-selector": [
      ${JSON.stringify(`#${id}-dev-overlay`)},
      ${JSON.stringify(`#${id}-dev-overlay *`)},
    ],
  },
  snapshotMap: {},
};
`;
}

function packageJson(name) {
  return `${JSON.stringify(
    {
      name,
      private: true,
      type: "module",
      scripts: {
        dev: "userstyle-dev dev",
        export: "userstyle-dev export",
        "lint:styles": "userstyle-dev lint",
        doctor: "userstyle-dev doctor",
        check: "userstyle-dev check",
        "snapshot:fetch": "userstyle-dev snapshot",
        "preview:install": "userstyle-dev preview:install",
      },
      devDependencies: {
        "userstyle-dev": `^${pkg.version}`,
      },
    },
    null,
    2,
  )}\n`;
}

export async function scaffold({
  dir,
  origin,
  name,
  id,
  author = "",
  port = 3847,
}) {
  if (!dir || !origin || !name) {
    throw new Error("dir, origin, and name are required");
  }
  const normalized = String(origin).replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`origin is not a URL: ${origin}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`origin must be http(s): ${origin}`);
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`Directory is not empty: ${dir}`);
  }

  const siteId = id || siteIdFromOrigin(normalized);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  cpSync(join(templateDir, "src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "style.config.mjs"), styleConfig({
    id: siteId,
    origin: normalized,
    name,
    author,
    port,
  }));
  writeFileSync(join(dir, "style.lint.config.mjs"), lintConfig(siteId));
  writeFileSync(
    join(dir, "package.json"),
    packageJson(packageName(dir, siteId)),
  );
  writeFileSync(
    join(dir, ".gitignore"),
    "node_modules/\nsnapshots/previews/\nlint-results.json\n",
  );
  writeFileSync(join(dir, "snapshots/.gitkeep"), "");
  return { dir, id: siteId, origin: normalized };
}
