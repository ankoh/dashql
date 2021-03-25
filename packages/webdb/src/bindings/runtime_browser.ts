// Copyright (c) 2020 The DashQL Authors

import { WebDBRuntime, copyBlobStreamTo, BlobStream } from './runtime_base';
import globToRegexp from 'glob-to-regexp';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class WebBlobStream implements BlobStream {
    url: string | null;
    buffer: Uint8Array | null;
    position: number;

    blob: Blob;

    public constructor(blob: Blob, url: string | null) {
        this.blob = blob;
        this.url = url;
        this.buffer = null;
        this.position = 0;
    }
}

export var BrowserWebDBRuntime: WebDBRuntime & {
    blobMap: (WebBlobStream | null)[];
} = {
    blobMap: [],
    bindings: null,
    dashql_add_blob_stream: function (blob_stream: BlobStream): number {
        for (let i = 0; i < BrowserWebDBRuntime.blobMap.length; i++) {
            if (BrowserWebDBRuntime.blobMap[i] === null) {
                BrowserWebDBRuntime.blobMap[i] = <WebBlobStream>blob_stream;
                return i;
            }
        }

        const id = BrowserWebDBRuntime.blobMap.length;
        BrowserWebDBRuntime.blobMap.push(<WebBlobStream>blob_stream);
        return id;
    },
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number {
        return BrowserWebDBRuntime.dashql_webdb_fs_read(blobId, buf, size);
    },
    dashql_webdb_fs_read: function (blobId: number, buf: number, bytes: number) {
        if (blobId >= BrowserWebDBRuntime.blobMap.length) return 0;
        let blobStream = BrowserWebDBRuntime.blobMap[blobId];
        if (blobStream === null) return 0;

        return copyBlobStreamTo(blobStream, BrowserWebDBRuntime.bindings!.instance!.HEAPU8, buf, bytes);
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
        for (let blob of BrowserWebDBRuntime.blobMap) {
            if (blob && blob.url && !blob.buffer && re.test(blob.url)) {
                const data = encoder.encode(blob.url);
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

        for (let i = 0; i < BrowserWebDBRuntime.blobMap.length; i++) {
            let blob = BrowserWebDBRuntime.blobMap[i];
            if (blob && blob.url == path) {
                if (!blob.buffer) {
                    const reader = new FileReaderSync();
                    blob.buffer = new Uint8Array(reader.readAsArrayBuffer(blob.blob));
                }
                blob.position = 0;
                return i;
            }
        }

        throw Error('File not found or cannot be opened: ' + path);
    },
    dashql_webdb_fs_file_close: function (blobId: number) {
        if (blobId < BrowserWebDBRuntime.blobMap.length) {
            BrowserWebDBRuntime.blobMap[blobId] = null;
        }
    },
    dashql_webdb_fs_file_get_size: function (blobId: number) {
        if (blobId < BrowserWebDBRuntime.blobMap.length) {
            let blob = BrowserWebDBRuntime.blobMap[blobId];
            if (!blob) return 0;
            return blob.blob.size;
        }
        return 0;
    },
    dashql_webdb_fs_file_get_last_modified_time: function (blobId: number) {
        // TODO: Keep fetch response header to answer BrowserWebDBRuntime
        return 0;
    },
    dashql_webdb_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_set_pointer: function (blobId: number, location: number) {
        if (blobId < BrowserWebDBRuntime.blobMap.length) {
            let blob = BrowserWebDBRuntime.blobMap[blobId];
            if (blob == null) return;
            blob.position = location;
        }
    },
    dashql_webdb_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let instance = BrowserWebDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        for (let blob of BrowserWebDBRuntime.blobMap) {
            if (blob && blob.url == path && !blob.buffer) {
                return true;
            }
        }

        return false;
    },
    dashql_webdb_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
