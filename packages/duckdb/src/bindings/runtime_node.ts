// Copyright (c) 2020 The DashQL Authors

import fs from 'fs';
import { DuckDBRuntime, FileFlags } from './runtime_base';
import globToRegexp from 'glob-to-regexp';
import path from 'path';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface NodeBlobHandle {
    url: string;
    handle: number;
    stat: fs.Stats;
}

export interface BlobStream {
    id: number;
    handle: NodeBlobHandle;
    position: number;
}

export var NodeDuckDBRuntime: DuckDBRuntime & {
    handleMap: Map<string, NodeBlobHandle>;
    streamMap: Map<number, BlobStream>;
    streamCounter: number;
} = {
    handleMap: new Map<string, NodeBlobHandle>(),
    streamMap: new Map<number, BlobStream>(),
    streamCounter: 1,
    bindings: null,

    duckdb_web_add_handle: function (url: any, handle: any): void {
        let node_handle = <NodeBlobHandle>handle;
        if (NodeDuckDBRuntime.handleMap.has(url)) {
            // Somewhat silently fail adding duplicate blob handle
            // Not overwriting entry since blobstreams refer to their handle
            console.info('URL already registered: ' + url);
        } else {
            NodeDuckDBRuntime.handleMap.set(url, node_handle);
        }
    },
    duckdb_web_get_absolute_url(url: string): string | null {
        let handle = NodeDuckDBRuntime.handleMap.has(url);
        if (!handle) return null;

        return path.resolve(url);
    },
    duckdb_web_fs_read: function (blobId: number, buf: number, bytes: number) {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;

        const size = Math.min(bytes, stream.handle.stat.size - stream.position);
        let heap: Uint8Array = NodeDuckDBRuntime.bindings!.instance!.HEAPU8;
        fs.readSync(stream.handle.handle, heap, buf, size, stream.position);
        stream.position += size;
        return size;
    },
    duckdb_web_fs_write: function (blobId: number, buf: number, bytes: number) {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;

        const heap: Uint8Array = NodeDuckDBRuntime.bindings!.instance!.HEAPU8;
        const slice = heap.subarray(buf, buf + bytes);
        const written = fs.writeSync(stream.handle.handle, slice, 0, slice.length, stream.position);
        stream.position += written;
        return written;
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
        for (let url of NodeDuckDBRuntime.handleMap.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
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
        // TODO: Respect all flags
        let instance = NodeDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));

        if ((flags & FileFlags.FILE_FLAGS_READ) == FileFlags.FILE_FLAGS_READ) {
            const handle = NodeDuckDBRuntime.handleMap.get(path);
            if (!handle) throw Error('File not found or cannot be opened: ' + path);

            const id = NodeDuckDBRuntime.streamCounter;
            const stream = { id: id, handle: handle, position: 0 };
            NodeDuckDBRuntime.streamMap.set(id, stream);
            NodeDuckDBRuntime.streamCounter++;
            return id;
        } else if ((flags & FileFlags.FILE_FLAGS_WRITE) == FileFlags.FILE_FLAGS_WRITE) {
            let handle = NodeDuckDBRuntime.handleMap.get(path);
            if (handle) throw Error('File is already opened: ' + path);

            handle = {
                url: path,
                handle: fs.openSync(path, 'w'),
                stat: new fs.Stats(),
            };

            NodeDuckDBRuntime.handleMap.set(path, handle);

            const id = NodeDuckDBRuntime.streamCounter;
            const stream = { id: id, handle: handle, position: 0 };
            NodeDuckDBRuntime.streamMap.set(id, stream);
            NodeDuckDBRuntime.streamCounter++;
            return id;
        } else {
            throw Error('Unsupported file flags: ' + flags);
        }
    },
    duckdb_web_fs_file_close: function (blobId: number) {
        NodeDuckDBRuntime.streamMap.delete(blobId);
    },
    duckdb_web_fs_file_get_size: function (blobId: number): number {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        return stream.handle.stat.size;
    },
    duckdb_web_fs_file_get_last_modified_time: function (blobId: number) {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        return stream.handle.stat.mtime.getTime();
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_file_set_pointer: function (blobId: number, location: number) {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (stream) stream.position = location;
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let instance = NodeDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return NodeDuckDBRuntime.handleMap.has(path);
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
