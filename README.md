# userstyle-dev

Shared development tools for UserStyle projects. A project is `style.config.mjs`, SCSS under `src/`, and snapshots. This package is the dev server, exporter, linter, and snapshotter.

```bash
npx create-userstyle my-style --origin https://example.com --name "Example Catppuccin"
cd my-style
npm install
npm run dev
```

Updating the tools in every project is `npm update`.

## Commands

| Command | What it does |
| --- | --- |
| `userstyle-dev dev` | Live-inject server. Serves `/dev.user.js` and republishes the UserStyle on each successful build. |
| `userstyle-dev export` | Expanded and minified UserStyle files from `exportFile` / `exportMinFile`. |
| `userstyle-dev doctor` | Bundles exist, page files are registered, explorer rules are valid. |
| `userstyle-dev lint` | Duplicate, redundant, and dead selectors. |
| `userstyle-dev check` | `doctor` then `lint`. |
| `userstyle-dev snapshot` | Fetch public pages (`--only <id>`, `--force`). |
| `userstyle-dev preview:install` | Symlink the selector-hover extension into Cursor. |

## Config

`style.config.mjs` exports:

- `site.id`, `site.origin`, optional `site.match`
- `metadata` (UserStyle header)
- `bundles` (`{ file, document }` with an `@-moz-document` matcher)
- `exportFile`, `exportMinFile`
- `port`, `host`
- `snapshotPages`
- optional `blackoutCss`
- optional `pageIdFromUrl(href)` for ad-hoc Alt+Shift+S names. Catalog captures use `snapshotPages[].id`.

`style.lint.config.mjs` is optional.

## Explorers

A snapshot entry has a `url`, or an `explore` rule that reads a link from a seed page:

```js
{ id: "post-list", url: "https://example.com/posts" },
{
  id: "post-view",
  explore: {
    from: "post-list",
    try: [
      {
        href: /\/posts\/(\d+)/,
        url: "https://example.com/posts/$1",
      },
    ],
  },
}
```

`from` is another catalog id that has a `url`, or an absolute URL. `try` runs in order. The first match fills `$1`, `$2`, … in `url`. A relative result is resolved against `site.origin`. The same rules drive `snapshot` and the live overlay **All** walk.

## Dev loop

`npm run dev`, install `http://127.0.0.1:3847/dev.user.js` in Violentmonkey, open the site. Alt+Shift+D toggles the overlay. Alt+Shift+S captures a snapshot. Disable any installed copy of the exported UserStyle while developing.
