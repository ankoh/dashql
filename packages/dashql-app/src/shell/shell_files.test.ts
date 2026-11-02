// @vitest-environment node
import type {
    EmbeddedExternalDirectoryDatabase,
    EmbeddedExternalFileDatabase,
    ExternalDirectoryMode,
} from '../platform/database/embedded_database.js';
import type { PlatformFile } from '../platform/file/file.js';
import { createShellFilesCommand, selectPlatformFiles, ShellFileRegistry } from './shell_files.js';

function sourceFile(path: string): PlatformFile {
    return {
        path,
        size: 3,
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        stream: () => new ReadableStream(),
        readAsArrayBuffer: async () => new Uint8Array([1, 2, 3]),
    };
}

class MockExternalFiles implements EmbeddedExternalFileDatabase, EmbeddedExternalDirectoryDatabase {
    readonly files = new Map<string, Blob>();
    readonly directories = new Map<string, ExternalDirectoryMode>();

    async registerExternalFile(name: string, blob: Blob): Promise<string> {
        const path = `/mnt/external/${name}`;
        this.files.set(path, blob);
        return path;
    }

    async removeExternalFile(path: string): Promise<void> {
        if (!this.files.delete(path)) throw new Error(`missing external file: ${path}`);
    }

    async registerExternalDirectory(
        handle: FileSystemDirectoryHandle,
        path: string | undefined,
        mode: ExternalDirectoryMode,
    ): Promise<string> {
        path ??= `/mnt/external/${handle.name}`;
        this.directories.set(path, mode);
        return path;
    }

    async removeExternalDirectory(path: string): Promise<void> {
        if (!this.directories.delete(path)) throw new Error(`missing directory: ${path}`);
    }

    async refreshExternalDirectory(path: string): Promise<void> {
        if (!this.directories.has(path)) throw new Error(`missing directory: ${path}`);
    }
}

describe('shell files command', () => {
    it('mounts browser files without reading or streaming them', async () => {
        const external = new MockExternalFiles();
        const file = sourceFile('input/data.csv');
        const stream = vi.spyOn(file, 'stream');
        const registry = new ShellFileRegistry(undefined, external);

        expect(await registry.mountFile(file)).toBe('/mnt/external/data.csv');
        expect(stream).not.toHaveBeenCalled();
        expect(await registry.list()).toEqual(['/mnt/external/data.csv']);
    });

    it('rejects retired and unknown subcommands', async () => {
        const command = createShellFilesCommand();

        for (const action of ['add', 'import', 'list', 'drop', 'get', 'unknown']) {
            await expect(command[2]([action], {})).resolves.toBe('usage: .fs');
        }
    });

    it('opens the filesystem dialog without a subcommand', async () => {
        const requestFilesystemDialog = vi.fn().mockResolvedValue(undefined);
        const requestMountDialog = vi.fn().mockResolvedValue('/mnt/external/data.csv');
        const command = createShellFilesCommand(
            requestMountDialog,
            requestFilesystemDialog,
        );

        await expect(command[2]([], {})).resolves.toBeUndefined();
        await expect(command[2](['ls'], {})).resolves.toBeUndefined();
        await expect(command[2](['mount'], {})).resolves.toBe('/mnt/external/data.csv');
        await expect(command[2](['mount-dir'], {})).resolves.toBe('/mnt/external/data.csv');
        await expect(command[2](['mount-dir-rw'], {})).resolves.toBe('/mnt/external/data.csv');
        expect(requestFilesystemDialog).toHaveBeenCalledWith(undefined);
        expect(requestFilesystemDialog).toHaveBeenCalledTimes(2);
        expect(requestMountDialog).toHaveBeenNthCalledWith(1, undefined);
        expect(requestMountDialog).toHaveBeenNthCalledWith(2, undefined);
        expect(requestMountDialog).toHaveBeenNthCalledWith(3, undefined);
    });

    it('does not print mount cancellation', async () => {
        const command = createShellFilesCommand(
            async () => 'Mount cancelled',
        );

        await expect(command[2](['mount'], {})).resolves.toBeUndefined();
        await expect(command[2](['mount-dir'], {})).resolves.toBeUndefined();
        await expect(command[2](['mount-dir-rw'], {})).resolves.toBeUndefined();
    });
});

describe('shell file registry directories', () => {
    const handle = (name: string) => ({ name }) as FileSystemDirectoryHandle;

    it('mounts, lists and drops directories', async () => {
        const external = new MockExternalFiles();
        const registry = new ShellFileRegistry(undefined, external, external);
        expect(await registry.mountDirectory(handle('data'), undefined, 'read')).toBe('/mnt/external/data');
        await registry.mountFile(sourceFile('a.csv'));
        expect(await registry.listFiles()).toEqual([
            { path: '/mnt/external/a.csv', size: 3 },
            { path: '/mnt/external/data', directoryMode: 'read' },
        ]);
        expect(await registry.drop('/mnt/external/data')).toBe(true);
        expect(external.directories.size).toBe(0);
        expect(await registry.drop('/mnt/external/missing')).toBe(false);
    });

    it('unmounts files and directories on dispose and rejects later mounts', async () => {
        const external = new MockExternalFiles();
        const registry = new ShellFileRegistry(undefined, external, external);
        await registry.mountDirectory(handle('data'), '/mnt/data', 'readwrite');
        await registry.mountFile(sourceFile('a.csv'));
        await registry.dispose();
        expect(external.directories.size).toBe(0);
        expect(external.files.size).toBe(0);
        await expect(registry.mountDirectory(handle('other'), undefined, 'read')).rejects.toThrow('disposed');
    });

    it('rejects directories without external directory support', async () => {
        const registry = new ShellFileRegistry(undefined, new MockExternalFiles());
        await expect(registry.mountDirectory(handle('data'), undefined, 'read')).rejects.toThrow('not supported');
    });

    it('forwards failing directory mounts', async () => {
        const external = new MockExternalFiles();
        vi.spyOn(external, 'registerExternalDirectory').mockRejectedValue(new Error('denied'));
        const registry = new ShellFileRegistry(undefined, external, external);
        await expect(registry.mountDirectory(handle('data'), undefined, 'read')).rejects.toThrow('denied');
        expect(await registry.list()).toEqual([]);
    });
});

describe('selectPlatformFiles', () => {
    it('rejects an aborted selection without opening the picker', async () => {
        const reason = new Error('aborted');
        await expect(selectPlatformFiles(AbortSignal.abort(reason))).rejects.toBe(reason);
    });
});

