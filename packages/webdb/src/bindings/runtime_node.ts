// Copyright (c) 2020 The DashQL Authors

import fs from 'fs';
import { copyBlobStreamTo } from '../bindings';
import { NodeBlobStream } from '../bindings/bindings_node';
import fg from 'fast-glob';
import { WebDBRuntime } from './runtime_base';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export var NodeWebDBRuntime: WebDBRuntime & {
    blobMap: (NodeBlobStream | null)[];
} = {
    bindings: null,
    /// Blob Stream

    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number {
        let blobStream = this.bindings!.getBlobStreamById(blobId);
        if (blobStream === undefined) return 0;
        return copyBlobStreamTo(blobStream, this.bindings!.instance!.HEAPU8, buf, size);
    },

    /// File System

    // Dense file handle map
    blobMap: [],

    dashql_webdb_fs_read: function (blobId: number, buf: number, bytes: number) {
        if (blobId >= this.blobMap.length) return 0;
        let blobStream = this.blobMap[blobId];
        if (blobStream === null) return 0;

        return copyBlobStreamTo(blobStream, this.bindings!.instance!.HEAPU8, buf, bytes);
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
        let instance = this.bindings!.instance!;
        const path = decoder.decode(instance.HEAPU8.subarray(pathPtr, pathPtr + pathLen));
        for (let f of fg.sync(path)) {
            const data = encoder.encode(f);
            const ptr = instance.stackAlloc(data.length);
            instance.HEAPU8.set(data, ptr);
            instance.ccall('dashql_webdb_fs_glob_callback', null, ['number', 'number'], [ptr, f.length]);
        }
    },
    dashql_webdb_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        // TODO: respect flags
        const path = decoder.decode(this.bindings!.instance!.HEAPU8.subarray(pathPtr, pathPtr + pathLen));

        for (let i = 0; i < this.blobMap.length; i++) {
            if (this.blobMap[i] === null) {
                this.blobMap[i] = NodeBlobStream.fromFile(path);
                return i;
            }
        }

        const id = this.blobMap.length;
        this.blobMap.push(NodeBlobStream.fromFile(path));
        return id;
    },
    dashql_webdb_fs_file_close: function (blobId: number) {
        if (blobId < this.blobMap.length) {
            this.blobMap[blobId] = null;
        }
    },
    dashql_webdb_fs_file_get_size: function (blobId: number): number {
        if (blobId < this.blobMap.length) {
            let blob = this.blobMap[blobId];
            if (blob == null) return 0;
            return blob.buffer.length;
        }
        return 0;
    },
    dashql_webdb_fs_file_get_last_modified_time: function (blobId: number) {
        if (blobId < this.blobMap.length) {
            let blob = this.blobMap[blobId];
            if (blob == null || blob.path == null) return 0;
            return fs.statSync(blob.path).mtime.getTime();
        }

        return 0;
    },
    dashql_webdb_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_set_pointer: function (blobId: number, location: number) {
        if (blobId < this.blobMap.length) {
            let blob = this.blobMap[blobId];
            if (blob == null) return;
            blob.position = location;
        }
    },
    dashql_webdb_fs_file_exists: function (pathPtr: number, pathLen: number) {
        let result = fs.existsSync(
            decoder.decode(this.bindings!.instance!.HEAPU8.subarray(pathPtr, pathPtr + pathLen)),
        );
        return result;
    },
    dashql_webdb_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
