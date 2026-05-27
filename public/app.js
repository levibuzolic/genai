const elements = {
  configLine: document.querySelector("#configLine"),
  syncNewButton: document.querySelector("#syncNewButton"),
  downloadMissingButton: document.querySelector("#downloadMissingButton"),
  retryErrorsButton: document.querySelector("#retryErrorsButton"),
  generateThumbnailsButton: document.querySelector("#generateThumbnailsButton"),
  verifyLibraryButton: document.querySelector("#verifyLibraryButton"),
  syncAllButton: document.querySelector("#syncAllButton"),
  cancelSyncButton: document.querySelector("#cancelSyncButton"),
  searchInput: document.querySelector("#searchInput"),
  mediaSelect: document.querySelector("#mediaSelect"),
  statusSelect: document.querySelector("#statusSelect"),
  sortSelect: document.querySelector("#sortSelect"),
  pageSizeSelect: document.querySelector("#pageSizeSelect"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  gridViewButton: document.querySelector("#gridViewButton"),
  listViewButton: document.querySelector("#listViewButton"),
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  pageStatus: document.querySelector("#pageStatus"),
  summaryCards: document.querySelector("#summaryCards"),
  activeFilters: document.querySelector("#activeFilters"),
  syncStatus: document.querySelector("#syncStatus"),
  libraryStatus: document.querySelector("#libraryStatus"),
  backupStatus: document.querySelector("#backupStatus"),
  backupSelect: document.querySelector("#backupSelect"),
  createBackupButton: document.querySelector("#createBackupButton"),
  restoreBackupButton: document.querySelector("#restoreBackupButton"),
  grid: document.querySelector("#grid"),
  emptyState: document.querySelector("#emptyState"),
  itemTemplate: document.querySelector("#itemTemplate"),
  itemDialog: document.querySelector("#itemDialog"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  detailPreview: document.querySelector("#detailPreview"),
  detailPrompt: document.querySelector("#detailPrompt"),
  detailNegativePrompt: document.querySelector("#detailNegativePrompt"),
  negativePromptSection: document.querySelector("#negativePromptSection"),
  detailFacts: document.querySelector("#detailFacts"),
  detailCopyPromptButton: document.querySelector("#detailCopyPromptButton"),
  detailCopyIdButton: document.querySelector("#detailCopyIdButton"),
  detailCopyUrlButton: document.querySelector("#detailCopyUrlButton"),
  detailOpenLink: document.querySelector("#detailOpenLink")
};

const SEARCH_DEBOUNCE_MS = 350;
const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 10000;
const MEDIA_OBSERVER_MARGIN = "900px 0px";
const MEDIA_EAGER_MARGIN_PX = 900;
const URL_DEFAULTS = {
  media: "all",
  status: "all",
  sort: "newest",
  pageSize: "48",
  page: 1,
  view: "grid",
  q: ""
};

const state = {
  page: 1,
  pageCount: 1,
  view: URL_DEFAULTS.view,
  lastCatalogUpdatedAt: null,
  lastRenderedTotal: null,
  lastQueryKey: "",
  lastFacetsKey: "",
  currentItems: [],
  itemNodes: new Map(),
  selectedItem: null,
  suppressUrlUpdate: false,
  lastStatusRunning: false,
  lastConfigLoadedAt: 0
};

let pollTimer = null;
let searchTimer = null;
let mediaObserver = null;

elements.syncNewButton.addEventListener("click", () => startSync(true));
elements.downloadMissingButton.addEventListener("click", () => startDownload("missing"));
elements.retryErrorsButton.addEventListener("click", () => startDownload("retry-errors"));
elements.generateThumbnailsButton.addEventListener("click", startThumbnailGeneration);
elements.verifyLibraryButton.addEventListener("click", startLibraryVerification);
elements.syncAllButton.addEventListener("click", () => startSync(false));
elements.cancelSyncButton.addEventListener("click", cancelSync);
elements.createBackupButton.addEventListener("click", createCatalogBackup);
elements.restoreBackupButton.addEventListener("click", restoreCatalogBackup);
elements.clearFiltersButton.addEventListener("click", clearFilters);
elements.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    loadItems({ force: true, historyMode: "replace" });
  }, SEARCH_DEBOUNCE_MS);
});

