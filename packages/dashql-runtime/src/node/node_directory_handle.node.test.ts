import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { NodeDirectoryHandle, NodeFileHandle } from './node_directory_handle.js';
import { ProcessLockManager } from './node_locks.js';

function tempFolder(): NodeDirectoryHandle {
    return new NodeDirectoryHandle(mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-handle-')));
}

describe('the directory handles of Node', () => {
    it('creates, lists and removes entries like the origin private file system', async () => {
        const root = tempFolder();
        const cache = await root.getDirectoryHandle('cache', { create: true });
        await expect(root.getDirectoryHandle('gone')).rejects.toMatchObject({ name: 'NotFoundError' });
        await expect(root.getFileHandle('cache')).rejects.toMatchObject({ name: 'TypeMismatchError' });
        await expect(root.getDirectoryHandle('../escape', { create: true })).rejects.toThrow(TypeError);

        const file = await cache.getFileHandle('a.parquet', { create: true });
        expect((await file.getFile()).size).toBe(0);
        const names: string[] = [];
        for await (const [name, handle] of root.entries()) names.push(`${name}:${handle.kind}`);
        expect(names).toEqual(['cache:directory']);

        await expect(root.removeEntry('cache')).rejects.toMatchObject({ name: 'InvalidModificationError' });
        await root.removeEntry('cache', { recursive: true });
        expect(readdirSync(root.hostPath)).toEqual([]);
    });

    it('writes a file when the stream closes, an aborted stream leaves it as it was', async () => {
        const root = tempFolder();
        const file = await root.getFileHandle('f.txt', { create: true });
        const writable = await file.createWritable();
        await writable.write('hello');
        expect(readFileSync(file.hostPath, 'utf8')).toBe('');
        await writable.close();
        expect(readFileSync(file.hostPath, 'utf8')).toBe('hello');

        const aborted = await file.createWritable();
        await aborted.write('lost');
        await aborted.abort();
        expect(readFileSync(file.hostPath, 'utf8')).toBe('hello');
        expect(readdirSync(root.hostPath)).toEqual(['f.txt']);

        // A stream is a target of pipeTo
        await new Blob(['piped']).stream().pipeTo(await file.createWritable());
        expect(await (await file.getFile()).text()).toBe('piped');

        await file.move('g.txt');
        expect(file.name).toBe('g.txt');
        expect(readdirSync(root.hostPath)).toEqual(['g.txt']);
        expect(file).toBeInstanceOf(NodeFileHandle);
    });
});

describe('the locks of the process', () => {
    it('grants shared locks together, an exclusive one alone, and refuses what is not available', async () => {
        const locks = new ProcessLockManager();
        const order: string[] = [];
        let releaseShared!: () => void;
        const shared = locks.request('a', { mode: 'shared' }, () => new Promise<void>(resolve => { order.push('shared'); releaseShared = resolve; }));
        await locks.request('a', { mode: 'shared' }, () => { order.push('second shared'); });
        expect(await locks.request('a', { mode: 'exclusive', ifAvailable: true }, lock => lock)).toBeNull();
        const exclusive = locks.request('a', { mode: 'exclusive' }, () => { order.push('exclusive'); });
        await Promise.resolve();
        expect(order).toEqual(['shared', 'second shared']);
        releaseShared();
        await shared;
        await exclusive;
        expect(order).toEqual(['shared', 'second shared', 'exclusive']);
    });
});
