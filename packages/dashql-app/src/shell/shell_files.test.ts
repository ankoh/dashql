// @vitest-environment node
import type {
    EmbeddedExternalDirectoryDatabase,
    EmbeddedExternalFileDatabase,
    ExternalDirectoryMode,
} from '../platform/database/embedded_database.js';
import type { PlatformFile } from '../platform/file/file.js';
import type { LoggerLike } from '../platform/logger/logger.js';
import {
    createShellFilesCommand,
    externalDirectoryDatabase,
    externalFileDatabase,
    selectPlatformDirectory,
    selectPlatformFiles,
    ShellFileRegistry,
} from './shell_files.js';

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
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects an aborted selection without opening the picker', async () => {
        const reason = new Error('aborted');
        await expect(selectPlatformFiles(AbortSignal.abort(reason))).rejects.toBe(reason);
    });

    it('resolves no files when the picker is cancelled', async () => {
        const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            expect(this.type).toBe('file');
            expect(this.multiple).toBe(true);
            this.dispatchEvent(new Event('cancel'));
        });
        await expect(selectPlatformFiles()).resolves.toEqual([]);
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('resolves the selected files', async () => {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['a,b'], 'data.csv'));
            this.files = transfer.files;
            this.dispatchEvent(new Event('change'));
        });
        const files = await selectPlatformFiles();
        expect(files.map(file => file.path)).toEqual(['data.csv']);
        expect(files[0].size).toBe(3);
    });

    it('rejects an open picker that is aborted', async () => {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => { });
        const abort = new AbortController();
        const selected = selectPlatformFiles(abort.signal);
        await new Promise(resolve => setTimeout(resolve, 0));
        abort.abort();
        await expect(selected).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('selectPlatformDirectory', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('needs the File System Access API', async () => {
        vi.stubGlobal('showDirectoryPicker', undefined);
        await expect(selectPlatformDirectory('read')).rejects.toThrow('File System Access API');
    });

    it('asks the picker for the access mode', async () => {
        const handle = { name: 'data' } as FileSystemDirectoryHandle;
        const picker = vi.fn().mockResolvedValue(handle);
        vi.stubGlobal('showDirectoryPicker', picker);
        await expect(selectPlatformDirectory('readwrite')).resolves.toBe(handle);
        expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' });
    });
});

describe('external database registrations', () => {
    it('finds the file and directory registrations of a database', () => {
        const external = new MockExternalFiles();
        expect(externalFileDatabase(external)).toBe(external);
        expect(externalDirectoryDatabase(external)).toBe(external);
        for (const database of [null, undefined, 'database', {}, { registerExternalFile: () => { } }]) {
            expect(externalFileDatabase(database)).toBeUndefined();
            expect(externalDirectoryDatabase(database)).toBeUndefined();
        }
    });
});

/// A logger that records the messages and their key values
class RecordingLogger implements LoggerLike {
    readonly records: { level: string; message: string; keyValues: Record<string, string | null | undefined> }[] = [];
    trace(message: string, keyValues: Record<string, string | null | undefined>) { this.records.push({ level: 'trace', message, keyValues }); }
    debug(message: string, keyValues: Record<string, string | null | undefined>) { this.records.push({ level: 'debug', message, keyValues }); }
    info(message: string, keyValues: Record<string, string | null | undefined>) { this.records.push({ level: 'info', message, keyValues }); }
    warn(message: string, keyValues: Record<string, string | null | undefined>) { this.records.push({ level: 'warn', message, keyValues }); }
    error(message: string, keyValues: Record<string, string | null | undefined>) { this.records.push({ level: 'error', message, keyValues }); }
    exception(_error: any) { }
}

