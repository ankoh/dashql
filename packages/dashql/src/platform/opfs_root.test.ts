import { describe, expect, it } from 'vitest';

import { readFileText } from './opfs_root.js';

/// A file handle whose snapshots fail to read the first `failures` times, like one that is rewritten after `getFile()`
function rewrittenFile(failures: number, text: string): FileSystemFileHandle & { snapshots: number } {
    const handle = {
        snapshots: 0,
        async getFile() {
            handle.snapshots += 1;
            const stale = handle.snapshots <= failures;
            return { text: async () => { if (stale) throw new TypeError('Cannot load blob due to access control checks'); return text; } };
        },
    };
    return handle as unknown as FileSystemFileHandle & { snapshots: number };
}

describe('readFileText', () => {
    it('reads a file that was rewritten after its snapshot from a new one', async () => {
        const handle = rewrittenFile(2, 'current');
        expect(await readFileText(handle)).toBe('current');
        expect(handle.snapshots).toBe(3);
    });

    it('fails once every attempt read a stale snapshot', async () => {
        const handle = rewrittenFile(3, 'current');
        await expect(readFileText(handle)).rejects.toThrow('Cannot load blob');
        expect(handle.snapshots).toBe(3);
    });
});
