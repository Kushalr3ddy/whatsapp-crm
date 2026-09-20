import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemStorage } from '@crm/storage-filesystem';
import { runStorageDriverContract } from './storage-driver.js';

runStorageDriverContract('filesystem', {
  async create() {
    // A fresh directory per test, so nothing leaks between them and a failure leaves
    // evidence behind rather than corrupting the next run.
    const root = await mkdtemp(join(tmpdir(), 'crm-storage-'));
    return {
      storage: new FilesystemStorage(root),
      dispose: async () => { await rm(root, { recursive: true, force: true }); }
    };
  }
});
