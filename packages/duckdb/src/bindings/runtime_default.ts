// Copyright (c) 2020 The DashQL Authors

import { DuckDBRuntime } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface RuntimeFile {
    fileID: number;
    url: string;
    buffer: Uint8Array;
    lastModified: Date;
}

const Runtime: DuckDBRuntime & {
    filesByPath: Map<string, RuntimeFile>;
    filesByID: Map<number, RuntimeFile>;
    nextFileID: number;
} = {
    filesByPath: new Map<string, RuntimeFile>(),
    filesByID: new Map<number, RuntimeFile>(),
    nextFileID: 0,
    bindings: null,

    duckdb_web_add_file_path(url: string, path: string): number {
        throw Error('cannot register a file path');
    },
    duckdb_web_add_file_blob(url: string, data: any): number {
        throw Error('cannot register a file blob');
    },
    duckdb_web_add_file_buffer(url: string, buffer: Uint8Array): number {
        const file = Runtime.filesByPath.get(url);
        if (file) return file.fileID;
        const fileID = Runtime.nextFileID++;
        const newFile: RuntimeFile = {
            fileID,
            url,
            buffer,
            lastModified: new Date(),
        };
        Runtime.filesByPath.set(url, newFile);
        Runtime.filesByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_get_file_object_url(fileId: number): string | null {
        throw Error('cannot retrieve a file by object url');
    },
    duckdb_web_get_file_buffer(fileId: number): Uint8Array | null {
        const file = Runtime.filesByID.get(fileId);
        if (!file) return null;
        return file.buffer;
    },
    duckdb_web_fs_read: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = Runtime.filesByID.get(fileId);
        if (!file || !file.buffer) return 0;
        const instance = Runtime.bindings!.instance!;
        const dst = instance.HEAPU8.subarray(buf, buf + bytes);
        const src = file.buffer.subarray(location, location + bytes);
        dst.set(src);
        return bytes;
    },
    duckdb_web_fs_write: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = Runtime.filesByID.get(fileId);
        if (!file) return 0;
        const instance = Runtime.bindings!.instance!;
        const src = instance.HEAPU8.subarray(buf, buf + bytes);
        const dst = file.buffer.subarray(location, location + bytes);
        dst.set(src);
        return bytes;
    },
    duckdb_web_fs_directory_exists: function (pathPtr: number, pathLen: number) {
        // TODO check if theres any RuntimeFile with prefix
        return false;
    },
    duckdb_web_fs_directory_create: function (pathPtr: number, pathLen: number) {},
    duckdb_web_fs_directory_remove: function (pathPtr: number, pathLen: number) {},
    duckdb_web_fs_directory_list_files: function (pathPtr: number, pathLen: number) {
        // TODO list files
        return false;
    },
    duckdb_web_fs_glob: function (pathPtr: number, pathLen: number) {
        const instance = Runtime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const re = globToRegexp(path);
        for (const url of Runtime.filesByPath.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                Runtime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        const instance = Runtime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = Runtime.filesByPath.get(path);
        if (file) return file.fileID;

        throw Error('File not found: ' + path);
    },
    duckdb_web_fs_file_close: function (fileId: number) {
        // Noop
    },
    duckdb_web_fs_file_get_size: function (fileId: number) {
        const file = Runtime.filesByID.get(fileId);
        if (!file) return 0;
        return file.buffer.length;
    },
    duckdb_web_fs_file_get_last_modified_time: function (fileId: number) {
        const file = Runtime.filesByID.get(fileId);
        if (!file) return 0;
        return file.lastModified.getTime();
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        const instance = Runtime.bindings!.instance!;
        const fromPath = decoder.decode(instance.HEAPU8.subarray(fromPtr, fromPtr + fromLen));
        const toPath = decoder.decode(instance.HEAPU8.subarray(toPtr, toPtr + toLen));
        const file = Runtime.filesByPath.get(fromPath);
        if (!file) return;

        file.url = toPath;
        Runtime.filesByPath.delete(fromPath);
        Runtime.filesByPath.set(toPath, file);
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        const instance = Runtime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = Runtime.filesByPath.get(path);
        return !!file;
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        const instance = Runtime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        Runtime.filesByPath.delete(path);
    },
};

export default Runtime;
