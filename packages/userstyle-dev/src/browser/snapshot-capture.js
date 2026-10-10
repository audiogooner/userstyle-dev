/**
 * In-page capture driver. Served by the dev server with html2canvas +
 * slim-document.mjs prepended (exports stripped). Receives `host`, `gmFetch`,
 * and optional `captureOptions` from the userscript. `html2canvas` is in the
 * surrounding Function scope.
 */
return (async function captureSnapshot(host, gmFetch, captureOptions = {}) {
  const pageUrl = location.href;
  const id =
    (captureOptions && captureOptions.id) ||
    (typeof projectPageIdFromUrl === "function"
      ? projectPageIdFromUrl(pageUrl)
      : pageIdFromUrl(pageUrl));
  const parsed = new DOMParser().parseFromString(
    document.documentElement.outerHTML,
    "text/html",
  );

  const sheetHrefs = stylesheetHrefs(document, pageUrl);
  const { root, notes } = slimDocument(parsed);
  const inventory = collectInventory(root);
  const outline = outlineTree(root);
  const capturedAt = new Date().toISOString();
  const stylesheets = [];

  for (const href of sheetHrefs) {
    const absolute = new URL(href, pageUrl).href;
    const name = stylesheetName(absolute);
    try {
      const css = await gmFetch(absolute);
      stylesheets.push({ name, css, url: absolute });
    } catch (error) {
      notes.push(`failed to fetch CSS ${absolute}: ${error.message}`);
    }
  }

  const html = serializeHtml(root, {
    id,
    url: pageUrl,
    title: document.title,
    capturedAt,
    source: "live",
    stylesheets: stylesheets.map((sheet) => sheet.name),
    notes,
  });

  await gmFetch(`${host}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      url: pageUrl,
      title: document.title,
      html,
      classes: inventory.classes,
      ids: inventory.ids,
      notes,
      stylesheets,
      source: "live",
      capturedAt,
      outline,
    }),
    timeout: 60000,
  });

  let previews = 0;
  if (!captureOptions.skipPreviews) {
    try {
      previews = await captureSelectorPreviews(host, gmFetch, id, capturedAt);
      if (previews) {
        notes.push(`${previews} selector previews`);
      }
    } catch (error) {
      notes.push(`previews: ${error.message}`);
    }
  }

  return { id, notes, previews };
})(host, gmFetch, captureOptions || {});

function previewToast(message) {
  document.dispatchEvent(
    new CustomEvent("userstyle-dev-toast", { detail: message, bubbles: true }),
  );
}

function isDevOverlayNode(node) {
  const overlayId =
    typeof USERSTYLE_DEV !== "undefined" ? USERSTYLE_DEV.overlayId : "";
  return Boolean(overlayId) && node?.id === overlayId;
}

function enableUserstyle() {
  const styles = [...document.querySelectorAll("style[data-userstyle-dev]")];
  const prev = styles.map((el) => el.disabled);
  for (const el of styles) {
    if (el.getAttribute("data-userstyle-dev") === "blackout") {
      continue;
    }
    el.disabled = false;
  }
  return () => {
    styles.forEach((el, i) => {
      el.disabled = prev[i];
    });
  };
}

function copyCssVariables(clonedDoc) {
  const live = getComputedStyle(document.documentElement);
  const dest = clonedDoc.documentElement?.style;
  if (!dest) {
    return;
  }
  for (const prop of live) {
    if (prop.startsWith("--")) {
      dest.setProperty(prop, live.getPropertyValue(prop));
    }
  }
}

const STYLE_SHORTHANDS = new Set([
  "all",
  "animation",
  "background",
  "border",
  "border-block",
  "border-color",
  "border-image",
  "border-inline",
  "border-radius",
  "border-style",
  "border-width",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "column-rule",
  "columns",
  "flex",
  "font",
  "gap",
  "grid",
  "inset",
  "list-style",
  "margin",
  "mask",
  "offset",
  "outline",
  "overflow",
  "padding",
  "place-content",
  "place-items",
  "place-self",
  "text-decoration",
  "transition",
]);

function copyComputedStyle(from, to) {
  const computed = getComputedStyle(from);
  for (const prop of computed) {
    if (STYLE_SHORTHANDS.has(prop) || prop.startsWith("--")) {
      continue;
    }
    to.style.setProperty(prop, computed.getPropertyValue(prop));
  }
  applyPaint(to, computed);
}

function applyPaint(to, computed) {
  const background = computed.backgroundColor;
  const display = computed.display;
  const radius = [
    computed.borderTopLeftRadius,
    computed.borderTopRightRadius,
    computed.borderBottomRightRadius,
    computed.borderBottomLeftRadius,
  ];
  const hasRadius = radius.some((value) => value && value !== "0px");

  if (display === "inline" && !isTransparentColor(background)) {
    to.style.setProperty("display", "inline-block", "important");
  }

  if (!isTransparentColor(background)) {
    to.style.setProperty("background-color", background, "important");
    const boxW = parseFloat(computed.width) || 0;
    const boxH = parseFloat(computed.height) || 0;
    const spread = Math.ceil(Math.max(boxW, boxH, 4) / 2);
    const existing = computed.boxShadow;
    const fill = `inset 0 0 0 ${spread}px ${background}`;
    const shadow =
      existing && existing !== "none" ? `${existing}, ${fill}` : fill;
    to.style.setProperty("box-shadow", shadow, "important");
    if (hasRadius) {
      to.style.setProperty("overflow", "hidden", "important");
    }
  }

  to.style.setProperty("border-top-left-radius", radius[0], "important");
  to.style.setProperty("border-top-right-radius", radius[1], "important");
  to.style.setProperty("border-bottom-right-radius", radius[2], "important");
  to.style.setProperty("border-bottom-left-radius", radius[3], "important");

  for (const side of ["top", "right", "bottom", "left"]) {
    for (const kind of ["width", "style", "color"]) {
      const prop = `border-${side}-${kind}`;
      to.style.setProperty(prop, computed.getPropertyValue(prop), "important");
    }
  }
}

function copyComputedTree(source, clone) {
  const from = [source, ...source.querySelectorAll("*")];
  const to = [clone, ...clone.querySelectorAll("*")];
  const n = Math.min(from.length, to.length);
  for (let i = 0; i < n; i += 1) {
    if (from[i].tagName !== to[i].tagName) {
      continue;
    }
    copyComputedStyle(from[i], to[i]);
  }
}

function captureBackdropColor(el) {
  return effectiveBackgroundColor(el.parentElement || document.body);
}

function isTransparentColor(color) {
  if (!color || color === "transparent") {
    return true;
  }
  const match = color.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
  );
  if (!match) {
    return false;
  }
  return match[4] !== undefined && Number(match[4]) === 0;
}

function effectiveBackgroundColor(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    const color = getComputedStyle(node).backgroundColor;
    if (!isTransparentColor(color)) {
      return color;
    }
    node = node.parentElement;
  }
  const fallbacks = [document.body, document.documentElement];
  for (const node of fallbacks) {
    if (!node) {
      continue;
    }
    const color = getComputedStyle(node).backgroundColor;
    if (!isTransparentColor(color)) {
      return color;
    }
  }
  return "#1e1e2e";
}

function captureScale(rect) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const long = Math.max(rect.width, rect.height, 1);
  let scale = Math.max(1.5, dpr);
  if (long * scale > 960) {
    scale = 960 / long;
  }
  return Math.min(2, Math.max(1, scale));
}

function cropToElement(canvas, rect, scale) {
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width <= width + 4 && canvas.height <= height + 4) {
    return canvas;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const sx = Math.max(0, Math.round((canvas.width - width) / 2));
  const sy = Math.max(0, Math.round((canvas.height - height) / 2));
  out.getContext("2d").drawImage(canvas, sx, sy, width, height, 0, 0, width, height);
  return out;
}

function padCanvas(source, padPx, color) {
  const pad = Math.max(2, padPx);
  const out = document.createElement("canvas");
  out.width = source.width + pad * 2;
  out.height = source.height + pad * 2;
  const ctx = out.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, pad, pad);
  return out;
}

async function captureSelectorPreviews(host, gmFetch, id, capturedAt) {
  if (typeof html2canvas !== "function") {
    throw new Error("html2canvas missing");
  }

  const targets = JSON.parse(
    await gmFetch(
      `${host}/selector-targets?href=${encodeURIComponent(location.href)}`,
    ),
  );
  if (!targets.length) {
    return 0;
  }

  previewToast("Capturing selector previews…");

  const overlayId =
    typeof USERSTYLE_DEV !== "undefined" ? USERSTYLE_DEV.overlayId : "";
  const overlay = overlayId ? document.getElementById(overlayId) : null;
  const overlayDisplay = overlay?.style.display;
  if (overlay) {
    overlay.style.setProperty("display", "none", "important");
  }
  const restoreTheme = enableUserstyle();

  const shots = [];
  const seen = new WeakMap();
  let unique = 0;

  try {
    for (const target of targets) {
      let el;
      try {
        el = document.querySelector(target.query);
      } catch {
        continue;
      }
      if (!el || isDevOverlayNode(el)) {
        continue;
      }

      if (seen.has(el)) {
        shots.push({ ...target, ...seen.get(el) });
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) {
        continue;
      }
      if (rect.width * rect.height > 3_000_000) {
        continue;
      }

      try {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const background = captureBackdropColor(el);
        const scale = captureScale(rect);
        const canvas = await html2canvas(el, {
          logging: false,
          useCORS: true,
          allowTaint: false,
          backgroundColor: background,
          scale,
          ignoreElements: isDevOverlayNode,
          onclone(doc, cloned) {
            if (overlayId) {
              doc.getElementById(overlayId)?.remove();
            }
            copyCssVariables(doc);
            if (cloned) {
              copyComputedTree(el, cloned);
            }
          },
        });
        const cropped = cropToElement(canvas, rect, scale);
        const pad = Math.round(Math.min(6, Math.max(3, Math.min(rect.width, rect.height) * 0.2)) * scale);
        const padded = padCanvas(cropped, pad, background);
        const dataUrl = padded.toDataURL("image/png");
        const png = dataUrl.replace(/^data:image\/png;base64,/, "");
        if (!png || png.length < 32) {
          continue;
        }
        const image = {
          png,
          width: padded.width,
          height: padded.height,
          cssWidth: rect.width,
          cssHeight: rect.height,
        };
        seen.set(el, image);
        shots.push({ ...target, ...image });
        unique += 1;
        if (unique === 1 || unique % 8 === 0) {
          previewToast(`Selector previews ${unique}…`);
        }
        if (unique >= 50) {
          break;
        }
      } catch {
        /* tainted canvas, unsupported CSS, etc. */
      }
    }
  } finally {
    restoreTheme();
    if (overlay) {
      if (overlayDisplay) {
        overlay.style.display = overlayDisplay;
      } else {
        overlay.style.removeProperty("display");
      }
    }
  }

  if (!shots.length) {
    return 0;
  }

  await gmFetch(`${host}/snapshot-previews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, capturedAt, shots }),
    timeout: 120000,
  });

  return shots.length;
}
