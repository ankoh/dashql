export interface WebDBRuntime {
    bindings: any;
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number;
    dashql_webdb_fs_read(blobId: number, buf: number, bytes: number): number;
    dashql_webdb_fs_write(blobId: number, buf: number, bytes: number): number;
    dashql_webdb_fs_directory_exists(pathPtr: number, pathLen: number): boolean;
    dashql_webdb_fs_directory_create(pathPtr: number, pathLen: number): void;
    dashql_webdb_fs_directory_remove(pathPtr: number, pathLen: number): void;
    dashql_webdb_fs_directory_list_files(pathPtr: number, pathLen: number): boolean;
    dashql_webdb_fs_glob(pathPtr: number, pathLen: number): void;
    dashql_webdb_fs_file_open(pathPtr: number, pathLen: number, flags: number): number;
    dashql_webdb_fs_file_close(blobId: number): void;
    dashql_webdb_fs_file_get_size(blobId: number): number;
    dashql_webdb_fs_file_get_last_modified_time(blobId: number): number;
    dashql_webdb_fs_file_move(fromPtr: number, fromLen: number, toPtr: number, toLen: number): void;
    dashql_webdb_fs_file_set_pointer(blobId: number, location: number): void;
    dashql_webdb_fs_file_exists(pathPtr: number, pathLen: number): boolean;
    dashql_webdb_fs_file_remove(pathPtr: number, pathLen: number): void;
}

export var DefaultWebDBRuntime: WebDBRuntime = {
    bindings: null,
    dashql_blob_stream_underflow: function (blobId: number, buf: number, size: number) {
        throw Error('undefined');
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
