import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/js/core/store.js'),
  'utf8'
);

function createDisk(options = {}) {
  const files = new Map();
  const errors = [];
  const operations = [];
  const fileSystem = {
    existsSync(file) { return files.has(file); },
    mkdirSync() {},
    readFileSync(file) {
      if (!files.has(file)) throw new Error('Missing file: ' + file);
      return files.get(file);
    },
    writeFileSync(file, contents) {
      operations.push('write:' + file);
      if (options.writeFails) throw new Error('Disk is full.');
      files.set(file, String(contents));
    },
    renameSync(from, to) {
      operations.push('rename:' + to);
      if (options.renameFails) throw new Error('Atomic replacement failed.');
      if (!files.has(from)) throw new Error('Missing temporary file.');
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlinkSync(file) {
      operations.push('unlink:' + file);
      files.delete(file);
    }
  };
  const R = {
    bridge: { cs: { getSystemPath() { return 'C:\\Users\\Test\\AppData\\Roaming'; } } },
    log: { error(message, error) { errors.push({ message, error }); }, warn() {} }
  };
  const window = {
    Rebound: R,
    cep_node: {
      require(name) {
        if (name === 'fs') return fileSystem;
        if (name === 'path') return { join: (...parts) => parts.join('\\') };
        throw new Error('Unexpected module: ' + name);
      }
    }
  };
  new Function('window', 'SystemPath', source)(window, { USER_DATA: 'userData' });
  return { disk: R.disk, errors, files, operations };
}

describe('atomic JSON persistence', () => {
  it('replaces one persisted value through a same-directory temporary file', () => {
    const { disk, files, operations } = createDisk();
    const value = [{ id: 'pin-1', label: 'My Undo' }];

    expect(disk.writeAtomic('home-shortcut-pads', value)).toBe(true);

    const persistedFile = 'C:\\Users\\Test\\AppData\\Roaming\\Rebound\\home-shortcut-pads.json';
    expect(JSON.parse(files.get(persistedFile))).toEqual(value);
    expect(operations.some((operation) => operation.indexOf('rename:' + persistedFile) === 0))
      .toBe(true);
    expect(Array.from(files.keys()).some((file) => /\.tmp$/.test(file))).toBe(false);
  });

  it('preserves the previous value and reports a failed replacement', () => {
    const { disk, errors, files } = createDisk();
    const persistedFile = 'C:\\Users\\Test\\AppData\\Roaming\\Rebound\\home-shortcut-pads.json';
    files.set(persistedFile, JSON.stringify([{ id: 'pin-1', label: 'Undo' }]));
    const { disk: failingDisk, errors: failingErrors, files: failingFiles } =
      createDisk({ renameFails: true });
    failingFiles.set(persistedFile, JSON.stringify([{ id: 'pin-1', label: 'Undo' }]));

    expect(failingDisk.writeAtomic('home-shortcut-pads', [
      { id: 'pin-1', label: 'My Undo' }
    ])).toBe(false);
    expect(JSON.parse(failingFiles.get(persistedFile))[0].label).toBe('Undo');
    expect(Array.from(failingFiles.keys())).toEqual([persistedFile]);
    expect(failingErrors[0].error.message).toBe('Atomic replacement failed.');
    expect(disk.writeAtomic('home-shortcut-pads', [])).toBe(true);
    expect(errors).toEqual([]);
  });
});
