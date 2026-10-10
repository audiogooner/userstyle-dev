function enclosingSelector(text, offset, lineAt) {
  const toLine = lineAt || ((idx) => defaultLineAt(text, idx));
  const stack = [];
  let i = 0;
  let chunkStart = 0;
  const end = Math.min(offset, text.length);

  while (i < end) {
    const c = text[i];
    const next = text[i + 1];

    if (c === "/" && next === "/") {
      i = text.indexOf("\n", i);
      if (i < 0) {
        break;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      const endComment = text.indexOf("*/", i + 2);
      i = endComment < 0 ? text.length : endComment + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(text, i);
      continue;
    }
    if (c === "#" && next === "{") {
      i = skipInterpolation(text, i);
      continue;
    }
    if (c === "{") {
      const selector = text.slice(chunkStart, i).replace(/\s+/g, " ").trim();
      if (selector) {
        stack.push({
          selector,
          line: firstContentLine(text, chunkStart, i, toLine),
        });
      }
      i += 1;
      chunkStart = i;
      continue;
    }
    if (c === "}") {
      stack.pop();
      i += 1;
      chunkStart = i;
      continue;
    }
    if (c === ";") {
      i += 1;
      chunkStart = i;
      continue;
    }
    i += 1;
  }

  const stacked = [...stack];
  const pendingEnd = selectorBraceAhead(text, chunkStart);
  if (pendingEnd != null) {
    const selector = text.slice(chunkStart, pendingEnd).replace(/\s+/g, " ").trim();
    if (selector) {
      stacked.push({
        selector,
        line: firstContentLine(text, chunkStart, pendingEnd, toLine),
      });
    }
  }

  const rules = stacked.filter((item) => !item.selector.startsWith("@"));
  const current = rules[rules.length - 1];
  if (!current) {
    return undefined;
  }

  return {
    line: current.line,
    selector: current.selector,
    full: expandSelector(rules),
  };
}

function selectorBraceAhead(text, from) {
  let i = from;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      i = text.indexOf("\n", i);
      if (i < 0) {
        return null;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      const endComment = text.indexOf("*/", i + 2);
      i = endComment < 0 ? text.length : endComment + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(text, i);
      continue;
    }
    if (c === "#" && next === "{") {
      i = skipInterpolation(text, i);
      continue;
    }
    if (c === "{") {
      return i;
    }
    if (c === ";" || c === "}") {
      return null;
    }
    i += 1;
  }
  return null;
}

function firstContentLine(text, from, to, lineAt) {
  let i = from;
  while (i < to && /\s/.test(text[i])) {
    i += 1;
  }
  return lineAt(Math.min(i, to));
}

function defaultLineAt(text, offset) {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function expandSelector(rules) {
  let full = "";
  for (const rule of rules) {
    full = combineSelector(full, rule.selector);
  }
  return full;
}

function combineSelector(parent, child) {
  const parts = child.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) {
    return parent;
  }
  return parts
    .map((part) => {
      if (!parent) {
        return part;
      }
      if (part.includes("&")) {
        return part.replaceAll("&", parent);
      }
      if (/^[>+~]/.test(part)) {
        return `${parent} ${part}`;
      }
      if (part.startsWith(":") || part.startsWith("[")) {
        return `${parent}${part}`;
      }
      return `${parent} ${part}`;
    })
    .join(", ");
}

function skipString(text, i) {
  const quote = text[i];
  i += 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

function skipInterpolation(text, i) {
  i += 2;
  let depth = 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '"' || text[i] === "'") {
      i = skipString(text, i);
      continue;
    }
    if (text[i] === "{") {
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
    }
    i += 1;
  }
  return i;
}

function normalizeSelector(selector) {
  return String(selector || "")
    .replace(/\s+/g, " ")
    .replace(/\[([^\]]+)=(["']?)([^"'[\]]+)\2\]/g, "[$1=$3]")
    .trim();
}

module.exports = {
  enclosingSelector,
  normalizeSelector,
  combineSelector,
};
