/**
 * DOM-agnostic snapshot slimmer. Uses standard DOM APIs so it can run in
 * the browser (userscript) and in Node (linkedom).
 *
 * No imports — the dev server concatenates this file into snapshot-capture.js.
 */

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const HOLLOW_TAGS = new Set([
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "IFRAME",
  "CANVAS",
  "EMBED",
  "OBJECT",
  "SCRIPT",
  "NOSCRIPT",
  "TEMPLATE",
]);
const PRESERVE_TAGS = new Set(["HEADER", "NAV", "FOOTER", "FORM", "HEAD", "HTML"]);
const PRESERVE_IDS = new Set([
  "container",
  "static-index",
  "myTopnav",
  "navbar",
  "navbar2",
  "submenu",
  "links",
  "notice",
  "long-notice",
  "motd",
]);

const MAX_TEXT = 160;
const MAX_TITLE = 80;
const MAX_STYLE = 500;
const MAX_DATA = 100;
const COLLAPSE_AFTER = 8;
const COLLAPSE_TR_AFTER = 40;
const COLLAPSE_KEEP = 3;
const OUTLINE_MAX_LINES = 400;

export function pageIdFromUrl(href) {
  try {
    const url = new URL(href);
    const page = url.searchParams.get("page");
    const s = url.searchParams.getAll("s").find(Boolean) || "";
    if (!page) {
      const path = url.pathname.replace(/^\//, "").replace(/\.php$/, "");
      if (!path || path === "index") {
        return "homepage";
      }
      return slugify(path);
    }
    return s ? `${page}-${slugify(s)}` : page;
  } catch {
    return "unknown";
  }
}

export function stylesheetName(href) {
  try {
    const url = new URL(href);
    const base = url.pathname.split("/").pop() || "style.css";
    return base.replace(/[^a-zA-Z0-9._-]/g, "") || "style.css";
  } catch {
    return "style.css";
  }
}

export function slimDocument(sourceDocument) {
  const root = sourceDocument.documentElement.cloneNode(true);
  const notes = [];

  for (const el of [...root.querySelectorAll("[data-userstyle-dev]")]) {
    el.remove();
  }
  const overlayId =
    typeof USERSTYLE_DEV !== "undefined" ? USERSTYLE_DEV.overlayId : "";
  if (overlayId) {
    root.querySelector(`#${overlayId}`)?.remove();
  }

  for (const link of [...root.querySelectorAll("link")]) {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    if (!rel.includes("stylesheet")) {
      link.remove();
    }
  }

  for (const meta of [...root.querySelectorAll("meta")]) {
    const name = (
      meta.getAttribute("name") ||
      meta.getAttribute("property") ||
      ""
    ).toLowerCase();
    if (name === "keywords" || name === "description") {
      meta.remove();
    }
    if (name === "og:image" || name === "twitter:image") {
      meta.setAttribute("content", "[image]");
    }
  }

  for (const el of [...root.querySelectorAll("*")]) {
    if (HOLLOW_TAGS.has(el.tagName)) {
      hollowMedia(el);
    }
    if (el.tagName === "SVG" && (el.innerHTML || "").length > 400) {
      clearChildren(el);
    }
    cleanAttributes(el);
  }

  collapseRepeated(root, notes);
  normalizeText(root);

  return { root, notes };
}

export function collectInventory(root) {
  const classes = new Set();
  const ids = new Set();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (el.id) {
      ids.add(el.id);
    }
    const className = classAttr(el);
    if (className) {
      for (const token of className.split(/\s+/)) {
        if (token) {
          classes.add(token);
        }
      }
    }
  }
  return {
    classes: [...classes].sort(),
    ids: [...ids].sort(),
  };
}

