import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageIdFromUrl } from "../src/lib/slim-document.mjs";

describe("pageIdFromUrl", () => {
  it("names homepage and php endpoints", () => {
    assert.equal(pageIdFromUrl("https://example.com/"), "homepage");
    assert.equal(pageIdFromUrl("https://example.com/index.php"), "homepage");
    assert.equal(pageIdFromUrl("https://example.com/tos.php"), "tos");
    assert.equal(pageIdFromUrl("https://example.com/redeemCode.php"), "redeemcode");
  });

  it("uses page and the first non-empty s", () => {
    assert.equal(
      pageIdFromUrl("https://example.com/index.php?page=wiki&s=edit&id=1"),
      "wiki-edit",
    );
    assert.equal(
      pageIdFromUrl("https://example.com/index.php?page=wiki&s=&s=edit&id=1"),
      "wiki-edit",
    );
    assert.equal(
      pageIdFromUrl("https://example.com/index.php?page=post&s=list&tags=all"),
      "post-list",
    );
  });

  it("keeps wiki search as the page name", () => {
    assert.equal(
      pageIdFromUrl("https://example.com/index.php?page=wiki&search=foo"),
      "wiki",
    );
    assert.equal(
      pageIdFromUrl("https://example.com/index.php?page=wiki&s=list&search=foo"),
      "wiki-list",
    );
  });
});
