// Copyright (c) 2020 The DashQL Authors

import { copyBlobStreamTo } from './webdb_bindings';
import { WebDBRuntime } from './webdb_runtime';
import globToRegexp from 'glob-to-regexp';
import { WebBlobStream, WebDB } from './webdb_bindings_web';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export var WebWebDBRuntime: WebDBRuntime & {
    blobMap: (WebBlobStream | null)[];
} = {
    blobMap: [],
    bindings: null,
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number {
        let blobStream = WebWebDBRuntime.bindings!.getBlobStreamById(blobId);
        if (blobStream === undefined) return 0;
        return copyBlobStreamTo(blobStream, WebWebDBRuntime.bindings!.instance!.HEAPU8, buf, size);
    },
    dashql_webdb_fs_read: function (blobId: number, buf: number, bytes: number) {
        if (blobId >= WebWebDBRuntime.blobMap.length) return 0;
        let blobStream = WebWebDBRuntime.blobMap[blobId];
        if (blobStream === null) return 0;

        return copyBlobStreamTo(blobStream, WebWebDBRuntime.bindings!.instance!.HEAPU8, buf, bytes);
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
        let instance = WebWebDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        let re = globToRegexp(path);
        let blobs = (<WebDB>WebWebDBRuntime.bindings!).blobs;
        blobs.forEach((v, k) => {
            if (re.test(k)) {
                const data = encoder.encode(k);
                const ptr = instance.stackAlloc(data.length);
                instance.HEAPU8.set(data, ptr);
                WebWebDBRuntime.bindings!.instance!.ccall(
                    'dashql_webdb_fs_glob_callback',
                    null,
                    ['number', 'number'],
                    [ptr, k.length],
                );
            }
        });
    },
    dashql_webdb_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        let instance = WebWebDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        let file = (<WebDB>WebWebDBRuntime.bindings!).blobs.get(path);
        if (file === undefined) throw Error('File not found: ' + path);

        for (let i = 0; i < WebWebDBRuntime.blobMap.length; i++) {
            if (WebWebDBRuntime.blobMap[i] === null) {
                WebWebDBRuntime.blobMap[i] = new WebBlobStream(file);
                return i;
            }
        }

        const id = WebWebDBRuntime.blobMap.length;
        WebWebDBRuntime.blobMap.push(new WebBlobStream(file));
        return id;
    },
    dashql_webdb_fs_file_close: function (blobId: number) {
        if (blobId < WebWebDBRuntime.blobMap.length) {
            WebWebDBRuntime.blobMap[blobId] = null;
        }
    },
    dashql_webdb_fs_file_get_size: function (blobId: number) {
        if (blobId < WebWebDBRuntime.blobMap.length) {
            let blob = WebWebDBRuntime.blobMap[blobId];
            if (blob == null) return 0;
            return blob.buffer.length;
        }
        return 0;
    },
    dashql_webdb_fs_file_get_last_modified_time: function (blobId: number) {
        // TODO: Keep fetch response header to answer WebWebDBRuntime
        return 0;
    },
    dashql_webdb_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_set_pointer: function (blobId: number, location: number) {
        if (blobId < WebWebDBRuntime.blobMap.length) {
            let blob = WebWebDBRuntime.blobMap[blobId];
            if (blob == null) return;
            blob.position = location;
        }
    },
    dashql_webdb_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let instance = WebWebDBRuntime.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        return (<WebDB>WebWebDBRuntime.bindings!).blobs.has(path);
    },
    dashql_webdb_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
