// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { showOverlayDialog } from "../../src/edit/overlay-dialog";

describe("showOverlayDialog", () => {
  afterEach(() => {
    document.querySelectorAll(".archivist-overlay-backdrop").forEach((el) => el.remove());
  });

  it("creates a backdrop and dialog in the host document", () => {
    const { close } = showOverlayDialog({
      hostDoc: document,
      title: "Test Dialog",
      body: (container) => {
        const p = document.createElement("p");
        p.textContent = "Hello";
        container.appendChild(p);
      },
      primaryLabel: "OK",
      onPrimary: vi.fn(),
    });

    const backdrop = document.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeTruthy();

    const dialog = backdrop!.querySelector(".archivist-overlay-dialog");
    expect(dialog).toBeTruthy();

    const title = dialog!.querySelector(".archivist-overlay-title");
    expect(title!.textContent).toBe("Test Dialog");

    const body = dialog!.querySelector(".archivist-overlay-body");
    expect(body!.querySelector("p")!.textContent).toBe("Hello");

    const primaryBtn = dialog!.querySelector(".archivist-overlay-btn-primary");
    expect(primaryBtn!.textContent).toBe("OK");

    close();
  });

  it("calls onPrimary when primary button is clicked", () => {
    const onPrimary = vi.fn();
    showOverlayDialog({
      hostDoc: document,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary,
    });

    const primaryBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-primary");
    primaryBtn!.click();
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("closes when cancel button is clicked", () => {
    showOverlayDialog({
      hostDoc: document,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary: vi.fn(),
    });

    const cancelBtn = document.querySelector<HTMLElement>(".archivist-overlay-btn-cancel");
    cancelBtn!.click();

    const backdrop = document.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeNull();
  });

  it("closes when close() handle is called", () => {
    const { close } = showOverlayDialog({
      hostDoc: document,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary: vi.fn(),
    });

    close();
    const backdrop = document.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeNull();
  });

  it("closes on Escape key", () => {
    showOverlayDialog({
      hostDoc: document,
      title: "Test",
      body: () => {},
      primaryLabel: "Save",
      onPrimary: vi.fn(),
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const backdrop = document.querySelector(".archivist-overlay-backdrop");
    expect(backdrop).toBeNull();
  });
});
