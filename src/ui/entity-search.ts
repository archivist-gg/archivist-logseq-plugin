import "@logseq/libs";
import type { EntityRegistry, RegisteredEntity } from "../entities/entity-registry";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let registry: EntityRegistry;
let root: HTMLElement;
let inputEl: HTMLInputElement;
let resultsEl: HTMLElement;
let results: RegisteredEntity[] = [];
let selectedIndex = -1;
let activeFilter: string | null = null;

// Filter definitions -- order matters for UI
const FILTER_TYPES = [
  { label: "All", value: null },
  { label: "Monsters", value: "monster" },
  { label: "Spells", value: "spell" },
  { label: "Magic Items", value: "item" },
  { label: "Feats", value: "feat" },
  { label: "Conditions", value: "condition" },
  { label: "Classes", value: "class" },
  { label: "Backgrounds", value: "background" },
] as const;

// ---------------------------------------------------------------------------
// DOM builders (createElement-based, no innerHTML)
// ---------------------------------------------------------------------------

function buildModal(): HTMLElement {
  const modal = document.createElement("div");
  modal.className = "archivist-search-modal";

  // Input
  inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "archivist-search-input";
  inputEl.placeholder = "Search entities...";
  modal.appendChild(inputEl);

  // Filters
  const filtersRow = document.createElement("div");
  filtersRow.className = "archivist-search-filters";

  for (const ft of FILTER_TYPES) {
    const btn = document.createElement("button");
    btn.className = "archivist-search-filter";
    btn.textContent = ft.label;
    if (ft.value === null) btn.classList.add("active");

    btn.addEventListener("click", () => {
      activeFilter = ft.value;

      // Update active state on all buttons
      filtersRow
        .querySelectorAll(".archivist-search-filter")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      runSearch();
    });

    filtersRow.appendChild(btn);
  }
  modal.appendChild(filtersRow);

  // Results
  resultsEl = document.createElement("div");
  resultsEl.className = "archivist-search-results";
  modal.appendChild(resultsEl);

  return modal;
}

function renderResults(): void {
  // Clear previous results
  while (resultsEl.firstChild) {
    resultsEl.removeChild(resultsEl.firstChild);
  }

  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "archivist-search-empty";
    empty.textContent =
      inputEl.value.trim() === ""
        ? "Type to search entities"
        : "No matching entities found";
    resultsEl.appendChild(empty);
    return;
  }

  results.forEach((entity, idx) => {
    const row = document.createElement("div");
    row.className = "archivist-search-result";
    if (idx === selectedIndex) row.classList.add("selected");

    // Type badge
    const badge = document.createElement("span");
    badge.className = `archivist-search-result-type ${entity.entityType}`;
    badge.textContent = entity.entityType;
    row.appendChild(badge);

    // Name
    const name = document.createElement("span");
    name.className = "archivist-search-result-name";
    name.textContent = entity.name;
    row.appendChild(name);

    // Compendium label
    const comp = document.createElement("span");
    comp.className = "archivist-search-result-compendium";
    comp.textContent = entity.compendium;
    row.appendChild(comp);

    row.addEventListener("click", () => {
      selectEntity(entity);
    });

    resultsEl.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Search logic
// ---------------------------------------------------------------------------

function runSearch(): void {
  const query = inputEl.value.trim();
  if (query === "") {
    results = [];
    selectedIndex = -1;
    renderResults();
    return;
  }

  results = registry.search(query, activeFilter ?? undefined, 20);
  selectedIndex = results.length > 0 ? 0 : -1;
  renderResults();
}

// ---------------------------------------------------------------------------
// Selection / navigation
// ---------------------------------------------------------------------------

async function selectEntity(entity: RegisteredEntity): Promise<void> {
  hideSearch();

  // Determine the page name from the entity's filePath
  // filePath is vault-relative, e.g., "SRD/Monsters/Goblin"
  const pageName = entity.filePath;

  // Check if user is currently editing a block
  const editingBlockUuid = await logseq.Editor.checkEditing();

  if (editingBlockUuid && typeof editingBlockUuid === "string") {
    // Insert embed reference at cursor
    await logseq.Editor.insertAtEditingCursor(
      `{{embed [[${pageName}]]}}`,
    );
  } else {
    // Navigate to entity page
    logseq.App.pushState("page", { name: pageName });
  }
}

function moveSelection(delta: number): void {
  if (results.length === 0) return;

  selectedIndex += delta;
  if (selectedIndex < 0) selectedIndex = results.length - 1;
  if (selectedIndex >= results.length) selectedIndex = 0;

  renderResults();

  // Scroll selected row into view
  const selectedRow = resultsEl.querySelector(".archivist-search-result.selected");
  if (selectedRow) {
    selectedRow.scrollIntoView({ block: "nearest" });
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onKeyDown(e: KeyboardEvent): void {
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      moveSelection(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      moveSelection(-1);
      break;
    case "Enter":
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        selectEntity(results[selectedIndex]);
      }
      break;
    case "Escape":
      e.preventDefault();
      hideSearch();
      break;
  }
}

function onInput(): void {
  runSearch();
}

function onBackdropClick(e: MouseEvent): void {
  // Close only if clicking the backdrop itself, not the modal
  if (e.target === root) {
    hideSearch();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set up the search overlay DOM inside #archivist-search-root.
 * Call once during plugin initialization.
 */
export function initEntitySearch(reg: EntityRegistry): void {
  registry = reg;

  root = document.getElementById("archivist-search-root")!;
  if (!root) {
    console.error("Archivist: #archivist-search-root not found in DOM");
    return;
  }

  const modal = buildModal();
  root.appendChild(modal);

  // Attach listeners
  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("keydown", onKeyDown);
  root.addEventListener("click", onBackdropClick);
}

/**
 * Show the search overlay, reset state, and focus the input.
 */
export async function showSearch(): Promise<void> {
  // Reset state
  inputEl.value = "";
  results = [];
  selectedIndex = -1;
  activeFilter = null;

  // Reset filter buttons to "All" active
  root
    .querySelectorAll(".archivist-search-filter")
    .forEach((btn, idx) => {
      btn.classList.toggle("active", idx === 0);
    });

  renderResults();

  // Show overlay and Logseq main UI
  root.classList.add("visible");
  logseq.showMainUI();

  // Focus input after a brief tick to ensure DOM is visible
  requestAnimationFrame(() => {
    inputEl.focus();
  });
}

/**
 * Hide the search overlay and restore Logseq's editing state.
 */
export function hideSearch(): void {
  root.classList.remove("visible");
  logseq.hideMainUI();
}
