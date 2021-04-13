// Copyright (c) 2020 The DashQL Authors

import fs from 'fs';
import { DuckDBRuntime } from './runtime_base';
import globToRegexp from 'glob-to-regexp';
import p from 'path';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface NodeRuntimeFile {
    fileID: number;
    fd: number;
    path: string;
    stat: fs.Stats;
}

export const NodeRuntime: DuckDBRuntime & {
    filesByPath: Map<string, NodeRuntimeFile>;
    filesByID: Map<number, NodeRuntimeFile>;
    nextFileID: number;
} = {
    filesByPath: new Map<string, NodeRuntimeFile>(),
    filesByID: new Map<number, NodeRuntimeFile>(),
    nextFileID: 0,
    bindings: null,

    duckdb_web_add_file_blob: function (url: string, blob: any) {
        throw Error('cannot register a file blob');
    },
    duckdb_web_add_file_buffer: function (url: string, buffer: Uint8Array) {
        throw Error('cannot register a file buffer');
    },
    duckdb_web_add_file_path: function (url: string, path: string) {
        const file = NodeRuntime.filesByPath.get(url);
        if (file) return file.fileID;

        // Always open with WRITE for now.
        // Buffer manager will have to do that anyway.
        const fd = fs.openSync(path, 'w');
        const stat = fs.fstatSync(fd);
        const fileID = NodeRuntime.nextFileID++;
        const newFile = {
            fileID,
            path: path,
            fd,
            stat,
        };
        NodeRuntime.filesByPath.set(path, newFile);
        NodeRuntime.filesByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_get_file_object_url(fileId: number): string | null {
        const file = NodeRuntime.filesByID.get(fileId);
        if (!file) return null;
        return p.resolve(file.path);
    },
    duckdb_web_get_file_buffer(fileId: number): Uint8Array | null {
        const file = NodeRuntime.filesByID.get(fileId);
        if (!file) return null;
        return fs.readFileSync(file.fd);
    },
    duckdb_web_fs_read: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = NodeRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const heap: Uint8Array = NodeRuntime.bindings!.instance!.HEAPU8;
        return fs.readSync(file.fd, heap, buf, bytes, location);
    },
    duckdb_web_fs_write: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = NodeRuntime.filesByID.get(fileId);
        if (!file) return 0;
        const heap: Uint8Array = NodeRuntime.bindings!.instance!.HEAPU8;
        const slice = heap.subarray(buf, buf + bytes);
        return fs.writeSync(file.fd, slice, 0, slice.length, location);
    },
    duckdb_web_fs_directory_exists: function (pathPtr: number, pathLen: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return fs.existsSync(path);
    },
    duckdb_web_fs_directory_create: function (pathPtr: number, pathLen: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return fs.mkdirSync(path);
    },
    duckdb_web_fs_directory_remove: function (pathPtr: number, pathLen: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return fs.rmdirSync(path);
    },
    duckdb_web_fs_directory_list_files: function (pathPtr: number, pathLen: number) {
        throw Error('cannot list files');
    },
    duckdb_web_fs_glob: function (pathPtr: number, pathLen: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const re = globToRegexp(path);
        for (let path of NodeRuntime.filesByPath.keys()) {
            if (re.test(path)) {
                const data = encoder.encode(path);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                NodeRuntime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = NodeRuntime.filesByPath.get(path);
        if (file) return file.fileID;
        const fd = fs.openSync(path, 'w');
        const stat = fs.fstatSync(fd);
        const fileID = NodeRuntime.nextFileID++;
        const newFile = {
            fileID,
            path: path,
            fd,
            stat,
        };
        NodeRuntime.filesByPath.set(path, newFile);
        NodeRuntime.filesByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_fs_file_close: function (fileId: number) {
        const file = NodeRuntime.filesByID.get(fileId);
        if (!file) return;
        NodeRuntime.filesByID.delete(fileId);
        NodeRuntime.filesByPath.delete(file.path);
    },
    duckdb_web_fs_file_get_size: function (fileId: number): number {
        const file = NodeRuntime.filesByID.get(fileId);
        if (!file) return 0;
        return file.stat.size;
    },
    duckdb_web_fs_file_get_last_modified_time: function (fileId: number) {
        const file = NodeRuntime.filesByID.get(fileId);
        if (!file) return 0;
        return file.stat.mtime.getTime();
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const fromPath = decoder.decode(instance.HEAPU8.subarray(fromPtr, fromPtr + fromLen));
        const toPath = decoder.decode(instance.HEAPU8.subarray(toPtr, toPtr + toLen));
        return fs.renameSync(fromPath, toPath);
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return NodeRuntime.filesByPath.has(path);
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        const instance = NodeRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return fs.rmSync(path);
    },
};

export default NodeRuntime;
