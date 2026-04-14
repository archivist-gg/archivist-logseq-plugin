import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { NodeFileAdapter } from '../../src/adapter/NodeFileAdapter.js';

describe('NodeFileAdapter', () => {
  let tmpDir: string;
  let adapter: NodeFileAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nfa-test-'));
    adapter = new NodeFileAdapter(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('write + read round trip', async () => {
    await adapter.write('hello.txt', 'Hello, world!');
    const content = await adapter.read('hello.txt');
    expect(content).toBe('Hello, world!');
  });

  it('exists returns true for existing file', async () => {
    await adapter.write('exists.txt', 'data');
    expect(await adapter.exists('exists.txt')).toBe(true);
  });

  it('exists returns false for missing file', async () => {
    expect(await adapter.exists('nope.txt')).toBe(false);
  });

  it('append to existing file', async () => {
    await adapter.write('log.txt', 'line1\n');
    await adapter.append('log.txt', 'line2\n');
    const content = await adapter.read('log.txt');
    expect(content).toBe('line1\nline2\n');
  });

  it('append to new file creates it', async () => {
    await adapter.append('new.txt', 'first');
    const content = await adapter.read('new.txt');
    expect(content).toBe('first');
  });

  it('delete removes a file', async () => {
    await adapter.write('doomed.txt', 'bye');
    expect(await adapter.exists('doomed.txt')).toBe(true);
    await adapter.delete('doomed.txt');
    expect(await adapter.exists('doomed.txt')).toBe(false);
  });

  it('listFiles returns relative paths', async () => {
    await adapter.write('folder/a.txt', 'a');
    await adapter.write('folder/b.txt', 'b');
    const files = await adapter.listFiles('folder');
    expect(files.sort()).toEqual(['folder/a.txt', 'folder/b.txt']);
  });

  it('listFolders returns relative paths', async () => {
    await adapter.ensureFolder('parent/child1');
    await adapter.ensureFolder('parent/child2');
    const folders = await adapter.listFolders('parent');
    expect(folders.sort()).toEqual(['parent/child1', 'parent/child2']);
  });

  it('ensureFolder creates nested directories', async () => {
    await adapter.ensureFolder('a/b/c');
    const stat = await fs.stat(path.join(tmpDir, 'a', 'b', 'c'));
    expect(stat.isDirectory()).toBe(true);
  });

  it('rename moves a file', async () => {
    await adapter.write('old.txt', 'content');
    await adapter.rename('old.txt', 'new.txt');
    expect(await adapter.exists('old.txt')).toBe(false);
    expect(await adapter.read('new.txt')).toBe('content');
  });

  it('stat returns mtime and size', async () => {
    await adapter.write('info.txt', 'hello');
    const s = await adapter.stat('info.txt');
    expect(s).not.toBeNull();
    expect(s!.size).toBe(5);
    expect(typeof s!.mtime).toBe('number');
    expect(s!.mtime).toBeGreaterThan(0);
  });

  it('stat returns null for missing file', async () => {
    const s = await adapter.stat('ghost.txt');
    expect(s).toBeNull();
  });

  it('listFilesRecursive returns all nested files', async () => {
    await adapter.write('top.txt', '1');
    await adapter.write('sub/deep.txt', '2');
    await adapter.write('sub/deeper/bottom.txt', '3');
    const files = await adapter.listFilesRecursive('.');
    expect(files.sort()).toEqual([
      'sub/deep.txt',
      'sub/deeper/bottom.txt',
      'top.txt',
    ]);
  });

  it('deleteFolder removes an empty folder', async () => {
    await adapter.ensureFolder('empty');
    await adapter.deleteFolder('empty');
    expect(await adapter.exists('empty')).toBe(false);
  });

  it('deleteFolder silently fails on non-empty folder', async () => {
    await adapter.write('notempty/file.txt', 'x');
    // should not throw
    await adapter.deleteFolder('notempty');
    // folder still exists because it was non-empty
    expect(await adapter.exists('notempty/file.txt')).toBe(true);
  });

  it('deleteFolder silently fails on missing folder', async () => {
    // should not throw
    await adapter.deleteFolder('nonexistent');
  });

  it('write creates parent directories', async () => {
    await adapter.write('deep/nested/file.txt', 'content');
    const content = await adapter.read('deep/nested/file.txt');
    expect(content).toBe('content');
  });

  it('append creates parent directories', async () => {
    await adapter.append('deep/nested/log.txt', 'entry');
    const content = await adapter.read('deep/nested/log.txt');
    expect(content).toBe('entry');
  });
});