[
  elements.mediaSelect,
  elements.statusSelect,
  elements.sortSelect,
  elements.pageSizeSelect
].forEach((element) => {
  element.addEventListener("change", () => {
    state.page = 1;
    loadItems({ force: true, historyMode: "push" });
  });
});

elements.gridViewButton.addEventListener("click", () => setView("grid", { historyMode: "push" }));
elements.listViewButton.addEventListener("click", () => setView("list", { historyMode: "push" }));
elements.prevPageButton.addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    loadItems({ force: true, historyMode: "push" });
  }
});
elements.nextPageButton.addEventListener("click", () => {
  if (state.page < state.pageCount) {
    state.page += 1;
    loadItems({ force: true, historyMode: "push" });
  }
});
elements.summaryCards.addEventListener("click", (event) => {
  const button = event.target.closest("[data-status-filter]");
  if (!button) return;

  elements.statusSelect.value = button.dataset.statusFilter;
  state.page = 1;
  loadItems({ force: true, historyMode: "push" });
});
elements.activeFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-clear-filter]");
  if (!button) return;

  clearSingleFilter(button.dataset.clearFilter);
});
elements.detailCopyPromptButton.addEventListener("click", () => {
  if (state.selectedItem?.prompt) {
    copyValue(state.selectedItem.prompt, elements.detailCopyPromptButton, "Copied");
  }
});
elements.detailCopyIdButton.addEventListener("click", () => {
  if (state.selectedItem?.id) {
    copyValue(state.selectedItem.id, elements.detailCopyIdButton, "Copied");
  }
});
elements.detailCopyUrlButton.addEventListener("click", () => {
  if (state.selectedItem?.outputUrl) {
    copyValue(state.selectedItem.outputUrl, elements.detailCopyUrlButton, "Copied");
  }
});
window.addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea, select")) return;

  if (event.key === "/") {
    event.preventDefault();
    elements.searchInput.focus();
    elements.searchInput.select();
  } else if (event.key === "ArrowLeft" && state.page > 1) {
    state.page -= 1;
    loadItems({ force: true, historyMode: "push" });
  } else if (event.key === "ArrowRight" && state.page < state.pageCount) {
    state.page += 1;
    loadItems({ force: true, historyMode: "push" });
  }
});
window.addEventListener("popstate", async () => {
  state.suppressUrlUpdate = true;
  hydrateStateFromUrl();
  setView(state.view, { updateUrl: false });
  await loadItems({ force: true, updateUrl: false });
  state.suppressUrlUpdate = false;
});

hydrateStateFromUrl();
setView(state.view);
setupMediaObserver();
await loadConfig();
await loadItems({ force: true });
await loadBackups();
await pollStatus();
scheduleNextPoll(ACTIVE_POLL_MS);

async function loadConfig() {
  const config = await fetchJson("/api/config");
  const auth = config.hasAuthorization
    ? `auth ${config.authorizationSource || "configured"}${config.authorizationExpiresAt ? ` until ${new Date(config.authorizationExpiresAt).toLocaleTimeString()}` : ""}`
    : "no active auth token";
  elements.configLine.textContent = `${config.mediaDir} · ${auth}`;
  state.lastConfigLoadedAt = Date.now();
}

async function loadItems(options = {}) {
  const params = buildItemParams();
  const queryKey = params.toString();
  const data = await fetchJson(`/api/items?${params}`);
  const facetsKey = JSON.stringify(data.facets || {});

  state.page = data.page || 1;
  state.pageCount = data.pageCount || 1;
  if (options.updateUrl !== false) {
    updateUrlFromState(options.historyMode || "replace");
  }
  renderPager(data);
  renderLibraryStatus(data);
  renderSummary(data.facets);
  renderActiveFilters();

  if (facetsKey !== state.lastFacetsKey) {
    renderFacets(data.facets);
    state.lastFacetsKey = facetsKey;
  }

  const changed = options.force ||
    queryKey !== state.lastQueryKey ||
    data.catalogUpdatedAt !== state.lastCatalogUpdatedAt ||
    data.total !== state.lastRenderedTotal;

  if (changed) {
    state.currentItems = data.items;
    renderItems(data.items);
    state.lastCatalogUpdatedAt = data.catalogUpdatedAt;
    state.lastRenderedTotal = data.total;
    state.lastQueryKey = queryKey;
  }
}

