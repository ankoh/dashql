import type { FileDownloader } from '../platform/file/file_downloader.js';
import type { PlatformFile } from '../platform/file/file.js';
import { isNativePlatform } from '../platform/native_globals.js';
import type { DashQLShellCommand } from './api.js';

export class ShellFileRegistry {
    private readonly files = new Map<string, PlatformFile>();

    list(): readonly PlatformFile[] {
        return Array.from(this.files.values()).sort((a, b) => a.path.localeCompare(b.path));
    }

    add(file: PlatformFile): void {
        this.files.set(file.path, file);
    }

    drop(path: string): boolean {
        return this.files.delete(path);
    }

    get(path: string): PlatformFile | undefined {
        return this.files.get(path);
    }
}

export function createShellFilesCommand(
    registry: ShellFileRegistry,
    downloader: FileDownloader,
    selectFiles: () => Promise<readonly PlatformFile[]> = selectPlatformFiles,
): DashQLShellCommand {
    return [
        'files',
        'Manage files: list, add, drop, or get',
        async args => {
            const [action = 'list', ...pathParts] = args;
            const path = pathParts.join(' ');
            switch (action) {
                case 'list': {
                    if (path.length !== 0) throw new Error('usage: .files list');
                    const files = registry.list();
                    return files.length === 0 ? 'No files registered' : files.map(file => file.path).join('\r\n');
                }
                case 'add': {
                    if (path.length !== 0) throw new Error('usage: .files add');
                    const files = await selectFiles();
                    for (const file of files) registry.add(file);
                    return files.length === 0 ? 'No files selected' : `Added ${files.length} file${files.length === 1 ? '' : 's'}`;
                }
                case 'drop': {
                    if (path.length === 0) throw new Error('usage: .files drop <path>');
                    if (!registry.drop(path)) throw new Error(`file not registered: ${path}`);
                    return `Dropped ${path}`;
                }
                case 'get': {
                    if (path.length === 0) throw new Error('usage: .files get <path>');
                    const file = registry.get(path);
                    if (file == null) throw new Error(`file not registered: ${path}`);
                    await downloader.downloadBufferAsFile(await file.readAsArrayBuffer(), fileName(path));
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

function fileName(path: string): string {
    return path.split(/[\\/]/).pop() || 'download';
}
