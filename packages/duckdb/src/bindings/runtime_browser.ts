// Copyright (c) 2020 The DashQL Authors

import { DuckDBRuntime } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface BrowserRuntimeFile {
    fileID: number;
    url: string;
    blob: Blob | null;
    buffer: Uint8Array | null;
    lastModified: Date;
}

export const BrowserRuntime: DuckDBRuntime & {
    filesByPath: Map<string, BrowserRuntimeFile>;
    filesByID: Map<number, BrowserRuntimeFile>;
    nextFileID: number;
} = {
    filesByPath: new Map<string, BrowserRuntimeFile>(),
    filesByID: new Map<number, BrowserRuntimeFile>(),
    nextFileID: 0,
    bindings: null,

    duckdb_web_add_file_path(url: string, path: string): number {
        throw Error('cannot register a file path');
    },
    duckdb_web_add_file_blob(url: string, blob: any): number {
        const file = BrowserRuntime.filesByPath.get(url);
        if (file) return file.fileID;
        const fileID = BrowserRuntime.nextFileID++;
        const newFile: BrowserRuntimeFile = {
            fileID,
            url,
            blob,
            buffer: null,
            lastModified: new Date(),
        };
        BrowserRuntime.filesByPath.set(url, newFile);
        BrowserRuntime.filesByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_add_file_buffer: function (url: string, buffer: Uint8Array) {
        const file = BrowserRuntime.filesByPath.get(url);
        if (file) return file.fileID;
        const fileID = BrowserRuntime.nextFileID++;
        const newFile: BrowserRuntimeFile = {
            fileID,
            url,
            blob: null,
            buffer: buffer,
            lastModified: new Date(),
        };
        BrowserRuntime.filesByPath.set(url, newFile);
        BrowserRuntime.filesByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_get_file_object_url(fileId: number): string | null {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return null;
        if (file.buffer) {
            return URL.createObjectURL(new Blob([file.buffer]));
        } else {
            return URL.createObjectURL(file.blob);
        }
    },
    duckdb_web_get_file_buffer(fileId: number): Uint8Array | null {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return null;
        if (file.buffer) {
            return file.buffer;
        } else {
            return new Uint8Array(new FileReaderSync().readAsArrayBuffer(file.blob!));
        }
    },
    duckdb_web_fs_read: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const instance = BrowserRuntime.bindings!.instance!;
        const dst = instance.HEAPU8.subarray(buf, buf + bytes);
        // We copy the blob only if the file was written to
        if (file.buffer) {
            const src = file.buffer.subarray(location, location + bytes);
            dst.set(src);
            return bytes;
        } else {
            const blob = file.blob!.slice(location, location + bytes);
            const src = new Uint8Array(new FileReaderSync().readAsArrayBuffer(blob));
            dst.set(src);
            return bytes;
        }
        return 0;
    },
    duckdb_web_fs_write: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const instance = BrowserRuntime.bindings!.instance!;
        const src = instance.HEAPU8.subarray(buf, buf + bytes);
        // Copy entire blob on first write
        if (!file.buffer) {
            file.buffer = new Uint8Array(new FileReaderSync().readAsArrayBuffer(file.blob!));
        }
        const dst = file.buffer.subarray(location, location + bytes);
        dst.set(src);
        return bytes;
    },
    duckdb_web_fs_directory_exists: function (pathPtr: number, pathLen: number) {
        // TODO check if theres any BrowserRuntimeFile with prefix
        return false;
    },
    duckdb_web_fs_directory_create: function (pathPtr: number, pathLen: number) {},
    duckdb_web_fs_directory_remove: function (pathPtr: number, pathLen: number) {},
    duckdb_web_fs_directory_list_files: function (pathPtr: number, pathLen: number) {
        // TODO list files
        return false;
    },
    duckdb_web_fs_glob: function (pathPtr: number, pathLen: number) {
        const instance = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const re = globToRegexp(path);
        for (const url of BrowserRuntime.filesByPath.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                BrowserRuntime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        const instance = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = BrowserRuntime.filesByPath.get(path);
        if (file) return file.fileID;

        throw Error('File not found: ' + path);
    },
    duckdb_web_fs_file_close: function (fileId: number) {
        // Noop
    },
    duckdb_web_fs_file_get_size: function (fileId: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        return file.buffer ? file.buffer.length : file.blob!.size;
    },
    duckdb_web_fs_file_get_last_modified_time: function (fileId: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        return file.lastModified.getTime();
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        const instance = BrowserRuntime.bindings!.instance!;
        const fromPath = decoder.decode(instance.HEAPU8.subarray(fromPtr, fromPtr + fromLen));
        const toPath = decoder.decode(instance.HEAPU8.subarray(toPtr, toPtr + toLen));
        const file = BrowserRuntime.filesByPath.get(fromPath);
        if (!file) return;

        file.url = toPath;
        BrowserRuntime.filesByPath.delete(fromPath);
        BrowserRuntime.filesByPath.set(toPath, file);
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        const instance = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = BrowserRuntime.filesByPath.get(path);
        return !!file;
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        const instance = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        BrowserRuntime.filesByPath.delete(path);
    },
};
export default BrowserRuntime;
