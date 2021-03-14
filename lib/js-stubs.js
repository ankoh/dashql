mergeInto(LibraryManager.library, {
    dashql_blob_stream_underflow: function(blobId, buf, size) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_blob_stream_underflow(blobId, buf, size);
    },
    dashql_webdb_fs_read: function(blobId, buf, size) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_read(blobId, buf, size);
    },
    dashql_webdb_fs_write: function(blobId, buf, size) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_write(blobId, buf, size);
    },
    dashql_webdb_fs_directory_exists: function(path) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_directory_exists(path);
    },
    dashql_webdb_fs_directory_create: function(path) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_directory_create(path);
    },
    dashql_webdb_fs_directory_remove: function(path) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            self :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_directory_remove(path);
    },
    dashql_webdb_fs_directory_list_files: function(path) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_directory_list_files(path);
    },
    dashql_webdb_fs_file_open: function(path, flags) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_open(path, flags);
    },
    dashql_webdb_fs_file_close: function(blobId) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_close(blobId);
    },
    dashql_webdb_fs_file_get_size: function(blobId) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_get_size(blobId);
    },
    dashql_webdb_fs_file_get_last_modified_time: function(blobId) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_get_last_modified_time(blobId);
    },
    dashql_webdb_fs_file_move: function(path_from, path_to) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_move(path_from, path_to);
    },
    dashql_webdb_fs_file_set_pointer: function(blobId, pos) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_set_pointer(blobId, pos);
    },
    dashql_webdb_fs_file_exists: function(path) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_exists(path);
    },
    dashql_webdb_fs_file_remove: function(path) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            window :
            {};
        return global.WebDBTrampoline.dashql_webdb_fs_file_remove(path);
    },
});