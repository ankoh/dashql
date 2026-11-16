// The directory handles of the origin private file system over a folder of the host, so the modules of the runtime that
// keep their files in the root of the app (the query result cache, the mounts of attachments, Parquet exports) keep
// them on disk in Node with the same layout (docs/design/storage_layout.md). Only what those modules use is there.
import { constants, openAsBlob } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

/// A handle of the host, the engine of Node mounts its path
export interface HostHandle {
    readonly hostPath: string;
}

function notFound(name: string): DOMException {
    return new DOMException(`${name} was not found`, 'NotFoundError');
}

function typeMismatch(name: string): DOMException {
    return new DOMException(`${name} is not of the requested kind`, 'TypeMismatchError');
}

/// Is the error the one of a path that does not exist?
function isMissing(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/// A name of an entry, a single component like in the origin private file system
function checkName(name: string): string {
    if (name.length === 0 || name === '.' || name === '..' || /[\\/]/.test(name)) throw new TypeError(`Invalid name ${name}`);
    return name;
}

/// The bytes of a chunk that a writable stream of a file takes
async function chunkBytes(chunk: unknown): Promise<Uint8Array> {
    if (chunk instanceof Uint8Array) return chunk;
    if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
    if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (chunk instanceof Blob) return new Uint8Array(await chunk.arrayBuffer());
    if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
    if (chunk != null && typeof chunk === 'object' && (chunk as { type?: unknown }).type === 'write') {
        return await chunkBytes((chunk as { data: unknown }).data);
    }
    throw new TypeError('Unsupported chunk of a file write');
}

/// The writable stream of a file. Like in the origin private file system the bytes go into a swap file that replaces the
/// file when the stream closes, an aborted stream leaves the file as it was.
class NodeWritableFileStream extends WritableStream<unknown> {
    constructor(target: string, swap: string) {
        let file: fs.FileHandle | null = null;
        super({
            start: async () => {
                file = await fs.open(swap, 'a');
            },
            write: async chunk => {
                await file!.write(await chunkBytes(chunk));
            },
            close: async () => {
                await file!.close();
                await fs.rename(swap, target);
            },
            abort: async () => {
                await file?.close().catch(() => {});
                await fs.rm(swap, { force: true });
            },
        });
    }

    /// Write a chunk without holding a writer
    async write(chunk: unknown): Promise<void> {
        const writer = this.getWriter();
        try {
            await writer.write(chunk);
        } finally {
            writer.releaseLock();
        }
    }
}

export class NodeFileHandle implements HostHandle {
    readonly kind = 'file';

    constructor(
        private parent: string,
        private entryName: string,
    ) { }

    get name(): string {
        return this.entryName;
    }

    get hostPath(): string {
        return path.join(this.parent, this.entryName);
    }

    async getFile(): Promise<File> {
        let stats;
        try {
            stats = await fs.stat(this.hostPath);
        } catch (error) {
            if (isMissing(error)) throw notFound(this.entryName);
            throw error;
        }
        if (!stats.isFile()) throw typeMismatch(this.entryName);
        // The blob reads the file when it is read, not now
        const blob = await openAsBlob(this.hostPath);
        return new File([blob], this.entryName, { lastModified: stats.mtimeMs });
    }

    async createWritable(options: { keepExistingData?: boolean } = {}): Promise<NodeWritableFileStream> {
        const swap = `${this.hostPath}.${crypto.randomUUID()}.crswap`;
        if (options.keepExistingData) {
            await fs.copyFile(this.hostPath, swap).catch(error => { if (!isMissing(error)) throw error; });
        }
        return new NodeWritableFileStream(this.hostPath, swap);
    }

    /// Rename the file in its folder, or move it into another folder
    async move(target: string | NodeDirectoryHandle, name?: string): Promise<void> {
        const parent = typeof target === 'string' ? this.parent : target.hostPath;
        const entryName = checkName(typeof target === 'string' ? target : name ?? this.entryName);
        await fs.rename(this.hostPath, path.join(parent, entryName));
        this.parent = parent;
        this.entryName = entryName;
    }

    async isSameEntry(other: unknown): Promise<boolean> {
        return other instanceof NodeFileHandle && other.hostPath === this.hostPath;
    }
}

export class NodeDirectoryHandle implements HostHandle {
    readonly kind = 'directory';

    constructor(readonly hostPath: string) { }

    get name(): string {
        return path.basename(this.hostPath);
    }

    async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<NodeDirectoryHandle> {
        const target = path.join(this.hostPath, checkName(name));
        try {
            if (!(await fs.stat(target)).isDirectory()) throw typeMismatch(name);
        } catch (error) {
            if (!isMissing(error)) throw error;
            if (!options.create) throw notFound(name);
            await fs.mkdir(target, { recursive: true });
        }
        return new NodeDirectoryHandle(target);
    }

    async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<NodeFileHandle> {
        const target = path.join(this.hostPath, checkName(name));
        try {
            if (!(await fs.stat(target)).isFile()) throw typeMismatch(name);
        } catch (error) {
            if (!isMissing(error)) throw error;
            if (!options.create) throw notFound(name);
            // An existing file stays as it is, like in the origin private file system
            await (await fs.open(target, constants.O_CREAT | constants.O_WRONLY)).close();
        }
        return new NodeFileHandle(this.hostPath, name);
    }

    async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
        const target = path.join(this.hostPath, checkName(name));
        let stats;
        try {
            stats = await fs.stat(target);
        } catch (error) {
            if (isMissing(error)) throw notFound(name);
            throw error;
        }
        if (stats.isDirectory()) {
            if (!options.recursive && (await fs.readdir(target)).length > 0) {
                throw new DOMException(`${name} is not empty`, 'InvalidModificationError');
            }
            await fs.rm(target, { recursive: true, force: true });
        } else {
            await fs.rm(target, { force: true });
        }
    }

    async *entries(): AsyncGenerator<[string, NodeDirectoryHandle | NodeFileHandle]> {
        let children;
        try {
            children = await fs.readdir(this.hostPath, { withFileTypes: true });
        } catch (error) {
            if (isMissing(error)) throw notFound(this.name);
            throw error;
        }
        for (const child of children) {
            // Swap files of writes that are not closed yet are no entries
            if (child.name.endsWith('.crswap')) continue;
            if (child.isDirectory()) yield [child.name, new NodeDirectoryHandle(path.join(this.hostPath, child.name))];
            else if (child.isFile()) yield [child.name, new NodeFileHandle(this.hostPath, child.name)];
        }
    }

    async *keys(): AsyncGenerator<string> {
        for await (const [name] of this.entries()) yield name;
    }

    async *values(): AsyncGenerator<NodeDirectoryHandle | NodeFileHandle> {
        for await (const [, handle] of this.entries()) yield handle;
    }

    [Symbol.asyncIterator](): AsyncGenerator<[string, NodeDirectoryHandle | NodeFileHandle]> {
        return this.entries();
    }

    async isSameEntry(other: unknown): Promise<boolean> {
        return other instanceof NodeDirectoryHandle && other.hostPath === this.hostPath;
    }

    /// The names from this folder to a handle below it, null if it is not below
    async resolve(other: NodeDirectoryHandle | NodeFileHandle): Promise<string[] | null> {
        const relative = path.relative(this.hostPath, other.hostPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
        return relative.length === 0 ? [] : relative.split(path.sep);
    }
}

/// A folder of the host as the root of the files of the app, created if it is missing
export async function openNodeRoot(folder: string): Promise<FileSystemDirectoryHandle> {
    await fs.mkdir(folder, { recursive: true });
    return new NodeDirectoryHandle(path.resolve(folder)) as unknown as FileSystemDirectoryHandle;
}
