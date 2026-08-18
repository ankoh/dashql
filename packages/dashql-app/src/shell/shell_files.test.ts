// @vitest-environment node
import type { PlatformFile } from '../platform/file/file.js';
import { createShellFilesCommand, ShellFileRegistry } from './shell_files.js';

function sourceFile(path: string, bytes: number[], onRead?: () => void): PlatformFile {
    return {
        path,
        readAsArrayBuffer: async () => {
            onRead?.();
            return new Uint8Array(bytes);
        },
    };
}

class MockOPFSFileHandle {
    bytes = new Uint8Array();
    closed = false;

    async createWritable() {
        return {
            write: async (data: ArrayBuffer) => { this.bytes = new Uint8Array(data); },
            close: async () => { this.closed = true; },
        };
    }

    async getFile() {
        return { arrayBuffer: async () => this.bytes.slice().buffer };
    }
}

class MockOPFSDirectoryHandle {
    readonly files = new Map<string, MockOPFSFileHandle>();

    async getDirectoryHandle() {
        return this as unknown as FileSystemDirectoryHandle;
    }

    async getFileHandle(name: string) {
        let file = this.files.get(name);
        if (file == null) {
            file = new MockOPFSFileHandle();
            this.files.set(name, file);
        }
        return file as unknown as FileSystemFileHandle;
    }

    async removeEntry(name: string) {
        if (!this.files.delete(name)) throw new DOMException('missing', 'NotFoundError');
    }

    async *entries() {
        for (const [name, handle] of this.files) {
            yield [name, { ...handle, kind: 'file' }];
        }
    }
}

describe('shell files command', () => {
    it('copies browser files to HyperDB-visible OPFS paths', async () => {
        const opfs = new MockOPFSDirectoryHandle();
        let sourceReads = 0;
        const registry = new ShellFileRegistry(false, async () => opfs as unknown as FileSystemDirectoryHandle);
        const downloader = { downloadBufferAsFile: vi.fn().mockResolvedValue(undefined) };
        const command = createShellFilesCommand(
            registry,
            downloader,
            async () => [sourceFile('input/data.csv', [1, 2, 3], () => { sourceReads++; })],
        );

        expect(await command[2](['add'], {})).toBe('Added 1 file\r\n/opfs/dashql-shell-files/data.csv');
        expect(opfs.files.get('data.csv')?.bytes).toEqual(new Uint8Array([1, 2, 3]));
        expect(opfs.files.get('data.csv')?.closed).toBe(true);
        expect(await command[2](['list'], {})).toBe('/opfs/dashql-shell-files/data.csv');

        expect(await command[2](['get', '/opfs/dashql-shell-files/data.csv'], {}))
            .toBe('Downloaded /opfs/dashql-shell-files/data.csv');
        expect(sourceReads).toBe(1);
        expect(downloader.downloadBufferAsFile).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'data.csv');

        expect(await command[2](['drop', '/opfs/dashql-shell-files/data.csv'], {}))
            .toBe('Dropped /opfs/dashql-shell-files/data.csv');
        expect(opfs.files.has('data.csv')).toBe(false);
        expect(await command[2]([], {})).toBe('No files registered');
    });

    it('lists and gets OPFS files created before the registry', async () => {
        const opfs = new MockOPFSDirectoryHandle();
        const existing = await opfs.getFileHandle('existing.csv') as unknown as MockOPFSFileHandle;
        existing.bytes = new Uint8Array([7, 8]);
        const downloader = { downloadBufferAsFile: vi.fn().mockResolvedValue(undefined) };
        const command = createShellFilesCommand(
            new ShellFileRegistry(false, async () => opfs as unknown as FileSystemDirectoryHandle),
            downloader,
        );

        expect(await command[2](['list'], {})).toBe('/opfs/dashql-shell-files/existing.csv');
        expect(await command[2](['get', '/opfs/dashql-shell-files/existing.csv'], {}))
            .toBe('Downloaded /opfs/dashql-shell-files/existing.csv');
        expect(downloader.downloadBufferAsFile).toHaveBeenCalledWith(new Uint8Array([7, 8]), 'existing.csv');
    });

    it('keeps native files at their host paths without deleting them', async () => {
        const registry = new ShellFileRegistry(true);
        const downloader = { downloadBufferAsFile: vi.fn().mockResolvedValue(undefined) };
        const command = createShellFilesCommand(
            registry,
            downloader,
            async () => [sourceFile('/tmp/a file.csv', [4, 5])],
        );

        expect(await command[2](['add'], {})).toBe('Added 1 file\r\n/tmp/a file.csv');
        expect(await command[2](['get', '/tmp/a', 'file.csv'], {})).toBe('Downloaded /tmp/a file.csv');
        expect(downloader.downloadBufferAsFile).toHaveBeenCalledWith(new Uint8Array([4, 5]), 'a file.csv');
        expect(await command[2](['drop', '/tmp/a', 'file.csv'], {})).toBe('Dropped /tmp/a file.csv');
    });

    it('validates subcommands and registered paths', async () => {
        const command = createShellFilesCommand(
            new ShellFileRegistry(true),
            { downloadBufferAsFile: vi.fn() },
            async () => [],
        );

        await expect(command[2](['add'], {})).resolves.toBe('No files selected');
        await expect(command[2](['unknown'], {})).rejects.toThrow('usage: .files [list|add|drop|get]');
        await expect(command[2](['get', 'missing.csv'], {})).rejects.toThrow('file not registered: missing.csv');
        await expect(command[2](['drop'], {})).rejects.toThrow('usage: .files drop <path>');
    });
});
