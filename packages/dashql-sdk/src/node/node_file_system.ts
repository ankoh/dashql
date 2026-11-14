import * as fs from 'node:fs/promises';

import type { FileStamp, FileSystem } from '../platform/file_system.js';

/// The stamp of a file, its size and modification time
function stampOf(stats: { size: number; mtimeMs: number }): FileStamp {
    return { size: stats.size, mtimeMs: stats.mtimeMs };
}

/// Is the error the one of a path that does not exist?
function isNotFound(error: unknown): boolean {
    return (error as { code?: string } | null)?.code === 'ENOENT';
}

/// The files of Node
export const NODE_FILE_SYSTEM: FileSystem = {
    async exists(path) {
        try {
            await fs.access(path);
            return true;
        } catch {
            return false;
        }
    },
    async fileStamp(path) {
        try {
            const stats = await fs.stat(path);
            return stats.isFile() ? stampOf(stats) : null;
        } catch (error) {
            if (isNotFound(error)) return null;
            throw error;
        }
    },
    async listFiles(path) {
        let entries;
        try {
            entries = await fs.readdir(path, { withFileTypes: true });
        } catch (error) {
            if (isNotFound(error)) return [];
            throw error;
        }
        const files = [];
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            files.push({ name: entry.name, ...stampOf(await fs.stat(`${path}/${entry.name}`)) });
        }
        return files;
    },
    async mkdir(path, options) {
        await fs.mkdir(path, { recursive: options?.recursive ?? false });
    },
    async readDir(path) {
        const entries = await fs.readdir(path, { withFileTypes: true });
        return entries.map(entry => ({
            name: entry.name,
            isFile: entry.isFile(),
            isDirectory: entry.isDirectory(),
            isSymlink: entry.isSymbolicLink(),
        }));
    },
    async readFile(path) {
        return new Uint8Array(await fs.readFile(path));
    },
    async readTextFile(path) {
        return await fs.readFile(path, 'utf8');
    },
    async remove(path, options) {
        await fs.rm(path, { recursive: options?.recursive ?? false });
    },
    async rename(from, to) {
        await fs.rename(from, to);
    },
    async stat(path) {
        const stats = await fs.lstat(path);
        return {
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            isSymlink: stats.isSymbolicLink(),
        };
    },
    async writeFile(path, data) {
        await fs.writeFile(path, data);
    },
    async writeTextFile(path, data) {
        await fs.writeFile(path, data, 'utf8');
        return stampOf(await fs.stat(path));
    },
};
