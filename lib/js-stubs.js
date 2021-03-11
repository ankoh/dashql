mergeInto(LibraryManager.library, {
    dashql_blob_stream_underflow: function(blobId, buf, size) {
        var global =
            typeof global !== 'undefined' ?
            global :
            typeof self !== 'undefined' ?
            self :
            typeof window !== 'undefined' ?
            self :
            {};
        return global.WebDBTrampoline.dashql_blob_stream_underflow(blobId, buf, size);
    },
});