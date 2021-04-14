// Copyright (c) 2020 The DashQL Authors

import { DuckDBRuntime } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface MinimalRuntimeFile {
    fileID: number;
    url: string;
    buffer: Uint8Array;
    lastModified: Date;
}

export const MinimalRuntime: DuckDBRuntime & {
    filesByURL: Map<string, MinimalRuntimeFile>;
    filesByID: Map<number, MinimalRuntimeFile>;
    nextFileID: number;
} = {
    filesByURL: new Map<string, MinimalRuntimeFile>(),
    filesByID: new Map<number, MinimalRuntimeFile>(),
    nextFileID: 0,
    bindings: null,

    duckdb_web_add_file_path(url: string, path: string): number {
        throw Error('cannot register a file path');
    },
    duckdb_web_add_file_blob(url: string, data: any): number {
        throw Error('cannot register a file blob');
    },
    duckdb_web_add_file_buffer(url: string, buffer: Uint8Array): number {
        const file = MinimalRuntime.filesByURL.get(url);
        if (file) return file.fileID;
        const fileID = MinimalRuntime.nextFileID++;
        const newFile: MinimalRuntimeFile = {
            fileID,
            url,
            buffer,
            lastModified: new Date(),
        };
        MinimalRuntime.filesByURL.set(url, newFile);
        MinimalRuntime.filesByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_get_file_object_url(fileId: number): string | null {
        throw Error('cannot retrieve a file by object url');
    },
    duckdb_web_get_file_buffer(fileId: number): Uint8Array | null {
        const file = MinimalRuntime.filesByID.get(fileId);
        return file?.buffer || null;
    },
    duckdb_web_fs_read: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = MinimalRuntime.filesByID.get(fileId);
        if (!file || !file.buffer) return 0;
        const inst = MinimalRuntime.bindings!.instance!;
        const dst = inst.HEAPU8.subarray(buf, buf + bytes);
        const src = file.buffer.subarray(location, location + bytes);
        dst.set(src);
        return bytes;
    },
    duckdb_web_fs_write: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = MinimalRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const inst = MinimalRuntime.bindings!.instance!;
        const src = inst.HEAPU8.subarray(buf, buf + bytes);
        const dst = file.buffer.subarray(location, location + bytes);
        dst.set(src);
        return bytes;
    },
    duckdb_web_fs_directory_exists: function (pathPtr: number, pathLen: number) {
        return false;
    },
    duckdb_web_fs_directory_create: function (pathPtr: number, pathLen: number) {},
    duckdb_web_fs_directory_remove: function (pathPtr: number, pathLen: number) {},
    duckdb_web_fs_directory_list_files: function (pathPtr: number, pathLen: number) {
        return false;
    },
    duckdb_web_fs_glob: function (pathPtr: number, pathLen: number) {
        const inst = MinimalRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const re = globToRegexp(path);
        for (const url of MinimalRuntime.filesByURL.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
                const ptr = inst.stackAlloc(data.length);
                inst.HEAPU8.set(data, ptr);
                MinimalRuntime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        const inst = MinimalRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = MinimalRuntime.filesByURL.get(path);
        if (file) return file.fileID;
        throw Error(`File not found: ${path}`);
    },
    duckdb_web_fs_file_close: function (fileId: number) {
        // Noop
    },
    duckdb_web_fs_file_get_size: function (fileId: number) {
        const file = MinimalRuntime.filesByID.get(fileId);
        if (!file) return 0;
        return file.buffer.length;
    },
    duckdb_web_fs_file_truncate: function (fileId: number, newSize: number) {
        const file = MinimalRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const newBuffer = new Uint8Array(newSize);
        newBuffer.set(file.buffer.subarray(0, Math.min(file.buffer.length, newSize)));
        file.buffer = newBuffer;
    },
    duckdb_web_fs_file_get_last_modified_time: function (fileId: number) {
        const file = MinimalRuntime.filesByID.get(fileId);
        if (!file) return 0;
        return file.lastModified.getTime();
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        const inst = MinimalRuntime.bindings!.instance!;
        const fromPath = decoder.decode(inst.HEAPU8.subarray(fromPtr, fromPtr + fromLen));
        const toPath = decoder.decode(inst.HEAPU8.subarray(toPtr, toPtr + toLen));
        const file = MinimalRuntime.filesByURL.get(fromPath);
        if (!file) return;
        file.url = toPath;
        MinimalRuntime.filesByURL.delete(fromPath);
        MinimalRuntime.filesByURL.set(toPath, file);
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        const inst = MinimalRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = MinimalRuntime.filesByURL.get(path);
        return !!file;
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        const inst = MinimalRuntime.bindings!.instance!;
        const path = decoder.decode(inst.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        MinimalRuntime.filesByURL.delete(path);
    },
};

export default MinimalRuntime;