function buildItemParams() {
  const params = new URLSearchParams();
  const query = elements.searchInput.value.trim();

  if (query) params.set("q", query);
  params.set("media", elements.mediaSelect.value);
  params.set("status", elements.statusSelect.value);
  params.set("sort", elements.sortSelect.value);
  params.set("pageSize", elements.pageSizeSelect.value);
  params.set("page", String(state.page));

  return params;
}

function hydrateStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  elements.searchInput.value = params.get("q") || URL_DEFAULTS.q;
  elements.mediaSelect.value = allowedSelectValue(elements.mediaSelect, params.get("media"), URL_DEFAULTS.media);
  elements.statusSelect.value = allowedSelectValue(elements.statusSelect, params.get("status"), URL_DEFAULTS.status);
  elements.sortSelect.value = allowedSelectValue(elements.sortSelect, params.get("sort"), URL_DEFAULTS.sort);
  elements.pageSizeSelect.value = allowedSelectValue(elements.pageSizeSelect, params.get("pageSize"), URL_DEFAULTS.pageSize);
  state.page = Math.max(1, Number(params.get("page") || URL_DEFAULTS.page));
  state.view = params.get("view") === "list" ? "list" : URL_DEFAULTS.view;
}

function updateUrlFromState(mode = "replace") {
  if (state.suppressUrlUpdate) {
    return;
  }

  const params = new URLSearchParams();
  const query = elements.searchInput.value.trim();
  const values = {
    q: query,
    media: elements.mediaSelect.value,
    status: elements.statusSelect.value,
    sort: elements.sortSelect.value,
    pageSize: elements.pageSizeSelect.value,
    page: String(state.page),
    view: state.view
  };

  for (const [key, value] of Object.entries(values)) {
    if (String(value || "") !== String(URL_DEFAULTS[key])) {
      params.set(key, value);
    }
  }

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;

  if (nextUrl !== currentUrl) {
    if (mode === "push") {
      window.history.pushState(null, "", nextUrl);
    } else {
      window.history.replaceState(null, "", nextUrl);
    }
  }
}

function clearFilters() {
  elements.searchInput.value = URL_DEFAULTS.q;
  elements.mediaSelect.value = URL_DEFAULTS.media;
  elements.statusSelect.value = URL_DEFAULTS.status;
  elements.sortSelect.value = URL_DEFAULTS.sort;
  state.page = 1;
  loadItems({ force: true, historyMode: "push" });
}

function clearSingleFilter(name) {
  if (name === "q") elements.searchInput.value = URL_DEFAULTS.q;
  if (name === "media") elements.mediaSelect.value = URL_DEFAULTS.media;
  if (name === "status") elements.statusSelect.value = URL_DEFAULTS.status;
  if (name === "sort") elements.sortSelect.value = URL_DEFAULTS.sort;
  state.page = 1;
  loadItems({ force: true, historyMode: "push" });
}

function allowedSelectValue(select, value, fallback) {
  return [...select.options].some((option) => option.value === value) ? value : fallback;
}

async function pollStatus() {
  const status = await fetchJson("/api/sync/status");
  const wasRunning = state.lastStatusRunning;
  state.lastStatusRunning = Boolean(status.running);
  renderStatus(status);

  if (status.running || wasRunning) {
    await loadConfig();
    await loadItems();
    if (wasRunning && !status.running) {
      await loadBackups();
    }
  } else if (Date.now() - state.lastConfigLoadedAt > 60000) {
    await loadConfig();
  }

  scheduleNextPoll(status.running ? ACTIVE_POLL_MS : IDLE_POLL_MS);
}

function scheduleNextPoll(delay) {
  clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollStatus, delay);
}

async function startSync(incremental) {
  setButtonsDisabled(true);
  updateCancelButton({ running: true, cancelRequested: false });

  try {
    const response = await fetchJson("/api/sync/start", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ incremental })
    });

    if (!response.ok) {
      throw new Error(response.error || "Unable to start sync.");
    }

    await pollStatus();
  } catch (error) {
    elements.syncStatus.textContent = error instanceof Error ? error.message : String(error);
    setButtonsDisabled(false);
    updateCancelButton({ running: false });
  }
}

