const IGNORE_SELECTORS_DEFAULT = new Set([":root", "html", "body", "*"]);

export function normalizeSelector(selector) {
  return String(selector || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function atRuleKey(path) {
  return (path || []).join("|");
}

export function stripCssComments(text) {
  return String(text || "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
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

export function splitDeclarations(text) {
  const raw = stripCssComments(text);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === '"' || c === "'") {
      i = skipString(raw, i) - 1;
      continue;
    }
    if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
    } else if (c === ";" && depth === 0) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function normalizeValue(value) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*!important\s*$/i, "!important");
}

export function parseDeclarations(text) {
  const items = [];
  for (const part of splitDeclarations(text)) {
    const colon = part.indexOf(":");
    if (colon < 0) {
      continue;
    }
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = normalizeValue(part.slice(colon + 1));
    if (!property || !value) {
      continue;
    }
    items.push({ property, value });
  }
  items.sort((a, b) => {
    const byProp = a.property.localeCompare(b.property);
    return byProp !== 0 ? byProp : a.value.localeCompare(b.value);
  });
  return items;
}

export function normalizeDeclarations(text) {
  const items = parseDeclarations(text);
  return {
    items,
    text: items.map((item) => `${item.property}:${item.value}`).join(";"),
    count: items.length,
  };
}

export function ruleFingerprint(selector, atRulePath, declText) {
  return `sel:${normalizeSelector(selector)}|at:${atRuleKey(atRulePath)}|decl:${declText}`;
}

export function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

export function matchesIgnore(value, patterns) {
  if (!patterns?.length) {
    return false;
  }
  const text = String(value || "");
  for (const pattern of patterns) {
    if (pattern === text) {
      return true;
    }
    if (pattern.includes("*") || pattern.includes("?")) {
      if (globToRegExp(pattern).test(text)) {
        return true;
      }
    }
  }
  return false;
}

export function isIgnoredSelector(selector, config) {
  const normalized = normalizeSelector(selector);
  if (IGNORE_SELECTORS_DEFAULT.has(normalized)) {
    return true;
  }
  return matchesIgnore(normalized, config?.ignoreSelectors);
}

export function isPartialSource(file) {
  return /(^|\/)_[^/]+\.scss$/.test(file || "");
}
