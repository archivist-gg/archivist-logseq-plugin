// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  showCreateCompendiumModal,
  showCompendiumSelectModal,
  showSaveAsNewModal,
} from "../../src/edit/compendium-modals";
import type { Compendium } from "../../src/entities/compendium-manager";

describe("showCreateCompendiumModal", () => {
  afterEach(() => {
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("renders name and description fields", () => {
    showCreateCompendiumModal({
      hostDoc: document,
      onCreate: vi.fn(),
    });

    const nameInput = document.querySelector<HTMLInputElement>('input[data-field="name"]');
    const descInput = document.querySelector<HTMLInputElement>('input[data-field="description"]');
    expect(nameInput).toBeTruthy();
    expect(descInput).toBeTruthy();
  });

  it("calls onCreate with trimmed name and description", () => {
    const onCreate = vi.fn();
    showCreateCompendiumModal({
      hostDoc: document,
      onCreate,
    });

    const nameInput = document.querySelector<HTMLInputElement>('input[data-field="name"]')!;
    const descInput = document.querySelector<HTMLInputElement>('input[data-field="description"]')!;
    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;

    // Simulate typing
    nameInput.value = "  Homebrew  ";
    descInput.value = "My compendium";
    primaryBtn.click();

    expect(onCreate).toHaveBeenCalledWith("Homebrew", "My compendium");
  });

  it("does not call onCreate if name is empty", () => {
    const onCreate = vi.fn();
    showCreateCompendiumModal({
      hostDoc: document,
      onCreate,
    });

    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;
    primaryBtn.click();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("showCompendiumSelectModal", () => {
  const comps: Compendium[] = [
    { name: "Homebrew", description: "My homebrew", readonly: false, homebrew: true },
    { name: "Campaign", description: "Campaign stuff", readonly: false, homebrew: true },
  ];

  afterEach(() => {
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("renders a dropdown with all compendiums plus new option", () => {
    showCompendiumSelectModal({
      hostDoc: document,
      compendiums: comps,
      onSelect: vi.fn(),
      onCreateNew: vi.fn(),
    });

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    // 2 compendiums + 1 "new" option
    expect(select.options.length).toBe(3);
    expect(select.options[0].value).toBe("Homebrew");
    expect(select.options[1].value).toBe("Campaign");
    expect(select.options[2].value).toBe("__new__");
  });

  it("calls onSelect with the selected compendium", () => {
    const onSelect = vi.fn();
    showCompendiumSelectModal({
      hostDoc: document,
      compendiums: comps,
      onSelect,
      onCreateNew: vi.fn(),
    });

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    select.value = "Campaign";
    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;
    primaryBtn.click();

    expect(onSelect).toHaveBeenCalledWith(comps[1]);
  });

  it("calls onCreateNew when + New Compendium is selected and confirmed", () => {
    const onCreateNew = vi.fn();
    showCompendiumSelectModal({
      hostDoc: document,
      compendiums: comps,
      onSelect: vi.fn(),
      onCreateNew,
    });

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    select.value = "__new__";
    select.dispatchEvent(new Event("change"));

    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});

describe("showSaveAsNewModal", () => {
  const comps: Compendium[] = [
    { name: "Homebrew", description: "My homebrew", readonly: false, homebrew: true },
  ];

  afterEach(() => {
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("renders name field pre-filled and compendium dropdown", () => {
    showSaveAsNewModal({
      hostDoc: document,
      compendiums: comps,
      defaultName: "Fire Drake",
      onSave: vi.fn(),
      onCreateNew: vi.fn(),
    });

    const nameInput = document.querySelector<HTMLInputElement>('input[data-field="entity-name"]')!;
    expect(nameInput.value).toBe("Fire Drake");

    const select = document.querySelector<HTMLSelectElement>('select[data-field="compendium"]')!;
    expect(select.options.length).toBe(2); // 1 compendium + new
  });

  it("calls onSave with selected compendium and entered name", () => {
    const onSave = vi.fn();
    showSaveAsNewModal({
      hostDoc: document,
      compendiums: comps,
      defaultName: "Fire Drake",
      onSave,
      onCreateNew: vi.fn(),
    });

    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary")!;
    primaryBtn.click();

    expect(onSave).toHaveBeenCalledWith(comps[0], "Fire Drake");
  });
});