async function startDownload(kind) {
  setButtonsDisabled(true);
  updateCancelButton({ running: true, cancelRequested: false });

  try {
    const endpoint = kind === "retry-errors" ? "/api/download/retry-errors" : "/api/download/missing";
    const response = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(response.error || "Unable to start download.");
    }

    await pollStatus();
  } catch (error) {
    elements.syncStatus.textContent = error instanceof Error ? error.message : String(error);
    setButtonsDisabled(false);
    updateCancelButton({ running: false });
  }
}

async function cancelSync() {
  elements.cancelSyncButton.disabled = true;
  elements.cancelSyncButton.textContent = "Cancelling...";

  try {
    await fetchJson("/api/sync/cancel", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    });
    await pollStatus();
  } catch (error) {
    elements.syncStatus.textContent = error instanceof Error ? error.message : String(error);
    await pollStatus();
  }
}

async function startThumbnailGeneration() {
  setButtonsDisabled(true);
  updateCancelButton({ running: true, cancelRequested: false });

  try {
    const response = await fetchJson("/api/thumbnails/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(response.error || "Unable to start thumbnail generation.");
    }

    await pollStatus();
  } catch (error) {
    elements.syncStatus.textContent = error instanceof Error ? error.message : String(error);
    setButtonsDisabled(false);
    updateCancelButton({ running: false });
  }
}

async function startLibraryVerification() {
  setButtonsDisabled(true);
  updateCancelButton({ running: true, cancelRequested: false });

  try {
    const response = await fetchJson("/api/library/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(response.error || "Unable to start library verification.");
    }

    await pollStatus();
  } catch (error) {
    elements.syncStatus.textContent = error instanceof Error ? error.message : String(error);
    setButtonsDisabled(false);
    updateCancelButton({ running: false });
  }
}

async function loadBackups() {
  const data = await fetchJson("/api/catalog/backups");
  const backups = data.backups || [];
  const selected = elements.backupSelect.value;

  elements.backupSelect.textContent = "";

  if (backups.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No backups yet";
    elements.backupSelect.append(option);
  } else {
    for (const backup of backups) {
      const option = document.createElement("option");
      option.value = backup.file;
      option.textContent = [
        formatDate(backup.createdAt),
        backup.reason,
        `${formatNumber(backup.itemCount || 0)} items`,
        formatBytes(backup.size)
      ].filter(Boolean).join(" · ");
      elements.backupSelect.append(option);
    }

    if ([...elements.backupSelect.options].some((option) => option.value === selected)) {
      elements.backupSelect.value = selected;
    }
  }

  elements.backupStatus.textContent = backups.length === 0
    ? "No backups yet."
    : `${formatNumber(backups.length)} backup${backups.length === 1 ? "" : "s"} available.`;
  elements.restoreBackupButton.disabled = backups.length === 0;
}

async function createCatalogBackup() {
  elements.createBackupButton.disabled = true;

  try {
    await fetchJson("/api/catalog/backup", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ reason: "manual" })
    });
    await loadBackups();
  } catch (error) {
    elements.backupStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    elements.createBackupButton.disabled = false;
  }
}

async function restoreCatalogBackup() {
  const file = elements.backupSelect.value;

  if (!file) {
    return;
  }

  const confirmed = window.confirm("Restore this catalog backup? The current catalog will be backed up first.");
  if (!confirmed) {
    return;
  }

  elements.restoreBackupButton.disabled = true;

  try {
    await fetchJson("/api/catalog/restore", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ file })
    });
    state.lastCatalogUpdatedAt = null;
    state.lastRenderedTotal = null;
    await loadItems({ force: true });
    await loadBackups();
    elements.backupStatus.textContent = "Catalog restored.";
  } catch (error) {
    elements.backupStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    elements.restoreBackupButton.disabled = !elements.backupSelect.value;
  }
}

function renderStatus(status) {
  const progressLabel = status.mode === "generate-thumbnails"
    ? "generated"
    : status.mode === "verify-library"
      ? "verified"
      : "downloaded";
  const parts = [
    status.message || "Idle.",
    ["cancelling", "cancelled"].includes(status.status) ? status.status : null,
    status.running ? `page ${status.currentPage}` : null,
    `scanned ${status.scanned}`,
    `${progressLabel} ${status.downloaded}`,
    `skipped ${status.skipped}`
  ].filter(Boolean);

  elements.syncStatus.textContent = parts.join(" · ");
  setButtonsDisabled(Boolean(status.running));
  updateCancelButton(status);
}

