// src/edit/overlay-dialog.ts

export interface OverlayDialogOptions {
  hostDoc: Document;
  title: string;
  body: (container: HTMLElement) => void;
  primaryLabel: string;
  onPrimary: () => void;
  onCancel?: () => void;
}

export interface OverlayDialogHandle {
  close: () => void;
}

export function showOverlayDialog(options: OverlayDialogOptions): OverlayDialogHandle {
  const { hostDoc, title, body, primaryLabel, onPrimary, onCancel } = options;

  // Backdrop
  const backdrop = hostDoc.createElement("div");
  backdrop.className = "archivist-overlay-backdrop";

  // Dialog
  const dialog = hostDoc.createElement("div");
  dialog.className = "archivist-overlay-dialog";

  // Title
  const titleEl = hostDoc.createElement("h3");
  titleEl.className = "archivist-overlay-title";
  titleEl.textContent = title;
  dialog.appendChild(titleEl);

  // Body
  const bodyEl = hostDoc.createElement("div");
  bodyEl.className = "archivist-overlay-body";
  body(bodyEl);
  dialog.appendChild(bodyEl);

  // Footer
  const footer = hostDoc.createElement("div");
  footer.className = "archivist-overlay-footer";

  const cancelBtn = hostDoc.createElement("button");
  cancelBtn.className = "archivist-overlay-btn archivist-overlay-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.type = "button";

  const primaryBtn = hostDoc.createElement("button");
  primaryBtn.className = "archivist-overlay-btn archivist-overlay-btn-primary";
  primaryBtn.textContent = primaryLabel;
  primaryBtn.type = "button";

  footer.appendChild(cancelBtn);
  footer.appendChild(primaryBtn);
  dialog.appendChild(footer);

  backdrop.appendChild(dialog);
  hostDoc.body.appendChild(backdrop);

  // --- Close behavior ---
  function close(): void {
    backdrop.remove();
    hostDoc.removeEventListener("keydown", onKeydown);
  }

  cancelBtn.addEventListener("click", () => {
    close();
    onCancel?.();
  });

  primaryBtn.addEventListener("click", () => {
    onPrimary();
  });

  // Click outside dialog to close
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      close();
      onCancel?.();
    }
  });

  // Escape key
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      close();
      onCancel?.();
    }
  }
  hostDoc.addEventListener("keydown", onKeydown);

  return { close };
}
