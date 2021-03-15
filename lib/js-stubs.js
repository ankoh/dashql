mergeInto(LibraryManager.library, {
    dashql_blob_stream_underflow: function(blobId, buf, size) {
        return global.WebDBTrampoline.dashql_blob_stream_underflow(blobId, buf, size);
    },
    dashql_webdb_fs_read: function(blobId, buf, size) {
        return global.WebDBTrampoline.dashql_webdb_fs_read(blobId, buf, size);
    },
    dashql_webdb_fs_write: function(blobId, buf, size) {
        return global.WebDBTrampoline.dashql_webdb_fs_write(blobId, buf, size);
    },
    dashql_webdb_fs_directory_exists: function(path, pathLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_directory_exists(path, pathLen);
    },
    dashql_webdb_fs_directory_create: function(path, pathLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_directory_create(path, pathLen);
    },
    dashql_webdb_fs_directory_remove: function(path, pathLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_directory_remove(path, pathLen);
    },
    dashql_webdb_fs_directory_list_files: function(path, pathLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_directory_list_files(path, pathLen);
    },
    dashql_webdb_fs_glob: function(path, pathLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_glob(path, pathLen);
    },
    dashql_webdb_fs_file_open: function(path, pathLen, flags) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_open(path, pathLen, flags);
    },
    dashql_webdb_fs_file_close: function(blobId) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_close(blobId);
    },
    dashql_webdb_fs_file_get_size: function(blobId) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_get_size(blobId);
    },
    dashql_webdb_fs_file_get_last_modified_time: function(blobId) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_get_last_modified_time(blobId);
    },
    dashql_webdb_fs_file_move: function(from, fromLen, to, toLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_move(from, fromLen, to, toLen);
    },
    dashql_webdb_fs_file_set_pointer: function(blobId, pos) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_set_pointer(blobId, pos);
    },
    dashql_webdb_fs_file_exists: function(path, pathLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_exists(path, pathLen);
    },
    dashql_webdb_fs_file_remove: function(path, pathLen) {
        return global.WebDBTrampoline.dashql_webdb_fs_file_remove(path, pathLen);
    },
});