function renderLibraryStatus(data) {
  const start = data.total === 0 ? 0 : ((data.page - 1) * data.pageSize) + 1;
  const end = Math.min(data.total, data.page * data.pageSize);
  const orphanCount = data.facets?.orphanFiles || 0;
  elements.libraryStatus.textContent = [
    `${start}-${end} of ${data.total} item${data.total === 1 ? "" : "s"}`,
    orphanCount ? `${formatNumber(orphanCount)} orphan file${orphanCount === 1 ? "" : "s"}` : null
  ].filter(Boolean).join(" · ");
}

function renderSummary(facets = {}) {
  const selectedStatus = elements.statusSelect.value;
  const cards = [
    ["Missing", facets.status?.missing || 0, "missing"],
    ["Errors", facets.status?.error || 0, "error"],
    ["Duplicates", facets.status?.duplicate || 0, "duplicate"],
    ["Unverified", facets.status?.unverified || 0, "unverified"],
    ["Favorited", facets.status?.favorited || 0, "favorited"]
  ].filter(([, value, status]) => value > 0 || selectedStatus === status);

  elements.summaryCards.textContent = "";

  for (const [label, value, status] of cards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "summaryCard";
    button.dataset.statusFilter = status;
    button.innerHTML = `<span>${label}</span><strong>${formatNumber(value)}</strong>`;
    button.classList.toggle("is-active", elements.statusSelect.value === status);
    elements.summaryCards.append(button);
  }
}

function renderActiveFilters() {
  const chips = [];
  const query = elements.searchInput.value.trim();

  if (query) chips.push(["q", `Search: ${query}`]);
  if (elements.mediaSelect.value !== URL_DEFAULTS.media) chips.push(["media", selectedText(elements.mediaSelect)]);
  if (elements.statusSelect.value !== URL_DEFAULTS.status) chips.push(["status", selectedText(elements.statusSelect)]);
  if (elements.sortSelect.value !== URL_DEFAULTS.sort) chips.push(["sort", `Sort: ${selectedText(elements.sortSelect)}`]);

  elements.activeFilters.textContent = "";
  elements.activeFilters.hidden = chips.length === 0;

  for (const [name, label] of chips) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.clearFilter = name;
    chip.textContent = `${label} x`;
    elements.activeFilters.append(chip);
  }
}

function renderPager(data) {
  elements.pageStatus.textContent = `Page ${data.page} of ${data.pageCount}`;
  elements.prevPageButton.disabled = data.page <= 1;
  elements.nextPageButton.disabled = data.page >= data.pageCount;
}

function renderFacets(facets = {}) {
  updateOptionLabels(elements.mediaSelect, {
    all: `All (${facets.media?.all || 0})`,
    image: `Images (${facets.media?.image || 0})`,
    video: `Videos (${facets.media?.video || 0})`
  });
  updateOptionLabels(elements.statusSelect, {
    all: `All statuses (${facets.status?.all || 0})`,
    downloaded: `Downloaded (${facets.status?.downloaded || 0})`,
    missing: `Missing local file (${facets.status?.missing || 0})`,
    error: `Errors (${facets.status?.error || 0})`,
    duplicate: `Duplicates (${facets.status?.duplicate || 0})`,
    unverified: `Unverified (${facets.status?.unverified || 0})`,
    favorited: `Favorited (${facets.status?.favorited || 0})`
  });
}

function updateOptionLabels(select, labels) {
  for (const option of select.options) {
    if (labels[option.value]) {
      option.textContent = labels[option.value];
    }
  }
}

function renderItems(items) {
  elements.emptyState.hidden = items.length > 0;

  const visibleIds = new Set();
  let nextNode = elements.grid.firstElementChild;

  for (const item of items) {
    let card = state.itemNodes.get(item.id);

    if (!card) {
      card = createItemCard();
      state.itemNodes.set(item.id, card);
    }

    updateItemCard(card, item);
    visibleIds.add(item.id);

    if (card === nextNode) {
      nextNode = nextNode.nextElementSibling;
    } else {
      elements.grid.insertBefore(card, nextNode);
    }

    refreshCardMedia(card);
  }

  for (const [id, card] of state.itemNodes) {
    if (!visibleIds.has(id)) {
      mediaObserver?.unobserve(card);
      pauseCardMedia(card);
      card.remove();
      state.itemNodes.delete(id);
    }
  }
}

