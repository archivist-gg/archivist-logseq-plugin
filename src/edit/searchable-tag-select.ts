export interface SearchableTagSelectOptions {
  container: HTMLElement;
  presets: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function createSearchableTagSelect(options: SearchableTagSelectOptions): void {
  const { container, presets, onChange, placeholder } = options;
  let selected = [...options.selected];

  const wrapper = document.createElement("div");
  wrapper.className = "archivist-tag-select";
  container.appendChild(wrapper);

  const pillRow = document.createElement("div");
  pillRow.className = "archivist-tag-pill-row";
  wrapper.appendChild(pillRow);

  const input = document.createElement("input");
  input.className = "archivist-tag-input";
  input.type = "text";
  input.placeholder = placeholder ?? "Search...";
  wrapper.appendChild(input);

  let dropdown: HTMLElement | null = null;
  let highlightedIndex = -1;
  let selectableItems: string[] = [];

  function renderPills(): void {
    pillRow.textContent = "";
    for (const value of selected) {
      const pill = document.createElement("div");
      pill.className = "archivist-tag-pill";
      pillRow.appendChild(pill);

      const span = document.createElement("span");
      span.textContent = value;
      pill.appendChild(span);

      const x = document.createElement("span");
      x.className = "archivist-tag-pill-x";
      x.textContent = "\u00d7";
      pill.appendChild(x);

      x.addEventListener("click", (e) => {
        e.stopPropagation();
        selected = selected.filter(v => v !== value);
        renderPills();
        onChange(selected);
        showDropdown();
      });
    }
  }

  function showDropdown(): void {
    hideDropdown();
    const query = input.value.toLowerCase();

    const available: string[] = [];
    const taken: string[] = [];
    for (const preset of presets) {
      if (query && !preset.toLowerCase().includes(query)) continue;
      if (selected.includes(preset)) {
        taken.push(preset);
      } else {
        available.push(preset);
      }
    }

    const hasCustom = query.length > 0 && !presets.some(p => p.toLowerCase() === query.toLowerCase());
    if (available.length === 0 && taken.length === 0 && !hasCustom) return;

    dropdown = document.createElement("div");
    dropdown.className = "archivist-tag-dropdown";
    wrapper.appendChild(dropdown);

    selectableItems = [...available];
    if (hasCustom) selectableItems.push(input.value.trim());
    highlightedIndex = available.length > 0 ? 0 : (hasCustom ? 0 : -1);

    for (let i = 0; i < available.length; i++) {
      const item = document.createElement("div");
      item.className = `archivist-tag-dropdown-item${i === highlightedIndex ? " archivist-tag-dropdown-item-highlighted" : ""}`;
      dropdown.appendChild(item);

      item.textContent = available[i];
      const value = available[i];
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectValue(value);
      });
    }

    for (const value of taken) {
      const item = document.createElement("div");
      item.className = "archivist-tag-dropdown-item archivist-tag-dropdown-item-selected";
      dropdown.appendChild(item);
      item.textContent = `${value} (selected)`;
    }

    if (hasCustom) {
      const customValue = input.value.trim();
      const custom = document.createElement("div");
      custom.className = "archivist-tag-dropdown-custom";
      dropdown.appendChild(custom);
      custom.textContent = `+ Add custom: "${customValue}"`;
      if (available.length === 0) custom.classList.add("archivist-tag-dropdown-item-highlighted");
      custom.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectValue(customValue);
      });
    }
  }

  function hideDropdown(): void {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    highlightedIndex = -1;
    selectableItems = [];
  }

  function updateHighlight(): void {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll(
      ".archivist-tag-dropdown-item:not(.archivist-tag-dropdown-item-selected), .archivist-tag-dropdown-custom"
    );
    items.forEach((el, i) => {
      el.classList.toggle("archivist-tag-dropdown-item-highlighted", i === highlightedIndex);
    });
  }

  function selectValue(value: string): void {
    if (!selected.includes(value)) {
      selected.push(value);
    }
    input.value = "";
    renderPills();
    onChange(selected);
    showDropdown();
    input.focus();
  }

  wrapper.addEventListener("click", () => input.focus());

  input.addEventListener("focus", () => {
    wrapper.classList.add("archivist-tag-select-focused");
    showDropdown();
  });

  input.addEventListener("blur", () => {
    wrapper.classList.remove("archivist-tag-select-focused");
    setTimeout(hideDropdown, 150);
  });

  input.addEventListener("input", () => showDropdown());

  input.addEventListener("keydown", (e) => {
    if (!dropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, selectableItems.length - 1);
      updateHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < selectableItems.length) {
        selectValue(selectableItems[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      hideDropdown();
    } else if (e.key === "Backspace" && input.value === "" && selected.length > 0) {
      selected.pop();
      renderPills();
      onChange(selected);
      showDropdown();
    }
  });

  renderPills();
}
