// Copyright (c) 2020 The DashQL Authors

import fs from 'fs';
import { DuckDBRuntime, BlobHandle, BlobStream } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class NodeBlobHandle extends BlobHandle {
    public open(): void {
        this.buffer = fs.readFileSync(this.url);
    }
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

    duckdb_web_add_blob_handle: function (blob_handle: BlobHandle): void {
        if (NodeDuckDBRuntime.handleMap.has(blob_handle.url)) {
            // Somewhat silently fail adding duplicate blob handle
            // Not overwriting entry since blobstreams refer to their handle
            console.info('URL already registered: ' + blob_handle.url);
        } else {
            NodeDuckDBRuntime.handleMap.set(blob_handle.url, <NodeBlobHandle>blob_handle);
        }
    },
    duckdb_web_blob_stream_open: function (url: string): number {
        const handle = NodeDuckDBRuntime.handleMap.get(url);
        if (!handle) throw Error('File not found or cannot be opened: ' + url);

        if (!handle.buffer) {
            handle.open();
        }

        const id = NodeDuckDBRuntime.streamCounter;
        const stream = new BlobStream(id, handle);
        NodeDuckDBRuntime.streamMap.set(id, stream);
        NodeDuckDBRuntime.streamCounter++;
        return id;
    },
    duckdb_web_fs_read: function (blobId: number, buf: number, bytes: number) {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;

        return stream.copyTo(NodeDuckDBRuntime.bindings!.instance!.HEAPU8, buf, bytes);
    },
    duckdb_web_fs_write: function (blobId: number, buf: number, bytes: number) {
        throw Error('undefined');
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
        // TODO: respect flags
        let instance = NodeDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return NodeDuckDBRuntime.duckdb_web_blob_stream_open(path);
    },
    duckdb_web_fs_file_close: function (blobId: number) {
        NodeDuckDBRuntime.streamMap.delete(blobId);
    },
    duckdb_web_fs_file_get_size: function (blobId: number): number {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        return stream.handle.buffer!.length;
    },
    duckdb_web_fs_file_get_last_modified_time: function (blobId: number) {
        let stream = NodeDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        return fs.statSync(stream.handle.url).mtime.getTime();
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