function createItemCard() {
  const node = elements.itemTemplate.content.cloneNode(true);
  const card = node.querySelector(".card");
  const copyPromptButton = node.querySelector(".copyPromptButton");
  const detailsButton = node.querySelector(".detailsButton");

  copyPromptButton.addEventListener("click", () => {
    copyValue(card.__item?.prompt, copyPromptButton, "Copied");
  });
  detailsButton.addEventListener("click", () => showDetails(card.__item));

  return card;
}

function updateItemCard(card, item) {
  const preview = card.querySelector(".preview");
  const previewLink = card.querySelector(".previewLink");
  const openLink = card.querySelector(".openLink");
  const copyPromptButton = card.querySelector(".copyPromptButton");
  const mediaUrl = item.localFile ? `/media/${encodeURIPath(item.localFile)}` : item.outputUrl;

  card.__item = item;
  card.dataset.itemId = item.id;
  previewLink.href = mediaUrl || "#";
  openLink.href = mediaUrl || "#";
  copyPromptButton.disabled = !item.prompt;
  updatePreview(card, preview, item, mediaUrl);

  card.querySelector(".cardMeta").textContent = [
    item.type || "media",
    formatDate(item.createdAtIso),
    item.size ? formatBytes(item.size) : null,
    item.downloadError ? "error" : null,
    Number(item.duplicateGroupSize || 0) > 1 ? "duplicate" : null,
    item.localFile && !item.sha256 ? "unverified" : null
  ].filter(Boolean).join(" · ");
  card.querySelector(".prompt").textContent = item.prompt || "No prompt text";
}

function updatePreview(card, preview, item, mediaUrl) {
  const mediaKey = `${mediaUrl || `missing:${item.downloadError || ""}`}:${item.posterUrl || ""}`;

  if (card.dataset.mediaKey === mediaKey) {
    const image = preview.querySelector("img");
    if (image) image.alt = item.prompt || item.id;
    const video = preview.querySelector("video");
    if (video && item.posterUrl) video.poster = item.posterUrl;
    return;
  }

  card.dataset.mediaKey = mediaKey;
  card.dataset.mediaLoaded = "false";
  preview.textContent = "";

  if (item.localFile?.toLowerCase().endsWith(".mp4")) {
    const video = document.createElement("video");
    video.dataset.src = mediaUrl;
    if (item.posterUrl) {
      video.poster = item.posterUrl;
    }
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "none";
    video.setAttribute("preload", video.preload);
    preview.appendChild(video);
    card.dataset.media = "video";
  } else if (item.localFile?.toLowerCase().endsWith(".png")) {
    const image = document.createElement("img");
    image.dataset.src = mediaUrl;
    image.alt = item.prompt || item.id;
    image.loading = "lazy";
    image.decoding = "async";
    preview.appendChild(image);
    card.dataset.media = "image";
  } else {
    preview.textContent = item.downloadError || "No local file";
    card.dataset.media = "missing";
    card.dataset.mediaLoaded = "true";
  }
}

function setupMediaObserver() {
  if (!("IntersectionObserver" in window)) {
    return;
  }

  mediaObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        activateCardMedia(entry.target);
      } else {
        pauseCardMedia(entry.target);
      }
    }
  }, {
    rootMargin: MEDIA_OBSERVER_MARGIN
  });
}

function refreshCardMedia(card) {
  if (mediaObserver) {
    mediaObserver.observe(card);
  }

  if (!mediaObserver || isElementNearViewport(card, MEDIA_EAGER_MARGIN_PX)) {
    activateCardMedia(card);
  }
}

function activateCardMedia(card) {
  if (card.dataset.mediaLoaded === "true") {
    return;
  }

  const image = card.querySelector("img[data-src]");
  if (image) {
    image.src = image.dataset.src;
    image.removeAttribute("data-src");
    card.dataset.mediaLoaded = "true";
    return;
  }

  const video = card.querySelector("video[data-src]");
  if (video) {
    video.src = video.dataset.src;
    video.removeAttribute("data-src");
    card.dataset.mediaLoaded = "true";
  }
}

function pauseCardMedia(card) {
  const video = card.querySelector("video");
  if (video && !video.paused) {
    video.pause();
  }
}

function isElementNearViewport(element, margin) {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
}

