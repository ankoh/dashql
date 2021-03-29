mergeInto(LibraryManager.library, {
    dashql_blob_stream_underflow: function (blobId, buf, size) {
        return globalThis.WebDBTrampoline.dashql_blob_stream_underflow(blobId, buf, size);
    },
    duckdb_web_fs_read: function (blobId, buf, size) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_read(blobId, buf, size);
    },
    duckdb_web_fs_write: function (blobId, buf, size) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_write(blobId, buf, size);
    },
    duckdb_web_fs_directory_exists: function (path, pathLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_directory_exists(path, pathLen);
    },
    duckdb_web_fs_directory_create: function (path, pathLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_directory_create(path, pathLen);
    },
    duckdb_web_fs_directory_remove: function (path, pathLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_directory_remove(path, pathLen);
    },
    duckdb_web_fs_directory_list_files: function (path, pathLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_directory_list_files(path, pathLen);
    },
    duckdb_web_fs_glob: function (path, pathLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_glob(path, pathLen);
    },
    duckdb_web_fs_file_open: function (path, pathLen, flags) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_open(path, pathLen, flags);
    },
    duckdb_web_fs_file_close: function (blobId) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_close(blobId);
    },
    duckdb_web_fs_file_get_size: function (blobId) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_get_size(blobId);
    },
    duckdb_web_fs_file_get_last_modified_time: function (blobId) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_get_last_modified_time(blobId);
    },
    duckdb_web_fs_file_move: function (from, fromLen, to, toLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_move(from, fromLen, to, toLen);
    },
    duckdb_web_fs_file_set_pointer: function (blobId, pos) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_set_pointer(blobId, pos);
    },
    duckdb_web_fs_file_exists: function (path, pathLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_exists(path, pathLen);
    },
    duckdb_web_fs_file_remove: function (path, pathLen) {
        return globalThis.WebDBTrampoline.duckdb_web_fs_file_remove(path, pathLen);
    },
});
