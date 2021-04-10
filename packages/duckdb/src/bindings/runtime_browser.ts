// Copyright (c) 2020 The DashQL Authors

import { DuckDBRuntime, BlobStream } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface WebBlobHandle {
    blob: Blob;
    url: string;
}

export var BrowserDuckDBRuntime: DuckDBRuntime & {
    handleMap: Map<string, WebBlobHandle>;
    streamMap: Map<number, BlobStream>;
    streamCounter: number;
} = {
    handleMap: new Map<string, WebBlobHandle>(),
    streamMap: new Map<number, BlobStream>(),
    streamCounter: 1,
    bindings: null,

    duckdb_web_add_blob_handle: function (handle: object): void {
        let web_handle = <WebBlobHandle>handle;
        if (BrowserDuckDBRuntime.handleMap.has(web_handle.url)) {
            // Somewhat silently fail adding duplicate blob handle
            // Not overwriting entry since blobstreams refer to their handle
            console.info('URL already registered: ' + web_handle.url);
        } else {
            BrowserDuckDBRuntime.handleMap.set(web_handle.url, web_handle);
        }
    },
    duckdb_web_blob_stream_open: function (url: string): number {
        const handle = BrowserDuckDBRuntime.handleMap.get(url);
        if (!handle) throw Error('File not found or cannot be opened: ' + url);

        const id = BrowserDuckDBRuntime.streamCounter;
        const stream = { id: id, url: handle.url, position: 0 };
        BrowserDuckDBRuntime.streamMap.set(id, stream);
        BrowserDuckDBRuntime.streamCounter++;
        return id;
    },
    duckdb_web_fs_read: function (blobId: number, buf: number, bytes: number) {
        const reader = new FileReaderSync();

        let stream = BrowserDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        let handle = BrowserDuckDBRuntime.handleMap.get(stream.url);
        if (!handle) return 0;

        // TODO: investigate if this kind of ad-hoc creation of small blobs is slower
        // than creating big chunks and managing those as pages
        const size = Math.min(bytes, handle.blob.size - stream.position);
        const blob = handle.blob.slice(stream.position, stream.position + size);
        let heap: Uint8Array = BrowserDuckDBRuntime.bindings!.instance!.HEAPU8;
        heap.set(new Uint8Array(reader.readAsArrayBuffer(blob)), buf);
        stream.position += size;
        return size;
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
        let instance = BrowserDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        let re = globToRegexp(path);
        for (let url of BrowserDuckDBRuntime.handleMap.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                BrowserDuckDBRuntime.bindings!.instance!.ccall(
                    'duckdb_web_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    duckdb_web_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        let instance = BrowserDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return BrowserDuckDBRuntime.duckdb_web_blob_stream_open(path);
    },
    duckdb_web_fs_file_close: function (blobId: number) {
        BrowserDuckDBRuntime.streamMap.delete(blobId);
    },
    duckdb_web_fs_file_get_size: function (blobId: number) {
        let stream = BrowserDuckDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        return BrowserDuckDBRuntime.handleMap.get(stream.url)!.blob.size;
    },
    duckdb_web_fs_file_get_last_modified_time: function (blobId: number) {
        // TODO: Keep fetch response header to answer BrowserDuckDBRuntime
        return 0;
    },
    duckdb_web_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    duckdb_web_fs_file_set_pointer: function (blobId: number, location: number) {
        let stream = BrowserDuckDBRuntime.streamMap.get(blobId);
        if (stream) stream.position = location;
    },
    duckdb_web_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let instance = BrowserDuckDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return BrowserDuckDBRuntime.handleMap.has(path);
    },
    duckdb_web_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