function showDetails(item) {
  state.selectedItem = item;
  const mediaUrl = item.localFile ? `/media/${encodeURIPath(item.localFile)}` : item.outputUrl;

  elements.detailTitle.textContent = item.type ? `${item.type} media` : "Media details";
  elements.detailMeta.textContent = [
    formatDate(item.createdAtIso),
    item.size ? formatBytes(item.size) : null,
    item.status,
    item.localFile ? "downloaded" : "not local"
  ].filter(Boolean).join(" · ");
  elements.detailPrompt.textContent = item.prompt || "No prompt text";
  elements.detailNegativePrompt.textContent = item.negativePrompt || "";
  elements.negativePromptSection.hidden = !item.negativePrompt;
  elements.detailOpenLink.href = mediaUrl || "#";
  elements.detailCopyPromptButton.disabled = !item.prompt;
  elements.detailCopyIdButton.disabled = !item.id;
  elements.detailCopyUrlButton.disabled = !item.outputUrl;
  elements.detailPreview.textContent = "";

  if (mediaUrl?.toLowerCase().endsWith(".mp4")) {
    const video = document.createElement("video");
    video.src = mediaUrl;
    if (item.posterUrl) {
      video.poster = item.posterUrl;
    }
    video.controls = true;
    video.muted = true;
    video.preload = item.posterUrl ? "none" : "metadata";
    video.setAttribute("preload", video.preload);
    elements.detailPreview.append(video);
  } else if (mediaUrl?.toLowerCase().endsWith(".png")) {
    const image = document.createElement("img");
    image.src = mediaUrl;
    image.alt = item.prompt || item.id;
    elements.detailPreview.append(image);
  } else {
    elements.detailPreview.textContent = item.downloadError || "No local media file";
  }

  renderDetailsFacts(item);
  elements.itemDialog.showModal();
}

function renderDetailsFacts(item) {
  const facts = [
    ["Job ID", item.id],
    ["Type", item.type],
    ["Status", item.status],
    ["Local file", item.localFile],
    ["Poster", item.thumbnailFile],
    ["SHA-256", item.sha256],
    ["Verified", formatDate(item.verifiedAt)],
    ["Duplicate of", item.duplicateOf],
    ["Duplicate group", item.duplicateGroupSize ? `${item.duplicateGroupSize} items` : null],
    ["Content type", item.contentType],
    ["Created", formatDate(item.createdAtIso)],
    ["Downloaded", formatDate(item.downloadedAt)],
    ["External task", item.externalTaskId],
    ["Output URL", item.outputUrl]
  ].filter(([, value]) => value);

  elements.detailFacts.textContent = "";

  for (const [label, value] of facts) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    elements.detailFacts.append(dt, dd);
  }
}

async function copyValue(value, button, label) {
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    flashButton(button, label);
  } catch {
    fallbackCopy(value);
    flashButton(button, label);
  }
}

function fallbackCopy(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function flashButton(button, label) {
  const original = button.textContent;
  button.textContent = label;
  window.setTimeout(() => {
    button.textContent = original;
  }, 900);
}

function setView(view, options = {}) {
  state.view = view === "list" ? "list" : "grid";
  elements.grid.dataset.view = state.view;
  elements.gridViewButton.classList.toggle("is-active", state.view === "grid");
  elements.listViewButton.classList.toggle("is-active", state.view === "list");

  if (options.updateUrl !== false) {
    updateUrlFromState(options.historyMode || "replace");
  }
}

function setButtonsDisabled(disabled) {
  elements.syncNewButton.disabled = disabled;
  elements.downloadMissingButton.disabled = disabled;
  elements.retryErrorsButton.disabled = disabled;
  elements.generateThumbnailsButton.disabled = disabled;
  elements.verifyLibraryButton.disabled = disabled;
  elements.syncAllButton.disabled = disabled;
  elements.createBackupButton.disabled = disabled;
  elements.restoreBackupButton.disabled = disabled || !elements.backupSelect.value;
}

function updateCancelButton(status) {
  const isRunning = Boolean(status.running);
  const isCancelling = Boolean(status.cancelRequested) || status.status === "cancelling";
  elements.cancelSyncButton.hidden = !isRunning;
  elements.cancelSyncButton.disabled = !isRunning || isCancelling;
  elements.cancelSyncButton.textContent = isCancelling ? "Cancelling..." : "Cancel";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function encodeURIPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function selectedText(select) {
  return select.selectedOptions[0]?.textContent || select.value;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}
