// Copyright (c) 2020 The DashQL Authors

import { WebDBRuntime, BlobStream, BlobHandle } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class WebBlobHandle extends BlobHandle {
    blob: Blob;

    public constructor(blob: Blob, url: string) {
        super(url);
        this.blob = blob;
    }

    public open(): void {
        const reader = new FileReaderSync();
        this.buffer = new Uint8Array(reader.readAsArrayBuffer(this.blob));
    }
}

export var BrowserWebDBRuntime: WebDBRuntime & {
    handleMap: Map<string, WebBlobHandle>;
    streamMap: Map<number, BlobStream>;
    streamCounter: number;
} = {
    handleMap: new Map<string, WebBlobHandle>(),
    streamMap: new Map<number, BlobStream>(),
    streamCounter: 1,
    bindings: null,

    dashql_add_blob_handle: function (blob_handle: BlobHandle): void {
        if (BrowserWebDBRuntime.handleMap.has(blob_handle.url)) {
            // Somewhat silently fail adding duplicate blob handle
            // Not overwriting entry since blobstreams refer to their handle
            console.info('URL already registered: ' + blob_handle.url);
        } else {
            BrowserWebDBRuntime.handleMap.set(blob_handle.url, <WebBlobHandle>blob_handle);
        }
    },
    dashql_blob_stream_open: function (url: string): number {
        const handle = BrowserWebDBRuntime.handleMap.get(url);
        if (!handle) throw Error('File not found or cannot be opened: ' + url);

        if (!handle.buffer) {
            handle.open();
        }

        const id = BrowserWebDBRuntime.streamCounter;
        const stream = new BlobStream(id, handle);
        BrowserWebDBRuntime.streamMap.set(id, stream);
        BrowserWebDBRuntime.streamCounter++;
        return id;
    },
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number {
        let stream = BrowserWebDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;

        const read = stream.copyTo(BrowserWebDBRuntime.bindings!.instance!.HEAPU8, buf, size);

        if (read == 0 && size > 0) {
            // Stream exhausted, close
            BrowserWebDBRuntime.streamMap.delete(blobId);
        }

        return read;
    },
    dashql_webdb_fs_read: function (blobId: number, buf: number, bytes: number) {
        let stream = BrowserWebDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;

        return stream.copyTo(BrowserWebDBRuntime.bindings!.instance!.HEAPU8, buf, bytes);
    },
    dashql_webdb_fs_write: function (blobId: number, buf: number, bytes: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_exists: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_create: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_directory_list_files: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_glob: function (pathPtr: number, pathLen: number) {
        let instance = BrowserWebDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        let re = globToRegexp(path);
        for (let url of BrowserWebDBRuntime.handleMap.keys()) {
            if (re.test(url)) {
                const data = encoder.encode(url);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                BrowserWebDBRuntime.bindings!.instance!.ccall(
                    'dashql_webdb_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, data.length],
                );
            }
        }
    },
    dashql_webdb_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        let instance = BrowserWebDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return BrowserWebDBRuntime.dashql_blob_stream_open(path);
    },
    dashql_webdb_fs_file_close: function (blobId: number) {
        BrowserWebDBRuntime.streamMap.delete(blobId);
    },
    dashql_webdb_fs_file_get_size: function (blobId: number) {
        let stream = BrowserWebDBRuntime.streamMap.get(blobId);
        if (!stream) return 0;
        return stream.handle.buffer!.length;
    },
    dashql_webdb_fs_file_get_last_modified_time: function (blobId: number) {
        // TODO: Keep fetch response header to answer BrowserWebDBRuntime
        return 0;
    },
    dashql_webdb_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_set_pointer: function (blobId: number, location: number) {
        let stream = BrowserWebDBRuntime.streamMap.get(blobId);
        if (stream) stream.position = location;
    },
    dashql_webdb_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let instance = BrowserWebDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return BrowserWebDBRuntime.handleMap.has(path);
    },
    dashql_webdb_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
