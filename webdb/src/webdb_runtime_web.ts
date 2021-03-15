// Copyright (c) 2020 The DashQL Authors

import { copyBlobStreamTo, WebDBBindings } from './webdb_bindings';

export var WebWebDBRuntime = {
    bindings: null as null | WebDBBindings,
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number {
        let blobStream = this.bindings!.getBlobStreamById(blobId);
        if (blobStream === undefined) return 0;
        return copyBlobStreamTo(blobStream, this.bindings!.instance!.HEAPU8, buf, size);
    },
    dashql_webdb_fs_read: function (blobId: number, buf: number, bytes: number) {
        throw Error('undefined');
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
        throw Error('undefined');
    },
    dashql_webdb_fs_file_open: function (pathPtr: number, pathLen: number, flags: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_close: function (blobId: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_get_size: function (blobId: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_get_last_modified_time: function (blobId: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_move: function (fromPtr: number, fromLen: number, toPtr: number, toLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_set_pointer: function (blobId: number, location: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_exists: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
    dashql_webdb_fs_file_remove: function (pathPtr: number, pathLen: number) {
        throw Error('undefined');
    },
};