describe('shell file registry logging', () => {
    const handle = (name: string) => ({ name }) as FileSystemDirectoryHandle;

    it('logs the stages of a file mount', async () => {
        const logger = new RecordingLogger();
        const registry = new ShellFileRegistry(logger, new MockExternalFiles());
        const progress: string[] = [];
        await registry.mountFile(sourceFile('input/data.csv'), undefined, { onProgress: message => progress.push(message) });
        expect(progress).toEqual(['Mounting data.csv']);
        expect(logger.records.map(r => [r.level, r.message])).toEqual([
            ['info', 'Mounting shell file'],
            ['info', 'Mounted shell file'],
        ]);
        expect(logger.records[0].keyValues).toMatchObject({
            source_path: 'input/data.csv',
            target_path: undefined,
            size_bytes: '3',
            stage: 'register_external_file',
        });
        expect(logger.records[1].keyValues).toMatchObject({
            source_path: 'input/data.csv',
            target_path: '/mnt/external/data.csv',
            stage: 'complete',
        });
        expect(Number(logger.records[1].keyValues.elapsed_ms)).toBeGreaterThanOrEqual(0);
    });

    it('logs failing file mounts', async () => {
        const logger = new RecordingLogger();
        const external = new MockExternalFiles();
        vi.spyOn(external, 'registerExternalFile').mockRejectedValue(new TypeError('denied'));
        const registry = new ShellFileRegistry(logger, external);
        await expect(registry.mountFile(sourceFile('data.csv'))).rejects.toThrow('denied');
        const failure = logger.records[logger.records.length - 1]!;
        expect(failure.level).toBe('error');
        expect(failure.message).toBe('Failed to mount shell file');
        expect(failure.keyValues).toMatchObject({ stage: 'register_external_file', error_name: 'TypeError' });
        expect(failure.keyValues.error).toContain('denied');
    });

    it('rejects files without support or without a blob', async () => {
        const file = sourceFile('data.csv');
        await expect(new ShellFileRegistry().mountFile(file)).rejects.toThrow('not supported');
        const registry = new ShellFileRegistry(undefined, new MockExternalFiles());
        await expect(registry.mountFile({ ...file, blob: undefined })).rejects.toThrow('cannot be mounted directly');
        await expect(registry.mountFile(file, undefined, { signal: AbortSignal.abort(new Error('stop')) })).rejects.toThrow('stop');
    });

    it('removes a file that finished mounting after the abort', async () => {
        const external = new MockExternalFiles();
        const abort = new AbortController();
        const register = external.registerExternalFile.bind(external);
        vi.spyOn(external, 'registerExternalFile').mockImplementation(async (name: string, blob: Blob) => {
            const path = await register(name, blob);
            abort.abort(new Error('cancelled'));
            return path;
        });
        const logger = new RecordingLogger();
        const registry = new ShellFileRegistry(logger, external);
        await expect(registry.mountFile(sourceFile('data.csv'), undefined, { signal: abort.signal })).rejects.toThrow('cancelled');
        expect(external.files.size).toBe(0);
        expect(await registry.list()).toEqual([]);
        expect(logger.records[logger.records.length - 1]!.keyValues.target_path).toBe('/mnt/external/data.csv');
    });

    it('removes a directory that finished mounting after the dispose', async () => {
        const external = new MockExternalFiles();
        const logger = new RecordingLogger();
        const registry = new ShellFileRegistry(logger, external, external);
        const register = external.registerExternalDirectory.bind(external);
        vi.spyOn(external, 'registerExternalDirectory').mockImplementation(async (h, path, mode) => {
            const mounted = await register(h, path, mode);
            await registry.dispose();
            return mounted;
        });
        await expect(registry.mountDirectory(handle('data'), undefined, 'read')).rejects.toThrow('disposed');
        expect(external.directories.size).toBe(0);
        expect(logger.records.map(r => r.message)).toEqual(['Mounting shell directory', 'Failed to mount shell directory']);
        expect(logger.records[1].keyValues).toMatchObject({ mode: 'read', target_path: '/mnt/external/data' });
    });

    it('logs directory mounts with their mode', async () => {
        const external = new MockExternalFiles();
        const logger = new RecordingLogger();
        const registry = new ShellFileRegistry(logger, external, external);
        await registry.mountDirectory(handle('data'), '/mnt/data', 'readwrite');
        expect(logger.records[logger.records.length - 1]).toMatchObject({
            level: 'info',
            message: 'Mounted shell directory',
            keyValues: { source_path: 'data', target_path: '/mnt/data', stage: 'complete', mode: 'readwrite' },
        });
    });

    it('warns about mounts that fail to unmount on dispose', async () => {
        const external = new MockExternalFiles();
        const logger = new RecordingLogger();
        const registry = new ShellFileRegistry(logger, external, external);
        await registry.mountFile(sourceFile('a.csv'));
        await registry.mountDirectory(handle('data'), undefined, 'read');
        vi.spyOn(external, 'removeExternalFile').mockRejectedValue(new Error('busy'));
        vi.spyOn(external, 'removeExternalDirectory').mockRejectedValue(new Error('busy'));
        await registry.dispose();
        await registry.dispose();
        const warnings = logger.records.filter(r => r.level === 'warn');
        expect(warnings.map(r => [r.message, r.keyValues.path])).toEqual([
            ['Failed to unmount shell file during disposal', '/mnt/external/a.csv'],
            ['Failed to unmount shell directory during disposal', '/mnt/external/data'],
        ]);
    });
});

