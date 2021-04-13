// Copyright (c) 2020 The DashQL Authors

import fs from 'fs';
import { DuckDBRuntime, FileFlags } from './runtime_base';
import globToRegexp from 'glob-to-regexp';
import p from 'path';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface NodeFile {
    fileID: number;
    fd: number;
    path: string;
    stat: fs.Stats;
}

export var NodeDuckDBRuntime: DuckDBRuntime & {
    fileByPath: Map<string, NodeFile>;
    fileByID: Map<number, NodeFile>;
    nextFileID: number;
} = {
    fileByPath: new Map<string, NodeFile>(),
    fileByID: new Map<number, NodeFile>(),
    nextFileID: 0,
    bindings: null,

    duckdb_web_add_handle: function (path: any, handle: any): void {
        if (NodeDuckDBRuntime.fileByPath.has(path)) return;
        NodeDuckDBRuntime.fileByPath.set(path, handle);
        NodeDuckDBRuntime.fileByID.set(path, handle);
    },
    duckdb_web_get_object_url(path: string): string | null {
        let handle = NodeDuckDBRuntime.fileByPath.has(path);
        if (!handle) return null;
        return p.resolve(path);
    },
    duckdb_web_fs_read: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = NodeDuckDBRuntime.fileByID.get(fileId);
        if (!file) return 0;
        let heap: Uint8Array = NodeDuckDBRuntime.bindings!.instance!.HEAPU8;
        return fs.readSync(file.fd, heap, buf, bytes, location);
    },
    duckdb_web_fs_write: function (fileId: number, buf: number, bytes: number, location: number) {
        const file = NodeDuckDBRuntime.fileByID.get(fileId);
        if (!file) return 0;
        const heap: Uint8Array = NodeDuckDBRuntime.bindings!.instance!.HEAPU8;
        const slice = heap.subarray(buf, buf + bytes);
        return fs.writeSync(file.fd, slice, 0, slice.length, location);
    },
    duckdb_web_fs_directory_exists: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_create: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_directory_list_files: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_glob: function (pathPtr: number, pathLen: number) {
        let instance = NodeDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        let re = globToRegexp(path);
        for (let path of NodeDuckDBRuntime.fileByPath.keys()) {
            if (re.test(path)) {
                const data = encoder.encode(path);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                NodeDuckDBRuntime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        const instance = NodeDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        const file = NodeDuckDBRuntime.fileByPath.get(path);
        if (file) return file.fileID;

        // Just always open with WRITE for now.
        // Buffer manager will have to do that anyway.
        const fd = fs.openSync(path, 'w');
        const stat = fs.fstatSync(fd);
        const fileID = NodeDuckDBRuntime.nextFileID++;
        const newFile = {
            fileID,
            path: path,
            fd,
            stat,
        };
        NodeDuckDBRuntime.fileByPath.set(path, newFile);
        NodeDuckDBRuntime.fileByID.set(fileID, newFile);
        return fileID;
    },
    duckdb_web_fs_file_close: function (fileId: number) {
        const file = NodeDuckDBRuntime.fileByID.get(fileId);
        if (!file) return;
        NodeDuckDBRuntime.fileByID.delete(fileId);
        NodeDuckDBRuntime.fileByPath.delete(file.path);
    },
    duckdb_web_fs_file_get_size: function (fileId: number): number {
        const file = NodeDuckDBRuntime.fileByID.get(fileId);
        if (!file) return 0;
        return file.stat.size;
    },
    duckdb_web_fs_file_get_last_modified_time: function (fileId: number) {
        const file = NodeDuckDBRuntime.fileByID.get(fileId);
        if (!file) return 0;
        return file.stat.mtime.getTime();
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let instance = NodeDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return NodeDuckDBRuntime.fileByPath.has(path);
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
