import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

export class NodeFileAdapter {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private root: string) {}

  private resolve(relativePath: string): string {
    return nodePath.join(this.root, relativePath);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<string> {
    return fs.readFile(this.resolve(path), 'utf-8');
  }

  async write(path: string, content: string): Promise<void> {
    const full = this.resolve(path);
    await fs.mkdir(nodePath.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }

  async append(path: string, content: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const full = this.resolve(path);
      await fs.mkdir(nodePath.dirname(full), { recursive: true });
      await fs.appendFile(full, content, 'utf-8');
    });
    await this.writeQueue;
  }

  async delete(path: string): Promise<void> {
    await fs.unlink(this.resolve(path));
  }

  async deleteFolder(path: string): Promise<void> {
    try {
      await fs.rmdir(this.resolve(path));
    } catch {
      // silently fail if non-empty or missing
    }
  }

  async listFiles(folder: string): Promise<string[]> {
    const full = this.resolve(folder);
    const entries = await fs.readdir(full, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => nodePath.join(folder, e.name));
  }

  async listFolders(folder: string): Promise<string[]> {
    const full = this.resolve(folder);
    const entries = await fs.readdir(full, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => nodePath.join(folder, e.name));
  }

  async listFilesRecursive(folder: string): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const full = this.resolve(dir);
      const entries = await fs.readdir(full, { withFileTypes: true });
      for (const entry of entries) {
        const rel = nodePath.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(rel);
        } else if (entry.isFile()) {
          results.push(rel);
        }
      }
    };
    await walk(folder);
    // Normalize away leading "./" from paths when folder is "."
    return results.map((p) =>
      p.startsWith('./') ? p.slice(2) : p.startsWith('.\\') ? p.slice(2) : p,
    );
  }

  async ensureFolder(path: string): Promise<void> {
    await fs.mkdir(this.resolve(path), { recursive: true });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const newFull = this.resolve(newPath);
    await fs.mkdir(nodePath.dirname(newFull), { recursive: true });
    await fs.rename(this.resolve(oldPath), newFull);
  }

  async stat(
    path: string,
  ): Promise<{ mtime: number; size: number } | null> {
    try {
      const s = await fs.stat(this.resolve(path));
      return { mtime: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }
}
