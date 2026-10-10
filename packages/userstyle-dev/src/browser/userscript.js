// ==UserScript==
// @name        __STYLE_NAME__ — live inject
// @namespace   __NAMESPACE__
// @version     0.1.2
// @description Development injector: live CSS, overlay to toggle bundles, snapshot capture
// @match       __MATCH__
// @grant       GM_xmlhttpRequest
// @connect     127.0.0.1
// @connect     localhost
// @connect     __CONNECT_HOST__
// @run-at      document-start
// ==/UserScript==

(() => {
  const HOST = "__DEV_ORIGIN__";
  const POLL_MS = 400;
  const STORAGE_KEY = "__SITE_ID__-dev-overlay-v1";
  const QUEUE_KEY = "__SITE_ID__-dev-snapshot-all-v1";
  const HOST_ID = "__SITE_ID__-dev-overlay";
  const ORIGIN = "__SITE_ORIGIN__";

  const defaults = {
    overlayOpen: false,
    uiHidden: false,
    stylesOn: true,
    siteCss: true,
    blackoutMedia: false,
    disabled: {},
    pos: null,
  };

  const DRAG_THRESHOLD = 3;

  const BLACKOUT_CSS = __BLACKOUT_CSS_JSON__;

  let state = loadState();
  let styleEls = new Map();
  let blackoutEl = null;
  let bundles = [];
  let generation = 0;
  let compileError = null;
  let online = false;
  let warnedOffline = false;
  let hostEl = null;
  let shadow = null;
  let toastTimer = 0;
  let drag = null;
  let suppressClick = false;
  let queueRunning = false;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        ...defaults,
        ...parsed,
        disabled: { ...defaults.disabled, ...(parsed.disabled || {}) },
      };
    } catch {
      return { ...defaults };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          overlayOpen: state.overlayOpen,
          uiHidden: state.uiHidden,
          stylesOn: state.stylesOn,
          siteCss: state.siteCss,
          blackoutMedia: state.blackoutMedia,
          disabled: state.disabled,
          pos: state.pos,
        }),
      );
    } catch {
      /* ignore quota / privacy mode */
    }
  }

  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        data: options.body,
        headers: {
          "Cache-Control": "no-cache",
          ...(options.headers || {}),
        },
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout")),
        timeout: options.timeout ?? 30000,
      });
    });
  }

  function isDevNode(el) {
    return el?.getAttribute?.("data-userstyle-dev") != null || el?.id === HOST_ID;
  }

  function applyThemeCss() {
    const keep = new Set();

    for (const bundle of bundles) {
      if (!bundle.matches || bundle.css == null) {
        continue;
      }

      keep.add(bundle.id);
      let el = styleEls.get(bundle.id);
      if (!el?.isConnected) {
        el = document.createElement("style");
        el.setAttribute("data-userstyle-dev", bundle.id);
        (document.head || document.documentElement).appendChild(el);
        styleEls.set(bundle.id, el);
      }
      if (el.textContent !== bundle.css) {
        el.textContent = bundle.css;
      }
      el.disabled = !state.stylesOn || !!state.disabled[bundle.id];
    }

    for (const [id, el] of styleEls) {
      if (!keep.has(id)) {
        el.remove();
        styleEls.delete(id);
      }
    }
  }

  function applyBlackout() {
    if (!blackoutEl?.isConnected) {
      blackoutEl = document.querySelector("style[data-userstyle-dev='blackout']");
      if (!blackoutEl) {
        blackoutEl = document.createElement("style");
        blackoutEl.setAttribute("data-userstyle-dev", "blackout");
      }
      (document.head || document.documentElement).appendChild(blackoutEl);
    }

    if (blackoutEl.textContent !== BLACKOUT_CSS) {
      blackoutEl.textContent = BLACKOUT_CSS;
    }
    blackoutEl.disabled = !state.blackoutMedia;
  }

  function applySiteCss() {
    for (const el of document.querySelectorAll("link[rel*='stylesheet'], style")) {
      if (isDevNode(el)) {
        continue;
      }
      el.disabled = !state.siteCss;
    }
  }

  function observeSiteCss() {
    new MutationObserver((mutations) => {
      if (state.siteCss) {
        return;
      }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) {
            continue;
          }
          if (
            (node.matches?.("link[rel*='stylesheet'], style") && !isDevNode(node)) ||
            node.querySelector?.("link[rel*='stylesheet'], style")
          ) {
            applySiteCss();
            return;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  const overlayCss = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ui {
      pointer-events: auto;
      font: 12px/1.35 ui-sans-serif, system-ui, sans-serif;
      color: #cdd6f4;
      -webkit-font-smoothing: antialiased;
    }
    .panel, .toast {
      background: #1e1e2e;
      color: #cdd6f4;
      font: inherit;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
    }
    .fab {
      display: block;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 6px solid transparent;
      border-radius: 50%;
      background-color: #89b4fa;
      background-clip: padding-box;
      cursor: grab;
      touch-action: none;
      user-select: none;
      opacity: .75;
    }
    .fab:hover { opacity: 1; }
    .fab.warn { background-color: #f9e2af; }
    .fab.err { background-color: #f38ba8; }
    .panel {
      width: 252px;
      border: 1px solid #45475a;
      border-radius: 10px;
      overflow: hidden;
      background: rgba(30, 30, 46, 0.8);
      backdrop-filter: blur(10px);
    }
    .fab[hidden], .panel[hidden], .toast[hidden] { display: none; }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: rgba(24, 24, 37, 0.4);
      border-bottom: 1px solid #313244;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .dragging .fab, .dragging header { cursor: grabbing; }
    .dragging { user-select: none; }
    header strong { font-weight: 650; }
    .grow { flex: 1; }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #89b4fa;
      flex: none;
    }
    .dot.warn { background: #f9e2af; }
    .dot.err { background: #f38ba8; }
    .status {
      color: #6c7086;
      font-size: 11px;
    }
    button.icon {
      background: none;
      border: 0;
      color: #a6adc8;
      cursor: pointer;
      font: 14px/1 inherit;
      padding: 0 2px;
    }
    button.icon:hover { color: #cdd6f4; }
    .body { padding: 8px 10px 10px; }
    .toggles {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 4px;
    }
    .toggles .wide { grid-column: 1 / -1; }
    label.chk {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .sec {
      color: #6c7086;
      font-size: 10px;
      font-weight: 650;
      letter-spacing: .04em;
      text-transform: uppercase;
      margin: 8px 0 4px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 1px 0;
    }
    .row > .chk { flex: 1; min-width: 0; }
    .row .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .only {
      background: none;
      border: 0;
      color: #89b4fa;
      cursor: pointer;
      font: inherit;
      font-size: 10px;
      padding: 0;
      opacity: 0;
    }
    .row:hover .only, .only:focus { opacity: 1; }
    .error {
      margin: 0 0 8px;
      padding: 6px 8px;
      background: #313244;
      color: #f38ba8;
      border-radius: 6px;
      max-height: 7.5em;
      overflow: auto;
      white-space: pre-wrap;
      font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .actions button {
      flex: 1 1 calc(50% - 6px);
      background: #313244;
      border: 1px solid #45475a;
      color: #cdd6f4;
      border-radius: 6px;
      padding: 5px 8px;
      cursor: pointer;
      font: inherit;
    }
    .actions button:hover { border-color: #89b4fa; }
    .actions button[hidden] { display: none; }
    .toast {
      position: absolute;
      right: 0;
      top: calc(100% + 8px);
      width: max-content;
      max-width: 280px;
      padding: 8px 10px;
      border: 1px solid #89b4fa;
      border-radius: 8px;
    }
    input { accent-color: #89b4fa; }
  `;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function pageBundles() {
    return bundles
      .filter((bundle) => bundle.matches)
      .sort((a, b) => {
        if (a.id === "base") {
          return -1;
        }
        if (b.id === "base") {
          return 1;
        }
        return a.id.localeCompare(b.id);
      });
  }

  function bundleList(items) {
    if (!items.length) {
      return "";
    }

    const rows = items
      .map((bundle) => {
        const checked = state.disabled[bundle.id] ? "" : " checked";
        return `<div class="row" title="${escapeHtml(bundle.document)}">
          <label class="chk">
            <input type="checkbox" data-bundle="${escapeHtml(bundle.id)}"${checked}>
            <span class="name">${escapeHtml(bundle.id)}</span>
          </label>
          <button class="only" type="button" data-solo="${escapeHtml(bundle.id)}">only</button>
        </div>`;
      })
      .join("");

    return `<div class="sec">this page</div>${rows}`;
  }

  function $ (sel) {
    return shadow.querySelector(sel);
  }

  function clampPosition(pos) {
    const rect = hostEl?.getBoundingClientRect();
    const maxTop = Math.max(window.innerHeight - (rect?.height || 0), 0);
    const maxRight = Math.max(window.innerWidth - (rect?.width || 0), 0);
    return {
      top: Math.round(Math.min(Math.max(pos.top, 0), maxTop)),
      right: Math.round(Math.min(Math.max(pos.right, 0), maxRight)),
    };
  }

  function applyOverlayPosition() {
    if (!hostEl) {
      return;
    }

    const pos = state.pos || { top: 12, right: 12 };
    hostEl.style.cssText = [
      "all:initial !important",
      "position:fixed !important",
      "z-index:2147483647 !important",
      `top:${pos.top}px !important`,
      `right:${pos.right}px !important`,
      "display:block !important",
      "width:auto !important",
      "height:auto !important",
      "pointer-events:none !important",
    ].join(";");
  }

  function onDragStart(event) {
    if (event.button !== 0 || drag) {
      return;
    }

    const handle = event.target.closest?.(".fab, header");
    if (!handle || event.target.closest("button.icon, input, .only")) {
      return;
    }

    const rect = hostEl.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      top: rect.top,
      right: window.innerWidth - rect.right,
      moved: false,
    };
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
    window.addEventListener("pointercancel", onDragEnd, true);
    event.preventDefault();
  }

  function onDragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }

    drag.moved = true;
    $(".ui").classList.add("dragging");
    state.pos = clampPosition({ top: drag.top + dy, right: drag.right - dx });
    applyOverlayPosition();
    event.preventDefault();
  }

  function onDragEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
    window.removeEventListener("pointercancel", onDragEnd, true);
    $(".ui").classList.remove("dragging");
    suppressClick = drag.moved;
    drag = null;
    if (suppressClick) {
      saveState();
    }
  }

  function mount() {
    if (hostEl?.isConnected) {
      return;
    }

    hostEl = document.getElementById(HOST_ID) || document.createElement("div");
    hostEl.id = HOST_ID;
    hostEl.setAttribute("data-userstyle-dev", "overlay");
    applyOverlayPosition();

    shadow = hostEl.shadowRoot || hostEl.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${overlayCss}</style>
      <div class="ui">
        <div class="toast" hidden></div>
        <button class="fab" type="button" data-act="open" hidden title="Dev overlay (Alt+Shift+D)" aria-label="Open dev overlay"></button>
        <div class="panel" hidden>
          <header>
            <span class="dot"></span>
            <strong>dev</strong>
            <span class="status grow"></span>
            <button class="icon" type="button" data-act="collapse" title="Collapse to badge">–</button>
            <button class="icon" type="button" data-act="hide" title="Hide (Alt+Shift+D)">×</button>
          </header>
          <div class="body">
            <pre class="error" hidden></pre>
            <div class="toggles">
              <label class="chk" title="Injected Catppuccin theme">
                <input type="checkbox" data-act="styles"> Theme
              </label>
              <label class="chk" title="Gelbooru's own stylesheets">
                <input type="checkbox" data-act="site"> Site CSS
              </label>
              <label class="chk wide" title="Grey out post images, thumbnails, and video">
                <input type="checkbox" data-act="blackout"> Black out media
              </label>
            </div>
            <div class="bundles"></div>
            <div class="actions">
              <button type="button" data-act="snapshot">Snapshot</button>
              <button type="button" data-act="snapshot-all" title="Live queue through every catalog page">All</button>
              <button type="button" data-act="snapshot-stop" hidden title="Cancel snapshot-all queue">Stop</button>
              <button type="button" data-act="reset">Reset</button>
            </div>
          </div>
        </div>
      </div>
    `;

    shadow.addEventListener("click", onOverlayClick);
    shadow.addEventListener("change", onOverlayChange);
    for (const type of ["mousedown", "mouseup", "pointerdown"]) {
      shadow.addEventListener(type, (event) => event.stopPropagation());
    }
    shadow.addEventListener("pointerdown", onDragStart);
    (document.documentElement || document.body).appendChild(hostEl);
    renderOverlay();
  }

  function onOverlayClick(event) {
    event.stopPropagation();
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    const act = event.target.closest("[data-act], [data-solo]");
    if (!act) {
      return;
    }

    if (act.dataset.act === "open") {
      state.uiHidden = false;
      state.overlayOpen = true;
    } else if (act.dataset.act === "collapse") {
      state.overlayOpen = false;
    } else if (act.dataset.act === "hide") {
      state.uiHidden = true;
      state.overlayOpen = false;
    } else if (act.dataset.act === "snapshot") {
      event.preventDefault();
      snapshot();
      return;
    } else if (act.dataset.act === "snapshot-all") {
      event.preventDefault();
      startSnapshotAll();
      return;
    } else if (act.dataset.act === "snapshot-stop") {
      event.preventDefault();
      stopSnapshotAll();
      return;
    } else if (act.dataset.act === "reset") {
      state.stylesOn = true;
      state.siteCss = true;
      state.blackoutMedia = false;
      state.disabled = {};
      state.uiHidden = false;
      state.pos = null;
      applyOverlayPosition();
      applySiteCss();
      applyThemeCss();
      applyBlackout();
    } else if (act.dataset.solo) {
      for (const bundle of bundles) {
        if (!bundle.matches) {
          continue;
        }
        if (bundle.id === act.dataset.solo) {
          delete state.disabled[bundle.id];
        } else {
          state.disabled[bundle.id] = true;
        }
      }
      state.stylesOn = true;
      applyThemeCss();
    } else {
      return;
    }

    event.preventDefault();
    saveState();
    renderOverlay();
  }

  function onOverlayChange(event) {
    event.stopPropagation();
    const target = event.target;
    if (target.dataset.act === "styles") {
      state.stylesOn = target.checked;
      applyThemeCss();
    } else if (target.dataset.act === "site") {
      state.siteCss = target.checked;
      applySiteCss();
    } else if (target.dataset.act === "blackout") {
      state.blackoutMedia = target.checked;
      applyBlackout();
    } else if (target.dataset.bundle) {
      if (target.checked) {
        delete state.disabled[target.dataset.bundle];
      } else {
        state.disabled[target.dataset.bundle] = true;
      }
      applyThemeCss();
    } else {
      return;
    }

    saveState();
    renderOverlay();
  }

  function statusInfo() {
    if (!online) {
      return { cls: "err", text: "offline" };
    }
    if (compileError) {
      return { cls: "err", text: "sass" };
    }
    if (!state.stylesOn) {
      return { cls: "warn", text: "off" };
    }
    if (generation) {
      return { cls: "", text: `live ${generation}` };
    }
    return { cls: "", text: "live" };
  }

  function renderOverlay() {
    if (!shadow) {
      return;
    }

    const { cls, text } = statusInfo();
    for (const dot of shadow.querySelectorAll(".dot")) {
      dot.className = `dot ${cls}`.trim();
    }
    $(".status").textContent = text;
    const fab = $(".fab");
    fab.className = `fab ${cls}`.trim();
    fab.hidden = state.uiHidden || state.overlayOpen;
    $(".panel").hidden = state.uiHidden || !state.overlayOpen;
    $("[data-act='styles']").checked = state.stylesOn;
    $("[data-act='site']").checked = state.siteCss;
    $("[data-act='blackout']").checked = state.blackoutMedia;

    const errorEl = $(".error");
    if (compileError) {
      errorEl.hidden = false;
      errorEl.textContent = compileError;
    } else {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    if (state.pos) {
      state.pos = clampPosition(state.pos);
      applyOverlayPosition();
    }

    $(".bundles").innerHTML = bundleList(pageBundles());

    const queue = loadQueue();
    const allBtn = $("[data-act='snapshot-all']");
    const stopBtn = $("[data-act='snapshot-stop']");
    if (allBtn && stopBtn) {
      allBtn.hidden = Boolean(queue);
      stopBtn.hidden = !queue;
    }
  }

  function toast(message, ms = 4500) {
    mount();
    const el = $(".toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    if (ms > 0) {
      toastTimer = setTimeout(() => {
        el.hidden = true;
      }, ms);
    }
  }

  function loadQueue() {
    try {
      return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveQueue(queue) {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function clearQueue() {
    sessionStorage.removeItem(QUEUE_KEY);
  }

  function urlsMatch(currentHref, targetHref) {
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

  function fillExploreUrl(template, match) {
    let url = template;
    for (let i = 1; i < match.length; i += 1) {
      const value = String(match[i] ?? "").replaceAll("&amp;", "&");
      url = url.replaceAll(`$${i}`, value);
    }
    return new URL(url, ORIGIN).href;
  }

  function exploreUrl(explore, doc) {
    const html = doc.documentElement
      ? doc.documentElement.outerHTML
      : String(doc);
    for (const attempt of explore.try || []) {
      const href = attempt.href || {};
      const re = new RegExp(href.source, href.flags || "");
      const match = html.match(re);
      if (match) {
        return fillExploreUrl(attempt.url, match);
      }
    }
    throw new Error("No explorer pattern matched");
  }

  async function snapshot(options = {}) {
    if (!options.quiet) {
      toast("Capturing snapshot…");
    }
    try {
      const src = await gmFetch(`${HOST}/snapshot-capture.js`);
      const result = await new Function(
        "host",
        "gmFetch",
        "captureOptions",
        src,
      )(HOST, gmFetch, {
        skipPreviews: Boolean(options.skipPreviews),
        id: options.id || "",
      });
      if (!options.quiet) {
        const extra = result.notes?.length ? ` (${result.notes.join("; ")})` : "";
        toast(`Saved snapshots/pages/${result.id}.html${extra}`);
      }
      return result;
    } catch (error) {
      if (!options.quiet) {
        toast(`Snapshot failed: ${error.message}`);
      }
      console.error("[__SITE_ID__-dev] snapshot", error);
      throw error;
    }
  }

  async function startSnapshotAll() {
    if (loadQueue()) {
      toast("Snapshot all already running — press Stop to cancel");
      return;
    }

    const ok = confirm(
      "Snapshot all catalog pages?\n\nThis tab will navigate through each page and capture a live snapshot (no selector previews). Stay logged in for account pages.",
    );
    if (!ok) {
      return;
    }

    try {
      const data = JSON.parse(await gmFetch(`${HOST}/snapshot-catalog`));
      const pages = data.pages || [];
      if (!pages.length) {
        toast("Snapshot catalog is empty — is npm run dev up?");
        return;
      }

      const steps = pages.map((page) => {
        if (page.explore) {
          return {
            type: "explore",
            id: page.id,
            seed: page.seed,
            explore: page.explore,
          };
        }
        return { type: "capture", id: page.id, url: page.url };
      });

      saveQueue({
        steps,
        index: 0,
        results: [],
        startedAt: Date.now(),
      });
      renderOverlay();
      toast(`Snapshot all 1/${steps.length} · ${steps[0].id}`, 0);
      void runQueueStep();
    } catch (error) {
      const hint =
        /HTTP 404/.test(error.message)
          ? " — restart `npm run dev` (new /snapshot-catalog route)"
          : "";
      toast(`Snapshot all failed: ${error.message}${hint}`);
      console.error("[__SITE_ID__-dev] snapshot all", error);
    }
  }

  function stopSnapshotAll() {
    clearQueue();
    queueRunning = false;
    toast("Snapshot all stopped");
    renderOverlay();
  }

  function finishSnapshotAll(queue) {
    clearQueue();
    const ok = queue.results.filter((item) => item.ok).length;
    const fail = queue.results.length - ok;
    toast(`Snapshot all done: ${ok} ok, ${fail} failed`, 8000);
    if (fail) {
      console.warn(
        "[__SITE_ID__-dev] snapshot all failures",
        queue.results.filter((item) => !item.ok),
      );
    }
    renderOverlay();
  }

  function advanceQueue(queue) {
    queue.index += 1;
    saveQueue(queue);
    if (queue.index >= queue.steps.length) {
      finishSnapshotAll(queue);
      return;
    }
    const next = queue.steps[queue.index];
    const url = next.type === "explore" ? next.seed : next.url;
    toast(`Snapshot all ${queue.index + 1}/${queue.steps.length} · ${next.id}`, 0);
    location.assign(url);
  }

  async function runQueueStep() {
    if (queueRunning) {
      return;
    }
    const queue = loadQueue();
    if (!queue) {
      return;
    }
    if (queue.index >= queue.steps.length) {
      finishSnapshotAll(queue);
      return;
    }

    queueRunning = true;
    const step = queue.steps[queue.index];
    const total = queue.steps.length;
    const label = `Snapshot all ${queue.index + 1}/${total} · ${step.id}`;

    try {
      if (step.type === "explore") {
        if (!urlsMatch(location.href, step.seed) && !step.navigated) {
          queue.steps[queue.index] = { ...step, navigated: true };
          saveQueue(queue);
          toast(label, 0);
          location.assign(step.seed);
          return;
        }

        try {
          const url = exploreUrl(step.explore, document);
          queue.steps[queue.index] = { type: "capture", id: step.id, url };
          saveQueue(queue);
          toast(label, 0);
          location.assign(url);
        } catch (error) {
          queue.results.push({
            id: step.id,
            ok: false,
            error: error.message,
          });
          advanceQueue(queue);
        }
        return;
      }

      if (step.type === "capture") {
        if (!urlsMatch(location.href, step.url) && !step.navigated) {
          queue.steps[queue.index] = { ...step, navigated: true };
          saveQueue(queue);
          toast(label, 0);
          location.assign(step.url);
          return;
        }

        toast(`Capturing ${label}`, 0);
        let outcome;
        try {
          const result = await snapshot({
            skipPreviews: true,
            quiet: true,
            id: step.id,
          });
          outcome =
            result.id !== step.id
              ? {
                  id: step.id,
                  ok: false,
                  error: `expected ${step.id}, got ${result.id}`,
                }
              : { id: step.id, ok: true };
        } catch (error) {
          outcome = { id: step.id, ok: false, error: error.message };
        }

        const latest = loadQueue();
        if (!latest) {
          return;
        }
        latest.results.push(outcome);
        advanceQueue(latest);
      }
    } finally {
      queueRunning = false;
    }
  }

  function scheduleQueueResume() {
    if (!loadQueue()) {
      return;
    }
    let started = false;
    const start = () => {
      if (started) {
        return;
      }
      started = true;
      setTimeout(() => {
        void runQueueStep();
      }, 500);
    };
    // window "load" waits for images, video, and ads. A post page can sit
    // there until a webm finishes, so the queue never reaches the next page.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
      setTimeout(start, 8000);
      return;
    }
    start();
  }

  async function tick() {
    mount();
    try {
      const url = `${HOST}/dev.json?href=${encodeURIComponent(location.href)}&generation=${generation}`;
      const data = JSON.parse(await gmFetch(url, { timeout: 3000 }));
      const wasOffline = !online;
      online = true;
      warnedOffline = false;

      if (data.unchanged) {
        const nextError = data.error || null;
        if (compileError !== nextError || wasOffline) {
          compileError = nextError;
          renderOverlay();
        }
        return;
      }

      generation = data.generation;
      compileError = data.error || null;
      bundles = data.bundles || [];
      applyThemeCss();
      renderOverlay();
    } catch {
      if (online || !warnedOffline) {
        online = false;
        renderOverlay();
      }
      if (!warnedOffline) {
        warnedOffline = true;
        console.warn(
          "[__SITE_ID__-dev] dev server is not reachable at",
          HOST,
          "— run `npm run dev`",
        );
      }
    }
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || !event.shiftKey || event.repeat) {
        return;
      }
      if (event.code === "KeyS") {
        event.preventDefault();
        event.stopPropagation();
        snapshot();
      } else if (event.code === "KeyD") {
        event.preventDefault();
        event.stopPropagation();
        if (state.uiHidden) {
          state.uiHidden = false;
          state.overlayOpen = true;
        } else {
          state.overlayOpen = !state.overlayOpen;
        }
        saveState();
        mount();
        renderOverlay();
      }
    },
    true,
  );

  window.addEventListener("resize", () => {
    if (state.pos && hostEl) {
      state.pos = clampPosition(state.pos);
      applyOverlayPosition();
    }
  });

  observeSiteCss();
  applySiteCss();
  applyBlackout();
  document.addEventListener("DOMContentLoaded", applySiteCss);
  document.addEventListener("userstyle-dev-toast", (event) => {
    if (event.detail) {
      toast(String(event.detail));
    }
  });
  scheduleQueueResume();
  tick();
  setInterval(tick, POLL_MS);
})();
