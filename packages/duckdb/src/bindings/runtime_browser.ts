// Copyright (c) 2020 The DashQL Authors

import { DuckDBRuntime } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface BrowserRuntimeFile {
    fileID: number;
    url: string;
    buffer: Uint8Array | null;
    blob: Blob | null;
    lastModified: Date;
}

export const BrowserRuntime: DuckDBRuntime & {
    filesByURL: Map<string, BrowserRuntimeFile>;
    filesByID: Map<number, BrowserRuntimeFile>;
    nextFileID: number;
} = {
    filesByURL: new Map<string, BrowserRuntimeFile>(),
    filesByID: new Map<number, BrowserRuntimeFile>(),
    nextFileID: 0,
    bindings: null,

    duckdb_web_add_file_path(url: string, path: string): number {
        throw Error('cannot register a file path');
    },
    duckdb_web_add_file_blob(url: string, blob: any): number {
        const file = BrowserRuntime.filesByURL.get(url);
        if (file) return file.fileID;
        const fileID = BrowserRuntime.nextFileID++;
        const newFile: BrowserRuntimeFile = {
            fileID,
            url,
            buffer: null,
            blob,
            lastModified: new Date(),
        };
        BrowserRuntime.filesByURL.set(url, newFile);
        BrowserRuntime.filesByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_add_file_buffer: function (url: string, buffer: Uint8Array) {
        const file = BrowserRuntime.filesByURL.get(url);
        if (file) return file.fileID;
        const fileID = BrowserRuntime.nextFileID++;
        const newFile: BrowserRuntimeFile = {
            fileID,
            url,
            buffer,
            blob: null,
            lastModified: new Date(),
        };
        BrowserRuntime.filesByURL.set(url, newFile);
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
        if (file.buffer) return file.buffer;
        return new Uint8Array(new FileReaderSync().readAsArrayBuffer(file.blob!));
    },
    duckdb_web_fs_read: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const inst = BrowserRuntime.bindings!.instance!;
        const dst = inst.HEAPU8.subarray(buf, buf + bytes);
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
    },
    duckdb_web_fs_write: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const inst = BrowserRuntime.bindings!.instance!;
        const src = inst.HEAPU8.subarray(buf, buf + bytes);
        // Copy entire blob on first write
        if (!file.buffer) {
            file.buffer = new Uint8Array(new FileReaderSync().readAsArrayBuffer(file.blob!));
            file.blob = null;
        }
        const dst = file.buffer.subarray(location, location + bytes);
        dst.set(src);
        return bytes;
    },
    duckdb_web_fs_directory_exists: function (_pathPtr: number, _pathLen: number) {
        // TODO check if theres any BrowserRuntimeFile with prefix
        return false;
    },
    duckdb_web_fs_directory_create: function (_pathPtr: number, _pathLen: number) {},
    duckdb_web_fs_directory_remove: function (_pathPtr: number, _pathLen: number) {},
    duckdb_web_fs_directory_list_files: function (_pathPtr: number, _pathLen: number) {
        // TODO list files
        return false;
    },
    duckdb_web_fs_glob: function (pathPtr: number, pathLen: number) {
        const inst = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const re = globToRegexp(path);
        for (const url of BrowserRuntime.filesByURL.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
                const ptr = inst.stackAlloc(data.length);
                inst.HEAPU8.set(data, ptr);
                BrowserRuntime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, _flags: number) {
        const inst = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = BrowserRuntime.filesByURL.get(path);
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
    duckdb_web_fs_file_truncate: function (fileId: number, newSize: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        let buffer = file.buffer;
        if (!buffer) {
            buffer = new Uint8Array(new FileReaderSync().readAsArrayBuffer(file.blob!));
        }
        const newBuffer = new Uint8Array(newSize);
        newBuffer.set(buffer.subarray(0, Math.min(buffer.length, newSize)));
        file.buffer = newBuffer;
        file.blob = null;
    },
    duckdb_web_fs_file_get_last_modified_time: function (fileId: number) {
        const file = BrowserRuntime.filesByID.get(fileId);
        if (!file) return 0;
        return file.lastModified.getTime();
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        const inst = BrowserRuntime.bindings!.instance!;
        const fromPath = decoder.decode(inst.HEAPU8.subarray(fromPtr, fromPtr + fromLen));
        const toPath = decoder.decode(inst.HEAPU8.subarray(toPtr, toPtr + toLen));
        const file = BrowserRuntime.filesByURL.get(fromPath);
        if (!file) return;
        file.url = toPath;
        BrowserRuntime.filesByURL.delete(fromPath);
        BrowserRuntime.filesByURL.set(toPath, file);
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        const inst = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = BrowserRuntime.filesByURL.get(path);
        return !!file;
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        const inst = BrowserRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        BrowserRuntime.filesByURL.delete(path);
    },
};
export default BrowserRuntime;
