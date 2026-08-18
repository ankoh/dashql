import type { FileDownloader } from '../platform/file/file_downloader.js';
import type { PlatformFile } from '../platform/file/file.js';
import { isNativePlatform } from '../platform/native_globals.js';
import type { DashQLShellCommand } from './api.js';

const SHELL_FILES_DIRECTORY = 'dashql-shell-files';
const HYPER_OPFS_ROOT = '/opfs';

interface ShellFileEntry {
    readonly path: string;
    read(): Promise<Uint8Array>;
    drop(): Promise<void>;
}

export class ShellFileRegistry {
    private readonly files = new Map<string, ShellFileEntry>();

    constructor(
        private readonly native: boolean = isNativePlatform(),
        private readonly getOPFSRoot: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory(),
    ) {}

    async list(): Promise<readonly string[]> {
        if (this.native) return Array.from(this.files.keys()).sort((a, b) => a.localeCompare(b));
        const directory = await this.getOPFSDirectory();
        const paths: string[] = [];
        for await (const [name, handle] of directory.entries()) {
            if (handle.kind === 'file') paths.push(this.opfsPath(name));
        }
        return paths.sort((a, b) => a.localeCompare(b));
    }

    async add(file: PlatformFile): Promise<string> {
        const entry = this.native ? nativeEntry(file) : await this.copyToOPFS(file);
        this.files.set(entry.path, entry);
        return entry.path;
    }

    async drop(path: string): Promise<boolean> {
        if (!this.native) {
            const name = this.opfsFileName(path);
            try {
                await (await this.getOPFSDirectory()).removeEntry(name);
                return true;
            } catch (error) {
                if ((error as DOMException).name === 'NotFoundError') return false;
                throw error;
            }
        }
        const entry = this.files.get(path);
        if (entry == null) return false;
        await entry.drop();
        this.files.delete(path);
        return true;
    }

    async get(path: string): Promise<ShellFileEntry | undefined> {
        if (this.native) return this.files.get(path);
        const name = this.opfsFileName(path);
        try {
            const directory = await this.getOPFSDirectory();
            const handle = await directory.getFileHandle(name, { create: false });
            return this.opfsEntry(directory, handle, name);
        } catch (error) {
            if ((error as DOMException).name === 'NotFoundError') return undefined;
            throw error;
        }
    }

    private async copyToOPFS(file: PlatformFile): Promise<ShellFileEntry> {
        const directory = await this.getOPFSDirectory();
        const name = fileName(file.path);
        const handle = await directory.getFileHandle(name, { create: true });
        const bytes = await file.readAsArrayBuffer();
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const writable = await handle.createWritable();
        try {
            await writable.write(copy.buffer);
        } finally {
            await writable.close();
        }

        return this.opfsEntry(directory, handle, name);
    }

    private async getOPFSDirectory(): Promise<FileSystemDirectoryHandle> {
        return await (await this.getOPFSRoot()).getDirectoryHandle(SHELL_FILES_DIRECTORY, { create: true });
    }

    private opfsEntry(
        directory: FileSystemDirectoryHandle,
        handle: FileSystemFileHandle,
        name: string,
    ): ShellFileEntry {
        return {
            path: this.opfsPath(name),
            read: async () => new Uint8Array(await (await handle.getFile()).arrayBuffer()),
            drop: async () => directory.removeEntry(name),
        };
    }

    private opfsPath(name: string): string {
        return `${HYPER_OPFS_ROOT}/${SHELL_FILES_DIRECTORY}/${name}`;
    }

    private opfsFileName(path: string): string {
        const prefix = `${HYPER_OPFS_ROOT}/${SHELL_FILES_DIRECTORY}/`;
        if (!path.startsWith(prefix) || path.slice(prefix.length) !== fileName(path)) {
            throw new Error(`invalid shell file path: ${path}`);
        }
        return path.slice(prefix.length);
    }
}

export function createShellFilesCommand(
    registry: ShellFileRegistry,
    downloader: FileDownloader,
    selectFiles: () => Promise<readonly PlatformFile[]> = selectPlatformFiles,
): DashQLShellCommand {
    return [
        'files',
        'Manage queryable files: list, add, drop, or get',
        async args => {
            const [action = 'list', ...pathParts] = args;
            const path = pathParts.join(' ');
            switch (action) {
                case 'list': {
                    if (path.length !== 0) throw new Error('usage: .files list');
                    const files = await registry.list();
                    return files.length === 0 ? 'No files registered' : files.join('\r\n');
                }
                case 'add': {
                    if (path.length !== 0) throw new Error('usage: .files add');
                    const selected = await selectFiles();
                    const paths: string[] = [];
                    for (const file of selected) paths.push(await registry.add(file));
                    if (paths.length === 0) return 'No files selected';
                    return `Added ${paths.length} file${paths.length === 1 ? '' : 's'}\r\n${paths.join('\r\n')}`;
                }
                case 'drop': {
                    if (path.length === 0) throw new Error('usage: .files drop <path>');
                    if (!await registry.drop(path)) throw new Error(`file not registered: ${path}`);
                    return `Dropped ${path}`;
                }
                case 'get': {
                    if (path.length === 0) throw new Error('usage: .files get <path>');
                    const file = await registry.get(path);
                    if (file == null) throw new Error(`file not registered: ${path}`);
                    await downloader.downloadBufferAsFile(await file.read(), fileName(path));
                    return `Downloaded ${path}`;
                }
                default:
                    throw new Error('usage: .files [list|add|drop|get]');
            }
        },
    ];
}

async function selectPlatformFiles(): Promise<readonly PlatformFile[]> {
    if (isNativePlatform()) {
        const [{ open }, { NativeFile }] = await Promise.all([
            import('@tauri-apps/plugin-dialog'),
            import('../platform/file/native_file.js'),
        ]);
        const paths = await open({ multiple: true });
        if (paths == null) return [];
        return (Array.isArray(paths) ? paths : [paths]).map(path => new NativeFile(path));
    }

    const { WebFile } = await import('../platform/file/web_file.js');
    return await new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', () => {
            resolve(Array.from(input.files ?? [], file => new WebFile(file, file.name)));
        }, { once: true });
        input.click();
    });
}

function nativeEntry(file: PlatformFile): ShellFileEntry {
    return {
        path: file.path,
        read: () => file.readAsArrayBuffer(),
        drop: async () => {},
    };
}

function fileName(path: string): string {
    return path.split(/[\\/]/).pop() || 'file';
}
