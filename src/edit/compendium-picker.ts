// src/edit/compendium-picker.ts

export function showCompendiumPicker(
  anchor: HTMLElement,
  compendiums: { name: string }[],
  onSelect: (compendium: { name: string }) => void,
): void {
  // Remove any existing picker
  const existing = anchor.querySelector(".archivist-compendium-picker");
  if (existing) existing.remove();

  const picker = document.createElement("div");
  picker.className = "archivist-compendium-picker";

  for (const comp of compendiums) {
    const option = document.createElement("div");
    option.className = "archivist-compendium-picker-option";
    option.textContent = comp.name;
    option.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanup();
      onSelect(comp);
    });
    picker.appendChild(option);
  }

  anchor.appendChild(picker);

  const onOutsideClick = (e: MouseEvent) => {
    if (!picker.contains(e.target as Node)) {
      cleanup();
    }
  };

  function cleanup(): void {
    picker.remove();
    document.removeEventListener("click", onOutsideClick, true);
  }

  setTimeout(() => {
    document.addEventListener("click", onOutsideClick, true);
  }, 0);
}
