export function urlsMatch(currentHref, targetHref) {
  try {
    const current = new URL(currentHref);
    const target = new URL(targetHref);
    if (current.origin !== target.origin || current.pathname !== target.pathname) {
      return false;
    }
    for (const [key, value] of target.searchParams) {
      const all = current.searchParams.getAll(key);
      if (!all.includes(value)) {
        return false;
      }
    }
    return true;
  } catch {
    return currentHref === targetHref;
  }
}

export function sourceHtml(htmlOrDoc) {
  if (typeof htmlOrDoc === "string") {
    return htmlOrDoc;
  }
  if (htmlOrDoc?.documentElement?.outerHTML) {
    return htmlOrDoc.documentElement.outerHTML;
  }
  if (typeof htmlOrDoc?.outerHTML === "string") {
    return htmlOrDoc.outerHTML;
  }
  throw new Error("explore expects an HTML string or Document");
}

function attemptRegex(href) {
  if (href instanceof RegExp) {
    return new RegExp(href.source, href.flags);
  }
  if (href && typeof href.source === "string") {
    return new RegExp(href.source, href.flags || "");
  }
  return null;
}

export function fillExploreUrl(template, match, origin) {
  let url = template;
  for (let i = 1; i < match.length; i += 1) {
    const value = String(match[i] ?? "").replaceAll("&amp;", "&");
    url = url.replaceAll(`$${i}`, value);
  }
  return new URL(url, origin).href;
}

export function resolveExplore(htmlOrDoc, explore, origin) {
  const html = sourceHtml(htmlOrDoc);
  const attempts = explore?.try || [];
  for (const attempt of attempts) {
    const re = attemptRegex(attempt.href);
    if (!re) {
      continue;
    }
    const match = html.match(re);
    if (!match) {
      continue;
    }
    return fillExploreUrl(attempt.url, match, origin);
  }
  throw new Error("No explorer pattern matched");
}

export function serializeExplore(explore) {
  return {
    try: (explore.try || []).map((attempt) => ({
      href: {
        source: attempt.href.source,
        flags: attempt.href.flags || "",
      },
      url: attempt.url,
    })),
  };
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

export function seedFor(entry, pages) {
  const from = entry.explore?.from;
  if (!from) {
    throw new Error(`${entry.id} explore needs from`);
  }
  if (isAbsoluteUrl(from)) {
    return from;
  }
  const seed = pages.find((page) => page.id === from);
  if (!seed) {
    throw new Error(`${entry.id} explores from unknown id ${from}`);
  }
  if (!seed.url) {
    throw new Error(`${entry.id} explores from ${from}, which has no url`);
  }
  return seed.url;
}

export function orderSnapshotPages(pages) {
  const remaining = [...pages];
  const done = new Set();
  const ordered = [];

  while (remaining.length) {
    const ready = [];
    const blocked = [];
    for (const page of remaining) {
      const from = page.explore?.from;
      if (!page.explore || !from || isAbsoluteUrl(from) || done.has(from)) {
        ready.push(page);
      } else {
        blocked.push(page);
      }
    }
    if (!ready.length) {
      throw new Error(
        `snapshot explore cycle: ${blocked.map((page) => page.id).join(", ")}`,
      );
    }
    for (const page of ready) {
      ordered.push(page);
      done.add(page.id);
    }
    remaining.length = 0;
    remaining.push(...blocked);
  }

  return ordered;
}

export function validatePage(page, pages) {
  const errors = [];
  if (!page.url && !page.explore) {
    errors.push(`snapshotPages ${page.id} needs url or explore`);
    return errors;
  }
  if (!page.explore) {
    return errors;
  }

  const from = page.explore.from;
  if (!from) {
    errors.push(`snapshotPages ${page.id} explore needs from`);
  } else if (!isAbsoluteUrl(from)) {
    const seed = pages.find((item) => item.id === from);
    if (!seed) {
      errors.push(`snapshotPages ${page.id} explores from unknown id ${from}`);
    } else if (!seed.url) {
      errors.push(
        `snapshotPages ${page.id} explores from ${from}, which has no url`,
      );
    }
  }

  const attempts = page.explore.try;
  if (!Array.isArray(attempts) || attempts.length === 0) {
    errors.push(`snapshotPages ${page.id} explore needs try`);
    return errors;
  }

  for (const attempt of attempts) {
    if (!(attempt?.href instanceof RegExp)) {
      errors.push(`snapshotPages ${page.id} explore href must be a RegExp`);
    }
    if (typeof attempt?.url !== "string" || !attempt.url) {
      errors.push(`snapshotPages ${page.id} explore url must be a string`);
    }
  }

  return errors;
}

export function catalogPages(pages, origin) {
  return pages.map((entry) => {
    let seed = null;
    if (entry.explore) {
      try {
        seed = seedFor(entry, pages);
      } catch {
        seed = null;
      }
    }
    return {
      id: entry.id,
      url: entry.url || null,
      seed,
      explore: entry.explore ? serializeExplore(entry.explore) : null,
      userscriptOnly: Boolean(entry.userscriptOnly),
      origin,
    };
  });
}
