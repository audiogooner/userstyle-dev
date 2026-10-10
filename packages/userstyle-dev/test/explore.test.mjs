import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  orderSnapshotPages,
  resolveExplore,
  urlsMatch,
  validatePage,
} from "../src/explore.mjs";

const origin = "https://gelbooru.com";

const postView = {
  from: "post-list",
  try: [
    {
      href: /page=post&(?:amp;)?s=view&(?:amp;)?id=(\d+)/,
      url: "https://gelbooru.com/index.php?page=post&s=view&id=$1",
    },
  ],
};

const wikiView = {
  from: "wiki-list",
  try: [
    {
      href: /page=wiki&(?:amp;)?s=view&(?:amp;)?id=(\d+)/,
      url: "https://gelbooru.com/index.php?page=wiki&s=view&id=$1",
    },
    {
      href: /href="(index\.php\?page=wiki&(?:amp;)?s=(?:view|list)&(?:amp;)?search=[^"]+)"/,
      url: "https://gelbooru.com/$1",
    },
  ],
};

describe("resolveExplore", () => {
  it("resolves post-view from a list snippet", () => {
    const html = `<a href="index.php?page=post&amp;s=view&amp;id=42">x</a>`;
    assert.equal(
      resolveExplore(html, postView, origin),
      "https://gelbooru.com/index.php?page=post&s=view&id=42",
    );
  });

  it("resolves wiki-view by id and falls back to search", () => {
    assert.equal(
      resolveExplore(
        `<a href="index.php?page=wiki&amp;s=view&amp;id=9">w</a>`,
        wikiView,
        origin,
      ),
      "https://gelbooru.com/index.php?page=wiki&s=view&id=9",
    );
    assert.equal(
      resolveExplore(
        `<a href="index.php?page=wiki&amp;s=view&amp;search=foo_bar">w</a>`,
        wikiView,
        origin,
      ),
      "https://gelbooru.com/index.php?page=wiki&s=view&search=foo_bar",
    );
  });

  it("rewrites wiki list ids into edit and history URLs", () => {
    const html = `<a href="index.php?page=wiki&amp;s=view&amp;id=7">w</a>`;
    const edit = {
      from: "wiki-list",
      try: [
        {
          href: /page=wiki&(?:amp;)?s=(?:view|edit)&(?:amp;)?id=(\d+)/,
          url: "https://gelbooru.com/index.php?page=wiki&s=edit&id=$1",
        },
      ],
    };
    const history = {
      from: "wiki-list",
      try: [
        {
          href: /page=wiki&(?:amp;)?s=(?:view|edit)&(?:amp;)?id=(\d+)/,
          url: "https://gelbooru.com/index.php?page=wiki&s=history&id=$1",
        },
      ],
    };
    assert.equal(
      resolveExplore(html, edit, origin),
      "https://gelbooru.com/index.php?page=wiki&s=edit&id=7",
    );
    assert.equal(
      resolveExplore(html, history, origin),
      "https://gelbooru.com/index.php?page=wiki&s=history&id=7",
    );
  });

  it("resolves tags-edit and conversation-view", () => {
    assert.equal(
      resolveExplore(
        `<a href="index.php?page=tags&amp;s=edit&amp;tag=1girl">t</a>`,
        {
          from: "tags-list",
          try: [
            {
              href: /page=tags&(?:amp;)?s=edit&(?:amp;)?tag=([^"'&\s<>]+)/,
              url: "https://gelbooru.com/index.php?page=tags&s=edit&tag=$1",
            },
          ],
        },
        origin,
      ),
      "https://gelbooru.com/index.php?page=tags&s=edit&tag=1girl",
    );
    assert.equal(
      resolveExplore(
        `<a href="index.php?page=conversation&amp;s=view&amp;id=3">c</a>`,
        {
          from: "conversation-list",
          try: [
            {
              href: /page=conversation&(?:amp;)?s=view&(?:amp;)?id=(\d+)/,
              url: "https://gelbooru.com/index.php?page=conversation&s=view&id=$1",
            },
          ],
        },
        origin,
      ),
      "https://gelbooru.com/index.php?page=conversation&s=view&id=3",
    );
  });
});

describe("urlsMatch", () => {
  it("treats extra query params on the current page as the same seed", () => {
    assert.equal(
      urlsMatch(
        "https://gelbooru.com/index.php?page=tags&s=list&pid=0",
        "https://gelbooru.com/index.php?page=tags&s=list",
      ),
      true,
    );
    assert.equal(
      urlsMatch(
        "https://gelbooru.com/index.php?page=tags&s=edit&tag=1girl",
        "https://gelbooru.com/index.php?page=tags&s=list",
      ),
      false,
    );
  });
});

describe("snapshot catalog order", () => {
  const pages = [
    {
      id: "post-view",
      explore: postView,
    },
    {
      id: "post-list",
      url: "https://gelbooru.com/index.php?page=post&s=list&tags=all",
    },
  ];

  it("fetches seed pages before explorers", () => {
    assert.deepEqual(
      orderSnapshotPages(pages).map((page) => page.id),
      ["post-list", "post-view"],
    );
  });

  it("rejects an explore whose seed has no url", () => {
    const errors = validatePage(
      { id: "post-view", explore: { from: "missing", try: postView.try } },
      pages,
    );
    assert.match(errors.join("\n"), /unknown id missing/);
  });

  it("rejects a cycle", () => {
    assert.throws(
      () =>
        orderSnapshotPages([
          { id: "a", explore: { from: "b", try: postView.try } },
          { id: "b", explore: { from: "a", try: postView.try } },
        ]),
      /cycle/,
    );
  });
});