export function outlineTree(root, maxLines = OUTLINE_MAX_LINES) {
  const lines = [];

  function walk(el, depth) {
    if (lines.length >= maxLines) {
      return;
    }
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = classAttr(el)
      ? "." + classAttr(el).split(/\s+/).filter(Boolean).join(".")
      : "";
    lines.push(`${"  ".repeat(depth)}${tag}${id}${cls}`);
    if (lines.length === maxLines) {
      lines.push("  …");
      return;
    }
    for (const child of el.children) {
      walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return lines.join("\n");
}

export function serializeHtml(root, meta) {
  const header = [
    "snapshot: " + (meta.id || ""),
    "url: " + (meta.url || ""),
    "title: " + (meta.title || ""),
    "captured: " + (meta.capturedAt || ""),
    "source: " + (meta.source || ""),
    "stylesheets: " + (meta.stylesheets || []).join(", "),
    ...(meta.notes || []).map((note) => "note: " + note),
  ].join("\n");

  return `<!DOCTYPE html>\n<!--\n${header}\n-->\n${serializeNode(root, 0)}\n`;
}

export function stylesheetHrefs(sourceDocument, pageUrl) {
  const base = pageUrl || sourceDocument.baseURI || undefined;
  return [...sourceDocument.querySelectorAll("link")]
    .filter((link) =>
      (link.getAttribute("rel") || "").toLowerCase().includes("stylesheet"),
    )
    .map((link) => link.getAttribute("href") || link.href)
    .filter(Boolean)
    .map((href) => {
      try {
        return new URL(href, base).href;
      } catch {
        return href;
      }
    });
}

function hollowMedia(el) {
  for (const attr of ["src", "srcset", "data-src", "data-original", "poster"]) {
    if (!el.hasAttribute(attr)) {
      continue;
    }
    const value = el.getAttribute(attr);
    const leaf = basename(value);
    if (leaf) {
      el.setAttribute(`data-snapshot-${attr}`, leaf);
    }
    el.removeAttribute(attr);
  }
  if (
    el.tagName === "IFRAME" ||
    el.tagName === "CANVAS" ||
    el.tagName === "OBJECT" ||
    el.tagName === "SCRIPT" ||
    el.tagName === "NOSCRIPT" ||
    el.tagName === "TEMPLATE"
  ) {
    clearChildren(el);
  }
}

function cleanAttributes(el) {
  for (const attr of [...el.attributes]) {
    const name = attr.name;
    const value = attr.value;

    if (name.startsWith("on")) {
      el.removeAttribute(name);
      continue;
    }
    if (name === "srcset" || name === "sizes") {
      el.removeAttribute(name);
      continue;
    }
    if (name === "href" && value.trim().startsWith("javascript:")) {
      el.setAttribute("href", "javascript:;");
      continue;
    }
    if ((name === "title" || name === "alt") && value.length > MAX_TITLE) {
      el.setAttribute(name, value.slice(0, MAX_TITLE) + "…");
      continue;
    }
    if (name === "style" && value.length > MAX_STYLE) {
      el.setAttribute(name, value.slice(0, MAX_STYLE) + "…");
      continue;
    }
    if (
      name.startsWith("data-") &&
      !name.startsWith("data-snapshot-") &&
      value.length > MAX_DATA
    ) {
      el.removeAttribute(name);
    }
  }
}

function normalizeText(root) {
  const walker = textWalker(root);
  let node;
  while ((node = walker.next())) {
    if (inSkippableTextParent(node)) {
      continue;
    }
    const collapsed = node.nodeValue.replace(/\s+/g, " ");
    if (!collapsed.trim()) {
      node.nodeValue = depthOf(node) > 0 ? "\n" : "";
      continue;
    }
    node.nodeValue =
      collapsed.length > MAX_TEXT
        ? collapsed.trim().slice(0, MAX_TEXT) + "…"
        : collapsed;
  }
}

function collapseRepeated(root, notes) {
  const parents = [root, ...root.querySelectorAll("*")];
  for (const parent of parents) {
    if (parent !== root && !parent.parentNode) {
      continue;
    }
    if (shouldPreserveChildren(parent)) {
      continue;
    }

    const children = [...parent.children];
    let i = 0;
    while (i < children.length) {
      const sig = signature(children[i]);
      let j = i + 1;
      while (j < children.length && signature(children[j]) === sig) {
        j += 1;
      }

      const count = j - i;
      const threshold =
        children[i].tagName === "TR" ? COLLAPSE_TR_AFTER : COLLAPSE_AFTER;
      const canCollapse = Boolean(classAttr(children[i])) && count > threshold;

      if (canCollapse) {
        const omitted = count - COLLAPSE_KEEP;
        for (let k = i + COLLAPSE_KEEP; k < j; k++) {
          children[k].remove();
        }
        const comment = (parent.ownerDocument || root.ownerDocument).createComment(
          ` snapshot: omitted ${omitted} more ${sig} (${count} total; nth-child ${COLLAPSE_KEEP + 1}–${count} not preserved) `,
        );
        const lastKept = children[i + COLLAPSE_KEEP - 1];
        lastKept.parentNode.insertBefore(comment, lastKept.nextSibling);
        notes.push(
          `omitted ${omitted} more ${sig} (${count} total)`,
        );
      }

      i = j;
    }
  }
}

function shouldPreserveChildren(parent) {
  if (PRESERVE_TAGS.has(parent.tagName)) {
    return true;
  }
  if (parent.id && PRESERVE_IDS.has(parent.id)) {
    return true;
  }
  return false;
}

function signature(el) {
  const cls = classAttr(el)
    ? "." + classAttr(el).split(/\s+/).filter(Boolean).join(".")
    : "";
  return el.tagName.toLowerCase() + cls;
}

function classAttr(el) {
  return (el.getAttribute && el.getAttribute("class")) || "";
}

function clearChildren(el) {
  if (typeof el.replaceChildren === "function") {
    el.replaceChildren();
    return;
  }
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function basename(value) {
  if (!value) {
    return "";
  }
  const first = value.split(/\s+/)[0];
  const withoutQuery = first.split("?")[0];
  const parts = withoutQuery.split("/");
  return parts[parts.length - 1] || "";
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

function textWalker(root) {
  const nodes = [];
  function collect(node) {
    if (node.nodeType === 3) {
      nodes.push(node);
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    for (const child of node.childNodes) {
      collect(child);
    }
  }
  collect(root);
  let i = 0;
  return {
    next() {
      return i < nodes.length ? nodes[i++] : null;
    },
  };
}

function inSkippableTextParent(node) {
  let current = node.parentNode;
  while (current && current.nodeType === 1) {
    if (current.tagName === "STYLE" || current.tagName === "PRE" || current.tagName === "TEXTAREA" || current.tagName === "CODE" || current.tagName === "TITLE" || current.tagName === "SCRIPT") {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function depthOf(node) {
  let depth = 0;
  let current = node.parentNode;
  while (current) {
    depth += 1;
    current = current.parentNode;
  }
  return depth;
}

function serializeNode(node, indent) {
  const pad = "  ".repeat(indent);

  if (node.nodeType === 8) {
    return `${pad}<!--${node.nodeValue}-->`;
  }

  if (node.nodeType === 3) {
    const text = node.nodeValue.replace(/\s+/g, " ").trim();
    return text ? `${pad}${escapeText(text)}` : "";
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attributes]
    .map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`)
    .join("");

  if (VOID.has(tag)) {
    return `${pad}<${tag}${attrs}>`;
  }

  if (tag === "style" || tag === "pre" || tag === "textarea") {
    return `${pad}<${tag}${attrs}>${node.textContent}</${tag}>`;
  }

  if (tag === "title") {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    const cut = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text;
    return `${pad}<${tag}${attrs}>${escapeText(cut)}</${tag}>`;
  }

  if (tag === "script" || tag === "noscript" || tag === "template") {
    return `${pad}<${tag}${attrs}></${tag}>`;
  }

  const serialized = [...node.childNodes]
    .map((child) => serializeNode(child, indent + 1))
    .filter(Boolean);

  if (serialized.length === 0) {
    return `${pad}<${tag}${attrs}></${tag}>`;
  }

  const onlyShortText =
    serialized.length === 1 &&
    node.childNodes.length === 1 &&
    node.firstChild.nodeType === 3 &&
    !serialized[0].includes("\n") &&
    serialized[0].trim().length < 80;

  if (onlyShortText) {
    return `${pad}<${tag}${attrs}>${escapeText(node.textContent.trim())}</${tag}>`;
  }

  return `${pad}<${tag}${attrs}>\n${serialized.join("\n")}\n${pad}</${tag}>`;
}

function escapeAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeText(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
