/**
 * ImageContextManager -- Image paste/drop support.
 *
 * Ported from Obsidian. Changes:
 * - `Notice` removed (no Obsidian API)
 * - `path.extname` -> inline extension extraction (no Node path in browser)
 * - `container.createDiv()` -> `doc.createElement('div')` + manual wiring
 * - `empty()` -> manual while(firstChild) removeChild
 * - `createEl()` -> `doc.createElement()`
 * - `addClass`/`removeClass` -> `classList.*`
 * - `Buffer.from()` -> browser-native btoa/FileReader for base64
 * - Constructor takes `doc: Document`
 */

import type { ImageAttachment, ImageMediaType } from '../state/types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface ImageContextCallbacks {
  onImagesChanged: () => void;
}

export class ImageContextManager {
  private doc: Document;
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private previewContainerEl: HTMLElement;
  private imagePreviewEl: HTMLElement;
  private inputEl: HTMLElement;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();

  constructor(
    doc: Document,
    containerEl: HTMLElement,
    inputEl: HTMLElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement,
  ) {
    this.doc = doc;
    this.containerEl = containerEl;
    this.previewContainerEl = previewContainerEl ?? containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;

    // Create image preview in previewContainerEl, before file indicator if present
    const fileIndicator = this.previewContainerEl.querySelector('.claudian-file-indicator');
    this.imagePreviewEl = doc.createElement('div');
    this.imagePreviewEl.className = 'claudian-image-preview';
    if (fileIndicator && fileIndicator.parentElement === this.previewContainerEl) {
      this.previewContainerEl.insertBefore(this.imagePreviewEl, fileIndicator);
    } else {
      this.previewContainerEl.appendChild(this.imagePreviewEl);
    }

    this.setupDragAndDrop();
    this.setupPasteHandler();
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  hasImages(): boolean {
    return this.attachedImages.size > 0;
  }

  clearImages(): void {
    this.attachedImages.clear();
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }

  /** Sets images directly (used for queued messages). */
  setImages(images: ImageAttachment[]): void {
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }

  private setupDragAndDrop(): void {
    const inputWrapper = this.containerEl.querySelector('.claudian-input-wrapper') as HTMLElement;
    if (!inputWrapper) return;

    this.dropOverlay = this.doc.createElement('div');
    this.dropOverlay.className = 'claudian-drop-overlay';
    inputWrapper.appendChild(this.dropOverlay);

    const dropContent = this.doc.createElement('div');
    dropContent.className = 'claudian-drop-content';
    this.dropOverlay.appendChild(dropContent);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '17 8 12 3 7 8');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '3');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '15');
    svg.appendChild(pathEl);
    svg.appendChild(polyline);
    svg.appendChild(line);
    dropContent.appendChild(svg);

    const textSpan = this.doc.createElement('span');
    textSpan.textContent = 'Drop image here';
    dropContent.appendChild(textSpan);

    const dropZone = inputWrapper;

    dropZone.addEventListener('dragenter', (e) => this.handleDragEnter(e as DragEvent));
    dropZone.addEventListener('dragover', (e) => this.handleDragOver(e as DragEvent));
    dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e as DragEvent));
    dropZone.addEventListener('drop', (e) => this.handleDrop(e as DragEvent));
  }

  private handleDragEnter(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer?.types.includes('Files')) {
      this.dropOverlay?.classList.add('visible');
    }
  }

  private handleDragOver(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    const inputWrapper = this.containerEl.querySelector('.claudian-input-wrapper');
    if (!inputWrapper) {
      this.dropOverlay?.classList.remove('visible');
      return;
    }

    const rect = inputWrapper.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      this.dropOverlay?.classList.remove('visible');
    }
  }

  private async handleDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay?.classList.remove('visible');

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (this.isImageFile(file)) {
        await this.addImageFromFile(file, 'drop');
      }
    }
  }

  private setupPasteHandler(): void {
    this.inputEl.addEventListener('paste', async (e) => {
      const items = (e as ClipboardEvent).clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await this.addImageFromFile(file, 'paste');
          }
          return;
        }
      }
    });
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && this.getMediaType(file.name) !== null;
  }

  private getMediaType(filename: string): ImageMediaType | null {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex < 0) return null;
    const ext = filename.slice(dotIndex).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }

  private async addImageFromFile(file: File, source: 'paste' | 'drop'): Promise<boolean> {
    if (file.size > MAX_IMAGE_SIZE) {
      console.warn(`[archivist] Image exceeds ${this.formatSize(MAX_IMAGE_SIZE)} limit.`);
      return false;
    }

    const mediaType = this.getMediaType(file.name) || (file.type as ImageMediaType);
    if (!mediaType) {
      console.warn('[archivist] Unsupported image type.');
      return false;
    }

    try {
      const base64 = await this.fileToBase64(file);

      const attachment: ImageAttachment = {
        id: this.generateId(),
        name: file.name || `image-${Date.now()}.${mediaType.split('/')[1]}`,
        mediaType,
        data: base64,
        size: file.size,
        source,
      };

      this.attachedImages.set(attachment.id, attachment);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
      return true;
    } catch (error) {
      console.error('[archivist] Failed to attach image:', error);
      return false;
    }
  }

  private async fileToBase64(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Result is data:mime;base64,DATA — extract just the base64 part
        const result = reader.result as string;
        const base64 = result.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // ============================================
  // Private: Image Preview
  // ============================================

  private updateImagePreview(): void {
    this.empty(this.imagePreviewEl);

    if (this.attachedImages.size === 0) {
      this.imagePreviewEl.style.display = 'none';
      return;
    }

    this.imagePreviewEl.style.display = 'flex';

    for (const [id, image] of this.attachedImages) {
      this.renderImagePreview(id, image);
    }
  }

  private renderImagePreview(id: string, image: ImageAttachment): void {
    const doc = this.doc;

    const previewEl = doc.createElement('div');
    previewEl.className = 'claudian-image-chip';
    this.imagePreviewEl.appendChild(previewEl);

    const thumbEl = doc.createElement('div');
    thumbEl.className = 'claudian-image-thumb';
    previewEl.appendChild(thumbEl);

    const imgEl = doc.createElement('img');
    imgEl.setAttribute('src', `data:${image.mediaType};base64,${image.data}`);
    imgEl.setAttribute('alt', image.name);
    thumbEl.appendChild(imgEl);

    const infoEl = doc.createElement('div');
    infoEl.className = 'claudian-image-info';
    previewEl.appendChild(infoEl);

    const nameEl = doc.createElement('span');
    nameEl.className = 'claudian-image-name';
    nameEl.textContent = this.truncateName(image.name, 20);
    nameEl.setAttribute('title', image.name);
    infoEl.appendChild(nameEl);

    const sizeEl = doc.createElement('span');
    sizeEl.className = 'claudian-image-size';
    sizeEl.textContent = this.formatSize(image.size);
    infoEl.appendChild(sizeEl);

    const removeEl = doc.createElement('span');
    removeEl.className = 'claudian-image-remove';
    removeEl.textContent = '\u00D7';
    removeEl.setAttribute('aria-label', 'Remove image');
    previewEl.appendChild(removeEl);

    removeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.attachedImages.delete(id);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
    });

    thumbEl.addEventListener('click', () => {
      this.showFullImage(image);
    });
  }

  private showFullImage(image: ImageAttachment): void {
    const doc = this.doc;

    const overlay = doc.createElement('div');
    overlay.className = 'claudian-image-modal-overlay';
    doc.body.appendChild(overlay);

    const modal = doc.createElement('div');
    modal.className = 'claudian-image-modal';
    overlay.appendChild(modal);

    const imgEl = doc.createElement('img');
    imgEl.setAttribute('src', `data:${image.mediaType};base64,${image.data}`);
    imgEl.setAttribute('alt', image.name);
    modal.appendChild(imgEl);

    const closeBtn = doc.createElement('div');
    closeBtn.className = 'claudian-image-modal-close';
    closeBtn.textContent = '\u00D7';
    modal.appendChild(closeBtn);

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      doc.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    doc.addEventListener('keydown', handleEsc);
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private truncateName(name: string, maxLen: number): string {
    if (name.length <= maxLen) return name;
    const dotIndex = name.lastIndexOf('.');
    const ext = dotIndex >= 0 ? name.slice(dotIndex) : '';
    const base = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
    const truncatedBase = base.slice(0, maxLen - ext.length - 3);
    return `${truncatedBase}...${ext}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private empty(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
}
